import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchAllOrdersSince, transformOrder, transformLineItems } from '@/lib/shopify';

export async function POST(request) {
  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));

    // Default: sync last 30 days
    const sinceDate = body.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Fetch orders from Shopify
    const shopifyOrders = await fetchAllOrdersSince(sinceDate);

    if (shopifyOrders.length === 0) {
      return NextResponse.json({ success: true, message: 'No new orders found', synced: 0 });
    }

    let synced = 0;
    let skipped = 0;
    let errors = [];

    for (const shopifyOrder of shopifyOrders) {
      try {
        const orderData = transformOrder(shopifyOrder);
        const lineItems = transformLineItems(shopifyOrder);

        // Upsert order (update if exists, insert if new)
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .upsert(orderData, { onConflict: 'shopify_order_id' })
          .select('id')
          .single();

        if (orderError) {
          errors.push({ order: orderData.order_number, error: orderError.message });
          continue;
        }

        // Upsert customer
        if (shopifyOrder.customer) {
          const customer = shopifyOrder.customer;
          await supabase.from('customers').upsert({
            shopify_customer_id: String(customer.id),
            name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
            phone: customer.phone || null,
            email: customer.email || null,
            city: shopifyOrder.shipping_address?.city || null,
            address: shopifyOrder.shipping_address?.address1 || null,
          }, { onConflict: 'shopify_customer_id' });
        }

        // Insert line items (delete old ones first to avoid duplicates)
        if (order?.id && lineItems.length > 0) {
          await supabase.from('order_items').delete().eq('order_id', order.id);
          await supabase.from('order_items').insert(
            lineItems.map(item => ({ ...item, order_id: order.id }))
          );
        }

        synced++;
      } catch (e) {
        errors.push({ order: shopifyOrder.name, error: e.message });
      }
    }

    skipped = shopifyOrders.length - synced - errors.length;

    return NextResponse.json({
      success: true,
      total_fetched: shopifyOrders.length,
      synced,
      skipped,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      message: `${synced} orders synced from Shopify`
    });

  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// GET - check sync status
export async function GET() {
  try {
    const supabase = createServerClient();

    const { count: totalOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    const { data: lastSynced } = await supabase
      .from('orders')
      .select('shopify_synced_at, order_number')
      .not('shopify_synced_at', 'is', null)
      .order('shopify_synced_at', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      success: true,
      total_orders: totalOrders || 0,
      last_synced: lastSynced?.shopify_synced_at || null,
      last_order: lastSynced?.order_number || null,
    });

  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
