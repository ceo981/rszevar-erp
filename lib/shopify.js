const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-01';

async function shopifyFetch(endpoint, params = {}) {
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
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }

  return res.json();
}

// Fetch orders with pagination
export async function fetchOrders({ limit = 50, sinceId = null, status = 'any', createdAtMin = null } = {}) {
  const params = { limit, status };
  if (sinceId) params.since_id = sinceId;
  if (createdAtMin) params.created_at_min = createdAtMin;

  const data = await shopifyFetch('orders.json', params);
  return data.orders || [];
}

// Fetch single order
export async function fetchOrder(orderId) {
  const data = await shopifyFetch(`orders/${orderId}.json`);
  return data.order;
}

// Fetch orders count
export async function fetchOrdersCount(status = 'any') {
  const data = await shopifyFetch('orders/count.json', { status });
  return data.count;
}

// Fetch all orders with auto-pagination (max 250 per page)
export async function fetchAllOrdersSince(sinceDate) {
  let allOrders = [];
  let page = 1;
  let hasMore = true;
  let sinceId = null;

  while (hasMore && page <= 20) { // Safety limit: 20 pages = 5000 orders max
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

// Transform Shopify order to our DB format
export function transformOrder(shopifyOrder) {
  const shipping = shopifyOrder.shipping_address || {};
  const customer = shopifyOrder.customer || {};

  // Parse tags (Shopify returns comma-separated string)
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

// Fetch all products with pagination
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

// Fetch inventory levels
export async function fetchInventoryLevels(inventoryItemIds) {
  if (!inventoryItemIds.length) return [];
  // Shopify allows max 50 inventory item IDs per request
  const chunks = [];
  for (let i = 0; i < inventoryItemIds.length; i += 50) {
    chunks.push(inventoryItemIds.slice(i, i + 50));
  }

  let allLevels = [];
  for (const chunk of chunks) {
    const data = await shopifyFetch('inventory_levels.json', {
      inventory_item_ids: chunk.join(','),
    });
    allLevels = allLevels.concat(data.inventory_levels || []);
  }
  return allLevels;
}

// Transform Shopify product to our DB format (one row per variant)
export function transformProducts(shopifyProduct) {
  return (shopifyProduct.variants || []).map(variant => ({
    shopify_product_id: String(shopifyProduct.id),
    shopify_variant_id: String(variant.id),
    title: shopifyProduct.title + (variant.title !== 'Default Title' ? ` - ${variant.title}` : ''),
    sku: variant.sku || null,
    barcode: variant.barcode || null,
    category: shopifyProduct.product_type || null,
    vendor: shopifyProduct.vendor || null,
    cost_price: parseFloat(variant.compare_at_price) || 0,
    selling_price: parseFloat(variant.price) || 0,
    stock_quantity: variant.inventory_quantity || 0,
    image_url: shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || null,
    is_active: shopifyProduct.status === 'active',
    shopify_inventory_item_id: String(variant.inventory_item_id),
    updated_at: new Date().toISOString(),
  }));
}

// Map Shopify order to ERP status + payment_status
// Returns { status, payment_status }
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
  // Cancelled is highest priority
  if (order.cancelled_at) {
    status = 'cancelled';
    return { status, payment_status };
  }

  // Fulfilled by Shopify (tracking added, courier handover) → dispatched
  if (order.fulfillment_status === 'fulfilled' || order.fulfillment_status === 'partial') {
    status = 'dispatched';
  }
  // Confirmed via tag from Shopify Admin
  else if (tags.includes('order_confirmed')) {
    status = 'confirmed';
  }
  // Card payment orders are auto-confirmed (paisay mil gaye, confirmation call ki zaroorat nahi)
  else if (payment_status === 'paid') {
    status = 'confirmed';
  }
  // Default: pending
  else {
    status = 'pending';
  }

  return { status, payment_status };
}
