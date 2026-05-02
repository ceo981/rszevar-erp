// ============================================================================
// RS ZEVAR ERP — Single-Image Upload Endpoint (May 2026)
// POST /api/products/[id]/upload-image
// ----------------------------------------------------------------------------
// PURPOSE: Upload ONE image at a time to a Shopify product. The frontend's
// editor calls this sequentially (one request per image) instead of stuffing
// all base64 attachments into the main PATCH body.
//
// WHY: Vercel's serverless function body limit is 4.5 MB. A 2000×2000 JPEG
// at 85% quality after base64 encoding is roughly 600 KB - 1 MB. Sending 4-5
// images in one PATCH body easily blew past the limit, returning plain text
// "Request Entity Too Large" → frontend "Unexpected token 'R'..." JSON parse
// error. Per-image uploads stay safely under the limit.
//
// REQUEST BODY:
//   { filename: string, attachment: base64-string, alt?: string }
//
// RESPONSE:
//   { success, image_id, position, src }
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

    const body = await request.json();
    const { filename, attachment, alt } = body || {};

    if (!attachment || typeof attachment !== 'string') {
      return NextResponse.json(
        { success: false, error: 'attachment (base64) required' },
        { status: 400 },
      );
    }

    // ── Upload to Shopify ──
    const uploadRes = await shopifyREST(`products/${id}/images.json`, {
      method: 'POST',
      body: {
        image: {
          attachment,
          filename: filename || `image-${Date.now()}.jpg`,
          alt: alt || '',
        },
      },
    });

    const newImage = uploadRes.image;
    if (!newImage?.id) {
      throw new Error('Shopify did not return new image id');
    }

    // ── Mirror image into DB images_data (best-effort) ──
    // Shopify products/update webhook will eventually fire and refresh the row,
    // but we update inline so the UI reflects the new image immediately.
    try {
      const supabase = createServerClient();
      const { data: firstRow } = await supabase
        .from('products')
        .select('images_data')
        .eq('shopify_product_id', String(id))
        .limit(1)
        .maybeSingle();

      const existing = Array.isArray(firstRow?.images_data) ? firstRow.images_data : [];
      const merged = existing.concat([{
        id: String(newImage.id),
        src: newImage.src,
        alt: newImage.alt || '',
        position: newImage.position,
        width: newImage.width || null,
        height: newImage.height || null,
        variant_ids: (newImage.variant_ids || []).map(v => String(v)),
      }]);

      await supabase
        .from('products')
        .update({ images_data: merged, updated_at: new Date().toISOString() })
        .eq('shopify_product_id', String(id));
    } catch (e) {
      // Webhook will reconcile — non-fatal
      console.warn('[upload-image] DB mirror failed (webhook will catch up):', e.message);
    }

    return NextResponse.json({
      success: true,
      image_id: String(newImage.id),
      position: newImage.position,
      src: newImage.src,
      alt: newImage.alt || '',
      duration_ms: Date.now() - startTime,
    });
  } catch (e) {
    console.error('[upload-image] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
