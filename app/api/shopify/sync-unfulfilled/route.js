// ============================================================================
// RS ZEVAR ERP — Full Unfulfilled Sync
// POST /api/shopify/sync-unfulfilled
//
// Kya karta hai:
//   Shopify se SARE unfulfilled open orders pull karta hai (koi date limit nahi)
//   + last 30 din ke fulfilled orders bhi (reference ke liye)
//
// Kis cheez se alag hai normal sync se:
//   Normal sync: last N din (3-10 din)
//   Ye sync: koi date limit nahi, fulfillment_status se filter
//
// Flow:
//   1. Shopify se unfulfilled open orders fetch (sab, paginated)
//   2. Shopify se last 30 din ke fulfilled orders fetch (reference)
//   3. Dono merge karo, transform karo
//   4. Upsert karo orders + line_items + customers
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { transformOrder, transformLineItems } from '../../../../lib/shopify';
import { getSettings } from '../../../../lib/settings';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION    = '2024-01';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Shopify REST fetch ──────────────────────────────────────────
async function shopifyFetch(endpoint, params = {}) {
  const url = new URL(`https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  const res = await fetch(url.toString(), {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Fetch all unfulfilled open orders (no date limit) ───────────
async function fetchUnfulfilledOrders() {
  const allOrders = [];
  let sinceId = null;
  let page = 1;

  while (page <= 40) { // max 40 pages = 10,000 orders
    const params = {
      limit: 250,
      status: 'open',               // open = not cancelled/archived
      fulfillment_status: 'unfulfilled', // sirf unfulfilled
    };
    if (sinceId) params.since_id = sinceId;

    const data = await shopifyFetch('orders.json', params);
    const orders = data.orders || [];

    if (orders.length === 0) break;
    allOrders.push(...orders);
    sinceId = orders[orders.length - 1].id;
    if (orders.length < 250) break;
    page++;

    // Rate limit protection
    await new Promise(r => setTimeout(r, 250));
  }

  return allOrders;
}

// ── Fetch last 30 days fulfilled orders (for reference) ─────────
async function fetchRecentFulfilledOrders() {
  const allOrders = [];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let sinceId = null;
  let page = 1;

  while (page <= 20) {
    const params = {
      limit: 250,
      status: 'any',
      fulfillment_status: 'shipped', // fulfilled = shipped in Shopify
    };
    if (sinceId) params.since_id = sinceId;
    else params.created_at_min = since;

    const data = await shopifyFetch('orders.json', params);
    const orders = data.orders || [];

    if (orders.length === 0) break;
    allOrders.push(...orders);
    sinceId = orders[orders.length - 1].id;
    if (orders.length < 250) break;
    page++;

    await new Promise(r => setTimeout(r, 250));
  }

  return allOrders;
}

// ── Main handler ─────────────────────────────────────────────────
export async function POST(request) {
  const startTime = Date.now();
  const body = await request.json().catch(() => ({}));

  // What to fetch — default: unfulfilled only
  // body.include_fulfilled = true to also include recent fulfilled
  const includeFulfilled = body.include_fulfilled !== false; // default true

  try {
    // 1. Fetch from Shopify
    let shopifyOrders = await fetchUnfulfilledOrders();
    const unfulfilledCount = shopifyOrders.length;

    if (includeFulfilled) {
      const fulfilledOrders = await fetchRecentFulfilledOrders();
      shopifyOrders = [...shopifyOrders, ...fulfilledOrders];
    }

    if (shopifyOrders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Shopify pe koi unfulfilled order nahi mila',
        synced: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    // Deduplicate
    const dedupMap = new Map();
    for (const o of shopifyOrders) dedupMap.set(String(o.id), o);
    const uniqueOrders = Array.from(dedupMap.values());

    // 2. Transform all orders
    const ordersToUpsert = [];
    const transformErrors = [];
    const customersToUpsert = [];
    const customerIdsSeen = new Set();

    for (const shopifyOrder of uniqueOrders) {
      try {
        const orderData = await transformOrder(shopifyOrder);
        ordersToUpsert.push(orderData);

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
        transformErrors.push({ order: shopifyOrder.name, error: e.message });
      }
    }

    // 3. Upsert orders in batches
    let synced = 0;
    const upsertErrors = [];
    const upsertedOrders = [];

    for (let i = 0; i < ordersToUpsert.length; i += 100) {
      const batch = ordersToUpsert.slice(i, i + 100);
      const { data, error } = await supabase
        .from('orders')
        .upsert(batch, { onConflict: 'shopify_order_id' })
        .select('id, shopify_order_id');

      if (error) {
        upsertErrors.push({ batch: i, error: error.message });
      } else {
        synced += (data || []).length;
        upsertedOrders.push(...(data || []));
      }
    }

    // 4. Upsert customers
    if (customersToUpsert.length > 0) {
      await supabase
        .from('customers')
        .upsert(customersToUpsert, { onConflict: 'shopify_customer_id' });
    }

    // 5. Insert line items — all in one batch (fast, no per-order checks)
    // Build shopify_order_id → db_id map
    const orderIdMap = new Map();
    for (const o of upsertedOrders) orderIdMap.set(o.shopify_order_id, o.id);

    // SKU → image_url map for fallback
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
    } catch (e) { /* silent */ }

    // Build all items at once
    const allItems = [];
    for (const shopifyOrder of uniqueOrders) {
      const dbId = orderIdMap.get(String(shopifyOrder.id));
      if (!dbId) continue;
      const items = transformLineItems(shopifyOrder, skuImageMap).map(i => ({ ...i, order_id: dbId }));
      allItems.push(...items);
    }

    // Insert in batches of 500 — use upsert on shopify_line_item_id to avoid duplicates
    let itemsInserted = 0;
    if (allItems.length > 0) {
      for (let i = 0; i < allItems.length; i += 500) {
        const batch = allItems.slice(i, i + 500);
        const { error } = await supabase
          .from('order_items')
          .upsert(batch, { onConflict: 'shopify_line_item_id', ignoreDuplicates: true });
        if (!error) itemsInserted += batch.length;
      }
    }

    return NextResponse.json({
      success: true,
      unfulfilled_fetched: unfulfilledCount,
      fulfilled_fetched: includeFulfilled ? (uniqueOrders.length - unfulfilledCount) : 0,
      total_fetched: uniqueOrders.length,
      synced,
      items_inserted: itemsInserted,
      customers_synced: customersToUpsert.length,
      transform_errors: transformErrors.length > 0 ? transformErrors.slice(0, 5) : undefined,
      upsert_errors: upsertErrors.length > 0 ? upsertErrors.slice(0, 3) : undefined,
      duration_ms: Date.now() - startTime,
      message: `✅ ${synced} orders synced (${unfulfilledCount} unfulfilled + ${includeFulfilled ? uniqueOrders.length - unfulfilledCount : 0} recent fulfilled) in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    });

  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err.message,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}

export async function GET() {
  // Quick stats
  try {
    const { count: total } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    const { count: pending } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    return NextResponse.json({ success: true, total_orders: total || 0, pending });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
