// ============================================================================
// RS ZEVAR ERP — Shopify Webhook Setup Endpoint
// Route: /api/shopify/webhooks/setup
// ----------------------------------------------------------------------------
// GET  → Lists all currently registered Shopify webhooks (diagnostic)
// POST → Registers products/update + products/delete webhooks via API,
//        deleting any existing duplicates pointing to our domain.
//        This ensures webhooks use the SAME app credentials as orders
//        webhooks (so SHOPIFY_WEBHOOK_SECRET matches).
//
// USE CASE
//   Manually-added webhooks via Shopify admin Settings → Notifications use
//   a DIFFERENT signing secret than app-level webhooks. This causes HMAC
//   verification to fail in our webhook handlers (401 Invalid HMAC).
//
//   By registering programmatically, we use the app's webhook secret which
//   is already configured in Vercel as SHOPIFY_WEBHOOK_SECRET.
// ============================================================================

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-01';

// Topics we want registered for the products module
const REQUIRED_TOPICS = [
  'products/update',
  'products/create',
];

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
    throw new Error(`Shopify ${method} ${endpoint} failed (${res.status}): ${data?.errors ? JSON.stringify(data.errors) : text}`);
  }
  return data;
}

function getWebhookBaseUrl(request) {
  // Prefer ERP_BASE_URL env var; fallback to inferring from request host
  const env = process.env.ERP_BASE_URL || process.env.NEXT_PUBLIC_ERP_BASE_URL;
  if (env) return env.replace(/\/$/, '');

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

// ── GET: list current webhooks ──────────────────────────────────────────────
export async function GET() {
  try {
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return NextResponse.json({ success: false, error: 'Shopify credentials not configured' }, { status: 500 });
    }

    const data = await shopifyREST('webhooks.json');
    const list = (data.webhooks || []).map(w => ({
      id: w.id,
      topic: w.topic,
      address: w.address,
      format: w.format,
      api_version: w.api_version,
      created_at: w.created_at,
      updated_at: w.updated_at,
    }));

    // Sort by topic for readability
    list.sort((a, b) => (a.topic || '').localeCompare(b.topic || ''));

    return NextResponse.json({
      success: true,
      total: list.length,
      webhooks: list,
      required_for_products: REQUIRED_TOPICS,
      currently_present: REQUIRED_TOPICS.filter(t => list.some(w => w.topic === t)),
      missing: REQUIRED_TOPICS.filter(t => !list.some(w => w.topic === t)),
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ── POST: register required product webhooks ────────────────────────────────
export async function POST(request) {
  const startTime = Date.now();
  const log = [];

  try {
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return NextResponse.json({ success: false, error: 'Shopify credentials not configured' }, { status: 500 });
    }

    const baseUrl = getWebhookBaseUrl(request);
    log.push(`Using webhook base URL: ${baseUrl}`);

    // Map of topic → desired endpoint path
    const TOPIC_PATHS = {
      'products/update': '/api/shopify/webhooks/products-update',
      'products/create': '/api/shopify/webhooks/products-update',  // Same handler — covers new product sync too
    };

    // 1. Fetch current webhooks
    const current = (await shopifyREST('webhooks.json')).webhooks || [];

    const results = [];

    for (const topic of REQUIRED_TOPICS) {
      const desiredAddress = `${baseUrl}${TOPIC_PATHS[topic]}`;

      // Find existing webhooks for this topic
      const existing = current.filter(w => w.topic === topic);

      // Delete ANY existing webhook for this topic on OUR domain or pointing
      // anywhere else — we'll recreate clean. (This removes the manually-added
      // one which uses wrong signing secret.)
      for (const w of existing) {
        try {
          await shopifyREST(`webhooks/${w.id}.json`, { method: 'DELETE' });
          log.push(`Deleted existing webhook id=${w.id} (${topic} → ${w.address})`);
        } catch (e) {
          log.push(`Failed to delete webhook id=${w.id}: ${e.message}`);
        }
      }

      // Create fresh webhook with our app's credentials (uses app webhook secret)
      try {
        const created = await shopifyREST('webhooks.json', {
          method: 'POST',
          body: {
            webhook: {
              topic,
              address: desiredAddress,
              format: 'json',
            },
          },
        });
        results.push({
          topic,
          status: 'registered',
          id: created.webhook?.id,
          address: created.webhook?.address,
        });
        log.push(`✓ Registered ${topic} → ${desiredAddress}`);
      } catch (e) {
        results.push({
          topic,
          status: 'failed',
          error: e.message,
        });
        log.push(`✗ Failed to register ${topic}: ${e.message}`);
      }
    }

    // Re-fetch final state
    const final = (await shopifyREST('webhooks.json')).webhooks || [];
    const productWebhooks = final.filter(w => REQUIRED_TOPICS.includes(w.topic));

    return NextResponse.json({
      success: results.every(r => r.status === 'registered'),
      message: `Setup complete — ${results.filter(r => r.status === 'registered').length}/${REQUIRED_TOPICS.length} webhooks registered`,
      results,
      log,
      final_product_webhooks: productWebhooks.map(w => ({
        topic: w.topic, address: w.address, api_version: w.api_version,
      })),
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err.message,
      log,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
