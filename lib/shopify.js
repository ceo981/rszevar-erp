// ============================================================================
// RS ZEVAR ERP — Shopify Helper Library
// Phase 4: Added fulfillment push (createShopifyFulfillment) + variant-level sync
// ============================================================================

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-01';

// Generic Shopify API caller (supports GET + POST/PUT)
async function shopifyFetch(endpoint, params = {}, options = {}) {
  const url = new URL(`https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/${endpoint}`);

  // Only put params in querystring for GET
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

// ============================================================================
// ORDERS
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

// Fetch all orders with auto-pagination (max 250 per page, safety limit 20 pages)
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

// Transform Shopify order to ERP DB format
export function transformOrder(shopifyOrder) {
  const shipping = shopifyOrder.shipping_address || {};
  const customer = shopifyOrder.customer || {};

  const tags = (shopifyOrder.tags || '')
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

  const { status, payment_status } = mapShopifyStatus(shopifyOrder, tags);

  return {
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
    shopify_synced_at: new Date().toISOString(),
    shopify_raw: shopifyOrder,
    created_at: shopifyOrder.created_at,
    updated_at: shopifyOrder.updated_at,
  };
}

// Transform line items
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
// PRODUCTS
// ============================================================================

export async function fetchAllProducts() {
  let allProducts = [];
  let sinceId = null;
  let hasMore = true;
  let page = 1;

  while (hasMore && page <= 10) {
    const params = { limit: 250 };
    if (sinceId) params.since_id = sinceId;

    const data = await shopifyFetch('products.json', params);
    const products = data.products || [];

    if (products.length === 0) {
      hasMore = false;
    } else {
      allProducts = allProducts.concat(products);
      sinceId = products[products.length - 1].id;
      hasMore = products.length === 250;
    }
    page++;
  }

  return allProducts;
}

// Transform Shopify product → array of variant rows (one row per variant)
// NOTE: cost_price is intentionally NOT set — Shopify doesn't expose cost
// without a separate inventory_item fetch, and we don't want to overwrite
// manually-entered cost prices in the ERP.
export function transformProducts(shopifyProduct) {
  return (shopifyProduct.variants || []).map(variant => {
    const isDefault = variant.title === 'Default Title';
    const fullTitle = isDefault
      ? shopifyProduct.title
      : `${shopifyProduct.title} - ${variant.title}`;

    return {
      shopify_product_id: String(shopifyProduct.id),
      shopify_variant_id: String(variant.id),
      title: fullTitle,
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
      shopify_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}

// ============================================================================
// FULFILLMENT (ERP → Shopify push)
// ============================================================================

// Cache the location ID — RS Zevar has 1 warehouse, no need to refetch
let cachedLocationId = null;

export async function getShopifyLocationId() {
  if (cachedLocationId) return cachedLocationId;
  const data = await shopifyFetch('locations.json');
  const loc = (data.locations || []).find(l => l.active) || data.locations?.[0];
  if (!loc) throw new Error('No active Shopify location found');
  cachedLocationId = loc.id;
  return loc.id;
}

// Map ERP courier names → Shopify carrier strings (for tracking link generation)
function mapCourierToShopifyCarrier(courier) {
  const map = {
    'PostEx': 'PostEx',
    'Leopards': 'Leopards Courier',
    'Kangaroo': 'Kangaroo Logistics',
  };
  return map[courier] || courier || 'Other';
}

/**
 * Push fulfillment to Shopify after ERP dispatch.
 * Uses the modern FulfillmentOrder API (2024-01 compatible).
 *
 * Flow:
 *   1. GET /orders/{id}/fulfillment_orders.json → get open fulfillment_order_ids
 *   2. POST /fulfillments.json with line_items_by_fulfillment_order + tracking
 *   3. Shopify auto-emails customer with tracking link
 *
 * Returns the created fulfillment object (has .id we can store).
 */
export async function createShopifyFulfillment(shopifyOrderId, trackingNumber, courier) {
  if (!shopifyOrderId) throw new Error('shopifyOrderId required');
  if (!trackingNumber) throw new Error('trackingNumber required');

  // Step 1: Get open fulfillment orders
  const foData = await shopifyFetch(`orders/${shopifyOrderId}/fulfillment_orders.json`);
  const openFOs = (foData.fulfillment_orders || []).filter(
    fo => fo.status === 'open' || fo.status === 'in_progress'
  );

  if (openFOs.length === 0) {
    throw new Error('No open fulfillment orders (already fulfilled or cancelled in Shopify)');
  }

  // Step 2: Build payload — fulfill ALL items in each open FO
  const lineItemsByFO = openFOs.map(fo => ({
    fulfillment_order_id: fo.id,
    // Empty fulfillment_order_line_items = fulfill everything in this FO
  }));

  // Step 3: Create fulfillment
  const data = await shopifyFetch('fulfillments.json', {}, {
    method: 'POST',
    body: {
      fulfillment: {
        line_items_by_fulfillment_order: lineItemsByFO,
        tracking_info: {
          number: trackingNumber,
          company: mapCourierToShopifyCarrier(courier),
        },
        notify_customer: true,
      },
    },
  });

  return data.fulfillment;
}

// ============================================================================
// STATUS MAPPING (used by transformOrder)
// ============================================================================

// Map Shopify order → ERP status + payment_status
//
// Rules:
// 1. cancelled_at → status: cancelled
// 2. financial_status === 'refunded' → payment_status: refunded
// 3. financial_status === 'paid' or 'partially_paid' → payment_status: paid
//    - Card payment orders come pre-paid
// 4. tags includes 'order_confirmed' → status: confirmed
// 5. fulfillment_status === 'fulfilled' or 'partial' → status: dispatched
//    - Never auto-set to 'delivered' (that comes from courier API)
// 6. Default: pending / unpaid
function mapShopifyStatus(order, tags = []) {
  let status = 'pending';
  let payment_status = 'unpaid';

  // ── Payment Status Mapping ──
  if (order.financial_status === 'refunded') {
    payment_status = 'refunded';
  } else if (order.financial_status === 'paid' || order.financial_status === 'partially_paid') {
    payment_status = 'paid';
  }

  // ── Order Status Mapping ──
  if (order.cancelled_at) {
    status = 'cancelled';
    return { status, payment_status };
  }

  if (order.fulfillment_status === 'fulfilled' || order.fulfillment_status === 'partial') {
    status = 'dispatched';
  } else if (tags.includes('order_confirmed')) {
    status = 'confirmed';
  } else if (payment_status === 'paid') {
    // Card payment orders are auto-confirmed (paisay mil gaye)
    status = 'confirmed';
  } else {
    status = 'pending';
  }

  return { status, payment_status };
}
