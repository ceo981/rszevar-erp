// ============================================================================
// RS ZEVAR ERP — Shopify Helper Library
// Phase 1: Products now fetched via GraphQL (REST → GraphQL migration)
//          Collections per product included in sync.
// ============================================================================

import { getSettings } from './settings';
import { matchTagDefinitions } from './tags';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-01';

// ── REST API fetch (used for orders, fulfillments, etc.) ──
async function shopifyFetch(endpoint, params = {}, options = {}) {
  const url = new URL(`https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/${endpoint}`);

  if (!options.method || options.method === 'GET') {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }

  return res.json();
}

// ── GraphQL API fetch (used for products + collections) ──
async function shopifyGraphQL(query, variables = {}) {
  // Use 2025-01 for GraphQL (matches app's webhook version)
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  // Read body as text first (Shopify sometimes returns non-JSON errors)
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Shopify GraphQL error ${res.status}: ${text.slice(0, 500)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Shopify GraphQL returned non-JSON: ${text.slice(0, 500)}`);
  }

  if (json.errors) {
    throw new Error(`Shopify GraphQL: ${json.errors.map(e => e.message).join(', ')}`);
  }

  return json;
}

// ============================================================================
// ORDERS (unchanged — still REST)
// ============================================================================

export async function fetchOrders({ limit = 50, sinceId = null, status = 'any', createdAtMin = null } = {}) {
  const params = { limit, status };
  if (sinceId) params.since_id = sinceId;
  if (createdAtMin) params.created_at_min = createdAtMin;
  const data = await shopifyFetch('orders.json', params);
  return data.orders || [];
}

export async function fetchOrder(orderId) {
  const data = await shopifyFetch(`orders/${orderId}.json`);
  return data.order;
}

export async function fetchOrdersCount(status = 'any') {
  const data = await shopifyFetch('orders/count.json', { status });
  return data.count;
}

export async function fetchAllOrdersSince(sinceDate) {
  let allOrders = [];
  let page = 1;
  let hasMore = true;
  let sinceId = null;

  while (hasMore && page <= 20) {
    const params = { limit: 250, status: 'any' };
    if (sinceId) params.since_id = sinceId;
    if (sinceDate && !sinceId) params.created_at_min = sinceDate;

    const data = await shopifyFetch('orders.json', params);
    const orders = data.orders || [];

    if (orders.length === 0) {
      hasMore = false;
    } else {
      allOrders = allOrders.concat(orders);
      sinceId = orders[orders.length - 1].id;
      hasMore = orders.length === 250;
    }
    page++;
  }

  return allOrders;
}

// ── Fulfillment info extraction ──
function extractFulfillmentInfo(shopifyOrder) {
  const fulfillments = shopifyOrder.fulfillments || [];
  if (fulfillments.length === 0) return null;

  const active = fulfillments
    .filter(f => f.status !== 'cancelled')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

  if (!active) return null;

  const rawCompany = (active.tracking_company || '').trim();
  const dispatched_courier = normalizeCourierName(rawCompany);

  return {
    tracking_number: active.tracking_number || null,
    dispatched_courier,
    dispatched_at: active.created_at || null,
    shopify_fulfillment_id: active.id ? String(active.id) : null,
  };
}

function normalizeCourierName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes('postex')) return 'PostEx';
  if (lower.includes('leopard')) return 'Leopards';
  if (lower.includes('kangaroo')) return 'Kangaroo';
  if (lower.includes('tcs')) return 'TCS';
  if (lower.includes('m&p') || lower.includes('mnp')) return 'M&P';
  return name;
}

function parseShopifyTags(tagsString) {
  if (!tagsString) return [];
  return String(tagsString)
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);
}

// ============================================================================
// transformOrder — ASYNC (reads settings from DB)
// ============================================================================

export async function transformOrder(shopifyOrder) {
  const shipping = shopifyOrder.shipping_address || {};
  const customer = shopifyOrder.customer || {};
  const tags = parseShopifyTags(shopifyOrder.tags);

  const [rules, matchedTagDefs] = await Promise.all([
    getSettings('business_rules'),
    matchTagDefinitions(tags),
  ]);

  const { status, payment_status } = mapShopifyStatus(shopifyOrder, tags, rules);

  const is_wholesale     = tags.includes('wholesale');
  const is_international = tags.includes('international');
  const is_walkin        = tags.includes('walkin');

  const base = {
    shopify_order_id: String(shopifyOrder.id),
    order_number: shopifyOrder.name || `#${shopifyOrder.order_number}`,
    customer_name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || shipping.name || 'Unknown',
    customer_phone: shipping.phone || customer.phone || null,
    customer_city: shipping.city || null,
    customer_address: [shipping.address1, shipping.address2, shipping.city, shipping.province].filter(Boolean).join(', '),
    subtotal: parseFloat(shopifyOrder.subtotal_price) || 0,
    discount: parseFloat(shopifyOrder.total_discounts) || 0,
    shipping_fee: shopifyOrder.shipping_lines?.[0] ? parseFloat(shopifyOrder.shipping_lines[0].price) : 0,
    total_amount: parseFloat(shopifyOrder.total_price) || 0,
    payment_method: shopifyOrder.gateway === 'Cash on Delivery (COD)' || shopifyOrder.gateway === 'manual' ? 'COD' : shopifyOrder.gateway || 'COD',
    status,
    payment_status,
    tags,
    is_wholesale,
    is_international,
    is_walkin,
    shopify_synced_at: new Date().toISOString(),
    shopify_raw: shopifyOrder,
    created_at: shopifyOrder.created_at,
    updated_at: shopifyOrder.updated_at,
  };

  const fulfillmentInfo = extractFulfillmentInfo(shopifyOrder);
  if (fulfillmentInfo) {
    if (fulfillmentInfo.tracking_number) base.tracking_number = fulfillmentInfo.tracking_number;
    if (fulfillmentInfo.dispatched_courier) base.dispatched_courier = fulfillmentInfo.dispatched_courier;
    if (fulfillmentInfo.dispatched_at) base.dispatched_at = fulfillmentInfo.dispatched_at;
    if (fulfillmentInfo.shopify_fulfillment_id) {
      base.shopify_fulfillment_id = fulfillmentInfo.shopify_fulfillment_id;
      base.shopify_fulfilled_at = fulfillmentInfo.dispatched_at;
    }
  }

  for (const tagDef of matchedTagDefs) {
    const action = tagDef.auto_action || {};
    if (action.set_courier) {
      if (tagDef.tag_key === 'kangaroo' || !base.dispatched_courier) {
        base.dispatched_courier = action.set_courier;
      }
    }
  }

  return base;
}

export function transformLineItems(shopifyOrder) {
  return (shopifyOrder.line_items || []).map(item => ({
    shopify_line_item_id: String(item.id),
    title: item.title + (item.variant_title ? ` - ${item.variant_title}` : ''),
    sku: item.sku || null,
    quantity: item.quantity,
    unit_price: parseFloat(item.price) || 0,
    total_price: (parseFloat(item.price) || 0) * item.quantity,
  }));
}

// ============================================================================
// PRODUCTS — GraphQL fetch with collections
// ============================================================================

const PRODUCTS_GRAPHQL_QUERY = `
  query GetProducts($cursor: String) {
    products(first: 25, after: $cursor) {
      edges {
        node {
          id
          title
          vendor
          productType
          status
          images(first: 1) {
            edges { node { url } }
          }
          collections(first: 20) {
            edges { node { handle title } }
          }
          variants(first: 100) {
            edges {
              node {
                id
                sku
                title
                price
                compareAtPrice
                inventoryQuantity
                barcode
                inventoryItem { id }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Extract numeric ID from Shopify GID (gid://shopify/Product/123 → "123")
function extractGid(gid) {
  if (!gid) return null;
  const parts = gid.split('/');
  return parts[parts.length - 1];
}

// Normalize GraphQL product → same shape as REST (so transformProducts works unchanged)
function normalizeGraphQLProduct(node) {
  return {
    id: extractGid(node.id),
    title: node.title,
    vendor: node.vendor,
    product_type: node.productType,
    status: (node.status || '').toLowerCase(),
    image: node.images?.edges?.[0]?.node
      ? { src: node.images.edges[0].node.url }
      : null,
    images: (node.images?.edges || []).map(e => ({ src: e.node.url })),
    // NEW: collections array [{handle, title}]
    collections: (node.collections?.edges || []).map(e => ({
      handle: e.node.handle,
      title: e.node.title,
    })),
    variants: (node.variants?.edges || []).map(e => {
      const v = e.node;
      return {
        id: extractGid(v.id),
        sku: v.sku,
        title: v.title,
        price: v.price,
        compare_at_price: v.compareAtPrice,
        inventory_quantity: v.inventoryQuantity,
        weight: 0,
        barcode: v.barcode,
        inventory_item_id: v.inventoryItem ? extractGid(v.inventoryItem.id) : null,
      };
    }),
  };
}

// Fetch ALL products via GraphQL with cursor pagination
// Returns normalized products array (same shape as old REST but with collections added)
export async function fetchAllProducts() {
  let allProducts = [];
  let cursor = null;
  let hasNextPage = true;
  let pageCount = 0;
  const MAX_PAGES = 60; // safety: 60 pages × 25 = 1500 products max

  while (hasNextPage && pageCount < MAX_PAGES) {
    let result;
    // Retry once on failure (Shopify sometimes returns non-JSON on rate limit)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await shopifyGraphQL(PRODUCTS_GRAPHQL_QUERY, { cursor });
        break; // success
      } catch (err) {
        if (attempt === 0) {
          console.warn(`[shopify] GraphQL page ${pageCount + 1} failed, retrying in 3s...`, err.message);
          await new Promise(r => setTimeout(r, 3000));
        } else {
          // Second attempt failed — return what we have so far
          console.error(`[shopify] GraphQL page ${pageCount + 1} failed twice, returning ${allProducts.length} products collected so far`);
          return allProducts;
        }
      }
    }

    const connection = result.data?.products;

    if (!connection) {
      console.error('[shopify] GraphQL: no products connection in response');
      break;
    }

    const products = (connection.edges || []).map(e => normalizeGraphQLProduct(e.node));
    allProducts = allProducts.concat(products);

    hasNextPage = connection.pageInfo?.hasNextPage || false;
    cursor = connection.pageInfo?.endCursor || null;
    pageCount++;

    // Rate limit protection: 1s delay between pages
    if (hasNextPage) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return allProducts;
}

// Transform one Shopify product → array of variant rows for DB upsert
// Now includes collections field from GraphQL data
export function transformProducts(shopifyProduct) {
  // Extract collections [{handle, title}] — will be same for all variants of this product
  const collections = shopifyProduct.collections || [];

  return (shopifyProduct.variants || []).map(variant => {
    const isDefault = variant.title === 'Default Title';
    const fullTitle = isDefault ? shopifyProduct.title : `${shopifyProduct.title} - ${variant.title}`;

    return {
      shopify_product_id: String(shopifyProduct.id),
      shopify_variant_id: String(variant.id),
      title: fullTitle,
      parent_title: shopifyProduct.title,
      sku: variant.sku || null,
      barcode: variant.barcode || null,
      category: shopifyProduct.product_type || null,
      vendor: shopifyProduct.vendor || null,
      selling_price: parseFloat(variant.price) || 0,
      compare_at_price: parseFloat(variant.compare_at_price) || 0,
      current_stock: variant.inventory_quantity || 0,
      stock_quantity: variant.inventory_quantity || 0,
      weight: parseFloat(variant.weight) || 0,
      image_url: shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || null,
      is_active: shopifyProduct.status === 'active',
      shopify_inventory_item_id: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
      collections, // NEW: JSONB array of {handle, title}
      shopify_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}

// ============================================================================
// FULFILLMENT (legacy)
// ============================================================================

let cachedLocationId = null;

export async function getShopifyLocationId() {
  if (cachedLocationId) return cachedLocationId;
  const data = await shopifyFetch('locations.json');
  const loc = (data.locations || []).find(l => l.active) || data.locations?.[0];
  if (!loc) throw new Error('No active Shopify location found');
  cachedLocationId = loc.id;
  return loc.id;
}

function mapCourierToShopifyCarrier(courier) {
  const map = { 'PostEx': 'PostEx', 'Leopards': 'Leopards Courier', 'Kangaroo': 'Kangaroo Logistics' };
  return map[courier] || courier || 'Other';
}

export async function createShopifyFulfillment(shopifyOrderId, trackingNumber, courier) {
  if (!shopifyOrderId) throw new Error('shopifyOrderId required');
  if (!trackingNumber) throw new Error('trackingNumber required');

  const foData = await shopifyFetch(`orders/${shopifyOrderId}/fulfillment_orders.json`);
  const openFOs = (foData.fulfillment_orders || []).filter(
    fo => fo.status === 'open' || fo.status === 'in_progress'
  );

  if (openFOs.length === 0) {
    throw new Error('No open fulfillment orders (already fulfilled or cancelled in Shopify)');
  }

  const lineItemsByFO = openFOs.map(fo => ({ fulfillment_order_id: fo.id }));

  const data = await shopifyFetch('fulfillments.json', {}, {
    method: 'POST',
    body: {
      fulfillment: {
        line_items_by_fulfillment_order: lineItemsByFO,
        tracking_info: { number: trackingNumber, company: mapCourierToShopifyCarrier(courier) },
        notify_customer: true,
      },
    },
  });

  return data.fulfillment;
}

// ============================================================================
// STATUS MAPPING — rules-aware
// ============================================================================

function mapShopifyStatus(order, tags = [], rules = {}) {
  let status = 'pending';
  let payment_status = 'unpaid';

  const walkinAutoDeliver   = rules['rules.walkin_auto_deliver']        ?? true;
  const walkinAutoPaid      = rules['rules.walkin_auto_paid']           ?? true;
  const autoConfirmPaid     = rules['rules.auto_confirm_paid_orders']   ?? true;
  const autoConfirmTagged   = rules['rules.auto_confirm_tagged_orders'] ?? true;

  if (order.financial_status === 'refunded') {
    payment_status = 'refunded';
  } else if (order.financial_status === 'paid' || order.financial_status === 'partially_paid') {
    payment_status = 'paid';
  }

  if (order.cancelled_at) {
    return { status: 'cancelled', payment_status };
  }

  if (tags.includes('walkin')) {
    if (walkinAutoDeliver) status = 'delivered';
    if (walkinAutoPaid) payment_status = 'paid';
    if (walkinAutoDeliver) return { status, payment_status };
  }

  if (order.fulfillment_status === 'fulfilled' || order.fulfillment_status === 'partial') {
    status = 'dispatched';
  } else if ((tags.includes('order_confirmed') || tags.includes('order confirmed')) && autoConfirmTagged) {
    status = 'confirmed';
  } else if (payment_status === 'paid' && autoConfirmPaid) {
    status = 'confirmed';
  } else {
    status = 'pending';
  }

  return { status, payment_status };
}
