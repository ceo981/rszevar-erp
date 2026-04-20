import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// RS ZEVAR ERP — AI Enhance: Push generated content to Shopify
// Takes enhancement_id + fields_to_push, updates product via REST API.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const API_VERSION = '2024-01';

async function shopifyRequest(endpoint, { method = 'GET', body = null } = {}) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const url = `https://${domain}/admin/api/${API_VERSION}/${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
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

async function upsertMetafield(productId, namespace, key, value, type = 'single_line_text_field') {
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

export async function POST(request) {
  const startTime = Date.now();
  const results = {};
  const errors = {};

  try {
    if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
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

    // ── Step 1: Update core product fields ──
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
        await shopifyRequest(`products/${productId}.json`, {
          method: 'PUT',
          body: { product: productUpdate },
        });
        results.product_update = {
          success: true,
          fields: Object.keys(productUpdate).filter(k => k !== 'id'),
        };

        // Mirror title back to ERP so sidebar stays in sync
        if (productUpdate.title) {
          await supabase
            .from('products')
            .update({ parent_title: productUpdate.title })
            .eq('shopify_product_id', productId);
        }
      } catch (e) {
        errors.product_update = e.message;
      }
    }

    // ── Step 2: SEO metafields ──
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

    // ── Step 3: Image alt texts ──
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
          await new Promise(r => setTimeout(r, 150));
        }
        results.alt_texts = { success: true, updates: altResults };
      } catch (e) {
        errors.alt_texts = e.message;
      }
    }

    // ── Step 4: FAQs as metafield ──
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

    // ── Step 5: Mark enhancement as pushed ──
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
