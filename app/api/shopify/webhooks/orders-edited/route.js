// ============================================================================
// RS ZEVAR ERP — Shopify orders/edited webhook
// POST /api/shopify/webhooks/orders-edited
// ----------------------------------------------------------------------------
// Fires whenever an order is edited via the Order Editing API — whether from
// RS ZEVAR ERP itself OR directly from Shopify Admin. Keeps ERP line items
// and totals in sync with Shopify truth.
//
// Safety net: our own /api/orders/edit-commit route also syncs inline, but
// this webhook catches:
//   - External edits done in Shopify Admin directly
//   - Any case where our inline sync failed silently
//
// HMAC verified. Idempotent (delete-then-insert line items).
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyShopifyWebhook } from '@/lib/shopify-webhook';
import { transformLineItems } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export async function POST(request) {
  const rawBody = await request.text();
  const hmac = request.headers.get('x-shopify-hmac-sha256');

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  let so;
  try { so = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  try {
    const shopifyOrderId = String(so.id);
    if (!shopifyOrderId) {
      return NextResponse.json({ received: true, skipped: 'no id' });
    }

    // Find matching ERP order
    const { data: order } = await supabase
      .from('orders')
      .select('id, order_number, total_amount')
      .eq('shopify_order_id', shopifyOrderId)
      .maybeSingle();

    if (!order) {
      // Not an order we track — acknowledge and move on
      console.log(`[webhook:orders/edited] Order ${shopifyOrderId} not in ERP — skipping`);
      return NextResponse.json({ received: true, skipped: 'not in ERP' });
    }

    // Pre-fetch SKU → image map for line item enrichment
    let skuImageMap = {};
    try {
      const { data: productImages } = await supabase
        .from('products')
        .select('sku, image_url')
        .not('sku', 'is', null)
        .not('image_url', 'is', null);
      for (const p of productImages || []) {
        if (p.sku && p.image_url && !skuImageMap[p.sku]) skuImageMap[p.sku] = p.image_url;
      }
    } catch {}

    // Compute totals from webhook payload
    const subtotal = parseFloat(so.subtotal_price || so.current_subtotal_price || 0);
    const shippingFee = parseFloat(
      (so.shipping_lines || []).reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0),
    );
    const discount = parseFloat(so.total_discounts || so.current_total_discounts || 0);
    const total = parseFloat(so.total_price || so.current_total_price || 0);

    // Replace order_items with Shopify truth
    const newItems = transformLineItems(so, skuImageMap).map(i => ({
      ...i,
      order_id: order.id,
    }));

    await supabase.from('order_items').delete().eq('order_id', order.id);
    if (newItems.length > 0) {
      const { error: insErr } = await supabase.from('order_items').insert(newItems);
      if (insErr) {
        console.error('[webhook:orders/edited] line items insert:', insErr.message);
      }
    }

    // Update orders table totals
    await supabase.from('orders').update({
      subtotal,
      shipping_fee: shippingFee,
      discount,
      total_amount: total,
      updated_at: new Date().toISOString(),
      shopify_synced_at: new Date().toISOString(),
    }).eq('id', order.id);

    // Activity log — webhook-driven entry. Safe to insert even if ERP-initiated
    // edit already logged, because this has a distinct action name.
    const totalChanged = Math.abs(total - parseFloat(order.total_amount || 0)) > 0.01;
    await supabase.from('order_activity_log').insert({
      order_id: order.id,
      action: 'shopify_order_edited_webhook',
      notes: `Shopify order edit synced. ${newItems.length} items. ` +
        (totalChanged
          ? `Total: Rs ${total.toLocaleString('en-PK')} (was Rs ${parseFloat(order.total_amount || 0).toLocaleString('en-PK')})`
          : 'Totals unchanged.'),
      performed_by: 'Shopify webhook',
      performed_at: new Date().toISOString(),
    });

    console.log(`[webhook:orders/edited] Synced ${order.order_number}: ${newItems.length} items, total Rs ${total}`);

    return NextResponse.json({ received: true, order_number: order.order_number, items: newItems.length, total });
  } catch (e) {
    console.error('[webhook:orders/edited] error:', e.message);
    // Return 200 so Shopify doesn't retry aggressively — we've logged it
    return NextResponse.json({ received: true, error: e.message });
  }
}
