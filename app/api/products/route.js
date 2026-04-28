import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { transformProducts } from '@/lib/shopify';
import { calculateSeoScore } from '@/lib/seo-score';

// ============================================================================
// Products / Inventory API
// Phase 1:    Collection filter (?collection=handle), collections dropdown
// Phase D M2.A: Parent aggregates in groupByProduct (parent_abc_*, parent_revenue_*,
//             parent_units_sold_*, parent_seo_score, parent_seo_tier)
// Phase D M2.C: New POST handler — creates product on Shopify with images,
//             collections, SEO meta in one call, then mirrors to DB
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION    = '2024-01';
const GRAPHQL_VERSION = '2025-01';

const MAX_FETCH = 10000;

// ── ABC ranking helpers ────────────────────────────────────────────────────
const ABC_RANK = { A: 4, B: 3, C: 2, D: 1 };
const RANK_TO_CLASS = ['', 'D', 'C', 'B', 'A'];
function bestAbc(variants, col) {
  let max = 0;
  for (const v of variants) {
    const r = ABC_RANK[v[col]] || 0;
    if (r > max) max = r;
  }
  return max ? RANK_TO_CLASS[max] : null;
}

// ── Shopify helpers ────────────────────────────────────────────────────────
async function shopifyREST(endpoint, { method = 'GET', body = null } = {}) {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  if (!res.ok) {
    const errMsg = data?.errors ? JSON.stringify(data.errors) : text.slice(0, 300);
    throw new Error(`Shopify ${method} ${endpoint} failed (${res.status}): ${errMsg}`);
  }
  return data;
}

async function shopifyGraphQL(query, variables = {}) {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${GRAPHQL_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${text.slice(0, 300)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (json.errors) throw new Error(`GraphQL: ${json.errors.map(e => e.message).join('; ')}`);
  return json;
}

async function fetchProductExtras(productId) {
  try {
    const data = await shopifyGraphQL(
      `query getProductExtras($id: ID!) {
        product(id: $id) {
          seo { title description }
          collections(first: 50) { edges { node { handle title } } }
        }
      }`,
      { id: `gid://shopify/Product/${productId}` }
    );
    const node = data?.data?.product;
    if (!node) return null;
    return {
      seo: { title: node.seo?.title ?? null, description: node.seo?.description ?? null },
      collections: (node.collections?.edges || []).map(e => ({ handle: e.node.handle, title: e.node.title })),
    };
  } catch (e) {
    console.error('[products POST] fetchProductExtras failed:', e.message);
    return null;
  }
}

function groupByProduct(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.shopify_product_id || `orphan-${r.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        group_key: key,
        id: key,
        shopify_product_id: r.shopify_product_id,
        parent_title: r.parent_title || (r.title ? r.title.split(' - ')[0] : 'Untitled'),
        image_url: r.image_url,
        vendor: r.vendor,
        category: r.category,
        is_active: r.is_active,
        variants: [],
      });
    }
    groups.get(key).variants.push(r);
  }

  for (const g of groups.values()) {
    g.variant_count = g.variants.length;
    g.total_stock = g.variants.reduce((s, v) => s + (v.stock_quantity || 0), 0);
    g.stock_quantity = g.total_stock;
    g.total_sold = g.variants.reduce((s, v) => s + (v.total_sold || 0), 0);
    g.has_out_of_stock = g.variants.some(v => (v.stock_quantity || 0) === 0);
    g.has_low_stock = g.variants.some(v => {
      const q = v.stock_quantity || 0;
      return q > 0 && q <= 5;
    });
    const prices = g.variants.map(v => v.selling_price || 0).filter(p => p > 0);
    g.selling_price = prices.length ? Math.min(...prices) : 0;
    g.is_active = g.variants.some(v => v.is_active);

    g.parent_abc_90d  = bestAbc(g.variants, 'abc_90d');
    g.parent_abc_180d = bestAbc(g.variants, 'abc_180d');
    g.parent_revenue_90d     = g.variants.reduce((s, v) => s + (Number(v.revenue_90d)     || 0), 0);
    g.parent_revenue_180d    = g.variants.reduce((s, v) => s + (Number(v.revenue_180d)    || 0), 0);
    g.parent_units_sold_90d  = g.variants.reduce((s, v) => s + (v.units_sold_90d  || 0), 0);
    g.parent_units_sold_180d = g.variants.reduce((s, v) => s + (v.units_sold_180d || 0), 0);
    g.parent_seo_score = g.variants[0]?.seo_score ?? null;
    g.parent_seo_tier  = g.variants[0]?.seo_tier  ?? null;
  }

  return Array.from(groups.values());
}

// ============================================================================
// GET — Inventory list (filtered, paginated)
// ============================================================================
export async function GET(request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const view = searchParams.get('view') || 'grouped';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '40');
    const search = searchParams.get('search');
    const category = searchParams.get('category');
    const collection = searchParams.get('collection');
    const stockFilter = searchParams.get('stock');
    const activeFilter = searchParams.get('active');
    const sort = searchParams.get('sort') || 'title';
    const order = searchParams.get('order') || 'asc';
    const abc = searchParams.get('abc') || 'all';
    const abcWindow = searchParams.get('abc_window') || '90d';
    const abcCol = abcWindow === '180d' ? 'abc_180d' : 'abc_90d';

    let query = supabase.from('products').select('*');

    if (search) {
      const safeSearch = search.replace(/[,()%]/g, ' ').trim();
      if (safeSearch) {
        query = query.or(
          `title.ilike.%${safeSearch}%,parent_title.ilike.%${safeSearch}%,sku.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%,vendor.ilike.%${safeSearch}%`
        );
      }
    }
    if (category && category !== 'all') query = query.eq('category', category);
    if (stockFilter === 'out') query = query.eq('stock_quantity', 0);
    if (stockFilter === 'low') query = query.lte('stock_quantity', 3).gt('stock_quantity', 0);
    if (activeFilter === 'active') query = query.eq('is_active', true);
    if (activeFilter === 'draft') query = query.eq('is_active', false);
    if (abc !== 'all') query = query.eq(abcCol, abc);

    const seoTier = searchParams.get('seo_tier');
    if (seoTier && seoTier !== 'all') query = query.eq('seo_tier', seoTier);

    if (collection && collection !== 'all') {
      query = query.contains('collections', [{ handle: collection }]);
    }

    query = query.order(sort, { ascending: order === 'asc' });

    const allRows = [];
    {
      const PAGE = 1000;
      let off = 0;
      while (off < MAX_FETCH) {
        const { data: chunk, error } = await query.range(off, off + PAGE - 1);
        if (error) throw error;
        if (!chunk || chunk.length === 0) break;
        allRows.push(...chunk);
        if (chunk.length < PAGE) break;
        off += PAGE;
      }
    }

    const [totalRowsRes, outRes, lowRes, activeRes] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('stock_quantity', 0),
      supabase.from('products').select('*', { count: 'exact', head: true }).lte('stock_quantity', 3).gt('stock_quantity', 0),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true),
    ]);

    const valueRows = [];
    const PAGE = 1000;
    let offset = 0;
    while (offset < MAX_FETCH) {
      const { data: chunk, error: chunkErr } = await supabase
        .from('products')
        .select('stock_quantity, selling_price, shopify_product_id')
        .range(offset, offset + PAGE - 1);
      if (chunkErr) throw chunkErr;
      if (!chunk || chunk.length === 0) break;
      valueRows.push(...chunk);
      if (chunk.length < PAGE) break;
      offset += PAGE;
    }

    const total_stock_value = valueRows.reduce((s, p) => s + (p.stock_quantity || 0) * (p.selling_price || 0), 0);
    const total_units = valueRows.reduce((s, p) => s + (p.stock_quantity || 0), 0);
    const distinctProducts = new Set(valueRows.map(p => p.shopify_product_id).filter(Boolean)).size;

    const productStats = {
      total: totalRowsRes.count || 0,
      total_variants: totalRowsRes.count || 0,
      total_products: distinctProducts,
      out_of_stock: outRes.count || 0,
      low_stock: lowRes.count || 0,
      active: activeRes.count || 0,
      total_stock_value,
      total_units,
    };

    const { data: cats } = await supabase
      .from('products')
      .select('category')
      .not('category', 'is', null)
      .range(0, MAX_FETCH - 1);
    const categories = [...new Set((cats || []).map(c => c.category).filter(Boolean))].sort();

    const { data: collRows } = await supabase
      .from('products')
      .select('collections')
      .not('collections', 'eq', '[]')
      .range(0, MAX_FETCH - 1);
    const collMap = new Map();
    for (const row of collRows || []) {
      for (const c of row.collections || []) {
        if (c.handle && !collMap.has(c.handle)) {
          collMap.set(c.handle, c.title || c.handle);
        }
      }
    }
    const collections = Array.from(collMap.entries())
      .map(([handle, title]) => ({ handle, title }))
      .sort((a, b) => a.title.localeCompare(b.title));

    let products, total;
    if (view === 'grouped') {
      const groups = groupByProduct(allRows || []);
      total = groups.length;
      const from = (page - 1) * limit;
      products = groups.slice(from, from + limit);
    } else {
      total = (allRows || []).length;
      const from = (page - 1) * limit;
      products = (allRows || []).slice(from, from + limit);
    }

    return NextResponse.json({
      success: true,
      view,
      products,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
      stats: productStats,
      categories,
      collections,
    });
  } catch (error) {
    console.error('Products fetch error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ============================================================================
// POST — Create new product (M2.C)
// Body: {
//   title (required), description_html, vendor, product_type, tags, handle,
//   status,
//   price, compare_at_price, sku,           // initial default-variant fields
//   seo_meta_title, seo_meta_description,
//   collections: [{id, handle, title}],     // numeric ids — used for collectionsToJoin
//   images:      [{filename, attachment, alt}]  // base64-encoded
// }
// Response: { success, shopify_product_id, results, errors? }
// ============================================================================
export async function POST(request) {
  const startTime = Date.now();
  const results = {};
  const errors = {};

  try {
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return NextResponse.json({ success: false, error: 'Shopify credentials not configured' }, { status: 500 });
    }

    const body = await request.json();
    const {
      title,
      description_html,
      vendor,
      product_type,
      tags,
      handle,
      status,
      price,
      compare_at_price,
      sku,
      seo_meta_title,
      seo_meta_description,
      collections,
      images,
    } = body;

    if (!title || !String(title).trim()) {
      return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 });
    }

    // ── Step 1: Create product via REST ────────────────────────────────────
    const productPayload = { product: { title: String(title).trim() } };
    if (typeof description_html === 'string' && description_html) productPayload.product.body_html = description_html;
    if (typeof vendor === 'string' && vendor) productPayload.product.vendor = vendor;
    if (typeof product_type === 'string' && product_type) productPayload.product.product_type = product_type;
    if (Array.isArray(tags) && tags.length > 0) {
      productPayload.product.tags = tags.filter(t => t && String(t).trim()).join(', ');
    }
    if (typeof handle === 'string' && handle.trim()) productPayload.product.handle = handle.trim();
    productPayload.product.status = (status && ['active', 'draft', 'archived'].includes(status)) ? status : 'draft';

    // Default variant (price/sku/compare-at)
    const variant = {};
    if (price !== undefined && price !== '' && price !== null) variant.price = String(price);
    if (compare_at_price !== undefined && compare_at_price !== '' && compare_at_price !== null) variant.compare_at_price = String(compare_at_price);
    if (sku !== undefined && sku !== '' && sku !== null) variant.sku = String(sku);
    if (Object.keys(variant).length > 0) productPayload.product.variants = [variant];

    let newProductId;
    try {
      const createRes = await shopifyREST('products.json', { method: 'POST', body: productPayload });
      if (!createRes.product?.id) throw new Error('Shopify did not return new product id');
      newProductId = String(createRes.product.id);
      results.product_create = {
        success: true,
        id: newProductId,
        handle: createRes.product.handle,
      };
    } catch (e) {
      // Hard fail — without a product id, nothing else can proceed
      return NextResponse.json({
        success: false,
        error: `Product creation failed: ${e.message}`,
        results,
        duration_ms: Date.now() - startTime,
      }, { status: 500 });
    }

    // ── Step 2: Upload images sequentially (best-effort) ───────────────────
    if (Array.isArray(images) && images.length > 0) {
      const imageResults = [];
      for (const img of images) {
        if (!img || !img.attachment) continue;
        try {
          const imgRes = await shopifyREST(`products/${newProductId}/images.json`, {
            method: 'POST',
            body: {
              image: {
                attachment: img.attachment,
                filename: img.filename || `image-${Date.now()}.jpg`,
                alt: img.alt || '',
              },
            },
          });
          imageResults.push({ filename: img.filename, success: true, id: imgRes.image?.id });
        } catch (e) {
          imageResults.push({ filename: img.filename, success: false, error: e.message });
        }
        // Throttle to avoid Shopify rate limits (2 requests/sec for plus, 4/sec advanced)
        await new Promise(r => setTimeout(r, 250));
      }
      results.images = imageResults;
    }

    // ── Step 3: SEO metafields ─────────────────────────────────────────────
    if (typeof seo_meta_title === 'string' && seo_meta_title.trim()) {
      try {
        await shopifyREST(`products/${newProductId}/metafields.json`, {
          method: 'POST',
          body: { metafield: { namespace: 'global', key: 'title_tag', value: seo_meta_title, type: 'single_line_text_field' } },
        });
        results.seo_meta_title = { success: true };
      } catch (e) { errors.seo_meta_title = e.message; }
    }
    if (typeof seo_meta_description === 'string' && seo_meta_description.trim()) {
      try {
        await shopifyREST(`products/${newProductId}/metafields.json`, {
          method: 'POST',
          body: { metafield: { namespace: 'global', key: 'description_tag', value: seo_meta_description, type: 'multi_line_text_field' } },
        });
        results.seo_meta_description = { success: true };
      } catch (e) { errors.seo_meta_description = e.message; }
    }

    // ── Step 4: Collections via GraphQL productUpdate ─────────────────────
    if (Array.isArray(collections) && collections.length > 0) {
      try {
        const toJoin = collections
          .filter(c => c && c.id)
          .map(c => `gid://shopify/Collection/${c.id}`);
        if (toJoin.length > 0) {
          const data = await shopifyGraphQL(
            `mutation productUpdate($input: ProductInput!) {
              productUpdate(input: $input) {
                product { id }
                userErrors { field message }
              }
            }`,
            {
              input: {
                id: `gid://shopify/Product/${newProductId}`,
                collectionsToJoin: toJoin,
              },
            }
          );
          const userErrors = data?.data?.productUpdate?.userErrors || [];
          if (userErrors.length > 0) {
            throw new Error(userErrors.map(e => e.message).join('; '));
          }
          results.collections = { success: true, joined: toJoin.length };
        }
      } catch (e) { errors.collections = e.message; }
    }

    // ── Step 5: Refetch + mirror to DB ────────────────────────────────────
    try {
      const fetchRes = await shopifyREST(`products/${newProductId}.json`);
      const fullProduct = fetchRes.product;
      const variants = transformProducts(fullProduct);

      // Stamp SEO + collections from GraphQL extras
      const extras = await fetchProductExtras(newProductId);
      if (extras) {
        for (const v of variants) {
          v.seo_meta_title = extras.seo.title;
          v.seo_meta_description = extras.seo.description;
          v.collections = extras.collections;
        }
      }

      const supabase = createServerClient();
      const { error: upsertErr } = await supabase
        .from('products')
        .upsert(variants, { onConflict: 'shopify_variant_id' });
      if (upsertErr) throw upsertErr;

      // Compute SEO score
      try {
        const { score, tier } = calculateSeoScore(variants[0]);
        await supabase
          .from('products')
          .update({ seo_score: score, seo_tier: tier, seo_score_updated_at: new Date().toISOString() })
          .eq('shopify_product_id', newProductId);
        results.seo_score = { score, tier };
      } catch (e) { /* best-effort */ }

      results.db_mirror = { success: true, variants: variants.length };
    } catch (e) {
      errors.db_mirror = e.message;
    }

    const anyError = Object.keys(errors).length > 0;
    return NextResponse.json({
      success: true,           // Product was created — partial errors don't kill success
      partial: anyError,
      shopify_product_id: newProductId,
      message: anyError
        ? `Created — but some side-tasks failed (see errors)`
        : `Created successfully`,
      results,
      errors: anyError ? errors : undefined,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[POST /api/products]', err);
    return NextResponse.json({
      success: false,
      error: err.message,
      results,
      errors,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
