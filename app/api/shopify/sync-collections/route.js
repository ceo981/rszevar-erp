import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION    = '2024-01';
const TIME_BUDGET_MS = 50000; // stop at 50s, leave 10s for DB updates

async function shopifyGet(endpoint, params = {}) {
  const url = new URL(`https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  return res.json();
}

export async function POST() {
  const start = Date.now();
  const elapsed = () => Date.now() - start;

  try {
    const supabase = createServerClient();

    // 1. Fetch all collections (custom + smart)
    const collections = [];
    for (const type of ['custom_collections', 'smart_collections']) {
      const data = await shopifyGet(`${type}.json`, { limit: 250 });
      collections.push(...(data[type] || []).map(c => ({ id: c.id, handle: c.handle, title: c.title })));
    }

    if (collections.length === 0) {
      return NextResponse.json({ success: true, message: 'No collections found', duration_ms: elapsed() });
    }

    // 2. For each collection, get product IDs (with timeout protection)
    const productCollections = new Map();
    let collectionsProcessed = 0;
    let timedOut = false;

    for (const coll of collections) {
      if (elapsed() > TIME_BUDGET_MS) { timedOut = true; break; }

      try {
        const data = await shopifyGet('products.json', {
          collection_id: coll.id, fields: 'id', limit: 250,
        });
        for (const p of data.products || []) {
          const pid = String(p.id);
          if (!productCollections.has(pid)) productCollections.set(pid, []);
          productCollections.get(pid).push({ handle: coll.handle, title: coll.title });
        }
        collectionsProcessed++;
      } catch (e) {
        // Skip this collection, continue with others
        console.warn(`[sync-collections] Skipped ${coll.handle}:`, e.message);
      }

      await new Promise(r => setTimeout(r, 100));
    }

    // 3. Batch update DB
    let updated = 0;
    for (const [productId, colls] of productCollections) {
      if (elapsed() > 58000) break; // hard stop at 58s
      const { error } = await supabase
        .from('products')
        .update({ collections: colls })
        .eq('shopify_product_id', productId);
      if (!error) updated++;
    }

    return NextResponse.json({
      success: true,
      message: `${collectionsProcessed}/${collections.length} collections synced, ${updated} products updated${timedOut ? ' (partial — run again to complete)' : ''}`,
      total_collections: collections.length,
      collections_processed: collectionsProcessed,
      updated,
      timed_out: timedOut,
      duration_ms: elapsed(),
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, duration_ms: elapsed() }, { status: 500 });
  }
}

export async function GET() { return POST(); }
