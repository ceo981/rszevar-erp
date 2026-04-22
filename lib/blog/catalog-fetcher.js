/**
 * Catalog Fetcher — Provides REAL collection slugs + bestseller products
 * to inject into Claude prompt. Prevents AI from inventing fake URLs.
 *
 * Data sources:
 * - collections table: Shopify-synced collections with handle (slug) + product count
 * - products table: Uses ABC classification (Phase 8) to find A-class bestsellers
 */

import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

/**
 * Fetch all active collections with their real Shopify handles + product counts
 * Returns array sorted by product count descending
 */
export async function fetchCollections(limit = 60) {
  const supabase = getServiceClient();

  // Try fetching from collections table first
  const { data: collectionsData, error: collectionsError } = await supabase
    .from('collections')
    .select('shopify_collection_id, handle, title, products_count')
    .order('products_count', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (!collectionsError && collectionsData && collectionsData.length > 0) {
    return collectionsData
      .filter((c) => c.handle && c.title) // Only include valid entries
      .map((c) => ({
        handle: c.handle,
        title: c.title,
        product_count: c.products_count || 0,
        url: `/collections/${c.handle}`,
      }));
  }

  // Fallback: derive from products.collections JSONB
  console.warn('[catalog-fetcher] collections table empty/error, falling back to products JSONB');
  const { data: productsData } = await supabase
    .from('products')
    .select('collections')
    .not('collections', 'is', null)
    .limit(5000);

  if (!productsData) return [];

  // Aggregate collection counts from products
  const collectionCounts = new Map();
  for (const product of productsData) {
    const colls = Array.isArray(product.collections) ? product.collections : [];
    for (const coll of colls) {
      if (coll?.handle && coll?.title) {
        const key = coll.handle;
        if (!collectionCounts.has(key)) {
          collectionCounts.set(key, { handle: coll.handle, title: coll.title, product_count: 0 });
        }
        collectionCounts.get(key).product_count++;
      }
    }
  }

  return Array.from(collectionCounts.values())
    .sort((a, b) => b.product_count - a.product_count)
    .slice(0, limit)
    .map((c) => ({ ...c, url: `/collections/${c.handle}` }));
}

/**
 * Fetch top bestseller products (ABC Class A from Phase 8)
 * Returns products with title, handle, price, and primary image
 */
export async function fetchBestsellerProducts(limit = 20) {
  const supabase = getServiceClient();

  // Query A-class products from ABC classification (90-day window preferred)
  const { data, error } = await supabase
    .from('products')
    .select('shopify_product_id, title, handle, price_min, price_max, featured_image_url, abc_class_90d, abc_rank_90d, revenue_90d, units_sold_90d')
    .eq('abc_class_90d', 'A')
    .eq('is_active', true)
    .order('revenue_90d', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error('[catalog-fetcher] bestsellers query error:', error);
    return [];
  }

  if (!data || data.length === 0) {
    // Fallback: just use products with highest price (proxy for premium)
    const { data: fallbackData } = await supabase
      .from('products')
      .select('shopify_product_id, title, handle, price_min, price_max, featured_image_url')
      .eq('is_active', true)
      .order('price_max', { ascending: false, nullsFirst: false })
      .limit(limit);

    return (fallbackData || []).map(formatProduct);
  }

  return data.map(formatProduct);
}

function formatProduct(p) {
  return {
    handle: p.handle,
    title: p.title,
    price_min: p.price_min,
    price_max: p.price_max,
    price_display: formatPrice(p.price_min, p.price_max),
    image_url: p.featured_image_url,
    url: `/products/${p.handle}`,
    revenue_90d: p.revenue_90d || null,
    units_sold_90d: p.units_sold_90d || null,
  };
}

function formatPrice(min, max) {
  if (!min && !max) return null;
  const m = Math.round(Number(min) || 0);
  const mx = Math.round(Number(max) || 0);
  if (mx > m) return `Rs ${m.toLocaleString()} – Rs ${mx.toLocaleString()}`;
  return `Rs ${m.toLocaleString()}`;
}

/**
 * Get complete catalog context for a blog generation prompt
 * Returns formatted strings ready to inject into the prompt
 */
export async function getCatalogContextForPrompt({ topicHint = '', maxCollections = 40, maxProducts = 15 } = {}) {
  const [collections, bestsellers] = await Promise.all([
    fetchCollections(60),
    fetchBestsellerProducts(30),
  ]);

  // Filter collections by topic relevance if hint provided (basic keyword match)
  let relevantCollections = collections;
  let relevantProducts = bestsellers;

  if (topicHint) {
    const hintLower = topicHint.toLowerCase();
    const keywords = hintLower.split(/\s+/).filter((w) => w.length > 3);

    // Score collections by title overlap with topic
    if (keywords.length > 0) {
      const scored = collections.map((c) => {
        const titleLower = c.title.toLowerCase();
        const score = keywords.filter((kw) => titleLower.includes(kw)).length;
        return { ...c, _score: score };
      });
      // Keep top scorers + fill with highest product counts
      const topScored = scored.filter((c) => c._score > 0).sort((a, b) => b._score - a._score);
      const remaining = scored.filter((c) => c._score === 0).sort((a, b) => b.product_count - a.product_count);
      relevantCollections = [...topScored, ...remaining];

      // Also score products
      const scoredProducts = bestsellers.map((p) => {
        const titleLower = p.title.toLowerCase();
        const score = keywords.filter((kw) => titleLower.includes(kw)).length;
        return { ...p, _score: score };
      });
      const topScoredProducts = scoredProducts.filter((p) => p._score > 0).sort((a, b) => b._score - a._score);
      const remainingProducts = scoredProducts.filter((p) => p._score === 0);
      relevantProducts = [...topScoredProducts, ...remainingProducts];
    }
  }

  relevantCollections = relevantCollections.slice(0, maxCollections);
  relevantProducts = relevantProducts.slice(0, maxProducts);

  // Build human-readable list for prompt
  const collectionsList = relevantCollections
    .map((c) => `- /collections/${c.handle} — "${c.title}" (${c.product_count} products)`)
    .join('\n');

  const productsList = relevantProducts
    .filter((p) => p.handle && p.title)
    .map((p) => {
      const price = p.price_display ? ` — ${p.price_display}` : '';
      const img = p.image_url ? `\n    image: ${p.image_url}` : '';
      return `- /products/${p.handle} — "${p.title}"${price}${img}`;
    })
    .join('\n');

  return {
    collectionsList,
    productsList,
    collectionsCount: relevantCollections.length,
    productsCount: relevantProducts.length,
    rawCollections: relevantCollections,
    rawProducts: relevantProducts,
  };
}
