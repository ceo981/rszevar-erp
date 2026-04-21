import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// SEO Score Recompute API
// GET  → tier distribution (green/yellow/red/none counts, distinct products)
// POST → recompute single (if shopify_product_id provided) OR all enhanced products

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const supabase = createServerClient();

    // Pull all (shopify_product_id, seo_tier) — paginate to bypass 1000-row cap
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

    // Dedupe to distinct products (variants share parent's score)
    const seen = new Map();
    for (const r of all) {
      if (!seen.has(r.shopify_product_id)) seen.set(r.shopify_product_id, r);
    }

    const distribution = { green: 0, yellow: 0, red: 0, none: 0 };
    let scoreSum = 0;
    for (const r of seen.values()) {
      const tier = r.seo_tier || 'none';
      if (distribution[tier] !== undefined) distribution[tier]++;
      scoreSum += r.seo_score || 0;
    }

    return NextResponse.json({
      success: true,
      total_products: seen.size,
      distribution,
      avg_score: seen.size ? Math.round(scoreSum / seen.size) : 0,
    });
  } catch (err) {
    console.error('[seo-score GET]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const startTime = Date.now();
  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));
    const { shopify_product_id } = body;

    // ── Single product mode ──
    if (shopify_product_id) {
      const pid = String(shopify_product_id);
      const { error } = await supabase.rpc('update_product_seo_score', {
        p_shopify_product_id: pid,
      });
      if (error) throw error;

      const { data: prod } = await supabase
        .from('products')
        .select('seo_score, seo_tier, seo_score_updated_at')
        .eq('shopify_product_id', pid)
        .limit(1)
        .maybeSingle();

      return NextResponse.json({
        success: true,
        mode: 'single',
        shopify_product_id: pid,
        seo_score: prod?.seo_score ?? 0,
        seo_tier: prod?.seo_tier ?? 'none',
        seo_score_updated_at: prod?.seo_score_updated_at ?? null,
        duration_ms: Date.now() - startTime,
      });
    }

    // ── Bulk mode: recompute every product that has at least one enhancement ──
    const enhRows = [];
    const PAGE = 1000;
    let off = 0;
    while (off < 10000) {
      const { data, error } = await supabase
        .from('ai_enhancements')
        .select('shopify_product_id')
        .not('shopify_product_id', 'is', null)
        .range(off, off + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      enhRows.push(...data);
      if (data.length < PAGE) break;
      off += PAGE;
    }

    const uniqueIds = [...new Set(enhRows.map(e => e.shopify_product_id).filter(Boolean))];

    let processed = 0;
    let failed = 0;
    for (const pid of uniqueIds) {
      const { error } = await supabase.rpc('update_product_seo_score', {
        p_shopify_product_id: pid,
      });
      if (error) {
        failed++;
        console.error('[seo-score recompute]', pid, error.message);
      } else {
        processed++;
      }
    }

    return NextResponse.json({
      success: true,
      mode: 'bulk',
      total: uniqueIds.length,
      processed,
      failed,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[seo-score POST]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
