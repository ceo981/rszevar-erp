// ============================================================================
// RS ZEVAR ERP — Variant Image Assignment Endpoint (May 2026)
// POST /api/products/[id]/assign-variant-images
// ----------------------------------------------------------------------------
// PURPOSE: Apply variant_image_assignments to an EXISTING product. Used by the
// "+ Add Product" page after images have been uploaded one-at-a-time via
// /upload-image (which avoids the Vercel 4.5MB body limit for create flows
// with many images).
//
// ─── BACKGROUND ─────────────────────────────────────────────────────────────
// Originally the POST /api/products route uploaded all images IN-LINE during
// product creation, then assigned variant images using Step 2.5 logic. But
// that meant 6+ heavy images in one POST body could exceed Vercel's 4.5MB
// limit, causing the same "Request Entity Too Large" error users hit on the
// edit page (Issue 6 reported May 2026).
//
// New flow on the create page:
//   1. POST /api/products with NO images (just metadata + variants)
//   2. Sequential POST /api/products/[id]/upload-image (one image at a time)
//   3. POST /api/products/[id]/assign-variant-images (this endpoint)
//
// ─── REQUEST BODY ───────────────────────────────────────────────────────────
//   {
//     assignments: {
//       "Black":         "12345",   // group key (option1 = Black)
//       "Black|2.4|":    "67890",   // composite key (option1|option2|option3)
//       ...
//     }
//   }
// Values are Shopify image IDs (already resolved frontend-side after uploads).
//
// ─── RESPONSE ───────────────────────────────────────────────────────────────
//   { success, results: [{ variant_id, success, image_id?, error? }] }
//
// ─── KEY RESOLUTION ─────────────────────────────────────────────────────────
//   For each variant on the product, build subKey + groupKey from option1/2/3.
//   - subKey   = `${option1}|${option2 ?? ''}|${option3 ?? ''}`
//   - groupKey = option1
//   Composite (subKey) wins; falls back to groupKey. This mirrors the original
//   Step 2.5 logic in /api/products/route.js POST.
// ============================================================================

import { NextResponse } from 'next/server';

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

    const { assignments } = await request.json();
    if (!assignments || typeof assignments !== 'object' || Object.keys(assignments).length === 0) {
      return NextResponse.json(
        { success: true, message: 'No assignments to apply', results: [] },
      );
    }

    // ── Fetch product to get variant list ──
    const productRes = await shopifyREST(`products/${id}.json`);
    const variants = productRes.product?.variants || [];
    if (variants.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Product has no variants' },
        { status: 400 },
      );
    }

    // ── Apply per-variant image assignment ──
    const results = [];
    for (const cv of variants) {
      const subKey   = `${cv.option1 ?? ''}|${cv.option2 ?? ''}|${cv.option3 ?? ''}`;
      const groupKey = cv.option1 ?? '';

      // Composite override wins; fall back to group default.
      let imageId = assignments[subKey];
      let resolvedFrom = 'sub';
      if (imageId === undefined || imageId === null) {
        imageId = assignments[groupKey];
        resolvedFrom = 'group';
      }
      if (imageId === undefined || imageId === null) continue;

      try {
        await shopifyREST(`variants/${cv.id}.json`, {
          method: 'PUT',
          body: { variant: { id: cv.id, image_id: String(imageId) } },
        });
        results.push({
          variant_id: cv.id,
          sub_key: subKey,
          group_key: groupKey,
          resolved_from: resolvedFrom,
          image_id: String(imageId),
          success: true,
        });
      } catch (e) {
        results.push({
          variant_id: cv.id,
          sub_key: subKey,
          group_key: groupKey,
          success: false,
          error: e.message,
        });
      }
      // Throttle to be kind to Shopify rate limits (2 req/sec standard)
      await new Promise(r => setTimeout(r, 200));
    }

    const allSucceeded = results.every(r => r.success);

    return NextResponse.json({
      success: allSucceeded,
      partial: !allSucceeded && results.some(r => r.success),
      total: results.length,
      results,
      duration_ms: Date.now() - startTime,
    });
  } catch (e) {
    console.error('[assign-variant-images] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
