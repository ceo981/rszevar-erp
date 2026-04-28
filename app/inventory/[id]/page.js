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
      // Variants (sorted by id for stable display)
      variants: rows
        .map(v => ({
          id: v.id,
          shopify_variant_id: v.shopify_variant_id,
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
//         alt_texts?: [{ image_id, alt }, ...] }
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
    } = body;

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

    // ── Step 4: Mirror to DB ──
    // Update DB based on what was successfully pushed. We DO NOT wait for
    // Shopify webhook — mirror immediately so UI shows fresh data on save.
    const supabase = createServerClient();
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
