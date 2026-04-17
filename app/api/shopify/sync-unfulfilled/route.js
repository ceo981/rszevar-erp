// ============================================================================
// RS ZEVAR ERP — Full Unfulfilled Sync
// POST /api/shopify/sync-unfulfilled
//
// Kya karta hai:
//   - Shopify se SARE unfulfilled open orders pull karta hai (koi date limit nahi)
//   - Saath mein last 30 din ke fulfilled orders bhi (reference ke liye)
//   - Transform + upsert to orders + order_items + customers
//
// Normal sync se farak:
//   Normal sync date-based hoti hai (last 3-10 din).
//   Ye sync unfulfilled orders ke liye date-less hai — sab pull.
//
// Use case:
//   Nuclear-reset ke baad fresh data lana — staff tomorrow fresh protocol
//   se kaam shuru kare sab in-flight orders pe.
//
// Ye ek-time route hai. Kaam ho jaaye to is folder ko delete kar dena.
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { transformOrder, transformLineItems } from '../../../../lib/shopify';

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

// ── Shopify REST fetch helper ─────────────────────────────────────────
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
    throw new Error(`Shopify API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const linkHeader = res.headers.get('link') || '';
  const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  const nextPageInfo = nextMatch ? new URL(nextMatch[1]).searchParams.get('page_info') : null;

  return { data, nextPageInfo };
}

// ── Paginated fetch ───────────────────────────────────────────────────
async function fetchAllPages(endpoint, initialParams, maxPages = 20) {
  const allOrders = [];
  let params = { ...initialParams };
  let pageCount = 0;

  while (pageCount < maxPages) {
    const { data, nextPageInfo } = await shopifyFetch(endpoint, params);
    const orders = data.orders || [];
    allOrders.push(...orders);
    pageCount++;

    if (!nextPageInfo) break;
    // Subsequent pages: only page_info + limit allowed
    params = { page_info: nextPageInfo, limit: 250 };
  }

  return allOrders;
}

// ── Main handler ──────────────────────────────────────────────────────
export async function POST(request) {
  const startTime = Date.now();

  try {
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return NextResponse.json({
        success: false,
        error: 'Shopify env vars missing (SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN)',
      }, { status: 500 });
    }

    // ── Step 1: Unfulfilled orders (no date limit) ──
    const unfulfilledOrders = await fetchAllPages('orders.json', {
      status: 'open',
      fulfillment_status: 'unfulfilled',
      limit: 250,
    });

    // ── Step 2: Last 30 days fulfilled (reference) ──
    const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const fulfilledOrders = await fetchAllPages('orders.json', {
      status: 'any',
      fulfillment_status: 'shipped', // fulfilled
      created_at_min: cutoff30,
      limit: 250,
    });

    // ── Dedupe by shopify id ──
    const allMap = new Map();
    [...unfulfilledOrders, ...fulfilledOrders].forEach(o => allMap.set(String(o.id), o));
    const uniqueOrders = Array.from(allMap.values());

    if (uniqueOrders.length === 0) {
      return NextResponse.json({
        success: true,
        unfulfilled_fetched: 0,
        fulfilled_fetched: 0,
        total_fetched: 0,
        synced: 0,
        duration_ms: Date.now() - startTime,
        message: 'Koi order nahi mila Shopify pe',
      });
    }

    // ── Step 3: Transform orders (async — reads settings + tag defs) ──
    const ordersToUpsert = [];
    const customersToUpsert = [];
    const seenCustomers = new Set();
    const transformErrors = [];

    for (const shopifyOrder of uniqueOrders) {
      try {
        const orderData = await transformOrder(shopifyOrder);
        ordersToUpsert.push(orderData);

        if (shopifyOrder.customer && !seenCustomers.has(shopifyOrder.customer.id)) {
          seenCustomers.add(shopifyOrder.customer.id);
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

    // ── Step 4: Upsert orders ──
    const { data: upsertedOrders, error: upsertError } = await supabase
      .from('orders')
      .upsert(ordersToUpsert, { onConflict: 'shopify_order_id' })
      .select('id, shopify_order_id');

    if (upsertError) {
      return NextResponse.json({
        success: false,
        error: `Upsert error: ${upsertError.message}`,
        debug: { transform_errors: transformErrors.slice(0, 3) },
      }, { status: 500 });
    }

    const synced = upsertedOrders?.length || 0;

    // Build map of shopify_order_id → db id
    const orderIdMap = new Map();
    (upsertedOrders || []).forEach(o => orderIdMap.set(o.shopify_order_id, o.id));

    // ── Step 5: Insert line items ──
    // Pre-fetch SKU → image_url map
    let skuImageMap = {};
    try {
      const { data: productImages } = await supabase
        .from('products')
        .select('sku, image_url')
        .not('sku', 'is', null)
        .not('image_url', 'is', null);
      for (const p of productImages || []) {
        if (p.sku && p.image_url && !skuImageMap[p.sku]) {
          skuImageMap[p.sku] = p.image_url;
        }
      }
    } catch {}

    let itemsInserted = 0;
    const allItems = [];
    for (const shopifyOrder of uniqueOrders) {
      const dbId = orderIdMap.get(String(shopifyOrder.id));
      if (!dbId) continue;
      const items = transformLineItems(shopifyOrder, skuImageMap).map(i => ({ ...i, order_id: dbId }));
      allItems.push(...items);
    }

    if (allItems.length > 0) {
      const { error: itemsError } = await supabase.from('order_items').insert(allItems);
      if (!itemsError) itemsInserted = allItems.length;
      else console.warn('Items insert error:', itemsError.message);
    }

    // ── Step 6: Upsert customers ──
    if (customersToUpsert.length > 0) {
      await supabase.from('customers').upsert(customersToUpsert, { onConflict: 'shopify_customer_id' });
    }

    return NextResponse.json({
      success: true,
      unfulfilled_fetched: unfulfilledOrders.length,
      fulfilled_fetched: fulfilledOrders.length,
      total_fetched: uniqueOrders.length,
      synced,
      items_inserted: itemsInserted,
      customers_synced: customersToUpsert.length,
      transform_errors: transformErrors.length > 0 ? transformErrors.slice(0, 5) : undefined,
      duration_ms: Date.now() - startTime,
      message: `✅ ${synced} orders synced (${unfulfilledOrders.length} unfulfilled + ${fulfilledOrders.length} recent fulfilled) in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
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
  return NextResponse.json({
    success: true,
    message: 'POST karo — body zaroori nahi. Ye ek-time route hai, kaam ke baad delete kar dena.',
  });
}
