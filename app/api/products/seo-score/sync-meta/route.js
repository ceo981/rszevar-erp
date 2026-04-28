import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// ============================================================================
// RS ZEVAR ERP — Sync SEO Meta from Shopify (Phase C)
// Route: POST /api/products/seo-score/sync-meta
// ----------------------------------------------------------------------------
// Why: Shopify's `seo.title` (= global.title_tag metafield) and
//      `seo.description` (= global.description_tag) are NOT in the products
//      REST endpoint that transformProducts() consumes. We fetch them via
//      GraphQL bulk query and write to seo_meta_title / seo_meta_description
//      columns added in Phase A.
//
// Pagination: 50 products per page (GraphQL cost limit-friendly), ~25 pages
//             for ~1230 products. With 300ms throttle between pages, total
//             ~25-30s — fits within Vercel 60s function limit.
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

export async function POST() {
  const startTime = Date.now();

  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
    return NextResponse.json({
      success: false,
      error: 'Shopify credentials not configured',
    }, { status: 500 });
  }

  try {
    const supabase = createServerClient();

    // ── Step 1: Fetch all products' SEO fields from Shopify ──
    const seoMap = new Map(); // shopify_product_id → { title, description }
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
          seoMap.set(productId, {
            title: edge.node.seo?.title || null,
            description: edge.node.seo?.description || null,
          });
        }
      }

      hasNextPage = connection.pageInfo?.hasNextPage || false;
      cursor = connection.pageInfo?.endCursor || null;
      pageCount++;

      // Throttle between pages (Shopify GraphQL cost limit ~100/sec)
      if (hasNextPage) await new Promise(r => setTimeout(r, 300));
    }

    // ── Step 2: Update DB rows ──
    // Each Shopify product has multiple variant rows in our DB; update all
    // variants sharing the same shopify_product_id with same meta values.
    let productsUpdated = 0;
    let variantsAffected = 0;
    let withTitle = 0;
    let withDescription = 0;
    let bothPresent = 0;
    const errors = [];

    for (const [productId, seo] of seoMap.entries()) {
      const { error, count } = await supabase
        .from('products')
        .update({
          seo_meta_title: seo.title,
          seo_meta_description: seo.description,
        }, { count: 'exact' })
        .eq('shopify_product_id', productId);

      if (error) {
        errors.push({ productId, error: error.message });
      } else {
        productsUpdated++;
        variantsAffected += (count || 0);
        if (seo.title) withTitle++;
        if (seo.description) withDescription++;
        if (seo.title && seo.description) bothPresent++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `${productsUpdated} products updated (${variantsAffected} variant rows). ${bothPresent} have both meta fields, ${withTitle} have title only, ${withDescription} have description only.`,
      stats: {
        total_fetched: seoMap.size,
        products_updated: productsUpdated,
        variants_affected: variantsAffected,
        with_meta_title: withTitle,
        with_meta_description: withDescription,
        with_both: bothPresent,
        with_neither: seoMap.size - Math.max(withTitle, withDescription),
      },
      pages_fetched: pageCount,
      errors_sample: errors.slice(0, 3),
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

// GET — quick status (last sync time + coverage)
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
