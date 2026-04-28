// ============================================================================
// RS ZEVAR ERP — Collections List API (Phase D M2.B — Apr 28 2026)
// Route: GET /api/collections
// ----------------------------------------------------------------------------
// Returns the full master list of Shopify collections (custom + smart),
// each with { id, handle, title, type }. Used by:
//   - Inventory editor's Collections multi-select dropdown
//   - In-ERP Add Product form (M2.C)
//
// Hybrid behaviour:
//   - Hits Shopify live (single REST call per type, 250 each)
//   - Sets Cache-Control: private, max-age=300 → browser caches 5 min so
//     subsequent opens within the same session are instant
//   - Pass ?force=1 to bypass any caching during testing
// ============================================================================

import { NextResponse } from 'next/server';

// Relative imports per Next.js 16 Turbopack alias rule on new files
// (no actual lib import needed here, but keeping pattern consistent)

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION    = '2024-01';

async function shopifyGet(endpoint, params = {}) {
  const url = new URL(`https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify ${endpoint} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function GET(request) {
  const startTime = Date.now();
  try {
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return NextResponse.json({
        success: false,
        error: 'Shopify credentials not configured',
      }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === '1';

    // Fetch both custom + smart collections (Shopify keeps them separate)
    // limit=250 is Shopify's max; if anyone exceeds 250 of either type
    // we'll need pagination via page_info — surfacing as a warning for now
    const [custom, smart] = await Promise.all([
      shopifyGet('custom_collections.json', { limit: 250 }),
      shopifyGet('smart_collections.json',  { limit: 250 }),
    ]);

    const customColls = (custom.custom_collections || []).map(c => ({
      id: String(c.id),
      handle: c.handle,
      title: c.title,
      type: 'custom',
    }));

    const smartColls = (smart.smart_collections || []).map(c => ({
      id: String(c.id),
      handle: c.handle,
      title: c.title,
      type: 'smart',
    }));

    const collections = [...customColls, ...smartColls]
      .sort((a, b) => a.title.localeCompare(b.title));

    const truncated = customColls.length === 250 || smartColls.length === 250;

    return NextResponse.json({
      success: true,
      count: collections.length,
      truncated,
      collections,
      duration_ms: Date.now() - startTime,
    }, {
      headers: {
        'Cache-Control': force ? 'no-store' : 'private, max-age=300',
      },
    });
  } catch (err) {
    console.error('[GET /api/collections]', err);
    return NextResponse.json({
      success: false,
      error: err.message,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
