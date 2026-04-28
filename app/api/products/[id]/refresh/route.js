// ============================================================================
// RS ZEVAR ERP — Single Product Refresh from Shopify (Phase D + M2.B hotfix v2)
// Route: POST /api/products/[id]/refresh
// ----------------------------------------------------------------------------
// Pulls ONE product fresh from Shopify and re-syncs to DB. Used as a safety
// net when products/update webhook misses an event (or is not registered).
// Much lighter than the full 1230-product "Sync from Shopify".
//
// Ensures EVERY editable field comes back fresh:
//   REST product:         title, description, vendor, type, tags, handle,
//                         status, images+alt, all variants (price/SKU/stock)
//   GraphQL extras:       seo.title (→ seo_meta_title)
//                         seo.description (→ seo_meta_description)
//                         collections (→ collections JSONB)
//
// Both REST + GraphQL data is stamped on every variant row before a single
// upsert, so the DB picks up everything atomically.
// ============================================================================

import { NextResponse } from 'next/server';
// Relative imports to avoid Next.js 16 Turbopack alias issues on new files
import { createServerClient } from '../../../../../lib/supabase.js';
import { transformProducts } from '../../../../../lib/shopify.js';
import { calculateSeoScore } from '../../../../../lib/seo-score.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-01';
const GRAPHQL_VERSION = '2025-01';

// ── GraphQL extras helper: SEO + collections in ONE call ───────────────────
// Returns { seo: {title, description}, collections: [{handle, title}] }
// or null on failure (caller decides whether to fail or proceed)
async function fetchProductExtras(productId) {
  const query = `
    query getProductExtras($id: ID!) {
      product(id: $id) {
        seo {
          title
          description
        }
        collections(first: 50) {
          edges { node { handle title } }
        }
      }
    }
  `;
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${GRAPHQL_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { id: `gid://shopify/Product/${productId}` },
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map(e => e.message).join('; '));
  const node = json?.data?.product;
  if (!node) return null;
  return {
    seo: {
      title: node.seo?.title ?? null,
      description: node.seo?.description ?? null,
    },
    collections: (node.collections?.edges || []).map(e => ({
      handle: e.node.handle,
      title: e.node.title,
    })),
  };
}

export async function POST(request, { params }) {
  const startTime = Date.now();
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Product id required' }, { status: 400 });
    }

    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return NextResponse.json({
        success: false,
        error: 'Shopify credentials not configured',
      }, { status: 500 });
    }

    // 1. Fetch single product from Shopify (REST — for variants/images/etc)
    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/products/${id}.json`;
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({
        success: false,
        error: `Shopify ${res.status}: ${text.slice(0, 200)}`,
      }, { status: res.status === 404 ? 404 : 500 });
    }

    const data = await res.json();
    const shopifyProduct = data.product;
    if (!shopifyProduct) {
      return NextResponse.json({
        success: false,
        error: 'Product not found in Shopify',
      }, { status: 404 });
    }

    // 2. Transform → variant rows (Phase A: includes tags, description, handle, images, status)
    const variants = transformProducts(shopifyProduct);
    if (variants.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Product has no variants',
      }, { status: 400 });
    }

    // 2.5 Fetch SEO + collections via GraphQL and stamp on every variant row
    //     so the upsert refreshes those columns too. Best-effort — we don't
    //     fail the whole refresh on this; we just log and surface the error.
    let extrasError = null;
    let seoSynced = false;
    let collectionsCount = 0;
    try {
      const extras = await fetchProductExtras(id);
      if (extras) {
        for (const v of variants) {
          v.seo_meta_title       = extras.seo.title;
          v.seo_meta_description = extras.seo.description;
          v.collections          = extras.collections;
        }
        seoSynced = true;
        collectionsCount = extras.collections.length;
      }
    } catch (e) {
      extrasError = e.message;
      console.error('[refresh] extras fetch failed:', e.message);
    }

    // 3. Upsert to DB
    const supabase = createServerClient();
    const { error: upsertErr } = await supabase
      .from('products')
      .upsert(variants, { onConflict: 'shopify_variant_id' });

    if (upsertErr) {
      throw upsertErr;
    }

    // 4. Recompute SEO score for fresh data
    let seoUpdate = null;
    try {
      const { score, tier } = calculateSeoScore(variants[0]);
      const updatedAt = new Date().toISOString();
      await supabase
        .from('products')
        .update({ seo_score: score, seo_tier: tier, seo_score_updated_at: updatedAt })
        .eq('shopify_product_id', String(id));
      seoUpdate = { score, tier };
    } catch (e) {
      // SEO recompute is best-effort; don't fail the refresh on its account
      console.error('[refresh] seo recompute failed:', e.message);
    }

    return NextResponse.json({
      success: true,
      message: `Refreshed from Shopify — ${variants.length} variant(s), ${seoSynced ? 'SEO ✓' : 'SEO ✗'}, ${collectionsCount} collection(s)${extrasError ? ' (extras error: see logs)' : ''}`,
      variants_synced: variants.length,
      seo_synced: seoSynced,
      collections_synced: collectionsCount,
      extras_error: extrasError,
      seo: seoUpdate,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[POST /api/products/[id]/refresh]', err);
    return NextResponse.json({
      success: false,
      error: err.message,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
