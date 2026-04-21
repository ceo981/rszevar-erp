import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// Push rszevar.related_products metafield — SELF-CONTAINED batch route
// All Shopify logic inlined (lesson 3.1: no server-to-server fetch, no lib dependency drift)

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const API_VERSION = '2024-01';
const NAMESPACE = 'rszevar';
const KEY = 'related_products';
const TYPE = 'list.product_reference';
const DEFAULT_BATCH = 20;
const MAX_BATCH = 40;
const INTER_CALL_MS = 500; // 2 req/sec global pacing

// ============================================================================
// HELPERS (inlined)
// ============================================================================

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

async function withRetry(fn, { maxRetries = 3, baseMs = 2000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retryable = e.status === 429 || (e.status >= 500 && e.status < 600);
      if (!retryable || attempt === maxRetries) throw e;
      await sleep(baseMs * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

async function pushOne(shopifyProductId, pickIds) {
  const gids = pickIds.map(id =>
    String(id).startsWith('gid://') ? String(id) : `gid://shopify/Product/${id}`
  );
  const value = JSON.stringify(gids);

  // Check existing
  const listing = await withRetry(() =>
    shopifyRequest(`products/${shopifyProductId}/metafields.json?namespace=${NAMESPACE}&key=${KEY}`)
  );
  const existing = (listing.metafields || []).find(
    m => m.namespace === NAMESPACE && m.key === KEY
  );

  await sleep(INTER_CALL_MS);

  // Upsert
  if (existing) {
    const updated = await withRetry(() =>
      shopifyRequest(`metafields/${existing.id}.json`, {
        method: 'PUT',
        body: { metafield: { id: existing.id, value, type: TYPE } },
      })
    );
    return { metafield_id: updated?.metafield?.id || existing.id, created: false };
  }

  const created = await withRetry(() =>
    shopifyRequest(`products/${shopifyProductId}/metafields.json`, {
      method: 'POST',
      body: { metafield: { namespace: NAMESPACE, key: KEY, value, type: TYPE } },
    })
  );
  return { metafield_id: created?.metafield?.id || null, created: true };
}

async function loadAll(supabase) {
  const rows = [];
  const PAGE = 1000;
  let off = 0;
  while (off < 10000) {
    const { data, error } = await supabase
      .from('products')
      .select('shopify_product_id, parent_title, related_products, related_metafield_pushed_at')
      .not('shopify_product_id', 'is', null)
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    off += PAGE;
  }
  const seen = new Map();
  for (const r of rows) {
    if (!seen.has(r.shopify_product_id)) seen.set(r.shopify_product_id, r);
  }
  return Array.from(seen.values());
}

// ============================================================================
// GET — stats
// ============================================================================

export async function GET() {
  try {
    const supabase = createServerClient();
    const all = await loadAll(supabase);
    let withPicks = 0, pushed = 0, pending = 0;
    for (const r of all) {
      const rp = r.related_products;
      const has = rp && Array.isArray(rp.picks) && rp.picks.length > 0;
      if (!has) continue;
      withPicks++;
      if (r.related_metafield_pushed_at) pushed++;
      else pending++;
    }
    return NextResponse.json({
      success: true,
      total_products: all.length,
      with_picks: withPicks,
      pushed,
      pending,
      progress_pct: withPicks > 0 ? Math.round((pushed / withPicks) * 100) : 0,
    });
  } catch (err) {
    console.error('[push-related-batch GET]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ============================================================================
// POST — batch push
// body: { batch_size, force }
// ============================================================================

export async function POST(request) {
  const startTime = Date.now();
  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));
    const batchSize = Math.min(
      Math.max(parseInt(body.batch_size) || DEFAULT_BATCH, 1),
      MAX_BATCH
    );
    const force = Boolean(body.force);

    if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
      return NextResponse.json(
        { success: false, error: 'Shopify env vars not set' },
        { status: 500 }
      );
    }

    const all = await loadAll(supabase);

    // Filter: has picks + (not pushed OR force)
    const pending = all.filter(r => {
      const rp = r.related_products;
      const has = rp && Array.isArray(rp.picks) && rp.picks.length > 0;
      if (!has) return false;
      if (force) return true;
      return !r.related_metafield_pushed_at;
    });

    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        message: force
          ? 'No products with picks found.'
          : 'All products with picks already pushed. Use force:true to re-push.',
        processed: 0,
        failed: 0,
        remaining: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    const batch = pending.slice(0, batchSize);
    const results = [];

    // Serialized loop (concurrency 1) — safest for Shopify 2 req/sec leaky bucket
    for (const p of batch) {
      const pickIds = (p.related_products.picks || [])
        .map(x => x.shopify_product_id)
        .filter(Boolean);

      if (pickIds.length === 0) {
        results.push({
          shopify_product_id: p.shopify_product_id,
          title: p.parent_title,
          success: false,
          error: 'picks empty',
        });
        continue;
      }

      try {
        const r = await pushOne(p.shopify_product_id, pickIds);
        const nowIso = new Date().toISOString();
        await supabase
          .from('products')
          .update({
            related_metafield_pushed_at: nowIso,
            related_metafield_id: r.metafield_id,
          })
          .eq('shopify_product_id', p.shopify_product_id);
        results.push({
          shopify_product_id: p.shopify_product_id,
          title: p.parent_title,
          success: true,
          metafield_id: r.metafield_id,
          created: r.created,
        });
      } catch (e) {
        results.push({
          shopify_product_id: p.shopify_product_id,
          title: p.parent_title,
          success: false,
          error: e.message,
        });
      }

      // Inter-product pacing
      await sleep(INTER_CALL_MS);
    }

    const ok = results.filter(r => r.success).length;
    const fail = results.filter(r => !r.success).length;

    const failureReasons = {};
    for (const r of results.filter(x => !x.success)) {
      const key = r.error?.slice(0, 80) || 'unknown';
      failureReasons[key] = (failureReasons[key] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      processed: ok,
      failed: fail,
      remaining: pending.length - batch.length,
      duration_ms: Date.now() - startTime,
      failure_reasons: failureReasons,
      results,
    });
  } catch (err) {
    console.error('[push-related-batch POST]', err.message);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
