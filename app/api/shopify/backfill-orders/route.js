// =====================================================================
// RS ZEVAR ERP — Shopify Orders Backfill Route
// File path: app/api/shopify/backfill-orders/route.js
//
// One-time (or rarely-run) endpoint to pull historical orders from Shopify
// that never made it into ERP. Skips existing orders by shopify_order_id,
// so re-running is SAFE (idempotent).
//
// Use case:
//   ERP was built recently, only has ~600 orders, but Shopify has 180
//   days of history. ABC classification needs that history to be accurate.
//
// Self-resuming:
//   If Vercel's 60s timeout hits mid-backfill, endpoint returns
//   { has_more: true, timed_out: true }. Just call it again — the skip
//   logic picks up from where it left off (duplicate shopify_order_id's
//   get filtered out, new ones get inserted).
//
// Endpoints:
//   POST /api/shopify/backfill-orders        → defaults to 180 days
//   POST /api/shopify/backfill-orders?days=365  → custom window
//   GET  /api/shopify/backfill-orders        → same as POST
// =====================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { transformOrder, transformLineItems } from '@/lib/shopify';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION    = '2024-01';

// Inline Shopify fetch (avoids circular deps + lets us tune params directly)
async function shopifyFetch(endpoint, params = {}) {
  const url = new URL(`https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }
  return res.json();
}

async function runBackfill(daysBack = 180, maxSeconds = 55) {
  const startTime = Date.now();
  const supabase  = createServerClient();

  const sinceDate = new Date(Date.now() - daysBack * 86400000).toISOString();

  // Running stats
  let pagesFetched     = 0;
  let ordersFetched    = 0;
  let ordersInserted   = 0;
  let ordersSkipped    = 0;
  let lineItemsInserted = 0;
  let errors           = [];

  let sinceId  = null;
  let hasMore  = true;
  let timedOut = false;

  while (hasMore) {
    // Check timeout budget (leave headroom for final response)
    if ((Date.now() - startTime) / 1000 > maxSeconds) {
      timedOut = true;
      break;
    }

    // Build page params
    const params = { limit: 250, status: 'any' };
    if (sinceId)           params.since_id       = sinceId;
    else                   params.created_at_min = sinceDate;

    // Fetch page
    const data   = await shopifyFetch('orders.json', params);
    const orders = data.orders || [];
    pagesFetched++;

    if (orders.length === 0) {
      hasMore = false;
      break;
    }
    ordersFetched += orders.length;

    // Skip logic: find which of these shopify_order_ids already exist in DB
    const shopifyIds = orders.map(o => String(o.id));
    const { data: existing, error: existErr } = await supabase
      .from('orders')
      .select('shopify_order_id')
      .in('shopify_order_id', shopifyIds);

    if (existErr) throw new Error(`Existing check failed: ${existErr.message}`);

    const existingSet = new Set((existing || []).map(r => r.shopify_order_id));
    const newOrders   = orders.filter(o => !existingSet.has(String(o.id)));
    ordersSkipped    += (orders.length - newOrders.length);

    // Insert new orders + their line items
    if (newOrders.length > 0) {
      // 1. Transform + insert orders, get back generated IDs
      const orderRows = newOrders.map(transformOrder);
      const { data: inserted, error: insertErr } = await supabase
        .from('orders')
        .insert(orderRows)
        .select('id, shopify_order_id');

      if (insertErr) {
        errors.push({ page: pagesFetched, stage: 'orders_insert', error: insertErr.message });
        // Advance pagination so we don't loop forever on same page
        sinceId = orders[orders.length - 1].id;
        hasMore = orders.length === 250;
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      ordersInserted += (inserted?.length || 0);

      // 2. Build shopify_order_id → db_id lookup
      const idMap = new Map();
      for (const row of inserted || []) {
        idMap.set(row.shopify_order_id, row.id);
      }

      // 3. Transform + insert line items with resolved order_id FK
      const allLineItems = [];
      for (const shopifyOrder of newOrders) {
        const dbOrderId = idMap.get(String(shopifyOrder.id));
        if (!dbOrderId) continue;
        const items = transformLineItems(shopifyOrder);
        for (const item of items) {
          allLineItems.push({ ...item, order_id: dbOrderId });
        }
      }

      if (allLineItems.length > 0) {
        // Batch insert line items (500 per batch)
        for (let i = 0; i < allLineItems.length; i += 500) {
          const batch = allLineItems.slice(i, i + 500);
          const { error: liErr } = await supabase.from('order_items').insert(batch);
          if (liErr) {
            errors.push({ page: pagesFetched, stage: 'line_items_insert', batch_start: i, error: liErr.message });
          } else {
            lineItemsInserted += batch.length;
          }
        }
      }
    }

    // Advance pagination (since_id based for reliability)
    sinceId = orders[orders.length - 1].id;
    hasMore = orders.length === 250;

    // Shopify rate limit: ~2 req/sec on standard plan. 500ms delay = safe.
    await new Promise(r => setTimeout(r, 500));
  }

  return {
    success: true,
    days_back: daysBack,
    since_date: sinceDate,
    pages_fetched: pagesFetched,
    orders_fetched: ordersFetched,
    orders_inserted: ordersInserted,
    orders_skipped: ordersSkipped,
    line_items_inserted: lineItemsInserted,
    errors: errors.length > 0 ? errors : undefined,
    timed_out: timedOut,
    has_more: timedOut || hasMore,
    next_action: timedOut
      ? '⏱️ Timed out — hit this endpoint again to resume (skip logic handles duplicates)'
      : (hasMore ? 'More data available' : '✅ Complete — now run /api/analytics/compute-abc'),
    duration_ms: Date.now() - startTime,
  };
}

// --------------------------------------------------------------
// POST / GET handlers
// --------------------------------------------------------------
async function handler(request) {
  try {
    const url  = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '180', 10);
    const result = await runBackfill(days);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[backfill-orders] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

export async function POST(request) { return handler(request); }
export async function GET(request)  { return handler(request); }
