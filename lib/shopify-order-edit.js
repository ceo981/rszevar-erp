/**
 * RS ZEVAR ERP — Shopify Order Editing helpers
 * =============================================
 * All GraphQL mutations for the Shopify Order Editing flow.
 *
 * Lifecycle:
 *   1. beginOrderEdit(shopify_order_id) → returns calculated_order_id
 *   2. stageXxx(...)                    → stages a single change (no commit)
 *   3. commitOrderEdit(calc_id, ...)    → applies changes to the real order
 *
 * If commit is never called, no changes happen. The "calculatedOrder" is a
 * draft held by Shopify for ~24 hours.
 *
 * All mutations go through the existing shopifyGraphQL helper in lib/shopify.js.
 * We re-implement shopifyGraphQL locally to avoid a circular dep — both files
 * hit the same endpoint with the same headers.
 *
 * Currency: hardcoded PKR (RS ZEVAR sells only in PKR).
 */

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2025-01';

async function gql(query, variables = {}) {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify GraphQL ${res.status}: ${text.slice(0, 500)}`);
  }

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Shopify GraphQL non-JSON: ${text.slice(0, 300)}`); }

  if (json.errors) {
    throw new Error(`Shopify GraphQL: ${json.errors.map(e => e.message).join(', ')}`);
  }

  return json.data;
}

// Check a mutation result for userErrors and throw if any
function throwUserErrors(key, result) {
  const errs = result?.[key]?.userErrors || [];
  if (errs.length > 0) {
    throw new Error(`Shopify ${key}: ${errs.map(e => `${e.field?.join('.') || ''}: ${e.message}`).join('; ')}`);
  }
}

// Calculated order shape we return to the frontend (kept minimal + stable)
const CALCULATED_ORDER_FIELDS = `
  id
  subtotalPriceSet { shopMoney { amount } }
  totalPriceSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  cartDiscountAmountSet { shopMoney { amount } }
  lineItems(first: 100) {
    edges {
      node {
        id
        title
        quantity
        editableQuantity
        hasStagedLineItemDiscount
        variant {
          id
          title
          sku
          image { url }
          product { id title }
        }
        originalUnitPriceSet { shopMoney { amount } }
        discountedTotalSet { shopMoney { amount } }
        uneditableSubtitle
        restocking
      }
    }
  }
  shippingLines(first: 5) {
    edges {
      node {
        id
        title
        priceSet { shopMoney { amount } }
      }
    }
  }
`;

function normalizeCalculatedOrder(co) {
  if (!co) return null;
  return {
    calculated_order_id: co.id,
    subtotal: parseFloat(co.subtotalPriceSet?.shopMoney?.amount || 0),
    total: parseFloat(co.totalPriceSet?.shopMoney?.amount || 0),
    shipping: parseFloat(co.totalShippingPriceSet?.shopMoney?.amount || 0),
    cart_discount: parseFloat(co.cartDiscountAmountSet?.shopMoney?.amount || 0),
    items: (co.lineItems?.edges || []).map(e => ({
      id: e.node.id,
      title: e.node.title,
      quantity: e.node.quantity,
      editable_quantity: e.node.editableQuantity,
      has_discount: !!e.node.hasStagedLineItemDiscount,
      restocking: !!e.node.restocking,
      uneditable_reason: e.node.uneditableSubtitle || null,
      variant_id: e.node.variant?.id || null,
      variant_title: e.node.variant?.title || null,
      sku: e.node.variant?.sku || null,
      image_url: e.node.variant?.image?.url || null,
      product_id: e.node.variant?.product?.id || null,
      product_title: e.node.variant?.product?.title || null,
      unit_price: parseFloat(e.node.originalUnitPriceSet?.shopMoney?.amount || 0),
      line_total: parseFloat(e.node.discountedTotalSet?.shopMoney?.amount || 0),
    })),
    shipping_lines: (co.shippingLines?.edges || []).map(e => ({
      id: e.node.id,
      title: e.node.title,
      price: parseFloat(e.node.priceSet?.shopMoney?.amount || 0),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Begin edit — creates a calculatedOrder (draft) for the given real order
// ─────────────────────────────────────────────────────────────────────────────
export async function beginOrderEdit(shopifyOrderId) {
  if (!shopifyOrderId) throw new Error('shopify_order_id required');
  const gid = `gid://shopify/Order/${shopifyOrderId}`;

  const query = `
    mutation BeginEdit($id: ID!) {
      orderEditBegin(id: $id) {
        calculatedOrder { ${CALCULATED_ORDER_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await gql(query, { id: gid });
  throwUserErrors('orderEditBegin', data);
  return normalizeCalculatedOrder(data.orderEditBegin.calculatedOrder);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2a. Stage: set line item quantity (0 = remove; restock=true → stock back)
// ─────────────────────────────────────────────────────────────────────────────
export async function stageSetQuantity({ calculated_order_id, line_item_id, quantity, restock = true }) {
  if (!calculated_order_id || !line_item_id) throw new Error('calculated_order_id + line_item_id required');
  if (typeof quantity !== 'number' || quantity < 0) throw new Error('quantity must be a non-negative number');

  const query = `
    mutation SetQty($id: ID!, $li: ID!, $q: Int!, $r: Boolean) {
      orderEditSetQuantity(id: $id, lineItemId: $li, quantity: $q, restock: $r) {
        calculatedOrder { ${CALCULATED_ORDER_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await gql(query, {
    id: calculated_order_id,
    li: line_item_id,
    q: quantity,
    r: restock,
  });
  throwUserErrors('orderEditSetQuantity', data);
  return normalizeCalculatedOrder(data.orderEditSetQuantity.calculatedOrder);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2b. Stage: add existing variant (uses Shopify variant GID)
// ─────────────────────────────────────────────────────────────────────────────
export async function stageAddVariant({ calculated_order_id, variant_id, quantity }) {
  if (!calculated_order_id || !variant_id) throw new Error('calculated_order_id + variant_id required');
  if (!quantity || quantity < 1) throw new Error('quantity must be >= 1');

  // Accept numeric ID or GID — normalize to GID
  const variantGid = String(variant_id).startsWith('gid://')
    ? variant_id
    : `gid://shopify/ProductVariant/${variant_id}`;

  const query = `
    mutation AddVariant($id: ID!, $vid: ID!, $q: Int!) {
      orderEditAddVariant(id: $id, variantId: $vid, quantity: $q) {
        calculatedOrder { ${CALCULATED_ORDER_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await gql(query, {
    id: calculated_order_id,
    vid: variantGid,
    q: quantity,
  });
  throwUserErrors('orderEditAddVariant', data);
  return normalizeCalculatedOrder(data.orderEditAddVariant.calculatedOrder);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2c. Stage: add custom item (title + price, no variant/product)
// ─────────────────────────────────────────────────────────────────────────────
export async function stageAddCustomItem({ calculated_order_id, title, price, quantity, taxable = false, requires_shipping = true }) {
  if (!calculated_order_id) throw new Error('calculated_order_id required');
  if (!title || !title.trim()) throw new Error('title required');
  if (!price || Number(price) <= 0) throw new Error('price must be > 0');
  if (!quantity || quantity < 1) throw new Error('quantity must be >= 1');

  const query = `
    mutation AddCustom($id: ID!, $title: String!, $price: MoneyInput!, $q: Int!, $tax: Boolean, $ship: Boolean) {
      orderEditAddCustomItem(
        id: $id,
        title: $title,
        price: $price,
        quantity: $q,
        taxable: $tax,
        requiresShipping: $ship
      ) {
        calculatedOrder { ${CALCULATED_ORDER_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await gql(query, {
    id: calculated_order_id,
    title: title.trim(),
    price: { amount: String(price), currencyCode: 'PKR' },
    q: quantity,
    tax: !!taxable,
    ship: !!requires_shipping,
  });
  throwUserErrors('orderEditAddCustomItem', data);
  return normalizeCalculatedOrder(data.orderEditAddCustomItem.calculatedOrder);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2d. Stage: per-line-item discount (amount OR percentage)
//      discount_type: 'FIXED_AMOUNT' | 'PERCENTAGE'
// ─────────────────────────────────────────────────────────────────────────────
export async function stageAddLineDiscount({ calculated_order_id, line_item_id, discount_type, discount_value, description }) {
  if (!calculated_order_id || !line_item_id) throw new Error('calculated_order_id + line_item_id required');
  if (!['FIXED_AMOUNT', 'PERCENTAGE'].includes(discount_type)) throw new Error('discount_type must be FIXED_AMOUNT or PERCENTAGE');
  if (!discount_value || Number(discount_value) <= 0) throw new Error('discount_value must be > 0');

  // Shopify expects either fixedValue.amount or percentValue depending on type
  const discount = {
    description: description || 'ERP discount',
  };
  if (discount_type === 'PERCENTAGE') {
    discount.percentValue = Number(discount_value);
  } else {
    discount.fixedValue = { amount: String(discount_value), currencyCode: 'PKR' };
  }

  const query = `
    mutation AddLineDiscount($id: ID!, $li: ID!, $d: OrderEditAppliedDiscountInput!) {
      orderEditAddLineItemDiscount(id: $id, lineItemId: $li, discount: $d) {
        calculatedOrder { ${CALCULATED_ORDER_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await gql(query, {
    id: calculated_order_id,
    li: line_item_id,
    d: discount,
  });
  throwUserErrors('orderEditAddLineItemDiscount', data);
  return normalizeCalculatedOrder(data.orderEditAddLineItemDiscount.calculatedOrder);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2e. Stage: update shipping line price
//      Shopify uses orderEditUpdateShippingLine for existing shipping lines.
// ─────────────────────────────────────────────────────────────────────────────
export async function stageUpdateShipping({ calculated_order_id, shipping_line_id, price }) {
  if (!calculated_order_id) throw new Error('calculated_order_id required');
  if (!shipping_line_id) throw new Error('shipping_line_id required');
  if (price === undefined || price === null || Number(price) < 0) throw new Error('price must be >= 0');

  const query = `
    mutation UpdateShipping($id: ID!, $sl: OrderEditUpdateShippingLineInput!) {
      orderEditUpdateShippingLine(id: $id, shippingLine: $sl) {
        calculatedOrder { ${CALCULATED_ORDER_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await gql(query, {
    id: calculated_order_id,
    sl: {
      id: shipping_line_id,
      price: { amount: String(price), currencyCode: 'PKR' },
    },
  });
  throwUserErrors('orderEditUpdateShippingLine', data);
  return normalizeCalculatedOrder(data.orderEditUpdateShippingLine.calculatedOrder);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Commit — applies all staged changes to the real order
//    notify_customer: emails customer via Shopify's system (optional)
//    staff_note: visible in Shopify order timeline ("Reason for edit")
// ─────────────────────────────────────────────────────────────────────────────
export async function commitOrderEdit({ calculated_order_id, notify_customer = false, staff_note }) {
  if (!calculated_order_id) throw new Error('calculated_order_id required');

  const query = `
    mutation Commit($id: ID!, $notify: Boolean, $note: String) {
      orderEditCommit(id: $id, notifyCustomer: $notify, staffNote: $note) {
        order {
          id
          name
          totalPriceSet { shopMoney { amount } }
        }
        userErrors { field message }
      }
    }
  `;

  const data = await gql(query, {
    id: calculated_order_id,
    notify: !!notify_customer,
    note: staff_note || null,
  });
  throwUserErrors('orderEditCommit', data);

  const o = data.orderEditCommit.order;
  return {
    shopify_order_gid: o?.id,
    order_number: o?.name,
    new_total: parseFloat(o?.totalPriceSet?.shopMoney?.amount || 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: extract numeric Shopify order id from a GID
//   "gid://shopify/Order/1234567890" → "1234567890"
// ─────────────────────────────────────────────────────────────────────────────
export function gidToNumericId(gid) {
  if (!gid) return null;
  const m = String(gid).match(/\/(\d+)$/);
  return m ? m[1] : null;
}
