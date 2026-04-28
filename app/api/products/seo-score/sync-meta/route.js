import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// ============================================================================
// RS ZEVAR ERP — Sync SEO Meta from Shopify (Phase C — chunked, Apr 28 2026)
// Route: POST /api/products/seo-score/sync-meta
// ----------------------------------------------------------------------------
// MODES (POST body discriminator)
//   {} or { action: "fetch" }       → fetch from Shopify GraphQL, return map
//                                      (no DB writes — ~25-30s)
//   { updates: [...] }                → apply DB updates for these products
//                                      (max 100 per call)
//
// WHY CHUNKED?
//   First version did GraphQL fetch + 1230 sequential DB updates in one call.
//   The DB update loop alone took 100ms × 1230 = 2 minutes. Hit Vercel 60s
//   function timeout (504 Gateway Timeout).
//
//   New design: Server does the slow Shopify fetch (must be server-side for
//   token security) and returns the data. Client chunks DB updates and shows
//   progress.
//
// CALL ORDER (frontend orchestration)
//   1. POST {} → returns { map: { product_id: { title, description } } }
//   2. Frontend chunks the map and calls POST { updates: [...] } repeatedly
//      with 100 entries per call until done.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GRAPHQL_VERSION = '2025-01';

async function shopifyGraphQL(query, variables = {}) {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${GRAPHQL_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${text.slice(0, 300)}`);
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Shopify GraphQL non-JSON: ${text.slice(0, 200)}`); }
  if (json.errors) throw new Error(`Shopify GraphQL: ${json.errors.map(e => e.message).join(', ')}`);
  return json;
}

const PRODUCTS_SEO_QUERY = `
  query GetProductsSeo($cursor: String) {
    products(first: 50, after: $cursor) {
      edges {
        node {
          id
          seo {
            title
            description
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

function extractGid(gid) {
  if (!gid) return null;
  const parts = String(gid).split('/');
  return parts[parts.length - 1];
}

// ── GET: coverage status ────────────────────────────────────────────────────
export async function GET() {
  try {
    const supabase = createServerClient();

    const [{ count: total }, { count: withTitle }, { count: withDesc }] = await Promise.all([
      supabase.from('products').select('shopify_product_id', { count: 'exact', head: true }).not('shopify_product_id', 'is', null),
      supabase.from('products').select('shopify_product_id', { count: 'exact', head: true }).not('seo_meta_title', 'is', null),
      supabase.from('products').select('shopify_product_id', { count: 'exact', head: true }).not('seo_meta_description', 'is', null),
    ]);

    return NextResponse.json({
      success: true,
      total_variants: total || 0,
      variants_with_meta_title: withTitle || 0,
      variants_with_meta_description: withDesc || 0,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ── POST: discriminated by body ─────────────────────────────────────────────
export async function POST(request) {
  const startTime = Date.now();

  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
    return NextResponse.json({
      success: false,
      error: 'Shopify credentials not configured',
    }, { status: 500 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { action, updates } = body;

    // ─── MODE 1: Apply DB updates for a chunk ──────────────────────────────
    if (Array.isArray(updates)) {
      if (updates.length === 0) {
        return NextResponse.json({
          success: true,
          mode: 'save',
          products_updated: 0,
          variants_affected: 0,
          duration_ms: Date.now() - startTime,
        });
      }
      if (updates.length > 200) {
        return NextResponse.json({
          success: false,
          error: 'Max 200 updates per chunk request',
        }, { status: 400 });
      }

      const supabase = createServerClient();

      // Run updates in parallel with concurrency 10
      const CONCURRENCY = 10;
      let productsUpdated = 0;
      let variantsAffected = 0;
      let withTitle = 0;
      let withDescription = 0;
      let bothPresent = 0;
      const errors = [];

      for (let i = 0; i < updates.length; i += CONCURRENCY) {
        const batch = updates.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(batch.map(u =>
          supabase
            .from('products')
            .update({
              seo_meta_title: u.title || null,
              seo_meta_description: u.description || null,
            }, { count: 'exact' })
            .eq('shopify_product_id', String(u.shopify_product_id))
        ));

        for (let j = 0; j < settled.length; j++) {
          const s = settled[j];
          const u = batch[j];
          if (s.status === 'fulfilled' && !s.value.error) {
            productsUpdated++;
            variantsAffected += (s.value.count || 0);
            if (u.title) withTitle++;
            if (u.description) withDescription++;
            if (u.title && u.description) bothPresent++;
          } else {
            const errMsg = s.status === 'rejected' ? s.reason?.message : s.value.error?.message;
            errors.push({ shopify_product_id: u.shopify_product_id, error: errMsg });
          }
        }
      }

      return NextResponse.json({
        success: true,
        mode: 'save',
        chunk_size: updates.length,
        products_updated: productsUpdated,
        variants_affected: variantsAffected,
        with_meta_title: withTitle,
        with_meta_description: withDescription,
        with_both: bothPresent,
        errors_sample: errors.slice(0, 3),
        duration_ms: Date.now() - startTime,
      });
    }

    // ─── MODE 2: Fetch all SEO data from Shopify (default) ─────────────────
    const seoMap = {}; // plain object so it serializes cleanly to JSON
    let cursor = null;
    let hasNextPage = true;
    let pageCount = 0;
    const MAX_PAGES = 30; // 1500 product safety cap

    while (hasNextPage && pageCount < MAX_PAGES) {
      const result = await shopifyGraphQL(PRODUCTS_SEO_QUERY, { cursor });
      const connection = result.data?.products;
      if (!connection) break;

      for (const edge of connection.edges || []) {
        const productId = extractGid(edge.node.id);
        if (productId) {
          seoMap[productId] = {
            title: edge.node.seo?.title || null,
            description: edge.node.seo?.description || null,
          };
        }
      }

      hasNextPage = connection.pageInfo?.hasNextPage || false;
      cursor = connection.pageInfo?.endCursor || null;
      pageCount++;

      if (hasNextPage) await new Promise(r => setTimeout(r, 300));
    }

    // Stats for the fetched data
    const ids = Object.keys(seoMap);
    let withTitle = 0;
    let withDescription = 0;
    let withBoth = 0;
    for (const id of ids) {
      const e = seoMap[id];
      if (e.title) withTitle++;
      if (e.description) withDescription++;
      if (e.title && e.description) withBoth++;
    }

    return NextResponse.json({
      success: true,
      mode: 'fetch',
      map: seoMap,
      stats: {
        total_fetched: ids.length,
        with_meta_title: withTitle,
        with_meta_description: withDescription,
        with_both: withBoth,
        with_neither: ids.length - Math.max(withTitle, withDescription),
      },
      pages_fetched: pageCount,
      duration_ms: Date.now() - startTime,
    });

  } catch (err) {
    console.error('[seo-score/sync-meta]', err);
    return NextResponse.json({
      success: false,
      error: err.message,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
