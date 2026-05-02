// ============================================================================
// RS ZEVAR ERP — Image Reorder Endpoint (May 2026)
// POST /api/products/[id]/reorder-images
// ----------------------------------------------------------------------------
// PURPOSE: Reorder images on a Shopify product. Given an ordered list of image
// IDs, sends one PUT per image to update its position. Then mirrors new
// positions to DB (images_data).
//
// REQUEST BODY:
//   { image_ids: [string, string, ...] }   // new order, position 1 = first
//
// RESPONSE:
//   { success, results: [{ image_id, position, success }] }
//
// WHY SEPARATE ENDPOINT:
//   The main PATCH route was getting bloated. Reorder is a focused, fast op
//   (1 PUT per image) — ~2-3s total for a 10-image product. Lives next to
//   /upload-image for clean separation of "image management" vs "product edit".
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION    = '2024-01';

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
    throw new Error(`Shopify ${method} ${endpoint} failed (${res.status}): ${data?.errors ? JSON.stringify(data.errors) : text.slice(0, 200)}`);
  }
  return data;
}

export async function POST(request, { params }) {
  const startTime = Date.now();

  try {
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return NextResponse.json(
        { success: false, error: 'Shopify credentials not configured' },
        { status: 500 },
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Product id required' },
        { status: 400 },
      );
    }

    const { image_ids } = await request.json();
    if (!Array.isArray(image_ids) || image_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'image_ids array required' },
        { status: 400 },
      );
    }

    const productId = String(id);

    // ── Update each image's position via PUT ──
    // Shopify's REST API: PUT /products/{id}/images/{image_id}.json
    // Body: { image: { id, position } } — position is 1-indexed.
    const results = [];
    for (let i = 0; i < image_ids.length; i++) {
      const imgId = String(image_ids[i]);
      const newPos = i + 1; // 1-indexed
      try {
        await shopifyREST(`products/${productId}/images/${imgId}.json`, {
          method: 'PUT',
          body: { image: { id: imgId, position: newPos } },
        });
        results.push({ image_id: imgId, position: newPos, success: true });
      } catch (e) {
        results.push({ image_id: imgId, position: newPos, success: false, error: e.message });
      }
      // Throttle to avoid Shopify rate limits (2 req/sec on standard plan)
      if (i < image_ids.length - 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const allSucceeded = results.every(r => r.success);

    // ── Mirror new order to DB images_data (best-effort) ──
    // Webhook products/update will fire from Shopify and reconcile, but we
    // update inline so the editor reflects the change immediately.
    try {
      const supabase = createServerClient();
      const { data: firstRow } = await supabase
        .from('products')
        .select('images_data')
        .eq('shopify_product_id', productId)
        .limit(1)
        .maybeSingle();

      if (firstRow && Array.isArray(firstRow.images_data)) {
        // Build position map from the ordered image_ids
        const posMap = new Map();
        image_ids.forEach((id, idx) => posMap.set(String(id), idx + 1));

        // Update positions; sort by new position
        const updated = firstRow.images_data
          .map(img => ({
            ...img,
            position: posMap.has(String(img.id)) ? posMap.get(String(img.id)) : (img.position || 999),
          }))
          .sort((a, b) => (a.position || 999) - (b.position || 999));

        await supabase
          .from('products')
          .update({ images_data: updated, updated_at: new Date().toISOString() })
          .eq('shopify_product_id', productId);
      }
    } catch (e) {
      console.warn('[reorder-images] DB mirror failed (webhook will catch up):', e.message);
    }

    return NextResponse.json({
      success: allSucceeded,
      partial: !allSucceeded && results.some(r => r.success),
      results,
      duration_ms: Date.now() - startTime,
    });
  } catch (e) {
    console.error('[reorder-images] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
