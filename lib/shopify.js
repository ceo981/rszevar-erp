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
    // FIX Apr 2026 — Use `updated_at_min` instead of `created_at_min`.
    // Pehle sync sirf naye orders pakarta tha. Agar purana order Shopify mein
    // edit hota (items remove/add/price change), uska `updated_at` refresh
    // hota hai lekin `created_at` wahi rehta. `created_at_min` filter us order
    // ko sync mein nahi laata — isliye edits ERP mein reflect nahi hote the.
    // `updated_at_min` dono ko catch karta hai: naye orders (updated_at
    // creation ke saath set hota) + edited purane orders.
    if (sinceDate && !sinceId) params.updated_at_min = sinceDate;

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
  let dispatched_courier = normalizeCourierName(rawCompany);

  // Fallback: if Shopify's tracking_company didn't identify a known courier
  // (e.g. it was "Other" or empty), try detecting from tracking number prefix.
  if (!KNOWN_COURIERS_FOR_FALLBACK.includes(dispatched_courier)) {
    const fromPrefix = detectCourierFromTracking(active.tracking_number);
    if (fromPrefix) dispatched_courier = fromPrefix;
  }

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

// Tracking-number-prefix based detection — fallback when tracking_company
// is "Other" / missing / unrecognized. Add more patterns as needed.
export function detectCourierFromTracking(tracking) {
  if (!tracking) return null;
  const t = String(tracking).trim().toUpperCase();
  if (t.startsWith('KL')) return 'Kangaroo';
  if (t.startsWith('KI')) return 'Leopards';
  // Future: PostEx prefix pattern can be added here
  return null;
}

const KNOWN_COURIERS_FOR_FALLBACK = ['PostEx', 'Leopards', 'Kangaroo', 'TCS', 'M&P'];

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

  // FIX Apr 2026 — Post-edit totals support:
  // Shopify sends both `subtotal_price`/`total_price`/`total_discounts` AND
  // `current_subtotal_price`/`current_total_price`/`current_total_discounts`.
  // After an order is edited, the `current_*` fields are the authoritative
  // post-edit values; the non-current ones remain as "original order snapshot".
  // We use `current_*` when available, fall back to non-current otherwise.
  // This fixes the bug where edited orders showed stale 46-items / Rs 64,520
  // instead of the correct 44-items / Rs 61,000 after Shopify-side edit.
  const subtotalRaw = shopifyOrder.current_subtotal_price ?? shopifyOrder.subtotal_price;
  const discountRaw = shopifyOrder.current_total_discounts ?? shopifyOrder.total_discounts;
  const totalRaw    = shopifyOrder.current_total_price ?? shopifyOrder.total_price;

  const base = {
    shopify_order_id: String(shopifyOrder.id),
    order_number: shopifyOrder.name || `#${shopifyOrder.order_number}`,
    customer_name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || shipping.name || 'Unknown',
    customer_phone: shipping.phone || customer.phone || null,
    customer_city: shipping.city || null,
    customer_address: [shipping.address1, shipping.address2, shipping.city, shipping.province].filter(Boolean).join(', '),
    subtotal: parseFloat(subtotalRaw) || 0,
    discount: parseFloat(discountRaw) || 0,
    shipping_fee: shopifyOrder.shipping_lines?.[0] ? parseFloat(shopifyOrder.shipping_lines[0].price) : 0,
    total_amount: parseFloat(totalRaw) || 0,
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

  // If mapShopifyStatus decided this is a 'confirmed' order (via tag or paid),
  // stamp confirmed_at. handleOrderWebhook will strip this if existing order
  // is already confirmed (to preserve original timestamp).
  if (status === 'confirmed') {
    base.confirmed_at = new Date().toISOString();
  }

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

// ============================================================================
// FIX Apr 2026 — Order-Edit removed-items filter
// ----------------------------------------------------------------------------
// Shopify ka Order Editing API jab kisi item ko remove karta hai, woh `line_items`
// array se item ko delete NAHI karta — woh us item ka `current_quantity: 0`
// set kar deta hai (history preservation ke liye). Original `quantity` field
// (purchase-time count) wahi rehta hai.
//
// Pre-edit (unedited orders): `current_quantity` undefined ya === quantity
// Post-edit fully removed:    `current_quantity === 0`, quantity unchanged
// Post-edit partial reduce:   `current_quantity < quantity`
// Post-refund:                `current_quantity` further reduces by refund qty
//
// `current_quantity` = "abhi active count" — yahi humein chahiye dispatch +
// packing + customer-facing displays mein.
// ============================================================================

// True agar item still part of the active order (not fully removed/refunded).
export function isActiveLineItem(item) {
  if (!item) return false;
  if (item.current_quantity !== undefined && item.current_quantity !== null) {
    return item.current_quantity > 0;
  }
  // Unedited orders may not have current_quantity — fall back to quantity
  return (item.quantity || 0) > 0;
}

// Effective (post-edit, post-refund) quantity — for display + packing.
export function getEffectiveQuantity(item) {
  if (!item) return 0;
  if (item.current_quantity !== undefined && item.current_quantity !== null) {
    return item.current_quantity;
  }
  return item.quantity || 1;
}

export function transformLineItems(shopifyOrder, skuImageMap = {}) {
  return (shopifyOrder.line_items || [])
    // FIX Apr 2026 — Filter out items removed via Shopify Order Edit.
    // Bug tha ke removed item bhi order_items table mein insert ho raha tha
    // (jaise ZEVAR-118275 mein White variant remove kiya tha but ERP mein
    // dono earrings dikha rahe thay). `current_quantity === 0` matlab item
    // ab order ka part nahi hai — skip it.
    .filter(isActiveLineItem)
    .map(item => {
      // Shopify REST kabhi kabhi image null deta hai multi-item orders mein
      // fallback: skuImageMap se (products table se pre-fetched)
      const imageUrl = item.image?.src
        || (item.sku ? skuImageMap[item.sku] : null)
        || null;

      // FIX Apr 2026 — Line-level discount tracking:
      // Shopify ka `line_item.price` original unit price hota hai (before discount).
      // Line-level discount `total_discount` mein hota hai (per line, not per unit).
      // Effective unit price = price - (total_discount / quantity).
      // Frontend is data ko strikethrough display ke liye use karega:
      //   Rs 1,450 (struck through) → Rs 1,380 (charged)
      const originalUnitPrice = parseFloat(item.price) || 0;
      const lineDiscount = parseFloat(item.total_discount) || 0;
      // FIX Apr 2026 — Use POST-edit quantity (current_quantity) so partial
      // reductions (qty 3 → 2) reflect correctly. Full removals already
      // filtered out above by isActiveLineItem.
      const qty = getEffectiveQuantity(item);
      const effectiveUnitPrice = qty > 0 ? originalUnitPrice - (lineDiscount / qty) : originalUnitPrice;

      return {
        shopify_line_item_id: String(item.id),
        title: item.title + (item.variant_title ? ` - ${item.variant_title}` : ''),
        sku: item.sku || null,
        quantity: qty,
        unit_price: originalUnitPrice,
        // total_price = original line total (before line-level discount)
        // Matches historical behavior + consistent with what ERP stores.
        total_price: originalUnitPrice * qty,
        image_url: imageUrl,
        // NOTE: originalUnitPrice, effectiveUnitPrice, lineDiscount
        // DB columns nahi hain — frontend shopify_raw se directly read karta hai
        // for strikethrough display (see OrderDrawer / order detail page).
        // Agar future mein order_items table mein `line_discount` column add kiya,
        // yahan add kar do aur DB bhi sync rahegi.
      };
    });
}

// ============================================================================
// PRODUCTS — REST for data, lightweight GraphQL for collections only
// ============================================================================

// ── REST: fetch all products (fast, reliable, proven) ──
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

// ── GraphQL: fetch ONLY product → collections mapping (lightweight) ──
// Returns Map<shopify_product_id, [{handle, title}]>
const COLLECTIONS_QUERY = `
  query GetCollections($cursor: String) {
    products(first: 100, after: $cursor) {
      edges {
        node {
          id
          collections(first: 20) {
            edges { node { handle title } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function extractGid(gid) {
  if (!gid) return null;
  const parts = gid.split('/');
  return parts[parts.length - 1];
}

export async function fetchProductCollections() {
  const collectionMap = new Map(); // shopify_product_id → [{handle, title}]
  let cursor = null;
  let hasNextPage = true;
  let pageCount = 0;

  while (hasNextPage && pageCount < 20) {
    let result;
    try {
      result = await shopifyGraphQL(COLLECTIONS_QUERY, { cursor });
    } catch (err) {
      console.error(`[shopify] Collections GraphQL page ${pageCount + 1} failed:`, err.message);
      break; // return what we have
    }

    const connection = result.data?.products;
    if (!connection) break;

    for (const edge of connection.edges || []) {
      const productId = extractGid(edge.node.id);
      const collections = (edge.node.collections?.edges || []).map(e => ({
        handle: e.node.handle,
        title: e.node.title,
      }));
      if (productId && collections.length > 0) {
        collectionMap.set(productId, collections);
      }
    }

    hasNextPage = connection.pageInfo?.hasNextPage || false;
    cursor = connection.pageInfo?.endCursor || null;
    pageCount++;

    if (hasNextPage) await new Promise(r => setTimeout(r, 300));
  }

  return collectionMap;
}

// Transform one Shopify product → array of variant rows for DB upsert
export function transformProducts(shopifyProduct) {
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
      image_url: (shopifyProduct.images?.find(img => img.variant_ids?.includes(variant.id))?.src)
        || shopifyProduct.image?.src
        || shopifyProduct.images?.[0]?.src
        || null,
      is_active: shopifyProduct.status === 'active',
      shopify_inventory_item_id: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
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

export async function createShopifyFulfillment(shopifyOrderId, trackingNumber, courier, trackingUrl) {
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
        tracking_info: {
          number: trackingNumber,
          company: mapCourierToShopifyCarrier(courier),
          url: trackingUrl || (trackingNumber ? `https://lcs.appsbymoose.com/track/${trackingNumber}` : null),
        },
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

  // NOTE: Shopify fulfillment status deliberately does NOT set ERP status to 'dispatched'.
  // Office status 'dispatched' can ONLY come from the ERP dispatcher's action.
  // Rule: courier/fulfillment activity = courier_status_raw only, not office status.
  if (
    (tags.includes('order_confirmed') ||
     tags.includes('order confirmed') ||
     tags.includes('whatsapp_confirmed') ||
     tags.includes('whatsapp confirmed')) &&
    autoConfirmTagged
  ) {
    status = 'confirmed';
  } else if (payment_status === 'paid' && autoConfirmPaid) {
    status = 'confirmed';
  } else {
    status = 'pending';
  }

  return { status, payment_status };
}

// ============================================================================
// SHOPIFY WRITE ACTIONS — Two-way sync
// ============================================================================

// ── Add/remove tags on a Shopify order ──
export async function updateShopifyOrderTags(shopifyOrderId, tagsToAdd = [], tagsToRemove = []) {
  // First get current tags
  const data = await shopifyFetch(`orders/${shopifyOrderId}.json`);
  const currentTags = (data.order?.tags || '').split(',').map(t => t.trim()).filter(Boolean);

  const newTags = [...new Set([
    ...currentTags.filter(t => !tagsToRemove.includes(t)),
    ...tagsToAdd,
  ])];

  return shopifyFetch(`orders/${shopifyOrderId}.json`, {}, {
    method: 'PUT',
    body: { order: { id: shopifyOrderId, tags: newTags.join(', ') } },
  });
}

// ── Add a note/comment to a Shopify order ──
export async function addShopifyOrderNote(shopifyOrderId, note) {
  // Shopify note field append — get existing first
  const data = await shopifyFetch(`orders/${shopifyOrderId}.json`);
  const existingNote = data.order?.note || '';
  const timestamp = new Date().toLocaleString('en-PK', { dateStyle: 'short', timeStyle: 'short' });
  const newNote = existingNote
    ? `${existingNote}\n---\n[${timestamp}] ${note}`
    : `[${timestamp}] ${note}`;

  return shopifyFetch(`orders/${shopifyOrderId}.json`, {}, {
    method: 'PUT',
    body: { order: { id: shopifyOrderId, note: newNote } },
  });
}

// ── Cancel a Shopify order (with restock support via GraphQL) ──
// reasonStr: 'customer' | 'declined' | 'fraud' | 'inventory' | 'staff' | 'other'
export async function cancelShopifyOrder(shopifyOrderId, options = {}) {
  // Backward compat: agar string pass hua hai (purana signature) to reason samjho
  if (typeof options === 'string') {
    options = { reason: options };
  }

  const {
    reason = 'other',
    restock = true,           // default TRUE — yahi tumhara fix hai
    refund = true,            // COD pe no-op; card orders ke liye safe default
    notifyCustomer = false,   // hum khud WhatsApp pe inform karte hain
    staffNote = null,
  } = options;

  // REST id (e.g. "5234567890") → GraphQL GID
  const orderGid = String(shopifyOrderId).startsWith('gid://')
    ? shopifyOrderId
    : `gid://shopify/Order/${shopifyOrderId}`;

  // OrderCancelReason enum is UPPERCASE in GraphQL
  const reasonEnum = String(reason).toUpperCase(); // 'OTHER', 'CUSTOMER', etc.

  const mutation = `
    mutation OrderCancel(
      $orderId: ID!
      $reason: OrderCancelReason!
      $restock: Boolean!
      $refund: Boolean!
      $notifyCustomer: Boolean
      $staffNote: String
    ) {
      orderCancel(
        orderId: $orderId
        reason: $reason
        restock: $restock
        refund: $refund
        notifyCustomer: $notifyCustomer
        staffNote: $staffNote
      ) {
        job { id done }
        orderCancelUserErrors { field message code }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    orderId: orderGid,
    reason: reasonEnum,
    restock,
    refund,
    notifyCustomer,
    staffNote,
  };

  const result = await shopifyGraphQL(mutation, variables);
  const payload = result?.data?.orderCancel;

  // Input/permission errors
  const userErrs = [
    ...(payload?.orderCancelUserErrors || []),
    ...(payload?.userErrors || []),
  ];
  if (userErrs.length) {
    throw new Error(`Shopify orderCancel: ${userErrs.map(e => e.message).join('; ')}`);
  }

  return {
    job_id: payload?.job?.id || null,
    job_done: payload?.job?.done || false,
    restocked: restock,
  };
}

// ── Update order address in Shopify ──
export async function updateShopifyOrderAddress(shopifyOrderId, shipping) {
  return shopifyFetch(`orders/${shopifyOrderId}.json`, {}, {
    method: 'PUT',
    body: {
      order: {
        id: shopifyOrderId,
        shipping_address: shipping,
      },
    },
  });
}

// ── Create a draft order in Shopify ──
export async function createShopifyDraftOrder({ customer_name, customer_phone, customer_address, customer_city, line_items, note }) {
  const [first_name, ...rest] = (customer_name || 'Customer').split(' ');
  const last_name = rest.join(' ') || '.';

  return shopifyFetch('draft_orders.json', {}, {
    method: 'POST',
    body: {
      draft_order: {
        line_items: line_items || [],
        shipping_address: {
          first_name,
          last_name,
          phone: customer_phone || '',
          address1: customer_address || '',
          city: customer_city || 'Karachi',
          country: 'Pakistan',
        },
        note: note || '',
      },
    },
  });
}

// ── Mark a Shopify order as paid (GraphQL — cleanest path) ──
// Shopify's orderMarkAsPaid mutation handles authorization capture or sale
// transaction creation internally — no manual transaction bookkeeping needed.
// Idempotent: if already paid, treat as no-op success.
export async function markShopifyOrderAsPaid(shopifyOrderId) {
  if (!shopifyOrderId) {
    throw new Error('shopify_order_id required');
  }

  const gid = `gid://shopify/Order/${shopifyOrderId}`;

  const mutation = `
    mutation MarkPaid($input: OrderMarkAsPaidInput!) {
      orderMarkAsPaid(input: $input) {
        order {
          id
          displayFinancialStatus
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const result = await shopifyGraphQL(mutation, { input: { id: gid } });
  const userErrors = result.data?.orderMarkAsPaid?.userErrors || [];

  if (userErrors.length > 0) {
    // Idempotency: if Shopify says already paid, treat as success
    const alreadyPaid = userErrors.some(e =>
      /already\s+paid|fully\s+paid|paid\s+in\s+full/i.test(e.message || ''),
    );
    if (alreadyPaid) {
      return { shopify_order_id: shopifyOrderId, already_paid: true };
    }
    throw new Error(`Shopify mark-as-paid: ${userErrors.map(e => e.message).join(', ')}`);
  }

  return {
    shopify_order_id: shopifyOrderId,
    financial_status: result.data?.orderMarkAsPaid?.order?.displayFinancialStatus || null,
    already_paid: false,
  };
}
