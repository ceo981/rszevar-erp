// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR — lib/bot-brain/tools.js
// ────────────────────────────────────────────────────────────────────────────
// Function-calling tools the bot can use against the live catalog (products
// table). Two tools for Phase 1:
//   • search_products      — keyword search by description
//   • get_product_by_link  — resolve an rszevar.com/products/<handle> URL
//
// products table = one row per VARIANT (parent grouped via handle / parent_title).
// We aggregate variants → a single product summary for the bot.
// ════════════════════════════════════════════════════════════════════════════

import { createServerClient } from '../supabase';
import { trackOrder } from './track';
import { buildCartLink } from './cart';

const SITE = 'https://rszevar.com';
const SELECT = 'title, parent_title, handle, selling_price, compare_at_price, stock_quantity, image_url, is_active';

function productUrl(handle) {
  return handle ? `${SITE}/products/${handle}` : SITE;
}

// ─── Tool schemas (Gemini functionDeclarations) ──────────────────────────────
export const TOOL_DECLARATIONS = [
  {
    name: 'search_products',
    description:
      'Search the RS ZEVAR catalog by keywords (product name or type, e.g. "gold locket set", "champagne bracelet", "kundan earrings"). Returns matching products with price, stock and link. Use this for any product / price / availability question described in words.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords describing the product the customer wants.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product_by_link',
    description:
      'Resolve a specific product when the customer pastes an rszevar.com product link. Returns the title, price, availability and available variants. Use whenever the message contains an rszevar.com/products/... URL.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The rszevar.com product URL the customer shared.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_best_sellers',
    description:
      "Get RS ZEVAR's current best-selling / most popular / trending products (ranked by recent sales). Use whenever the customer asks about best sellers, top selling, most popular, trending, 'what should I buy', or 'aap ke best products kya hain'.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'track_order',
    description:
      "Look up the live status of a customer's order using their order number (e.g. 121580 or ZEVAR-XXXXXX) or their phone number. Use when the customer asks where their order is, order/delivery status, tracking, or shares an order number/phone for tracking. Returns the current status, courier, tracking number and tracking link.",
    parameters: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: "The customer's order number or phone number." },
      },
      required: ['identifier'],
    },
  },
  {
    name: 'build_cart',
    description:
      "Create a Shopify checkout cart link for products the customer wants to order on the website. Call this ONLY after the customer has clearly chosen the product(s), the specific variant (colour/size) where a product has more than one, the quantity, and has confirmed they want to order. Pass each item's product handle (from search results), the chosen variant text if applicable, and quantity. Returns a checkout link to share, OR a list of variants to choose from when the variant is ambiguous, OR an out-of-stock/not-found note.",
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Products to put in the cart.',
          items: {
            type: 'object',
            properties: {
              handle: { type: 'string', description: 'Product handle from search results.' },
              variant: { type: 'string', description: 'Chosen variant text e.g. "green", "2.4", "Red / M". Optional if the product has only one variant.' },
              quantity: { type: 'integer', description: 'Quantity (default 1).' },
            },
            required: ['handle'],
          },
        },
      },
      required: ['items'],
    },
  },
];

// ─── Aggregate variant rows → product summaries ──────────────────────────────
function aggregate(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const key = r.handle || r.parent_title || r.title;
    if (!key) continue;
    let p = map.get(key);
    if (!p) {
      p = {
        name: r.parent_title || r.title,
        handle: r.handle || null,
        min: null,
        max: null,
        compare_at: r.compare_at_price ?? null,
        in_stock: false,
        image: r.image_url || null,
        variants: [],
      };
      map.set(key, p);
    }
    if (r.selling_price != null) {
      if (p.min == null || r.selling_price < p.min) p.min = r.selling_price;
      if (p.max == null || r.selling_price > p.max) p.max = r.selling_price;
    }
    const inStock = (r.stock_quantity ?? 0) > 0;
    if (inStock) {
      p.in_stock = true;
      if (r.title && r.title !== p.name) p.variants.push(r.title);
    }
    if (!p.image && r.image_url) p.image = r.image_url;
  }
  return [...map.values()].map((p) => ({
    name: p.name,
    price: p.min == null ? null : p.min === p.max ? p.min : `${p.min}-${p.max}`,
    compare_at_price: p.compare_at,
    in_stock: p.in_stock,
    available_variants: [...new Set(p.variants)].slice(0, 15),
    url: productUrl(p.handle),
    image: p.image,
  }));
}

// ─── search_products ─────────────────────────────────────────────────────────
export async function searchProducts(query, db) {
  const raw = String(query || '').trim();
  if (!raw) return { results: [] };
  // Strip chars that break PostgREST .or() filters.
  const q = raw.replace(/[,()%*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return { results: [] };

  async function run(term) {
    const safe = term.replace(/[,()%*]/g, ' ').trim();
    const { data, error } = await db
      .from('products')
      .select(SELECT)
      .eq('is_active', true)
      .or(`parent_title.ilike.%${safe}%,title.ilike.%${safe}%`)
      .limit(80);
    if (error) throw error;
    return data || [];
  }

  let rows = await run(q);
  if (rows.length === 0) {
    const longest = q.split(' ').sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 3) rows = await run(longest);
  }

  const products = aggregate(rows).slice(0, 5);
  return { count: products.length, results: products };
}

// ─── get_product_by_link ─────────────────────────────────────────────────────
export async function getProductByLink(url, db) {
  const m = String(url || '').match(/\/products\/([^/?#\s]+)/i);
  const handle = m ? decodeURIComponent(m[1]) : null;
  if (!handle) return { found: false, reason: 'No product handle found in URL' };

  const { data, error } = await db
    .from('products')
    .select(SELECT)
    .eq('handle', handle)
    .limit(100);
  if (error) throw error;

  const rows = (data || []).filter((r) => r.is_active !== false);
  if (rows.length === 0) return { found: false, handle };

  return { found: true, product: aggregate(rows)[0] };
}

// ─── get_best_sellers ────────────────────────────────────────────────────────
export async function getBestSellers(db, limit) {
  limit = limit || 6;
  async function run(col) {
    const { data, error } = await db
      .from('products')
      .select(SELECT + ', ' + col)
      .eq('is_active', true)
      .gt('stock_quantity', 0)
      .not(col, 'is', null)
      .order(col, { ascending: false })
      .limit(60);
    if (error) throw error;
    return data || [];
  }
  let rows = await run('units_sold_90d');
  if (rows.length === 0) rows = await run('units_sold_180d');
  const products = aggregate(rows).slice(0, limit);
  return { count: products.length, results: products };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────
export async function executeTool(name, args, supabase) {
  const db = supabase || createServerClient();
  try {
    if (name === 'search_products') return await searchProducts(args?.query || '', db);
    if (name === 'get_product_by_link') return await getProductByLink(args?.url || '', db);
    if (name === 'get_best_sellers') return await getBestSellers(db);
    if (name === 'track_order') return await trackOrder(db, args?.identifier || '');
    if (name === 'build_cart') return await buildCartLink(db, args?.items || []);
    return { error: `Unknown tool: ${name}` };
  } catch (e) {
    return { error: e.message };
  }
}
