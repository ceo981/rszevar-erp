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

// ── Location ID helper (cached for this request) ───────────────────────────
let _cachedLocationId = null;
async function getPrimaryLocationId() {
  if (_cachedLocationId) return _cachedLocationId;
  const data = await shopifyREST('locations.json');
  const loc = (data.locations || []).find(l => l.active) || data.locations?.[0];
  if (!loc) throw new Error('No active Shopify location');
  _cachedLocationId = String(loc.id);
  return _cachedLocationId;
}

// ── Set inventory level for a variant ──────────────────────────────────────
async function setInventoryLevel(inventoryItemId, locationId, qty) {
  return shopifyREST('inventory_levels/set.json', {
    method: 'POST',
    body: {
      location_id: Number(locationId),
      inventory_item_id: Number(inventoryItemId),
      available: Number(qty) || 0,
    },
  });
}

// ── Upsert product-level metafield (new product → just POST) ──────────────
async function postProductMetafield(productId, namespace, key, value, type = 'single_line_text_field') {
  if (!value || !String(value).trim()) return null;
  return shopifyREST(`products/${productId}/metafields.json`, {
    method: 'POST',
    body: { metafield: { namespace, key, value: String(value), type } },
  });
}

// ── M2.K — Convert weight + unit to grams (Shopify's canonical unit) ──
// Returns null if input is empty/invalid; otherwise an integer >= 0.
function computeGrams(weight, unit) {
  if (weight === undefined || weight === null || weight === '') return null;
  const n = Number(weight);
  if (!Number.isFinite(n) || n < 0) return null;
  const u = (unit || 'g').toLowerCase();
  let g;
  switch (u) {
    case 'kg':  g = n * 1000;          break;
    case 'oz':  g = n * 28.3495231;    break;
    case 'lb':  g = n * 453.59237;     break;
    case 'g':
    default:    g = n;                 break;
  }
  return Math.round(g);
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
      // Default-variant fields (used when no options/variants are sent)
      price,
      compare_at_price,
      sku,
      // M2.D — inventory tracking
      track_inventory,           // boolean
      initial_stock,             // number — default variant initial qty
      // M2.E — Cost per item (applied to ALL variants via inventory_item.cost)
      cost_per_item,
      // M2.K — Weight (applied to all variants by default; per-variant weight overrides via variants_input[].weight)
      weight,                    // number (in weight_unit)
      weight_unit,               // 'g' | 'kg' | 'oz' | 'lb' (default 'g')
      // SEO
      seo_meta_title,
      seo_meta_description,
      // Collections
      collections,
      // Images
      images,
      // M2.D — variant options + variants
      options,                   // [{name, values: [...]}]
      variants_input,            // [{option1, option2?, price, compare_at_price, sku, stock}]
      // M2.F — per-color image assignment: { 'Black': 0, 'green': 1 } (image array index)
      variant_image_assignments,
      // M2.D — Google Shopping metafields (product level, "google" namespace)
      google_age_group,
      google_gender,
      google_condition,
      google_mpn,
      // M2.J — AI Enhance product metafields (rszevar namespace)
      // Sent by /inventory/new page when user clicks Apply in AI Enhance modal,
      // then clicks Create Product. Mirrors PATCH route field set.
      ai_faqs,                          // array of { q, a }
      ai_mf_occasion,                   // array of strings
      ai_mf_set_contents,               // array of strings
      ai_mf_stone_type,                 // array of strings
      ai_mf_material,                   // single string
      ai_mf_color_finish,               // single string
      // M2.J — enhancement tracking. When set, the ai_enhancements row will be
      // marked as pushed at the end of this request.
      ai_enhancement_id,
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

    // M2.D — Variant options + variants (multi-variant flow)
    const useVariantOptions = Array.isArray(options) && options.length > 0
      && Array.isArray(variants_input) && variants_input.length > 0;

    if (useVariantOptions) {
      // Multi-variant flow
      productPayload.product.options = options
        .filter(o => o && o.name && Array.isArray(o.values) && o.values.length > 0)
        .map(o => ({ name: String(o.name).trim(), values: o.values.map(v => String(v).trim()).filter(Boolean) }));

      productPayload.product.variants = variants_input.map(v => {
        const variant = {};
        if (v.option1 !== undefined) variant.option1 = String(v.option1);
        if (v.option2 !== undefined && v.option2 !== null) variant.option2 = String(v.option2);
        if (v.option3 !== undefined && v.option3 !== null) variant.option3 = String(v.option3);
        if (v.price !== undefined && v.price !== '' && v.price !== null) variant.price = String(v.price);
        if (v.compare_at_price !== undefined && v.compare_at_price !== '' && v.compare_at_price !== null) variant.compare_at_price = String(v.compare_at_price);
        if (v.sku !== undefined && v.sku !== '' && v.sku !== null) variant.sku = String(v.sku);
        // M2.K — weight per variant (grams to Shopify; UI may send weight + weight_unit and we convert)
        const grams = computeGrams(v.weight, v.weight_unit || weight_unit);
        if (grams !== null) {
          variant.grams = grams;
          variant.weight = grams / 1000;       // Shopify also accepts kg as `weight`
          variant.weight_unit = 'g';
        }
        if (track_inventory) variant.inventory_management = 'shopify';
        return variant;
      });
    } else {
      // Default-variant flow (single variant)
      const variant = {};
      if (price !== undefined && price !== '' && price !== null) variant.price = String(price);
      if (compare_at_price !== undefined && compare_at_price !== '' && compare_at_price !== null) variant.compare_at_price = String(compare_at_price);
      if (sku !== undefined && sku !== '' && sku !== null) variant.sku = String(sku);
      // M2.K — weight on default variant
      const grams = computeGrams(weight, weight_unit);
      if (grams !== null) {
        variant.grams = grams;
        variant.weight = grams / 1000;
        variant.weight_unit = 'g';
      }
      if (track_inventory) variant.inventory_management = 'shopify';
      if (Object.keys(variant).length > 0) productPayload.product.variants = [variant];
    }

    let newProductId;
    let createdShopifyProduct;
    try {
      const createRes = await shopifyREST('products.json', { method: 'POST', body: productPayload });
      if (!createRes.product?.id) throw new Error('Shopify did not return new product id');
      newProductId = String(createRes.product.id);
      createdShopifyProduct = createRes.product;
      results.product_create = {
        success: true,
        id: newProductId,
        handle: createRes.product.handle,
        variants: (createRes.product.variants || []).length,
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

    // ── Step 1.5: Set inventory levels (M2.D) ──────────────────────────────
    if (track_inventory) {
      try {
        const locationId = await getPrimaryLocationId();
        const createdVariants = createdShopifyProduct.variants || [];
        const stockResults = [];

        if (useVariantOptions) {
          // Match each created variant to its variants_input entry by option1+option2
          const inputByKey = new Map();
          for (const vi of variants_input) {
            const key = `${vi.option1 ?? ''}|${vi.option2 ?? ''}|${vi.option3 ?? ''}`;
            inputByKey.set(key, vi);
          }
          for (const cv of createdVariants) {
            const key = `${cv.option1 ?? ''}|${cv.option2 ?? ''}|${cv.option3 ?? ''}`;
            const inp = inputByKey.get(key);
            const qty = inp && inp.stock !== undefined && inp.stock !== '' ? Number(inp.stock) : 0;
            try {
              await setInventoryLevel(cv.inventory_item_id, locationId, qty);
              stockResults.push({ variant_id: cv.id, qty, success: true });
            } catch (e) {
              stockResults.push({ variant_id: cv.id, qty, success: false, error: e.message });
            }
            await new Promise(r => setTimeout(r, 150));
          }
        } else {
          // Single default variant → use initial_stock
          const cv = createdVariants[0];
          if (cv && cv.inventory_item_id) {
            const qty = initial_stock !== undefined && initial_stock !== '' ? Number(initial_stock) : 0;
            try {
              await setInventoryLevel(cv.inventory_item_id, locationId, qty);
              stockResults.push({ variant_id: cv.id, qty, success: true });
            } catch (e) {
              stockResults.push({ variant_id: cv.id, qty, success: false, error: e.message });
            }
          }
        }
        results.inventory_levels = stockResults;
      } catch (e) {
        errors.inventory_levels = e.message;
      }
    }

    // ── Step 1.6: Set inventory_item.cost for ALL variants (M2.E) ──────────
    // Cost in Shopify is stored on inventory_item, not variant. So we need a
    // separate PUT per variant after product create. Same cost applies to all
    // variants (per Abdul's UX request: "ek baar daldo upar, sab me auto pick").
    if (cost_per_item !== undefined && cost_per_item !== null && cost_per_item !== '') {
      const costStr = String(cost_per_item);
      const createdVariants = createdShopifyProduct.variants || [];
      const costResults = [];
      for (const cv of createdVariants) {
        if (!cv.inventory_item_id) continue;
        try {
          await shopifyREST(`inventory_items/${cv.inventory_item_id}.json`, {
            method: 'PUT',
            body: { inventory_item: { id: cv.inventory_item_id, cost: costStr } },
          });
          costResults.push({ variant_id: cv.id, cost: costStr, success: true });
        } catch (e) {
          costResults.push({ variant_id: cv.id, cost: costStr, success: false, error: e.message });
        }
        await new Promise(r => setTimeout(r, 150));
      }
      results.cost_per_item = costResults;
    }

    // ── Step 2: Upload images sequentially (best-effort) ───────────────────
    // M2.F — Track uploaded image Shopify IDs by their original input index, so
    // we can map variant_image_assignments to actual image IDs in Step 2.5.
    const uploadedImageIdByIndex = {};
    if (Array.isArray(images) && images.length > 0) {
      const imageResults = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
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
          if (imgRes.image?.id) uploadedImageIdByIndex[i] = imgRes.image.id;
        } catch (e) {
          imageResults.push({ filename: img.filename, success: false, error: e.message });
        }
        // Throttle to avoid Shopify rate limits (2 requests/sec for plus, 4/sec advanced)
        await new Promise(r => setTimeout(r, 250));
      }
      results.images = imageResults;
    }

    // ── Step 2.5: Assign images to variant groups (M2.F + M2.H) ───────────
    // variant_image_assignments shape:
    //   - Group key:    'Black' → applies to all variants where option1=Black
    //   - Composite:    'Black|2.4|' → overrides for that exact sub-variant
    // Resolution: composite key takes priority; fall back to group key.
    if (variant_image_assignments && typeof variant_image_assignments === 'object'
        && Object.keys(variant_image_assignments).length > 0
        && createdShopifyProduct.variants?.length > 0) {
      const assignResults = [];
      for (const cv of createdShopifyProduct.variants) {
        const subKey   = `${cv.option1 ?? ''}|${cv.option2 ?? ''}|${cv.option3 ?? ''}`;
        const groupKey = cv.option1 ?? '';
        // composite override wins; else fall back to group default
        let imgIdx = variant_image_assignments[subKey];
        let resolvedFrom = 'sub';
        if (imgIdx === undefined || imgIdx === null) {
          imgIdx = variant_image_assignments[groupKey];
          resolvedFrom = 'group';
        }
        if (imgIdx === undefined || imgIdx === null) continue;

        const shopifyImageId = uploadedImageIdByIndex[imgIdx];
        if (!shopifyImageId) {
          assignResults.push({ variant_id: cv.id, key: subKey, success: false, error: 'image upload failed' });
          continue;
        }
        try {
          await shopifyREST(`variants/${cv.id}.json`, {
            method: 'PUT',
            body: { variant: { id: cv.id, image_id: shopifyImageId } },
          });
          assignResults.push({
            variant_id: cv.id,
            sub_key: subKey,
            group_key: groupKey,
            resolved_from: resolvedFrom,
            image_id: shopifyImageId,
            success: true,
          });
        } catch (e) {
          assignResults.push({ variant_id: cv.id, key: subKey, success: false, error: e.message });
        }
        await new Promise(r => setTimeout(r, 200));
      }
      results.variant_image_assignments = assignResults;
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

    // ── Step 3.5: Google Shopping metafields (M2.D) ────────────────────────
    // Product-level "google" namespace metafields. Used by Shopify's Google
    // & YouTube channel for Google Merchant Center feed.
    const googleFields = [
      { key: 'age_group', value: google_age_group },
      { key: 'gender',    value: google_gender },
      { key: 'condition', value: google_condition },
      { key: 'mpn',       value: google_mpn },
    ];
    const googleResults = [];
    for (const f of googleFields) {
      if (!f.value || !String(f.value).trim()) continue;
      try {
        await postProductMetafield(newProductId, 'google', f.key, f.value, 'single_line_text_field');
        googleResults.push({ key: f.key, success: true });
      } catch (e) {
        googleResults.push({ key: f.key, success: false, error: e.message });
      }
    }
    if (googleResults.length > 0) results.google_metafields = googleResults;

    // ── Step 3.6: AI Enhance product metafields (M2.J) ─────────────────────
    // rszevar namespace — same shape as inventory-list push flow.
    const aiMetafieldMap = [
      { param: ai_faqs,             mf_key: 'faqs',         type: 'json',                          kind: 'json'   },
      { param: ai_mf_occasion,      mf_key: 'occasion',     type: 'list.single_line_text_field',   kind: 'list'   },
      { param: ai_mf_set_contents,  mf_key: 'set_contents', type: 'list.single_line_text_field',   kind: 'list'   },
      { param: ai_mf_stone_type,    mf_key: 'stone_type',   type: 'list.single_line_text_field',   kind: 'list'   },
      { param: ai_mf_material,      mf_key: 'material',     type: 'single_line_text_field',        kind: 'string' },
      { param: ai_mf_color_finish,  mf_key: 'color_finish', type: 'single_line_text_field',        kind: 'string' },
    ];

    const aiMetaResults = [];
    for (const mf of aiMetafieldMap) {
      if (mf.param === undefined || mf.param === null) continue;
      let stringValue;
      if (mf.kind === 'list') {
        if (!Array.isArray(mf.param) || mf.param.length === 0) continue;
        stringValue = JSON.stringify(mf.param.map(v => String(v).trim()).filter(Boolean));
      } else if (mf.kind === 'json') {
        if (!Array.isArray(mf.param) || mf.param.length === 0) continue;
        stringValue = JSON.stringify(mf.param);
      } else {
        if (typeof mf.param !== 'string' || !mf.param.trim()) continue;
        stringValue = mf.param.trim();
      }
      try {
        await postProductMetafield(newProductId, 'rszevar', mf.mf_key, stringValue, mf.type);
        aiMetaResults.push({ key: mf.mf_key, success: true });
      } catch (e) {
        aiMetaResults.push({ key: mf.mf_key, success: false, error: e.message });
      }
      await new Promise(r => setTimeout(r, 120));
    }
    if (aiMetaResults.length > 0) results.ai_metafields = aiMetaResults;

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

    // ── Step 4.5: Auto-publish to ALL sales channels (M2.G) ───────────────
    // By default, REST API products are only published to "Online Store" + the
    // channels the private app token has explicit access to. To match Shopify
    // admin's "publish everywhere" behavior (Google, TikTok, Shop, Facebook),
    // we fetch all publications via GraphQL and explicitly publish to each.
    //
    // NOTE: This requires `write_publications` scope on the private app. If
    // the scope is missing, this step fails gracefully and just logs the error.
    try {
      const pubData = await shopifyGraphQL(
        `query AllPublications { publications(first: 50) { edges { node { id name } } } }`,
        {}
      );
      const pubs = (pubData?.data?.publications?.edges || []).map(e => e.node);
      if (pubs.length > 0) {
        const publishRes = await shopifyGraphQL(
          `mutation publishProduct($id: ID!, $input: [PublicationInput!]!) {
            publishablePublish(id: $id, input: $input) {
              publishable { ... on Product { id } }
              userErrors { field message }
            }
          }`,
          {
            id: `gid://shopify/Product/${newProductId}`,
            input: pubs.map(p => ({ publicationId: p.id })),
          }
        );
        const pubErrors = publishRes?.data?.publishablePublish?.userErrors || [];
        results.publications = {
          success: pubErrors.length === 0,
          attempted: pubs.length,
          channels: pubs.map(p => p.name),
          errors: pubErrors.length > 0 ? pubErrors : undefined,
        };
      } else {
        results.publications = { success: false, error: 'No publications returned' };
      }
    } catch (e) {
      // Most likely: missing `write_publications` scope on the private app.
      errors.publications = e.message;
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

    // ── Step 8: M2.J — mark ai_enhancements row as pushed ──
    // For new products, "applied_via" is 'new' (vs 'editor' for existing).
    if (ai_enhancement_id) {
      try {
        const supabase = createServerClient();   // local scope — outer try block's supabase has gone out of scope
        const fieldsPushed = [];
        if (typeof title === 'string')                  fieldsPushed.push('title');
        if (typeof description_html === 'string' && description_html) fieldsPushed.push('description');
        if (typeof seo_meta_title === 'string'     && seo_meta_title.trim())     fieldsPushed.push('meta_title');
        if (typeof seo_meta_description === 'string' && seo_meta_description.trim()) fieldsPushed.push('meta_description');
        if (typeof handle === 'string' && handle.trim())fieldsPushed.push('url_handle');
        if (Array.isArray(tags) && tags.length > 0)     fieldsPushed.push('tags');
        // Alt texts on new products go via images[].alt — count them
        if (Array.isArray(images) && images.some(im => im && im.alt))
                                                        fieldsPushed.push('alt_texts');
        if (Array.isArray(ai_faqs) && ai_faqs.length > 0) fieldsPushed.push('faqs');
        if (Array.isArray(ai_mf_occasion) && ai_mf_occasion.length > 0)         fieldsPushed.push('mf_occasion');
        if (Array.isArray(ai_mf_set_contents) && ai_mf_set_contents.length > 0) fieldsPushed.push('mf_set_contents');
        if (Array.isArray(ai_mf_stone_type) && ai_mf_stone_type.length > 0)     fieldsPushed.push('mf_stone_type');
        if (typeof ai_mf_material === 'string'     && ai_mf_material.trim())     fieldsPushed.push('mf_material');
        if (typeof ai_mf_color_finish === 'string' && ai_mf_color_finish.trim()) fieldsPushed.push('mf_color_finish');

        await supabase
          .from('ai_enhancements')
          .update({
            pushed_to_shopify: true,
            pushed_at: new Date().toISOString(),
            status: anyError ? 'partial' : 'pushed',
            fields_pushed: fieldsPushed,
            shopify_product_id: newProductId,   // bind enhancement to the new product
            pushed_output: {
              title: title || null,
              body_html: description_html || null,
              handle: handle || null,
              tags: Array.isArray(tags) ? tags.join(', ') : null,
              meta_title: seo_meta_title || null,
              meta_description: seo_meta_description || null,
              applied_via: 'new',
            },
            push_response: { results, errors },
            push_error: anyError ? JSON.stringify(errors) : null,
          })
          .eq('id', ai_enhancement_id);
        results.ai_enhancement_marked = { success: true };
      } catch (e) {
        console.warn('[POST] failed to mark ai_enhancement', e.message);
        errors.ai_enhancement_marked = e.message;
      }
    }

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
