// ============================================================================
// RS ZEVAR ERP — Sync Unfulfilled Only (v2 — leaner, no timeout)
// POST /api/shopify/sync-unfulfilled
//
// v2 changes:
//   - Sirf UNFULFILLED orders pull karta hai (fulfilled skip)
//   - Last 90 din ka cap (old stuck orders skip)
//   - Max 5 pages (250*5 = 1250 orders cap) — Vercel 60s timeout safe
//
// Use case:
//   Nuclear-reset ke baad fresh in-flight orders pull karna.
//   Fulfilled orders ki abhi zaroorat nahi — wo courier ke paas hain,
//   protocol pe koi asar nahi.
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

// ── Shopify REST fetch ───────────────────────────────────────────────
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
    throw new Error(`Shopify API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const linkHeader = res.headers.get('link') || '';
  const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  const nextPageInfo = nextMatch ? new URL(nextMatch[1]).searchParams.get('page_info') : null;

  return { data, nextPageInfo };
}

// ── Main handler ─────────────────────────────────────────────────────
export async function POST() {
  const startTime = Date.now();

  try {
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return NextResponse.json({
        success: false,
        error: 'Shopify env vars missing',
      }, { status: 500 });
    }

    // ── Step 1: Fetch unfulfilled orders (max 5 pages) ──
    const allOrders = [];
    let params = {
      status: 'open',
      fulfillment_status: 'unfulfilled',
      created_at_min: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      limit: 250,
    };

    const MAX_PAGES = 5;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, nextPageInfo } = await shopifyFetch('orders.json', params);
      const orders = data.orders || [];
      allOrders.push(...orders);
      if (!nextPageInfo || orders.length < 250) break;
      params = { page_info: nextPageInfo, limit: 250 };
    }

    if (allOrders.length === 0) {
      return NextResponse.json({
        success: true,
        total_fetched: 0,
        synced: 0,
        duration_ms: Date.now() - startTime,
        message: 'Koi unfulfilled order nahi mila Shopify pe',
      });
    }

    // ── Step 2: Transform (async — reads settings) ──
    const ordersToUpsert = [];
    const customersToUpsert = [];
    const seenCustomers = new Set();
    const transformErrors = [];

    for (const shopifyOrder of allOrders) {
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

    // ── Step 3: Upsert orders ──
    const { data: upsertedOrders, error: upsertError } = await supabase
      .from('orders')
      .upsert(ordersToUpsert, { onConflict: 'shopify_order_id' })
      .select('id, shopify_order_id');

    if (upsertError) {
      return NextResponse.json({
        success: false,
        error: `Upsert error: ${upsertError.message}`,
        transform_errors: transformErrors.slice(0, 3),
      }, { status: 500 });
    }

    const synced = upsertedOrders?.length || 0;
    const orderIdMap = new Map();
    (upsertedOrders || []).forEach(o => orderIdMap.set(o.shopify_order_id, o.id));

    // ── Step 4: Insert line items ──
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

    const allItems = [];
    for (const shopifyOrder of allOrders) {
      const dbId = orderIdMap.get(String(shopifyOrder.id));
      if (!dbId) continue;
      const items = transformLineItems(shopifyOrder, skuImageMap).map(i => ({ ...i, order_id: dbId }));
      allItems.push(...items);
    }

    let itemsInserted = 0;
    if (allItems.length > 0) {
      const { error: itemsError } = await supabase.from('order_items').insert(allItems);
      if (!itemsError) itemsInserted = allItems.length;
    }

    // ── Step 5: Upsert customers ──
    if (customersToUpsert.length > 0) {
      await supabase.from('customers').upsert(customersToUpsert, { onConflict: 'shopify_customer_id' });
    }

    return NextResponse.json({
      success: true,
      total_fetched: allOrders.length,
      synced,
      items_inserted: itemsInserted,
      customers_synced: customersToUpsert.length,
      transform_errors: transformErrors.length > 0 ? transformErrors.slice(0, 5) : undefined,
      duration_ms: Date.now() - startTime,
      message: `✅ ${synced} unfulfilled orders synced in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
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
    message: 'POST karo — ek-time route. Kaam ke baad delete kar dena.',
  });
}
