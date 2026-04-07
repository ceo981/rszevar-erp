import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchAllOrdersSince, transformOrder, transformLineItems } from '@/lib/shopify';

const LOCKED_STATUSES = ['delivered', 'returned', 'rto', 'cancelled', 'refunded'];

export async function POST(request) {
  const startTime = Date.now();
  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));

    // Default: sync last 3 days (fast)
    // Client can override: { days: 7 } or { days: 30 } or { since: 'ISO_DATE' }
    const days = body.days || 3;
    const sinceDate = body.since || new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // 1. Fetch orders from Shopify
    const shopifyOrders = await fetchAllOrdersSince(sinceDate);

    if (shopifyOrders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No new orders found',
        synced: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    // 2. BATCH FETCH existing orders (1 query instead of N)
    const shopifyOrderIds = shopifyOrders.map(o => String(o.id));
    const { data: existingOrders } = await supabase
      .from('orders')
      .select('id, shopify_order_id, status, payment_status')
      .in('shopify_order_id', shopifyOrderIds);

    const existingMap = new Map();
    (existingOrders || []).forEach(o => existingMap.set(o.shopify_order_id, o));

    // 3. Transform + apply locked status rules
    const ordersToUpsert = [];
    const customersToUpsert = [];
    const customerIdsSeen = new Set();
    const errors = [];

    for (const shopifyOrder of shopifyOrders) {
      try {
        const orderData = transformOrder(shopifyOrder);
        const existing = existingMap.get(orderData.shopify_order_id);

        if (existing) {
          if (LOCKED_STATUSES.includes(existing.status)) {
            delete orderData.status;
          }
          if (existing.payment_status === 'paid' && orderData.payment_status === 'unpaid') {
            delete orderData.payment_status;
          }
          if (existing.payment_status === 'refunded') {
            delete orderData.payment_status;
          }
        }

        ordersToUpsert.push(orderData);

        // Unique customers
        if (shopifyOrder.customer && !customerIdsSeen.has(shopifyOrder.customer.id)) {
          customerIdsSeen.add(shopifyOrder.customer.id);
          const c = shopifyOrder.customer;
          customersToUpsert.push({
            shopify_customer_id: String(c.id),
            name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown',
            phone: c.phone || null,
            email: c.email || null,
            city: shopifyOrder.shipping_address?.city || null,
            address: shopifyOrder.shipping_address?.address1 || null,
          });
        }
      } catch (e) {
        errors.push({ order: shopifyOrder.name, error: e.message });
      }
    }

    // 4. BATCH UPSERT orders (1 query instead of N)
    let synced = 0;
    let upsertedOrders = [];
    if (ordersToUpsert.length > 0) {
      const { data, error: upsertError } = await supabase
        .from('orders')
        .upsert(ordersToUpsert, { onConflict: 'shopify_order_id' })
        .select('id, shopify_order_id');

      if (upsertError) {
        return NextResponse.json({
          success: false,
          error: `Batch upsert failed: ${upsertError.message}`,
          duration_ms: Date.now() - startTime,
        }, { status: 500 });
      }
      upsertedOrders = data || [];
      synced = upsertedOrders.length;
    }

    // 5. BATCH UPSERT customers in parallel
    const customerPromise = customersToUpsert.length > 0
      ? supabase.from('customers').upsert(customersToUpsert, { onConflict: 'shopify_customer_id' })
      : Promise.resolve();

    // 6. LINE ITEMS: only for NEW orders (existing ones rarely change items)
    const newOrdersMap = new Map();
    upsertedOrders.forEach(o => {
      if (!existingMap.has(o.shopify_order_id)) {
        newOrdersMap.set(o.shopify_order_id, o.id);
      }
    });

    const itemsPromise = (async () => {
      if (newOrdersMap.size === 0) return;
      const allItems = [];
      for (const shopifyOrder of shopifyOrders) {
        const dbId = newOrdersMap.get(String(shopifyOrder.id));
        if (!dbId) continue;
        const items = transformLineItems(shopifyOrder).map(i => ({ ...i, order_id: dbId }));
        allItems.push(...items);
      }
      if (allItems.length > 0) {
        await supabase.from('order_items').insert(allItems);
      }
    })();

    // Wait for both parallel operations
    await Promise.all([customerPromise, itemsPromise]);

    return NextResponse.json({
      success: true,
      total_fetched: shopifyOrders.length,
      synced,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      duration_ms: Date.now() - startTime,
      message: `${synced} orders synced in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    });

  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        duration_ms: Date.now() - startTime,
      },
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
      .maybeSingle();

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
