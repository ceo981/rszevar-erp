// ============================================================================
// RS ZEVAR ERP — Auto Product Sync Webhook (Apr 28 2026 final)
// Route: /api/shopify/webhooks/products-update
// ----------------------------------------------------------------------------
// Multi-secret HMAC verification — supports BOTH:
//   - Settings → Notifications webhooks (signed with ACCOUNT-level secret,
//     stored in env var SHOPIFY_WEBHOOK_SECRET)
//   - API-registered webhooks via custom app (signed with APP-level secret =
//     custom app's "API secret key", stored in env var SHOPIFY_APP_WEBHOOK_SECRET)
//
// Tries each configured secret in turn. First match wins.
// ============================================================================

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServerClient } from '@/lib/supabase';
import { transformProducts } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const GRAPHQL_VERSION = '2025-01';

// M2.B hotfix — REST product payload doesn't include collections, so fetch
// them via a tiny GraphQL call and stamp on every variant row before upsert
async function fetchProductCollections(productId) {
  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) return null;
  const query = `
    query getProductCollections($id: ID!) {
      product(id: $id) {
        collections(first: 50) { edges { node { handle title } } }
      }
    }
  `;
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${GRAPHQL_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { id: `gid://shopify/Product/${productId}` } }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (json.errors) return null;
  const edges = json?.data?.product?.collections?.edges || [];
  return edges.map(e => ({ handle: e.node.handle, title: e.node.title }));
}

function tryHmac(rawBody, hmacHeader, secret) {
  try {
    const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
    const a = Buffer.from(computed);
    const b = Buffer.from(hmacHeader);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyHmac(rawBody, hmacHeader) {
  if (!hmacHeader) {
    return { valid: false, reason: 'header_missing' };
  }

  // Try secrets in order — Settings webhooks (account secret) first,
  // then API-registered webhooks (app secret).
  const candidates = [
    { name: 'SHOPIFY_WEBHOOK_SECRET',      value: process.env.SHOPIFY_WEBHOOK_SECRET },
    { name: 'SHOPIFY_APP_WEBHOOK_SECRET',  value: process.env.SHOPIFY_APP_WEBHOOK_SECRET },
  ].filter(s => s.value);

  if (candidates.length === 0) {
    return { valid: false, reason: 'no_secrets_configured' };
  }

  for (const { name, value } of candidates) {
    if (tryHmac(rawBody, hmacHeader, value)) {
      return { valid: true, matched: name };
    }
  }

  return {
    valid: false,
    reason: 'all_secrets_mismatched',
    tried: candidates.map(c => c.name),
  };
}

export async function POST(request) {
  const startTime = Date.now();
  const rawBody = await request.text();

  const hmac        = request.headers.get('x-shopify-hmac-sha256');
  const topic       = request.headers.get('x-shopify-topic')        || 'unknown';
  const shopDomain  = request.headers.get('x-shopify-shop-domain')  || 'unknown';
  const webhookId   = request.headers.get('x-shopify-webhook-id')   || 'none';

  console.log(`[webhook:products] INCOMING — topic=${topic} shop=${shopDomain} webhook_id=${webhookId} body_bytes=${rawBody.length} hmac=${hmac ? 'present' : 'missing'}`);

  const hmacResult = verifyHmac(rawBody, hmac);
  if (!hmacResult.valid) {
    console.log(`[webhook:products] HMAC FAIL — reason=${hmacResult.reason}${hmacResult.tried ? ' tried=' + hmacResult.tried.join(',') : ''}`);
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  console.log(`[webhook:products] HMAC verified using ${hmacResult.matched}`);

  let shopifyProduct;
  try {
    shopifyProduct = JSON.parse(rawBody);
  } catch (e) {
    console.log('[webhook:products] REJECTED: invalid JSON —', e.message);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  console.log(`[webhook:products] parsed product id=${shopifyProduct.id} title="${(shopifyProduct.title || '').slice(0, 50)}" variants=${shopifyProduct.variants?.length || 0} status=${shopifyProduct.status}`);

  const variants = transformProducts(shopifyProduct);
  if (variants.length === 0) {
    console.log('[webhook:products] SKIPPED: no variants');
    return NextResponse.json({ success: true, skipped: 'no_variants' });
  }

  // M2.B hotfix — also pull collections via GraphQL and stamp on variant rows
  // (best-effort; webhook still succeeds if this fails)
  let collectionsFetched = null;
  try {
    const colls = await fetchProductCollections(shopifyProduct.id);
    if (Array.isArray(colls)) {
      for (const v of variants) v.collections = colls;
      collectionsFetched = colls.length;
    }
  } catch (e) {
    console.error('[webhook:products] collections fetch failed:', e.message);
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
  console.log(`[webhook:products] SUCCESS — product_id=${shopifyProduct.id} title="${(shopifyProduct.title || '').slice(0, 50)}" variants_synced=${variants.length} collections_synced=${collectionsFetched ?? 'skip'} elapsed_ms=${elapsed}`);

  return NextResponse.json({
    success: true,
    product: shopifyProduct.title,
    variants_synced: variants.length,
    collections_synced: collectionsFetched,
  });
}
