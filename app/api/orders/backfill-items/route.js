import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!domain || !token) {
      return NextResponse.json({ success: false, error: 'Shopify credentials missing' });
    }

    // 1. Find orders that have NO items in order_items
    const { data: allOrders } = await supabase
      .from('orders')
      .select('id, order_number, shopify_order_id')
      .not('shopify_order_id', 'is', null);

    const { data: ordersWithItems } = await supabase
      .from('order_items')
      .select('order_id');

    const withItemsSet = new Set((ordersWithItems || []).map(o => o.order_id));
    const missingOrders = (allOrders || []).filter(o => !withItemsSet.has(o.id));

    console.log(`[backfill] Found ${missingOrders.length} orders missing items`);

    if (missingOrders.length === 0) {
      return NextResponse.json({ success: true, message: 'All orders already have items!', synced: 0 });
    }

    let synced = 0;
    let failed = 0;

    // 2. Process in batches of 10
    const BATCH = 10;
    for (let i = 0; i < missingOrders.length; i += BATCH) {
      const batch = missingOrders.slice(i, i + BATCH);

      await Promise.all(batch.map(async (order) => {
        try {
          const res = await fetch(
            `https://${domain}/admin/api/2024-01/orders/${order.shopify_order_id}.json?fields=id,line_items`,
            { headers: { 'X-Shopify-Access-Token': token } }
          );

          if (!res.ok) { failed++; return; }

          const { order: shopifyOrder } = await res.json();
          const lineItems = shopifyOrder?.line_items || [];

          if (lineItems.length === 0) { return; }

          const items = lineItems.map(item => ({
            order_id: order.id,
            shopify_line_item_id: String(item.id),
            title: item.title || '',
            sku: item.sku || '',
            quantity: item.quantity || 1,
            unit_price: parseFloat(item.price || 0),
            total_price: parseFloat(item.price || 0) * (item.quantity || 1),
            created_at: new Date().toISOString(),
          }));

          const { error } = await supabase
            .from('order_items')
            .upsert(items, { onConflict: 'order_id,shopify_line_item_id', ignoreDuplicates: true });

          if (!error) synced++;
          else { console.error(`[backfill] Error for ${order.order_number}:`, error.message); failed++; }

        } catch (e) {
          console.error(`[backfill] Failed ${order.order_number}:`, e.message);
          failed++;
        }
      }));

      // Small delay between batches
      if (i + BATCH < missingOrders.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    return NextResponse.json({
      success: true,
      total_missing: missingOrders.length,
      synced,
      failed,
      message: `✅ ${synced} orders synced | ❌ ${failed} failed`,
    });

  } catch (e) {
    console.error('[backfill] Error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
