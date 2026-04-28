import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { calculateSeoScore } from '@/lib/seo-score';

// ============================================================================
// RS ZEVAR ERP — SEO Score Recompute (Phase C — chunked, Apr 28 2026)
// Route: POST /api/products/seo-score/recompute
// ----------------------------------------------------------------------------
// MODES (POST body discriminator)
//   { shopify_product_id: "..." }     → single product (UI per-product action)
//   { action: "list" }                 → return all distinct product IDs
//                                        (frontend uses this to plan chunks)
//   { product_ids: [...] }             → score + update THESE products only
//                                        (max 100 per call, fits in 60s easily)
//
// WHY CHUNKED?
//   First version tried bulk-all-in-one — fetched 5300 variant rows including
//   heavy description_html/images_data (~50MB transfer), then 80+ sequential
//   UPDATE calls. Hit Vercel 60s function timeout (504 Gateway Timeout).
//
//   New design: client orchestrates, server handles 100-product chunks.
//   Each chunk: ~5MB fetch + 5-10 update calls = 3-8s. Comfortable.
//   Total time visible to user with live progress bar.
//
// SCORE PROPAGATION
//   Each Shopify product has multiple variant rows in our DB; all variants of
//   same product share product-level data (description, tags, meta, images).
//   We compute score from FIRST variant row (representative) and write same
//   score to ALL variants of that product via .in('shopify_product_id', ...).
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── GET: tier distribution snapshot (unchanged) ────────────────────────────
export async function GET() {
  try {
    const supabase = createServerClient();

    const all = [];
    const PAGE = 1000;
    let off = 0;
    while (off < 10000) {
      const { data, error } = await supabase
        .from('products')
        .select('shopify_product_id, seo_tier, seo_score')
        .not('shopify_product_id', 'is', null)
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

    const distribution = { green: 0, yellow: 0, red: 0, none: 0 };
    let scoreSum = 0;
    let scored = 0;
    for (const r of seen.values()) {
      const tier = r.seo_tier || 'none';
      if (distribution[tier] !== undefined) distribution[tier]++;
      if (r.seo_score !== null && r.seo_score !== undefined) {
        scoreSum += r.seo_score;
        scored++;
      }
    }

    return NextResponse.json({
      success: true,
      total_products: seen.size,
      distribution,
      avg_score: scored ? Math.round(scoreSum / scored) : 0,
    });
  } catch (err) {
    console.error('[seo-score GET]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ── Helper: fetch product rows for given product IDs ──────────────────────
async function fetchProductRows(supabase, productIds) {
  // Single query — for ≤100 product IDs this gets ~400-500 variant rows.
  const { data, error } = await supabase
    .from('products')
    .select('id, shopify_product_id, parent_title, description_html, tags, handle, seo_meta_title, seo_meta_description, images_data')
    .in('shopify_product_id', productIds);
  if (error) throw error;
  return data || [];
}

function pickRepresentativePerProduct(rows) {
  // First-seen variant row per product is enough — variants share product-level data
  const seen = new Map();
  for (const r of rows) {
    if (!seen.has(r.shopify_product_id)) seen.set(r.shopify_product_id, r);
  }
  return seen;
}

// ── POST: discriminated by body ────────────────────────────────────────────
export async function POST(request) {
  const startTime = Date.now();

  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));
    const { shopify_product_id, action, product_ids } = body;

    // ─── MODE 1: Single product ──────────────────────────────────────────
    if (shopify_product_id) {
      const pid = String(shopify_product_id);
      const rows = await fetchProductRows(supabase, [pid]);
      if (rows.length === 0) {
        return NextResponse.json({
          success: false,
          error: `No variants found for product ${pid}`,
        }, { status: 404 });
      }

      const repRow = rows[0];
      const { score, tier, breakdown } = calculateSeoScore(repRow);
      const updatedAt = new Date().toISOString();

      const { error } = await supabase
        .from('products')
        .update({ seo_score: score, seo_tier: tier, seo_score_updated_at: updatedAt })
        .eq('shopify_product_id', pid);

      if (error) throw error;

      return NextResponse.json({
        success: true,
        mode: 'single',
        shopify_product_id: pid,
        seo_score: score,
        seo_tier: tier,
        breakdown,
        seo_score_updated_at: updatedAt,
        variants_updated: rows.length,
        duration_ms: Date.now() - startTime,
      });
    }

    // ─── MODE 2: List all product IDs (lightweight, used by frontend to chunk) ──
    if (action === 'list') {
      const all = [];
      const PAGE = 1000;
      let off = 0;
      while (off < 20000) {
        const { data, error } = await supabase
          .from('products')
          .select('shopify_product_id')
          .not('shopify_product_id', 'is', null)
          .range(off, off + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
        off += PAGE;
      }

      const unique = [...new Set(all.map(r => r.shopify_product_id).filter(Boolean))];

      return NextResponse.json({
        success: true,
        mode: 'list',
        product_ids: unique,
        total: unique.length,
        duration_ms: Date.now() - startTime,
      });
    }

    // ─── MODE 3: Score + update a chunk of products ──────────────────────
    if (Array.isArray(product_ids)) {
      if (product_ids.length === 0) {
        return NextResponse.json({
          success: true,
          mode: 'chunk',
          processed: 0,
          tier_distribution: { green: 0, yellow: 0, red: 0 },
          duration_ms: Date.now() - startTime,
        });
      }
      if (product_ids.length > 200) {
        return NextResponse.json({
          success: false,
          error: 'Max 200 product IDs per chunk request',
        }, { status: 400 });
      }

      // Fetch rows for these specific products
      const rows = await fetchProductRows(supabase, product_ids.map(String));
      const productMap = pickRepresentativePerProduct(rows);

      // Score each product
      const scoreMap = new Map(); // shopify_product_id → { score, tier }
      const tierCounts = { green: 0, yellow: 0, red: 0 };
      let scoreSum = 0;

      for (const [pid, repRow] of productMap.entries()) {
        const { score, tier } = calculateSeoScore(repRow);
        scoreMap.set(pid, { score, tier });
        tierCounts[tier]++;
        scoreSum += score;
      }

      // Group products by (score, tier) so we can issue one UPDATE per group
      const grouped = new Map(); // "score|tier" → [productIds]
      for (const [pid, { score, tier }] of scoreMap.entries()) {
        const key = `${score}|${tier}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(pid);
      }

      const updatedAt = new Date().toISOString();
      const updateOps = [];
      for (const [key, ids] of grouped.entries()) {
        const [scoreStr, tier] = key.split('|');
        updateOps.push({ ids, score: parseInt(scoreStr, 10), tier });
      }

      // Run updates in parallel with concurrency 5
      const CONCURRENCY = 5;
      let processed = 0;
      let failed = 0;
      const errors = [];

      for (let i = 0; i < updateOps.length; i += CONCURRENCY) {
        const batch = updateOps.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(batch.map(op =>
          supabase
            .from('products')
            .update({ seo_score: op.score, seo_tier: op.tier, seo_score_updated_at: updatedAt })
            .in('shopify_product_id', op.ids)
        ));

        for (let j = 0; j < settled.length; j++) {
          const s = settled[j];
          const op = batch[j];
          if (s.status === 'fulfilled' && !s.value.error) {
            processed += op.ids.length;
          } else {
            failed += op.ids.length;
            const errMsg = s.status === 'rejected' ? s.reason?.message : s.value.error?.message;
            errors.push({ score: op.score, tier: op.tier, ids_count: op.ids.length, error: errMsg });
          }
        }
      }

      return NextResponse.json({
        success: true,
        mode: 'chunk',
        chunk_size: product_ids.length,
        processed,
        failed,
        avg_score: processed ? Math.round(scoreSum / scoreMap.size) : 0,
        tier_distribution: tierCounts,
        errors_sample: errors.slice(0, 3),
        duration_ms: Date.now() - startTime,
      });
    }

    // ─── No mode matched ─────────────────────────────────────────────────
    return NextResponse.json({
      success: false,
      error: 'POST body must include one of: { shopify_product_id }, { action: "list" }, or { product_ids: [...] }',
    }, { status: 400 });

  } catch (err) {
    console.error('[seo-score recompute]', err);
    return NextResponse.json({
      success: false,
      error: err.message,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
