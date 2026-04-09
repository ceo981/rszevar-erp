// =====================================================================
// RS ZEVAR ERP — ABC Classification Compute Route
// File path: app/api/analytics/compute-abc/route.js
//
// What it does:
//   Computes dual-window (90d + 180d) ABC classification for all product
//   variants based on order history. Runs daily via Vercel cron, but can
//   also be triggered manually by hitting the endpoint.
//
// Flow:
//   1. Reset all active products → Class D, revenue/units = 0
//   2. Fetch delivered + dispatched orders from last 180 days
//   3. Fetch line items for those orders (chunked)
//   4. Aggregate revenue + units per SKU for both 90d and 180d windows
//   5. Sort by revenue desc, assign A (≤80% cumulative), B (≤95%), C (rest)
//   6. Bulk-update products table via RPC
//
// Endpoints:
//   POST /api/analytics/compute-abc   (manual trigger from UI button)
//   GET  /api/analytics/compute-abc   (Vercel cron hits this)
// =====================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function runCompute() {
  const startTime = Date.now();
  const supabase = createServerClient();

  // ----- Time windows -----
  const now = Date.now();
  const DAY_MS = 86400000;
  const cutoff180Date = new Date(now - 180 * DAY_MS);
  const cutoff90Date  = new Date(now - 90  * DAY_MS);
  const cutoff180 = cutoff180Date.toISOString();
  const cutoff90  = cutoff90Date.toISOString();

  // ----- Step 1: Reset all active products to D/0 -----
  const { data: resetCount, error: resetErr } = await supabase
    .rpc('reset_abc_stats');
  if (resetErr) throw new Error(`reset_abc_stats RPC failed: ${resetErr.message}`);

  // ----- Step 2: Fetch eligible orders (paginated) -----
  const orders = [];
  let pageFrom = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, created_at')
      .in('status', ['delivered', 'dispatched'])
      .gte('created_at', cutoff180)
      .range(pageFrom, pageFrom + pageSize - 1);
    if (error) throw new Error(`orders fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    orders.push(...data);
    if (data.length < pageSize) break;
    pageFrom += pageSize;
  }

  if (orders.length === 0) {
    return {
      success: true,
      message: 'No delivered/dispatched orders in last 180 days — nothing to compute',
      reset_count: resetCount,
      orders_processed: 0,
      duration_ms: Date.now() - startTime,
    };
  }

  // orderId → createdAt lookup
  const orderDates = new Map();
  for (const o of orders) orderDates.set(o.id, o.created_at);

  // ----- Step 3: Fetch line items (chunked by order_id IN clause) -----
  const orderIds = orders.map(o => o.id);
  const lineItems = [];
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from('order_items')
      .select('order_id, sku, quantity, total_price')
      .in('order_id', chunk);
    if (error) throw new Error(`order_items fetch failed at chunk ${i}: ${error.message}`);
    lineItems.push(...(data || []));
  }

  // ----- Step 4: Aggregate per SKU -----
  // stats[normalizedSku] = {
  //   sku_raw, revenue_90, revenue_180, units_90, units_180, last_sold_at
  // }
  const stats = {};
  for (const item of lineItems) {
    if (!item.sku) continue;
    const skuNorm = item.sku.trim().toUpperCase();
    if (!skuNorm) continue;

    const createdAt = orderDates.get(item.order_id);
    if (!createdAt) continue;

    const qty     = parseInt(item.quantity || 0, 10);
    const revenue = parseFloat(item.total_price || 0);

    if (!stats[skuNorm]) {
      stats[skuNorm] = {
        sku_raw: item.sku,
        revenue_90: 0,
        revenue_180: 0,
        units_90: 0,
        units_180: 0,
        last_sold_at: createdAt,
      };
    }

    // 180d bucket (all fetched orders qualify)
    stats[skuNorm].revenue_180 += revenue;
    stats[skuNorm].units_180   += qty;

    // 90d bucket
    if (new Date(createdAt) >= cutoff90Date) {
      stats[skuNorm].revenue_90 += revenue;
      stats[skuNorm].units_90   += qty;
    }

    // Track latest sale date
    if (createdAt > stats[skuNorm].last_sold_at) {
      stats[skuNorm].last_sold_at = createdAt;
    }
  }

  // ----- Step 5: Classify A/B/C per window -----
  const classify = (revenueKey) => {
    const entries = Object.entries(stats)
      .map(([sku, s]) => ({ sku, revenue: s[revenueKey] }))
      .filter(x => x.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);

    const total = entries.reduce((sum, x) => sum + x.revenue, 0);
    const classes = {};
    if (total === 0) return classes;

    let cumulative = 0;
    for (const e of entries) {
      cumulative += e.revenue;
      const pct = (cumulative / total) * 100;
      if      (pct <= 80) classes[e.sku] = 'A';
      else if (pct <= 95) classes[e.sku] = 'B';
      else                classes[e.sku] = 'C';
    }
    return classes;
  };

  const abc90  = classify('revenue_90');
  const abc180 = classify('revenue_180');

  // ----- Step 6: Build update payload + bulk apply -----
  const updates = Object.entries(stats).map(([skuNorm, s]) => ({
    sku: s.sku_raw,
    abc_90d:         abc90[skuNorm]  || 'D',
    abc_180d:        abc180[skuNorm] || 'D',
    revenue_90d:     Math.round(s.revenue_90 * 100) / 100,
    revenue_180d:    Math.round(s.revenue_180 * 100) / 100,
    units_sold_90d:  s.units_90,
    units_sold_180d: s.units_180,
    last_sold_at:    s.last_sold_at,
  }));

  // Send in chunks of 500 to keep RPC payloads reasonable
  let totalUpdated = 0;
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    const { data: updated, error } = await supabase
      .rpc('bulk_update_abc', { updates: batch });
    if (error) throw new Error(`bulk_update_abc failed at batch ${i}: ${error.message}`);
    totalUpdated += (updated || 0);
  }

  // ----- Distribution summary -----
  const countBy = (classes) => ({
    A: Object.values(classes).filter(c => c === 'A').length,
    B: Object.values(classes).filter(c => c === 'B').length,
    C: Object.values(classes).filter(c => c === 'C').length,
  });

  return {
    success: true,
    duration_ms: Date.now() - startTime,
    orders_processed: orders.length,
    line_items_processed: lineItems.length,
    unique_skus_with_sales: Object.keys(stats).length,
    variants_reset: resetCount,
    variants_updated: totalUpdated,
    unmatched_skus: Object.keys(stats).length - totalUpdated,
    distribution_90d: countBy(abc90),
    distribution_180d: countBy(abc180),
    windows: {
      cutoff_90d: cutoff90,
      cutoff_180d: cutoff180,
    },
  };
}

// --------------------------------------------------------------
// POST handler — manual trigger (from UI button, curl, Postman)
// --------------------------------------------------------------
export async function POST() {
  try {
    const result = await runCompute();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[compute-abc] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// --------------------------------------------------------------
// GET handler — Vercel cron hits this
// --------------------------------------------------------------
export async function GET() {
  try {
    const result = await runCompute();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[compute-abc cron] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
