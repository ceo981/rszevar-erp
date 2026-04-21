import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// Related Products — batch generator + stats
// GET  → progress stats (total / done / pending counts)
// POST → process next N products that don't have related_products yet
//        Body: { batch_size: 15, concurrency: 3 }
// Calls generate-one internally for each product.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_BATCH = 15;
const DEFAULT_CONCURRENCY = 3;

// Run async fn over an array with a concurrency cap.
async function runWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = { success: false, error: e.message };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function getBaseUrl(request) {
  // Prefer VERCEL_URL when deployed, fall back to request origin in dev
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host');
  return `${proto}://${host}`;
}

export async function GET() {
  try {
    const supabase = createServerClient();

    // Pull all (shopify_product_id, related_products) — paginate
    const all = [];
    const PAGE = 1000;
    let off = 0;
    while (off < 10000) {
      const { data, error } = await supabase
        .from('products')
        .select('shopify_product_id, related_products, is_active, stock_quantity')
        .not('shopify_product_id', 'is', null)
        .range(off, off + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      off += PAGE;
    }

    // Distinct products
    const seen = new Map();
    for (const r of all) {
      if (!seen.has(r.shopify_product_id)) seen.set(r.shopify_product_id, r);
    }

    let total = 0;
    let withRelated = 0;
    let activeInStock = 0;
    let pending = 0;
    let totalCostUsd = 0;
    for (const r of seen.values()) {
      total++;
      const isEligible = r.is_active && (r.stock_quantity || 0) > 0;
      if (isEligible) activeInStock++;
      const rp = r.related_products;
      const hasPicks = rp && Array.isArray(rp.picks) && rp.picks.length > 0;
      if (hasPicks) {
        withRelated++;
        if (typeof rp.cost_usd === 'number') totalCostUsd += rp.cost_usd;
      } else if (isEligible) {
        pending++;
      }
    }

    return NextResponse.json({
      success: true,
      total_products: total,
      eligible_products: activeInStock,
      with_related: withRelated,
      pending: pending,
      progress_pct: activeInStock > 0 ? Math.round((withRelated / activeInStock) * 100) : 0,
      total_cost_usd_so_far: Number(totalCostUsd.toFixed(4)),
    });
  } catch (err) {
    console.error('[related-products batch GET]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const startTime = Date.now();
  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));
    const batchSize  = Math.min(Math.max(parseInt(body.batch_size) || DEFAULT_BATCH, 1), 30);
    const concurrency = Math.min(Math.max(parseInt(body.concurrency) || DEFAULT_CONCURRENCY, 1), 5);

    // ── Step 1: Find pending products (active, in-stock, no related_products) ──
    const all = [];
    const PAGE = 1000;
    let off = 0;
    while (off < 10000) {
      const { data, error } = await supabase
        .from('products')
        .select('shopify_product_id, parent_title, related_products, is_active, stock_quantity')
        .not('shopify_product_id', 'is', null)
        .eq('is_active', true)
        .gt('stock_quantity', 0)
        .range(off, off + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      off += PAGE;
    }

    const seen = new Map();
    for (const r of all) {
      if (!seen.has(r.shopify_product_id)) seen.set(r.shopify_product_id, r);
    }

    const pending = Array.from(seen.values()).filter(r => {
      const rp = r.related_products;
      const hasPicks = rp && Array.isArray(rp.picks) && rp.picks.length > 0;
      return !hasPicks;
    });

    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All eligible products already have related_products generated.',
        processed: 0,
        remaining: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    const batch = pending.slice(0, batchSize);

    // ── Step 2: Process batch with concurrency cap ──
    const baseUrl = getBaseUrl(request);

    const results = await runWithConcurrency(batch, concurrency, async (p) => {
      const res = await fetch(`${baseUrl}/api/products/related/generate-one`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopify_product_id: p.shopify_product_id }),
      });
      const json = await res.json().catch(() => ({ success: false, error: 'Invalid JSON' }));
      return {
        shopify_product_id: p.shopify_product_id,
        title: p.parent_title,
        success: json.success === true,
        ai_used: json.ai_used || false,
        picks_count: json.picks?.length || 0,
        cost_usd: json.cost_usd || 0,
        error: json.error || null,
      };
    });

    const ok = results.filter(r => r.success).length;
    const fail = results.filter(r => !r.success).length;
    const totalCost = results.reduce((s, r) => s + (r.cost_usd || 0), 0);
    const aiCalls = results.filter(r => r.ai_used).length;

    return NextResponse.json({
      success: true,
      processed: ok,
      failed: fail,
      ai_calls: aiCalls,
      remaining: pending.length - batch.length,
      batch_cost_usd: Number(totalCost.toFixed(6)),
      batch_cost_pkr: Math.round(totalCost * 285),  // approx conversion
      duration_ms: Date.now() - startTime,
      results,
    });
  } catch (err) {
    console.error('[related-products batch POST]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
