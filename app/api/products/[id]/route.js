// ============================================================================
// RS ZEVAR ERP — Single Product API (Phase D M2.B — Apr 28 2026)
// Route: /api/products/[id]   (id = shopify_product_id)
// ----------------------------------------------------------------------------
// GET    → fetch full product (parent fields + all variants)
// PATCH  → save edits to Shopify, mirror to DB
// ----------------------------------------------------------------------------
// M2.B additions:
//   - shopifyGraphQL helper (uses 2025-01 to match webhook version)
//   - PATCH now accepts collections_join_ids + collections_leave_ids and
//     fires productUpdate mutation to add/remove the product from collections
//   - PATCH also accepts the new full collections array for DB mirror
// ============================================================================

import { NextResponse } from 'next/server';
// NOTE: Use relative import — Next.js 16 Turbopack sometimes fails @/lib alias on new files
import { createServerClient } from '../../../../lib/supabase.js';
import { calculateSeoScore } from '../../../../lib/seo-score.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-01';        // REST
const GRAPHQL_VERSION = '2025-01';    // GraphQL (matches webhook + lib/shopify.js)

// ── Shopify REST helper ─────────────────────────────────────────────────────
async function shopifyRequest(endpoint, { method = 'GET', body = null } = {}) {
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
    const errMsg = data?.errors ? JSON.stringify(data.errors) : text;
    throw new Error(`Shopify ${method} ${endpoint} failed (${res.status}): ${errMsg}`);
  }
  return data;
}

// ── Shopify GraphQL helper (M2.B — for collections mutations) ───────────────
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
  if (!res.ok) {
    throw new Error(`Shopify GraphQL ${res.status}: ${text.slice(0, 400)}`);
  }
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Shopify GraphQL non-JSON response: ${text.slice(0, 400)}`); }
  if (json.errors) {
    throw new Error(`GraphQL: ${json.errors.map(e => e.message).join('; ')}`);
  }
  return json;
}

// ── Location ID helper (cached for this request) ───────────────────────────
let _cachedLocationId = null;
async function getPrimaryLocationId() {
  if (_cachedLocationId) return _cachedLocationId;
  const data = await shopifyRequest('locations.json');
  const loc = (data.locations || []).find(l => l.active) || data.locations?.[0];
  if (!loc) throw new Error('No active Shopify location');
  _cachedLocationId = String(loc.id);
  return _cachedLocationId;
}

// ── Set inventory level for a variant ──────────────────────────────────────
async function setInventoryLevel(inventoryItemId, locationId, qty) {
  return shopifyRequest('inventory_levels/set.json', {
    method: 'POST',
    body: {
      location_id: Number(locationId),
      inventory_item_id: Number(inventoryItemId),
      available: Number(qty) || 0,
    },
  });
}

// ── Enable inventory tracking on a variant if not already ─────────────────
async function ensureInventoryTracking(variantId) {
  return shopifyRequest(`variants/${variantId}.json`, {
    method: 'PUT',
    body: { variant: { id: variantId, inventory_management: 'shopify' } },
  });
}

// ── M2.K — Convert weight + unit to grams ──
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

// ── Metafield helper (for SEO meta title/description) ──────────────────────
async function upsertMetafield(productId, namespace, key, value, type = 'single_line_text_field') {
  if (!value) {
    // Empty value: try to delete existing if it exists
    try {
      const listing = await shopifyRequest(`products/${productId}/metafields.json?namespace=${namespace}&key=${key}`);
      const existing = (listing.metafields || []).find(m => m.namespace === namespace && m.key === key);
      if (existing) {
        await shopifyRequest(`metafields/${existing.id}.json`, { method: 'DELETE' });
      }
    } catch (e) { /* silent — metafield may not exist */ }
    return;
  }

  const listing = await shopifyRequest(`products/${productId}/metafields.json?namespace=${namespace}&key=${key}`);
  const existing = (listing.metafields || []).find(m => m.namespace === namespace && m.key === key);
  if (existing) {
    return shopifyRequest(`metafields/${existing.id}.json`, {
      method: 'PUT',
      body: { metafield: { id: existing.id, value, type } },
    });
  }
  return shopifyRequest(`products/${productId}/metafields.json`, {
    method: 'POST',
    body: { metafield: { namespace, key, value, type } },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// GET — Fetch product by shopify_product_id (returns parent + variants)
// ────────────────────────────────────────────────────────────────────────────
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Product id required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const productId = String(id);

    // Fetch all variant rows for this product
    const { data: rows, error } = await supabase
      .from('products')
      .select('*')
      .eq('shopify_product_id', productId);

    if (error) throw error;
    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Product not found' }, { status: 404 });
    }

    // First row carries all product-level fields (they're duplicated across variants by design)
    const first = rows[0];

    // M2.D — fetch Google Shopping metafields (best-effort)
    const googleMeta = { age_group: null, gender: null, condition: null, mpn: null };
    try {
      const metaRes = await shopifyRequest(`products/${productId}/metafields.json?namespace=google`);
      for (const m of metaRes.metafields || []) {
        if (m.key in googleMeta) googleMeta[m.key] = m.value;
      }
    } catch (e) {
      // Silent — metafields are best-effort. Editor handles null values.
    }

    const product = {
      shopify_product_id: productId,
      // Product-level fields
      title: first.parent_title || '',
      description_html: first.description_html || '',
      vendor: first.vendor || '',
      product_type: first.category || '',  // legacy: stored as `category`
      tags: Array.isArray(first.tags) ? first.tags : [],
      handle: first.handle || '',
      shopify_status: first.shopify_status || (first.is_active ? 'active' : 'draft'),
      seo_meta_title: first.seo_meta_title || '',
      seo_meta_description: first.seo_meta_description || '',
      images_data: Array.isArray(first.images_data) ? first.images_data : [],
      collections: Array.isArray(first.collections) ? first.collections : [],
      seo_score: first.seo_score,
      seo_tier: first.seo_tier,
      seo_score_updated_at: first.seo_score_updated_at,
      // M2.D — Google Shopping metafields
      google_age_group: googleMeta.age_group || '',
      google_gender:    googleMeta.gender    || '',
      google_condition: googleMeta.condition || '',
      google_mpn:       googleMeta.mpn       || '',
      // Variants (sorted by id for stable display)
      variants: rows
        .map(v => ({
          id: v.id,
          shopify_variant_id: v.shopify_variant_id,
          shopify_inventory_item_id: v.shopify_inventory_item_id,
          title: v.title,
          variant_label: v.title && v.parent_title && v.title.startsWith(v.parent_title + ' - ')
            ? v.title.slice((v.parent_title + ' - ').length)
            : (v.title?.split(' - ').slice(1).join(' - ') || 'Default'),
          sku: v.sku,
          barcode: v.barcode,
          selling_price: v.selling_price,
          compare_at_price: v.compare_at_price,
          stock_quantity: v.stock_quantity,
          weight: v.weight,
          image_url: v.image_url,
          abc_90d: v.abc_90d,
          abc_180d: v.abc_180d,
          revenue_90d: v.revenue_90d,
          revenue_180d: v.revenue_180d,
          units_sold_90d: v.units_sold_90d,
          units_sold_180d: v.units_sold_180d,
        }))
        .sort((a, b) => (a.shopify_variant_id || '').localeCompare(b.shopify_variant_id || '')),
    };

    return NextResponse.json({ success: true, product });
  } catch (err) {
    console.error('[GET /api/products/[id]]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PATCH — Save edits to Shopify, mirror to DB
// Body: { title?, description_html?, vendor?, product_type?, tags?, handle?,
//         shopify_status?, seo_meta_title?, seo_meta_description?,
//         alt_texts?: [{ image_id, alt }, ...],
//         google_age_group?, google_gender?, google_condition?, google_mpn?,
//         ai_faqs?: [{q,a},...], ai_mf_occasion?: string[], ai_mf_set_contents?: string[],
//         ai_mf_stone_type?: string[], ai_mf_material?: string, ai_mf_color_finish?: string }
// ────────────────────────────────────────────────────────────────────────────
export async function PATCH(request, { params }) {
  const startTime = Date.now();
  const results = {};
  const errors = {};

  try {
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return NextResponse.json({
        success: false,
        error: 'Shopify credentials not configured',
      }, { status: 500 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Product id required' }, { status: 400 });
    }

    const productId = String(id);
    const body = await request.json();

    const {
      title,
      description_html,
      vendor,
      product_type,
      tags,
      handle,
      shopify_status,
      seo_meta_title,
      seo_meta_description,
      alt_texts,
      // M2.B — collections multi-select
      collections,                  // [{handle, title}] — full new state for DB mirror
      collections_join_ids,         // [numeric collection ids] — to ADD product to
      collections_leave_ids,        // [numeric collection ids] — to REMOVE product from
      // M2.D — variant edits
      variants_update,              // [{shopify_variant_id, price?, compare_at_price?, sku?, stock?}]
      // M2.D — image add/remove
      images_to_add,                // [{filename, attachment, alt}]
      images_to_remove,             // [shopify_image_id, ...]
      // M2.D — Google Shopping metafields
      google_age_group,
      google_gender,
      google_condition,
      google_mpn,
      // M2.J — AI Enhance product metafields (rszevar namespace)
      // Sent by editor pages when user clicks Apply in AI Enhance modal,
      // then clicks Save. Same metafields as the older list-page push flow.
      ai_faqs,                          // array of { q, a } objects
      ai_mf_occasion,                   // array of strings (list.single_line_text_field)
      ai_mf_set_contents,               // array of strings
      ai_mf_stone_type,                 // array of strings
      ai_mf_material,                   // single string
      ai_mf_color_finish,               // single string
      // M2.J — enhancement tracking. When set, the ai_enhancements row will be
      // marked as pushed at the end of this request, mirroring the inventory-list
      // push flow's tracking. Without this, apply-mode enhancements stay forever
      // in 'generated' state in the DB.
      ai_enhancement_id,
      // Phase 2 — adjustment history log fields (Apr 2026)
      // Top-level metadata applies to ALL variant changes in this save.
      // Each variants_update item can also include `previous` (snapshot of old
      // values) and `product_title` for log row enrichment.
      performed_by,
      performed_by_email,
      reason,
    } = body;

    // Phase 2 — Create supabase client EARLY (used for adjustment logging during
    // variant updates AND for DB mirror at end of handler).
    const supabase = createServerClient();

    // ── Step 1: Build core product update payload ──
    const productUpdate = { id: productId };
    let hasCoreUpdate = false;

    if (typeof title === 'string') { productUpdate.title = title; hasCoreUpdate = true; }
    if (typeof description_html === 'string') { productUpdate.body_html = description_html; hasCoreUpdate = true; }
    if (typeof vendor === 'string') { productUpdate.vendor = vendor; hasCoreUpdate = true; }
    if (typeof product_type === 'string') { productUpdate.product_type = product_type; hasCoreUpdate = true; }
    if (Array.isArray(tags)) {
      productUpdate.tags = tags.filter(t => t && String(t).trim()).join(', ');
      hasCoreUpdate = true;
    }
    if (typeof handle === 'string' && handle.trim()) { productUpdate.handle = handle.trim(); hasCoreUpdate = true; }
    if (shopify_status && ['active', 'draft', 'archived'].includes(shopify_status)) {
      productUpdate.status = shopify_status;
      hasCoreUpdate = true;
    }

    if (hasCoreUpdate) {
      try {
        const updateRes = await shopifyRequest(`products/${productId}.json`, {
          method: 'PUT',
          body: { product: productUpdate },
        });
        results.product_update = {
          success: true,
          fields: Object.keys(productUpdate).filter(k => k !== 'id'),
        };
        // Capture Shopify's authoritative response (e.g. handle may differ if collision)
        results._shopify_product = updateRes.product;
      } catch (e) {
        errors.product_update = e.message;
      }
    }

    // ── Step 2: SEO metafields (separate API calls) ──
    if (typeof seo_meta_title === 'string') {
      try {
        await upsertMetafield(productId, 'global', 'title_tag', seo_meta_title, 'single_line_text_field');
        results.seo_meta_title = { success: true };
      } catch (e) {
        errors.seo_meta_title = e.message;
      }
    }

    if (typeof seo_meta_description === 'string') {
      try {
        await upsertMetafield(productId, 'global', 'description_tag', seo_meta_description, 'multi_line_text_field');
        results.seo_meta_description = { success: true };
      } catch (e) {
        errors.seo_meta_description = e.message;
      }
    }

    // ── Step 2.5: Collections add/remove via GraphQL (M2.B) ──
    // Editor sends numeric collection IDs computed via diff of master list.
    // We translate to GIDs and fire a single productUpdate mutation.
    const joinIds  = Array.isArray(collections_join_ids)  ? collections_join_ids.filter(Boolean)  : [];
    const leaveIds = Array.isArray(collections_leave_ids) ? collections_leave_ids.filter(Boolean) : [];

    if (joinIds.length > 0 || leaveIds.length > 0) {
      try {
        const productGid = `gid://shopify/Product/${productId}`;
        const toJoin  = joinIds.map(cid  => `gid://shopify/Collection/${cid}`);
        const toLeave = leaveIds.map(cid => `gid://shopify/Collection/${cid}`);

        const mutation = `
          mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id }
              userErrors { field message }
            }
          }
        `;

        const input = { id: productGid };
        if (toJoin.length > 0)  input.collectionsToJoin  = toJoin;
        if (toLeave.length > 0) input.collectionsToLeave = toLeave;

        const data = await shopifyGraphQL(mutation, { input });
        const userErrors = data?.data?.productUpdate?.userErrors || [];
        if (userErrors.length > 0) {
          throw new Error(userErrors.map(e => `${(e.field||[]).join('.')}: ${e.message}`).join('; '));
        }

        results.collections = {
          success: true,
          joined: toJoin.length,
          left: toLeave.length,
        };
      } catch (e) {
        errors.collections = e.message;
      }
    }

    // ── Step 3: Image alt texts ──
    if (Array.isArray(alt_texts) && alt_texts.length > 0) {
      const altResults = [];
      for (const entry of alt_texts) {
        if (!entry.image_id) continue;
        try {
          await shopifyRequest(`products/${productId}/images/${entry.image_id}.json`, {
            method: 'PUT',
            body: { image: { id: entry.image_id, alt: entry.alt || '' } },
          });
          altResults.push({ image_id: entry.image_id, success: true });
        } catch (e) {
          altResults.push({ image_id: entry.image_id, success: false, error: e.message });
        }
        await new Promise(r => setTimeout(r, 120));
      }
      results.alt_texts = altResults;
    }

    // ── Step 3.1: Variant updates (M2.D — price/compare-at/SKU/stock per variant) ──
    if (Array.isArray(variants_update) && variants_update.length > 0) {
      const variantResults = [];
      let locationId = null;

      for (const v of variants_update) {
        const vid = v.shopify_variant_id;
        if (!vid) continue;

        const variantPatch = {};
        if (v.price !== undefined && v.price !== '' && v.price !== null) variantPatch.price = String(v.price);
        if (v.compare_at_price !== undefined && v.compare_at_price !== null) variantPatch.compare_at_price = v.compare_at_price === '' ? null : String(v.compare_at_price);
        if (typeof v.sku === 'string') variantPatch.sku = v.sku;
        if (typeof v.barcode === 'string') variantPatch.barcode = v.barcode;
        // M2.K — image_id (per-variant image assignment). null/0/'' detaches.
        if (v.image_id !== undefined) {
          if (v.image_id === null || v.image_id === '' || v.image_id === 0) {
            variantPatch.image_id = null;
          } else {
            const imgIdNum = Number(v.image_id);
            if (Number.isFinite(imgIdNum) && imgIdNum > 0) {
              variantPatch.image_id = imgIdNum;
            }
          }
        }
        // M2.K — weight (frontend may send weight + weight_unit, OR just grams directly)
        if (v.grams !== undefined && v.grams !== null && v.grams !== '') {
          const g = Number(v.grams);
          if (Number.isFinite(g) && g >= 0) {
            variantPatch.grams = Math.round(g);
            variantPatch.weight = Math.round(g);     // weight in grams (matches weight_unit='g')
            variantPatch.weight_unit = 'g';
          }
        } else if (v.weight !== undefined && v.weight !== null && v.weight !== '') {
          const grams = computeGrams(v.weight, v.weight_unit);
          if (grams !== null) {
            variantPatch.grams = grams;
            variantPatch.weight = grams;             // weight in grams
            variantPatch.weight_unit = 'g';
          }
        }

        const hasFieldChange = Object.keys(variantPatch).length > 0;
        const hasStockChange = v.stock !== undefined && v.stock !== null && v.stock !== '';

        // Phase 2.1 — Anti-theft control: reject stock changes without a reason.
        // Frontend enforces this too, but we double-check server-side so direct
        // API calls (Postman, scripts, etc.) can't bypass the audit trail.
        if (hasStockChange) {
          const prevStock = Number(v.previous?.stock_quantity ?? 0);
          const newStock  = Number(v.stock);
          const stockActuallyChanged = prevStock !== newStock;
          if (stockActuallyChanged && !(typeof reason === 'string' && reason.trim().length > 0)) {
            variantResults.push({
              shopify_variant_id: vid,
              success: false,
              error: 'Stock change requires a reason. Please specify why stock is being adjusted (e.g. Restocked, Damaged, Manual count).',
              code: 'reason_required',
            });
            continue;
          }
        }

        const r = { shopify_variant_id: vid, success: true };

        // Field updates via PUT /variants/{id}
        if (hasFieldChange) {
          try {
            await shopifyRequest(`variants/${vid}.json`, {
              method: 'PUT',
              body: { variant: { id: vid, ...variantPatch } },
            });
            r.fields_updated = Object.keys(variantPatch);
          } catch (e) {
            r.success = false;
            r.error = e.message;
          }
        }

        // Stock update via inventory_levels/set
        if (hasStockChange && r.success) {
          try {
            // Need inventory_item_id for this variant — fetch if not provided
            let invItemId = v.shopify_inventory_item_id;
            if (!invItemId) {
              const variantData = await shopifyRequest(`variants/${vid}.json`);
              invItemId = variantData.variant?.inventory_item_id;
              if (variantData.variant?.inventory_management !== 'shopify') {
                // Enable tracking first
                await ensureInventoryTracking(vid);
              }
            }
            if (!invItemId) throw new Error('Could not resolve inventory_item_id');
            if (!locationId) locationId = await getPrimaryLocationId();
            await setInventoryLevel(invItemId, locationId, v.stock);
            r.stock_set = Number(v.stock);
          } catch (e) {
            r.success = false;
            r.stock_error = e.message;
          }
        }

        // ── Phase 2 — Write adjustment log rows ──
        // After SUCCESSFUL variant update, write granular log rows to
        // inventory_adjustments (one row per changed field). Best effort:
        // if logging fails, don't fail the user-facing save.
        if (r.success && (hasFieldChange || hasStockChange)) {
          const prev = v.previous || {};
          const variantLabel = prev.variant_label || null;
          const productTitle = v.product_title || null;
          const skuForLog = (typeof v.sku === 'string') ? v.sku : (prev.sku || null);

          const baseRow = {
            shopify_variant_id: String(vid),
            shopify_inventory_item_id: v.shopify_inventory_item_id ? String(v.shopify_inventory_item_id) : null,
            shopify_product_id: productId,
            variant_label: variantLabel,
            product_title: productTitle,
            sku: skuForLog,
            performed_by: performed_by || null,
            performed_by_email: performed_by_email || null,
            reason: reason || null,
            source: 'erp_variant_edit',
          };

          const logRows = [];

          // Stock change
          if (hasStockChange) {
            const newStock = Number(v.stock);
            const oldStock = Number(prev.stock_quantity ?? 0);
            if (newStock !== oldStock) {
              logRows.push({
                ...baseRow,
                activity: 'stock',
                description: `Manually adjusted: ${oldStock} → ${newStock}`,
                field_name: 'stock',
                old_value: String(oldStock),
                new_value: String(newStock),
                stock_before: oldStock,
                stock_after: newStock,
                stock_delta: newStock - oldStock,
              });
            }
          }

          // Price change
          if (variantPatch.price !== undefined) {
            const newP = String(variantPatch.price ?? '');
            const oldP = String(prev.selling_price ?? '');
            if (newP !== oldP) {
              logRows.push({
                ...baseRow,
                activity: 'price',
                description: `Price: Rs ${oldP || '0'} → Rs ${newP || '0'}`,
                field_name: 'selling_price',
                old_value: oldP,
                new_value: newP,
              });
            }
          }

          // Compare-at change
          if (variantPatch.compare_at_price !== undefined) {
            const newC = variantPatch.compare_at_price === null ? '' : String(variantPatch.compare_at_price);
            const oldC = String(prev.compare_at_price ?? '');
            if (newC !== oldC) {
              logRows.push({
                ...baseRow,
                activity: 'compare_at_price',
                description: `Compare-at: ${oldC || '—'} → ${newC || '—'}`,
                field_name: 'compare_at_price',
                old_value: oldC,
                new_value: newC,
              });
            }
          }

          // SKU change
          if (variantPatch.sku !== undefined) {
            const newS = String(variantPatch.sku || '');
            const oldS = String(prev.sku ?? '');
            if (newS !== oldS) {
              logRows.push({
                ...baseRow,
                activity: 'sku',
                description: `SKU: ${oldS || '—'} → ${newS || '—'}`,
                field_name: 'sku',
                old_value: oldS,
                new_value: newS,
              });
            }
          }

          // Barcode change
          if (variantPatch.barcode !== undefined) {
            const newB = String(variantPatch.barcode || '');
            const oldB = String(prev.barcode ?? '');
            if (newB !== oldB) {
              logRows.push({
                ...baseRow,
                activity: 'barcode',
                description: `Barcode: ${oldB || '—'} → ${newB || '—'}`,
                field_name: 'barcode',
                old_value: oldB,
                new_value: newB,
              });
            }
          }

          // Weight change (in grams)
          if (variantPatch.grams !== undefined) {
            const newW = String(variantPatch.grams);
            const oldW = String(prev.weight ?? '');
            if (newW !== oldW) {
              logRows.push({
                ...baseRow,
                activity: 'weight',
                description: `Weight: ${oldW || '0'}g → ${newW}g`,
                field_name: 'weight',
                old_value: oldW,
                new_value: newW,
              });
            }
          }

          // Bulk-insert all log rows for this variant (best effort)
          if (logRows.length > 0) {
            try {
              const { error: logErr } = await supabase
                .from('inventory_adjustments')
                .insert(logRows);
              if (logErr) {
                r.log_error = logErr.message;
              } else {
                r.log_entries = logRows.length;
              }
            } catch (logErr) {
              r.log_error = logErr.message;
            }
          }
        }

        variantResults.push(r);
        await new Promise(r => setTimeout(r, 150));
      }
      results.variants_update = variantResults;
    }

    // ── Step 3.2: Image add (M2.D) ──
    if (Array.isArray(images_to_add) && images_to_add.length > 0) {
      const addResults = [];
      for (const img of images_to_add) {
        if (!img || !img.attachment) continue;
        try {
          const imgRes = await shopifyRequest(`products/${productId}/images.json`, {
            method: 'POST',
            body: {
              image: {
                attachment: img.attachment,
                filename: img.filename || `image-${Date.now()}.jpg`,
                alt: img.alt || '',
              },
            },
          });
          addResults.push({ filename: img.filename, success: true, id: imgRes.image?.id });
        } catch (e) {
          addResults.push({ filename: img.filename, success: false, error: e.message });
        }
        await new Promise(r => setTimeout(r, 250));
      }
      results.images_added = addResults;
    }

    // ── Step 3.2b: Image remove (M2.D) ──
    if (Array.isArray(images_to_remove) && images_to_remove.length > 0) {
      const removeResults = [];
      for (const imgId of images_to_remove) {
        if (!imgId) continue;
        try {
          await shopifyRequest(`products/${productId}/images/${imgId}.json`, { method: 'DELETE' });
          removeResults.push({ image_id: imgId, success: true });
        } catch (e) {
          removeResults.push({ image_id: imgId, success: false, error: e.message });
        }
        await new Promise(r => setTimeout(r, 150));
      }
      results.images_removed = removeResults;
    }

    // ── Step 3.3: Google Shopping metafields (M2.D) ──
    const googleFields = [
      { key: 'age_group', value: google_age_group },
      { key: 'gender',    value: google_gender },
      { key: 'condition', value: google_condition },
      { key: 'mpn',       value: google_mpn },
    ];
    const googleHasAny = googleFields.some(f => f.value !== undefined);
    if (googleHasAny) {
      const googleResults = [];
      for (const f of googleFields) {
        if (f.value === undefined) continue;   // not in payload — skip
        try {
          await upsertMetafield(productId, 'google', f.key, f.value, 'single_line_text_field');
          googleResults.push({ key: f.key, success: true });
        } catch (e) {
          googleResults.push({ key: f.key, success: false, error: e.message });
        }
        await new Promise(r => setTimeout(r, 100));
      }
      results.google_metafields = googleResults;
    }

    // ── Step 3.4: AI Enhance product metafields (M2.J) ──
    // Writes to rszevar namespace. Same shape as the inventory-list push flow
    // so the resulting product has identical metafield coverage regardless
    // of whether content was applied via single-page editor or pushed via list.
    const aiMetafieldMap = [
      {
        param:  ai_faqs,
        mf_key: 'faqs',
        type:   'json',
        kind:   'json',                  // serialize whole array
      },
      {
        param:  ai_mf_occasion,
        mf_key: 'occasion',
        type:   'list.single_line_text_field',
        kind:   'list',
      },
      {
        param:  ai_mf_set_contents,
        mf_key: 'set_contents',
        type:   'list.single_line_text_field',
        kind:   'list',
      },
      {
        param:  ai_mf_stone_type,
        mf_key: 'stone_type',
        type:   'list.single_line_text_field',
        kind:   'list',
      },
      {
        param:  ai_mf_material,
        mf_key: 'material',
        type:   'single_line_text_field',
        kind:   'string',
      },
      {
        param:  ai_mf_color_finish,
        mf_key: 'color_finish',
        type:   'single_line_text_field',
        kind:   'string',
      },
    ];

    const aiMetaResults = [];
    for (const mf of aiMetafieldMap) {
      // undefined → field not in payload → skip entirely (don't touch existing)
      if (mf.param === undefined) continue;

      // Validate by kind
      let stringValue;
      if (mf.kind === 'list') {
        if (!Array.isArray(mf.param) || mf.param.length === 0) continue;
        stringValue = JSON.stringify(mf.param.map(v => String(v).trim()).filter(Boolean));
      } else if (mf.kind === 'json') {
        if (!Array.isArray(mf.param) || mf.param.length === 0) continue;
        stringValue = JSON.stringify(mf.param);
      } else { // string
        if (typeof mf.param !== 'string' || !mf.param.trim()) continue;
        stringValue = mf.param.trim();
      }

      try {
        await upsertMetafield(productId, 'rszevar', mf.mf_key, stringValue, mf.type);
        aiMetaResults.push({ key: mf.mf_key, success: true });
      } catch (e) {
        aiMetaResults.push({ key: mf.mf_key, success: false, error: e.message });
      }
      await new Promise(r => setTimeout(r, 120));   // rate limit
    }
    if (aiMetaResults.length > 0) results.ai_metafields = aiMetaResults;

    // ── Step 4: Mirror to DB ──
    // Update DB based on what was successfully pushed. We DO NOT wait for
    // Shopify webhook — mirror immediately so UI shows fresh data on save.
    // (supabase client created earlier at top of handler — Phase 2)
    const dbUpdate = {};

    if (typeof title === 'string') dbUpdate.parent_title = title;
    if (typeof description_html === 'string') dbUpdate.description_html = description_html;
    if (typeof vendor === 'string') dbUpdate.vendor = vendor;
    if (typeof product_type === 'string') dbUpdate.category = product_type;
    if (Array.isArray(tags)) dbUpdate.tags = tags.filter(t => t && String(t).trim());
    if (typeof handle === 'string' && handle.trim()) {
      // Use whatever Shopify returned (may differ if handle collided)
      dbUpdate.handle = results._shopify_product?.handle || handle.trim();
    }
    if (shopify_status) {
      dbUpdate.shopify_status = shopify_status;
      dbUpdate.is_active = shopify_status === 'active';
    }
    if (typeof seo_meta_title === 'string') dbUpdate.seo_meta_title = seo_meta_title || null;
    if (typeof seo_meta_description === 'string') dbUpdate.seo_meta_description = seo_meta_description || null;

    // M2.B — mirror collections to DB (strip id, store {handle, title} to match
    // existing JSONB shape used by sync-collections route)
    if (Array.isArray(collections)) {
      dbUpdate.collections = collections
        .filter(c => c && c.handle)
        .map(c => ({ handle: c.handle, title: c.title || c.handle }));
    }

    // Update images_data if alt texts changed
    if (Array.isArray(alt_texts) && alt_texts.length > 0) {
      // Fetch current images_data
      const { data: firstRow } = await supabase
        .from('products')
        .select('images_data')
        .eq('shopify_product_id', productId)
        .limit(1)
        .maybeSingle();

      if (firstRow && Array.isArray(firstRow.images_data)) {
        const altMap = new Map(alt_texts.map(e => [String(e.image_id), e.alt || '']));
        const newImages = firstRow.images_data.map(img =>
          altMap.has(String(img.id)) ? { ...img, alt: altMap.get(String(img.id)) } : img
        );
        dbUpdate.images_data = newImages;
      }
    }

    if (Object.keys(dbUpdate).length > 0) {
      dbUpdate.updated_at = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from('products')
        .update(dbUpdate)
        .eq('shopify_product_id', productId);
      if (updateErr) {
        errors.db_mirror = updateErr.message;
      } else {
        results.db_mirror = { success: true, fields: Object.keys(dbUpdate) };
      }
    }

    // ── Step 4.5: Full refetch when variant/image structure changed (M2.D) ──
    // Variant edits change variant rows; image add/remove changes images_data.
    // Shopify will fire products/update webhook for these, but to make the UI
    // immediately consistent we do a quick refetch + upsert here.
    const needsFullRefetch =
      (Array.isArray(variants_update) && variants_update.length > 0) ||
      (Array.isArray(images_to_add) && images_to_add.length > 0) ||
      (Array.isArray(images_to_remove) && images_to_remove.length > 0);

    if (needsFullRefetch) {
      try {
        // Lazy import — relative path counted from this route file
        const { transformProducts } = await import('../../../../lib/shopify.js');
        const fetchRes = await shopifyRequest(`products/${productId}.json`);
        const variantRows = transformProducts(fetchRes.product);
        // Preserve collections from existing DB row (transformProducts doesn't carry them)
        const { data: existing } = await supabase
          .from('products')
          .select('collections')
          .eq('shopify_product_id', productId)
          .limit(1)
          .maybeSingle();
        if (existing?.collections) {
          for (const v of variantRows) v.collections = existing.collections;
        }
        const { error: upErr } = await supabase
          .from('products')
          .upsert(variantRows, { onConflict: 'shopify_variant_id' });
        if (upErr) errors.full_refetch = upErr.message;
        else results.full_refetch = { success: true, variants: variantRows.length };
      } catch (e) {
        errors.full_refetch = e.message;
      }
    }

    // ── Step 5: Recompute SEO score (uses fresh data) ──
    try {
      const { data: rep } = await supabase
        .from('products')
        .select('parent_title, description_html, tags, handle, seo_meta_title, seo_meta_description, images_data')
        .eq('shopify_product_id', productId)
        .limit(1)
        .maybeSingle();

      if (rep) {
        const { score, tier } = calculateSeoScore(rep);
        await supabase
          .from('products')
          .update({
            seo_score: score,
            seo_tier: tier,
            seo_score_updated_at: new Date().toISOString(),
          })
          .eq('shopify_product_id', productId);
        results.seo_recompute = { success: true, score, tier };
      }
    } catch (e) {
      errors.seo_recompute = e.message;
    }

    // Strip internal helper before returning
    delete results._shopify_product;

    const anySuccess = Object.keys(results).length > 0;
    const anyError = Object.keys(errors).length > 0;

    // ── Step 6: M2.J — mark ai_enhancements row as pushed ──
    // Mirrors the inventory-list push flow's tracking so analytics & cost
    // dashboards see the same lifecycle for both flows.
    if (ai_enhancement_id) {
      try {
        // Compute fields_pushed list from what was sent + what succeeded.
        // Visible fields come from the body keys; metafields come from result keys.
        const fieldsPushed = [];
        if (typeof title === 'string')                  fieldsPushed.push('title');
        if (typeof description_html === 'string')       fieldsPushed.push('description');
        if (typeof seo_meta_title === 'string')         fieldsPushed.push('meta_title');
        if (typeof seo_meta_description === 'string')   fieldsPushed.push('meta_description');
        if (typeof handle === 'string' && handle.trim())fieldsPushed.push('url_handle');
        if (Array.isArray(tags))                        fieldsPushed.push('tags');
        if (Array.isArray(alt_texts) && alt_texts.length > 0) fieldsPushed.push('alt_texts');
        if (Array.isArray(ai_faqs) && ai_faqs.length > 0)     fieldsPushed.push('faqs');
        if (Array.isArray(ai_mf_occasion))     fieldsPushed.push('mf_occasion');
        if (Array.isArray(ai_mf_set_contents)) fieldsPushed.push('mf_set_contents');
        if (Array.isArray(ai_mf_stone_type))   fieldsPushed.push('mf_stone_type');
        if (typeof ai_mf_material === 'string'     && ai_mf_material.trim())     fieldsPushed.push('mf_material');
        if (typeof ai_mf_color_finish === 'string' && ai_mf_color_finish.trim()) fieldsPushed.push('mf_color_finish');

        await supabase
          .from('ai_enhancements')
          .update({
            pushed_to_shopify: anySuccess,
            pushed_at: anySuccess ? new Date().toISOString() : null,
            status: anySuccess && !anyError ? 'pushed' : (anySuccess ? 'partial' : 'failed'),
            fields_pushed: fieldsPushed,
            pushed_output: {
              title: typeof title === 'string' ? title : null,
              body_html: typeof description_html === 'string' ? description_html : null,
              handle: typeof handle === 'string' ? handle : null,
              tags: Array.isArray(tags) ? tags.join(', ') : null,
              meta_title: typeof seo_meta_title === 'string' ? seo_meta_title : null,
              meta_description: typeof seo_meta_description === 'string' ? seo_meta_description : null,
              applied_via: 'editor',  // distinguishes from list-page push
            },
            push_response: { results, errors },
            push_error: anyError ? JSON.stringify(errors) : null,
          })
          .eq('id', ai_enhancement_id);
        results.ai_enhancement_marked = { success: true };
      } catch (e) {
        // Non-fatal — save already succeeded; just log.
        console.warn('[PATCH] failed to mark ai_enhancement', e.message);
        errors.ai_enhancement_marked = e.message;
      }
    }

    return NextResponse.json({
      success: anySuccess && !anyError,
      partial: anySuccess && anyError,
      message: anyError
        ? (anySuccess ? 'Partially saved — some operations failed' : 'Save failed')
        : 'Saved successfully',
      results,
      errors: anyError ? errors : undefined,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[PATCH /api/products/[id]]', err);
    return NextResponse.json({
      success: false,
      error: err.message,
      results,
      errors,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
