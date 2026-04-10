// =====================================================================
// RS ZEVAR ERP — Sync Collections via REST API
// File path: app/api/shopify/sync-collections/route.js
//
// Pure REST (no GraphQL). Gets all collections, then for each collection
// gets its products, builds reverse map, updates DB.
// =====================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION    = '2024-01';

async function shopifyGet(endpoint, params = {}) {
  const url = new URL(`https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchAllCollections() {
  const collections = [];
  for (const type of ['custom_collections', 'smart_collections']) {
    let hasMore = true, sinceId = null;
    while (hasMore) {
      const params = { limit: 250 };
      if (sinceId) params.since_id = sinceId;
      const data = await shopifyGet(`${type}.json`, params);
      const items = data[type] || [];
      collections.push(...items.map(c => ({ id: c.id, handle: c.handle, title: c.title })));
      hasMore = items.length === 250;
      if (hasMore) sinceId = items[items.length - 1].id;
    }
  }
  return collections;
}

async function fetchCollectionProductIds(collectionId) {
  const ids = [];
  let hasMore = true, sinceId = null;
  while (hasMore) {
    const params = { limit: 250, collection_id: collectionId, fields: 'id' };
    if (sinceId) params.since_id = sinceId;
    const data = await shopifyGet('products.json', params);
    const products = data.products || [];
    ids.push(...products.map(p => String(p.id)));
    hasMore = products.length === 250;
    if (hasMore) sinceId = products[products.length - 1].id;
    await new Promise(r => setTimeout(r, 200));
  }
  return ids;
}

export async function POST() {
  const startTime = Date.now();
  try {
    const supabase = createServerClient();
    const collections = await fetchAllCollections();

    if (collections.length === 0) {
      return NextResponse.json({ success: true, message: 'No collections found', duration_ms: Date.now() - startTime });
    }

    const productCollections = new Map();
    for (const coll of collections) {
      const productIds = await fetchCollectionProductIds(coll.id);
      for (const pid of productIds) {
        if (!productCollections.has(pid)) productCollections.set(pid, []);
        productCollections.get(pid).push({ handle: coll.handle, title: coll.title });
      }
    }

    let updated = 0, errors = 0;
    for (const [productId, colls] of productCollections) {
      const { error } = await supabase
        .from('products')
        .update({ collections: colls })
        .eq('shopify_product_id', productId);
      if (error) errors++; else updated++;
    }

    return NextResponse.json({
      success: true,
      message: `${collections.length} collections synced, ${updated} products updated`,
      total_collections: collections.length,
      products_with_collections: productCollections.size,
      updated, errors,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[sync-collections] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET() { return POST(); }
