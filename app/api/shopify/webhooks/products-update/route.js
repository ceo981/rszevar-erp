// ============================================================================
// RS ZEVAR ERP — Auto Product Sync Webhook (Phase D — verbose logging)
// Route: /api/shopify/webhooks/products-update
// ----------------------------------------------------------------------------
// Updated Apr 28 2026 — Added verbose logging so we can diagnose webhook
// delivery issues from Vercel logs. Every incoming request now logs:
//   - Whether headers (HMAC, topic, shop) are present
//   - Body size
//   - HMAC verification result (pass/fail with reason)
//   - Product details if parsed successfully
//   - Final outcome (success/skipped/failed)
// ============================================================================

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServerClient } from '@/lib/supabase';
import { transformProducts } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!hmacHeader) {
    console.log('[webhook:products] HMAC FAIL: x-shopify-hmac-sha256 header missing');
    return false;
  }
  if (!secret) {
    console.log('[webhook:products] HMAC FAIL: SHOPIFY_WEBHOOK_SECRET env var not set in Vercel');
    return false;
  }
  try {
    const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
    const a = Buffer.from(computed);
    const b = Buffer.from(hmacHeader);
    if (a.length !== b.length) {
      console.log(`[webhook:products] HMAC FAIL: signature length mismatch (computed=${a.length}, received=${b.length})`);
      return false;
    }
    const match = crypto.timingSafeEqual(a, b);
    if (!match) {
      console.log(`[webhook:products] HMAC FAIL: signatures differ. computed_prefix=${computed.slice(0, 12)}... received_prefix=${hmacHeader.slice(0, 12)}...`);
    }
    return match;
  } catch (e) {
    console.log('[webhook:products] HMAC FAIL: exception —', e.message);
    return false;
  }
}

export async function POST(request) {
  const startTime = Date.now();
  const rawBody = await request.text();

  const hmac        = request.headers.get('x-shopify-hmac-sha256');
  const topic       = request.headers.get('x-shopify-topic')        || 'unknown';
  const shopDomain  = request.headers.get('x-shopify-shop-domain')  || 'unknown';
  const webhookId   = request.headers.get('x-shopify-webhook-id')   || 'none';
  const apiVersion  = request.headers.get('x-shopify-api-version')  || 'none';

  console.log(`[webhook:products] INCOMING — topic=${topic} shop=${shopDomain} webhook_id=${webhookId} api_version=${apiVersion} body_bytes=${rawBody.length} hmac=${hmac ? 'present' : 'missing'}`);

  if (!verifyHmac(rawBody, hmac)) {
    console.log('[webhook:products] REJECTED: HMAC verification failed');
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  console.log('[webhook:products] HMAC verified OK');

  let shopifyProduct;
  try {
    shopifyProduct = JSON.parse(rawBody);
  } catch (e) {
    console.log('[webhook:products] REJECTED: invalid JSON —', e.message);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  console.log(`[webhook:products] parsed product id=${shopifyProduct.id} title="${(shopifyProduct.title || '').slice(0, 50)}" variants=${shopifyProduct.variants?.length || 0} status=${shopifyProduct.status}`);

  // Transform into variant rows (Phase A: includes tags, description, images, etc.)
  const variants = transformProducts(shopifyProduct);
  if (variants.length === 0) {
    console.log('[webhook:products] SKIPPED: no variants in payload');
    return NextResponse.json({ success: true, skipped: 'no_variants' });
  }

  const supabase = createServerClient();

  const { error } = await supabase
    .from('products')
    .upsert(variants, { onConflict: 'shopify_variant_id' });

  if (error) {
    console.error('[webhook:products] UPSERT FAILED:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const elapsed = Date.now() - startTime;
  console.log(`[webhook:products] SUCCESS — product_id=${shopifyProduct.id} title="${(shopifyProduct.title || '').slice(0, 50)}" variants_synced=${variants.length} elapsed_ms=${elapsed}`);

  return NextResponse.json({
    success: true,
    product: shopifyProduct.title,
    variants_synced: variants.length,
  });
}
