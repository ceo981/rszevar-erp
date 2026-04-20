route.js// =====================================================================
// RS ZEVAR ERP — AI Enhance: Push to Shopify
// File: app/api/ai/push-to-shopify/route.js
//
// POST body:
//   {
//     enhancement_id: "uuid",
//     fields_to_push: {
//       title: true | false,
//       title_override: "...custom title if user edited suggestion...",
//       description: true | false,
//       description_override: "...",    // if user edited in preview
//       meta_title: true | false,
//       meta_description: true | false,
//       url_handle: true | false,
//       tags: true | false,
//       alt_texts: true | false,
//       faqs: true | false               // stored as metafield for future schema use
//     }
//   }
//
// Returns:
//   { success, results: { title_updated, description_updated, ... }, errors }
// =====================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-01';

// ── Small Shopify REST helpers (self-contained — no external deps) ──
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

// ── Set or update a single product metafield ──
async function upsertMetafield(productId, namespace, key, value, type = 'single_line_text_field') {
  // List existing metafields for this product
  const listing = await shopifyRequest(
    `products/${productId}/metafields.json?namespace=${namespace}&key=${key}`
  );
  const existing = (listing.metafields || []).find(
    m => m.namespace === namespace && m.key === key
  );

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

// =====================================================================
// POST handler
// =====================================================================
export async function POST(request) {
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

    const body = await request.json();
    const { enhancement_id, fields_to_push } = body;

    if (!enhancement_id || !fields_to_push) {
      return NextResponse.json({
        success: false,
        error: 'Missing enhancement_id or fields_to_push',
      }, { status: 400 });
    }

    // ─── Load the enhancement record ───
    const supabase = createServerClient();
    const { data: enh, error: fetchErr } = await supabase
      .from('ai_enhancements')
      .select('*')
      .eq('id', enhancement_id)
      .single();

    if (fetchErr || !enh) {
      return NextResponse.json({
        success: false,
        error: 'Enhancement record not found: ' + (fetchErr?.message || 'unknown'),
      }, { status: 404 });
    }

    const productId = enh.shopify_product_id;
    const g = enh.generated_output || {};

    if (!productId) {
      return NextResponse.json({
        success: false,
        error: 'Enhancement has no shopify_product_id',
      }, { status: 400 });
    }

    // =================================================================
    // STEP 1: Update core product fields (title, body_html, handle, tags)
    // =================================================================
    const productUpdate = { id: productId };
    let productUpdateNeeded = false;

    if (fields_to_push.title) {
      const titleToPush = fields_to_push.title_override || g.title_suggestions?.[0]?.title;
      if (titleToPush) {
        productUpdate.title = titleToPush;
        productUpdateNeeded = true;
      }
    }

    if (fields_to_push.description) {
      const descToPush = fields_to_push.description_override || g.description_html;
      if (descToPush) {
        productUpdate.body_html = descToPush;
        productUpdateNeeded = true;
      }
    }

    if (fields_to_push.url_handle && g.url_handle) {
      productUpdate.handle = g.url_handle;
      productUpdateNeeded = true;
    }

    if (fields_to_push.tags && Array.isArray(g.tags)) {
      productUpdate.tags = g.tags.join(', ');
      productUpdateNeeded = true;
    }

    if (productUpdateNeeded) {
      try {
        const updateRes = await shopifyRequest(`products/${productId}.json`, {
          method: 'PUT',
          body: { product: productUpdate },
        });
        results.product_update = {
          success: true,
          fields: Object.keys(productUpdate).filter(k => k !== 'id'),
        };

        // Mirror core fields back into ERP DB so sidebar stays in sync
        const erpUpdate = {};
        if (productUpdate.title) erpUpdate.parent_title = productUpdate.title;
        if (Object.keys(erpUpdate).length > 0) {
          await supabase
            .from('products')
            .update(erpUpdate)
            .eq('shopify_product_id', productId);
        }
      } catch (e) {
        errors.product_update = e.message;
      }
    }

    // =================================================================
    // STEP 2: Update SEO metafields (meta_title → global.title_tag,
    //                                 meta_description → global.description_tag)
    // =================================================================
    if (fields_to_push.meta_title && g.meta_title) {
      try {
        await upsertMetafield(productId, 'global', 'title_tag', g.meta_title, 'single_line_text_field');
        results.meta_title = { success: true, value: g.meta_title };
      } catch (e) {
        errors.meta_title = e.message;
      }
    }

    if (fields_to_push.meta_description && g.meta_description) {
      try {
        await upsertMetafield(
          productId, 'global', 'description_tag', g.meta_description, 'multi_line_text_field'
        );
        results.meta_description = { success: true, value: g.meta_description };
      } catch (e) {
        errors.meta_description = e.message;
      }
    }

    // =================================================================
    // STEP 3: Update image alt texts (fetch live images, match by position)
    // =================================================================
    if (fields_to_push.alt_texts && Array.isArray(g.alt_texts) && g.alt_texts.length > 0) {
      try {
        const imgList = await shopifyRequest(`products/${productId}/images.json`);
        const images = (imgList.images || []).sort((a, b) => a.position - b.position);

        const altResults = [];
        for (const altEntry of g.alt_texts) {
          const targetImg = images[altEntry.position - 1];
          if (!targetImg) continue;

          try {
            await shopifyRequest(`products/${productId}/images/${targetImg.id}.json`, {
              method: 'PUT',
              body: { image: { id: targetImg.id, alt: altEntry.alt } },
            });
            altResults.push({ position: altEntry.position, success: true });
          } catch (e) {
            altResults.push({ position: altEntry.position, success: false, error: e.message });
          }
          // tiny pause to respect Shopify rate limits
          await new Promise(r => setTimeout(r, 150));
        }
        results.alt_texts = { success: true, updates: altResults };
      } catch (e) {
        errors.alt_texts = e.message;
      }
    }

    // =================================================================
    // STEP 4: FAQs → stored as custom metafield (for schema markup later)
    // =================================================================
    if (fields_to_push.faqs && Array.isArray(g.faqs) && g.faqs.length > 0) {
      try {
        await upsertMetafield(
          productId,
          'rszevar',
          'faqs',
          JSON.stringify(g.faqs),
          'json'
        );
        results.faqs = { success: true, count: g.faqs.length };
      } catch (e) {
        errors.faqs = e.message;
      }
    }

    // =================================================================
    // STEP 5: Mark enhancement as pushed
    // =================================================================
    const anySuccess = Object.keys(results).length > 0;
    const anyErrors = Object.keys(errors).length > 0;

    const fieldsPushed = Object.keys(fields_to_push).filter(k => fields_to_push[k] === true);

    await supabase
      .from('ai_enhancements')
      .update({
        pushed_to_shopify: anySuccess,
        pushed_at: anySuccess ? new Date().toISOString() : null,
        status: anySuccess && !anyErrors ? 'pushed' : (anySuccess ? 'partial' : 'failed'),
        fields_pushed: fieldsPushed,
        pushed_output: {
          title: productUpdate.title,
          body_html: productUpdate.body_html,
          handle: productUpdate.handle,
          tags: productUpdate.tags,
          meta_title: fields_to_push.meta_title ? g.meta_title : null,
          meta_description: fields_to_push.meta_description ? g.meta_description : null,
        },
        push_response: { results, errors },
        push_error: anyErrors ? JSON.stringify(errors) : null,
      })
      .eq('id', enhancement_id);

    return NextResponse.json({
      success: anySuccess,
      partial: anySuccess && anyErrors,
      message: anySuccess
        ? (anyErrors ? 'Partially pushed — some fields failed' : 'All selected fields pushed to Shopify')
        : 'Push failed — nothing was updated',
      results,
      errors: anyErrors ? errors : undefined,
      duration_ms: Date.now() - startTime,
    });

  } catch (err) {
    console.error('[push-to-shopify] error:', err);
    return NextResponse.json({
      success: false,
      error: err.message,
      results,
      errors,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
