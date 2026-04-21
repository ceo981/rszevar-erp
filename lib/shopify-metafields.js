// ============================================================================
// RS ZEVAR ERP — Shopify Metafields Helper
// Reuses REST upsert pattern from app/api/ai/push-to-shopify/route.js
// Used by: app/api/products/metafields/push-related-one/route.js
// (batch route inlines everything — lesson 3.1 self-containment)
// ============================================================================

const API_VERSION = '2024-01';

async function shopifyRequest(endpoint, { method = 'GET', body = null } = {}) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) {
    throw new Error('SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN not set');
  }
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
    const errMsg = data?.errors ? JSON.stringify(data.errors) : text.slice(0, 300);
    const err = new Error(`Shopify ${method} ${endpoint} failed (${res.status}): ${errMsg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retry on 429 / 5xx with exponential backoff
async function withRetry(fn, { maxRetries = 3, baseMs = 2000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retryable = e.status === 429 || (e.status >= 500 && e.status < 600);
      if (!retryable || attempt === maxRetries) throw e;
      await sleep(baseMs * Math.pow(2, attempt)); // 2s, 4s, 8s
    }
  }
  throw lastErr;
}

// ============================================================================
// pushRelatedMetafield
// Upserts rszevar.related_products on the given product.
// type: list.product_reference — value is JSON-stringified array of Product GIDs
//
// Args:
//   shopifyProductId — numeric string ("7234567890123")
//   pickIds          — array of numeric Shopify product IDs
//
// Returns: { metafield_id, created }
// ============================================================================

export async function pushRelatedMetafield(shopifyProductId, pickIds, { interCallDelayMs = 500 } = {}) {
  if (!shopifyProductId) throw new Error('shopifyProductId required');
  if (!Array.isArray(pickIds) || pickIds.length === 0) {
    throw new Error('pickIds must be a non-empty array');
  }

  const namespace = 'rszevar';
  const key = 'related_products';
  const type = 'list.product_reference';

  // Convert numeric IDs to Shopify GIDs
  const gids = pickIds.map(id => {
    const clean = String(id).trim();
    if (!clean) throw new Error('Empty pick id');
    return clean.startsWith('gid://') ? clean : `gid://shopify/Product/${clean}`;
  });
  const value = JSON.stringify(gids);

  // Step 1 — check existing
  const listing = await withRetry(() =>
    shopifyRequest(
      `products/${shopifyProductId}/metafields.json?namespace=${namespace}&key=${key}`
    )
  );
  const existing = (listing.metafields || []).find(
    m => m.namespace === namespace && m.key === key
  );

  await sleep(interCallDelayMs);

  // Step 2 — upsert
  if (existing) {
    const updated = await withRetry(() =>
      shopifyRequest(`metafields/${existing.id}.json`, {
        method: 'PUT',
        body: { metafield: { id: existing.id, value, type } },
      })
    );
    return {
      metafield_id: updated?.metafield?.id || existing.id,
      created: false,
    };
  }

  const created = await withRetry(() =>
    shopifyRequest(`products/${shopifyProductId}/metafields.json`, {
      method: 'POST',
      body: { metafield: { namespace, key, value, type } },
    })
  );
  return {
    metafield_id: created?.metafield?.id || null,
    created: true,
  };
}
