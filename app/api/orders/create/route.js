// ============================================================================
// RS ZEVAR ERP — Create Order Endpoint
// POST /api/orders/create
//
// Shopify-like "Create Order" flow. Tumhare existing /api/orders/draft route
// sirf draft pe rukta tha aur Shopify admin URL kholta tha. Yeh full flow karta
// hai aur seedha real order banata hai (no draft state visible to user).
//
// Architecture:
//   1. Shopify ko POST /draft_orders.json   → draft create
//   2. Shopify ko PUT  /draft_orders/{id}/complete.json?payment_pending=true
//                                           → real order ban jata (COD style)
//   3. ERP DB mein order upsert karo
//   4. Frontend ko erp_order_id wapas karo → redirect /orders/{id}
//
// COD ke liye payment_pending=true zaroori hai — Shopify order ko
// financial_status:'pending' ke saath create karega, koi gateway transaction
// nahi banegi. Settlement aur payment Leopards/Kangaroo ke COD flow se hota
// hai jo already ERP mein integrated hai.
//
// Tags handling: Defaults `whatsapp_confirmed` add karta hai. Walk-in/wholesale
// tags caller specify kar sakta hai but yeh route un par specific behavior
// trigger nahi karta — woh existing tag system handle karta hai.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Shopify create + complete kabhi 10-15s lagte hain

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION    = '2024-01';

// ─── Shopify HTTP helpers ──────────────────────────────────────────────────
async function shopifyRequest(method, endpoint, body) {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/${endpoint}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // Shopify error format: { errors: { field: ['msg', ...] } } ya { errors: 'string' }
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const errMsg = parsed?.errors
      ? (typeof parsed.errors === 'string' ? parsed.errors : JSON.stringify(parsed.errors))
      : text.slice(0, 500);
    throw new Error(`Shopify ${res.status}: ${errMsg}`);
  }
  return JSON.parse(text);
}

// ─── Validation helpers ────────────────────────────────────────────────────
function validateInput(body) {
  const errs = [];
  if (!body.line_items?.length) errs.push('Kam az kam 1 product zaroori hai');
  if (!body.customer?.first_name && !body.customer?.last_name) errs.push('Customer name zaroori hai');
  if (!body.customer?.phone) errs.push('Customer phone zaroori hai');
  for (const [i, li] of (body.line_items || []).entries()) {
    if (!li.shopify_variant_id && !li.title) {
      errs.push(`Item ${i+1}: variant_id ya title zaroori hai`);
    }
    if (!li.quantity || li.quantity < 1) errs.push(`Item ${i+1}: quantity 1 ya zyada honi chahiye`);
  }
  return errs;
}

// ─── Shopify draft_order payload builder ───────────────────────────────────
function buildShopifyPayload(body) {
  const { line_items, customer, shipping_address, shipping_line, order_discount, note, tags } = body;

  // Line items — har item shopify variant id se ya custom title se
  const shopifyLineItems = line_items.map(item => {
    const li = item.shopify_variant_id
      ? { variant_id: parseInt(item.shopify_variant_id), quantity: item.quantity || 1 }
      : { title: item.title || 'Custom Item', quantity: item.quantity || 1, price: String(item.unit_price || 0) };

    // Manual price override (jab user "edit price" se badalta hai)
    if (item.shopify_variant_id && item.unit_price !== undefined && item.unit_price !== null && item.use_custom_price) {
      li.price = String(item.unit_price);
    }

    // Per-line discount (Shopify Draft Order API supports this)
    if (item.discount && item.discount.value > 0) {
      li.applied_discount = {
        title: item.discount.title || 'Manual discount',
        value_type: item.discount.type === 'percentage' ? 'percentage' : 'fixed_amount',
        value: String(item.discount.value),
        amount: String(item.discount.amount || 0),
        description: item.discount.description || 'ERP manual discount',
      };
    }

    return li;
  });

  // Address fields — first_name aur last_name dono chahiye
  const addr = {
    first_name: customer.first_name || 'Customer',
    last_name:  customer.last_name  || '.',
    phone:      customer.phone || '',
    address1:   shipping_address?.address1 || '',
    address2:   shipping_address?.address2 || '',
    city:       shipping_address?.city || 'Karachi',
    province:   shipping_address?.province || 'Sindh',
    country:    shipping_address?.country || 'Pakistan',
    zip:        shipping_address?.zip || '',
  };

  // Default tags for ERP-created orders. Caller override kar sakta hai but
  // 'erp_manual' hamesha rakho taa ke baad mein report mein identify kar sako.
  const finalTags = Array.from(new Set([
    ...(Array.isArray(tags) ? tags : (tags ? [tags] : [])),
    'whatsapp_confirmed',
    'erp_manual',
  ])).join(', ');

  const draftOrder = {
    line_items: shopifyLineItems,
    customer: customer.id ? { id: customer.id } : undefined,
    shipping_address: addr,
    billing_address:  addr,
    note: note || '',
    tags: finalTags,
    use_customer_default_address: false,
  };

  // Shipping line — agar manual price diya hai
  if (shipping_line && shipping_line.price > 0) {
    draftOrder.shipping_line = {
      title:  shipping_line.title || 'Shipping Charges',
      price:  String(shipping_line.price),
      custom: true,
    };
  }

  // Order-level discount (line-level discount se alag)
  if (order_discount && order_discount.value > 0) {
    draftOrder.applied_discount = {
      title: order_discount.title || 'Order discount',
      value_type: order_discount.type === 'percentage' ? 'percentage' : 'fixed_amount',
      value: String(order_discount.value),
      amount: String(order_discount.amount || 0),
      description: order_discount.description || 'ERP order discount',
    };
  }

  return { draft_order: draftOrder };
}

// ─── ERP DB upsert ─────────────────────────────────────────────────────────
// Webhook bhi async fire hoga aur same shopify_order_id ke saath insert
// karne ki koshish kar sakta hai. Isi liye onConflict pattern use karte hain.
async function upsertOrderInERP(supabase, shopifyOrder) {
  const o = shopifyOrder;

  // Status mapping — same logic jo lib/shopify.js#mapShopifyStatus karta hai,
  // simplified inline taa ke route self-contained ho.
  let officeStatus = 'confirmed'; // default for manual ERP orders
  let paymentStatus = 'unpaid';
  if (o.financial_status === 'paid') paymentStatus = 'paid';
  if (o.cancelled_at) officeStatus = 'cancelled';

  const tags = (o.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const isWholesale     = tags.some(t => /wholesale/i.test(t));
  const isWalkin        = tags.some(t => /walk[\s-]?in/i.test(t));
  const isInternational = tags.some(t => /international/i.test(t));

  // FIX Apr 2026 — current_total_price use karte hain (post-edit), warna
  // initial total mismatch ho sakta hai jab discounts applied ho.
  const total    = parseFloat(o.current_total_price ?? o.total_price ?? 0);
  const subtotal = parseFloat(o.current_subtotal_price ?? o.subtotal_price ?? 0);
  const shipping = parseFloat((o.shipping_lines?.[0]?.price) ?? 0);
  const discount = parseFloat(o.current_total_discounts ?? o.total_discounts ?? 0);

  const orderRow = {
    shopify_order_id:  String(o.id),
    order_number:      o.name?.replace('#', 'ZEVAR-') || `ZEVAR-${o.order_number}`,
    customer_name:     [o.shipping_address?.first_name, o.shipping_address?.last_name].filter(Boolean).join(' ').trim() || 'Customer',
    customer_phone:    o.shipping_address?.phone || o.phone || '',
    customer_address:  [o.shipping_address?.address1, o.shipping_address?.address2].filter(Boolean).join(', '),
    customer_city:     o.shipping_address?.city || '',
    subtotal,
    discount,
    shipping_fee:      shipping,
    total_amount:      total,
    payment_method:    'COD',
    status:            officeStatus,
    payment_status:    paymentStatus,
    confirmed_at:      new Date().toISOString(),
    tags,
    is_wholesale:      isWholesale,
    is_walkin:         isWalkin,
    is_international:  isInternational,
    shopify_raw:       o,
    shopify_synced_at: new Date().toISOString(),
    created_at:        o.created_at || new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('orders')
    .upsert(orderRow, { onConflict: 'shopify_order_id' })
    .select('id, order_number')
    .single();

  if (error) {
    console.error('[create] ERP upsert error:', error.message);
    return null;
  }

  // Order items — dedupe karne ke liye pehle delete then insert
  if (data?.id && Array.isArray(o.line_items)) {
    await supabase.from('order_items').delete().eq('order_id', data.id);

    const items = o.line_items
      .filter(li => (li.current_quantity ?? li.quantity ?? 0) > 0) // active only
      .map(li => {
        const qty   = li.current_quantity ?? li.quantity ?? 1;
        const price = parseFloat(li.price) || 0;
        return {
          order_id: data.id,
          shopify_line_item_id: String(li.id),
          title: li.title + (li.variant_title ? ` - ${li.variant_title}` : ''),
          sku: li.sku || null,
          quantity: qty,
          unit_price: price,
          total_price: price * qty,
          image_url: li.image?.src || null,
        };
      });

    if (items.length > 0) {
      await supabase.from('order_items').insert(items);
    }
  }

  return data;
}

// ─── Main POST handler ─────────────────────────────────────────────────────
export async function POST(request) {
  const supabase = createServerClient();

  try {
    const body = await request.json();

    // Step 1: Validation
    const errs = validateInput(body);
    if (errs.length > 0) {
      return NextResponse.json({ success: false, error: errs.join('; ') }, { status: 400 });
    }

    // Step 2: Shopify Draft Order create
    const shopifyPayload = buildShopifyPayload(body);
    const draftRes = await shopifyRequest('POST', 'draft_orders.json', shopifyPayload);
    const draft = draftRes.draft_order;
    if (!draft?.id) {
      return NextResponse.json({ success: false, error: 'Shopify draft order create nahi hua' }, { status: 500 });
    }

    // Step 3: Complete the draft → real order
    // payment_pending=true is critical for COD: order banta hai with
    // financial_status='pending', no transaction. Customer cash on delivery
    // pe pay karega aur ERP settlement flow se mark hoga.
    const completeRes = await shopifyRequest('PUT', `draft_orders/${draft.id}/complete.json?payment_pending=true`);
    const realOrder = completeRes.draft_order?.order_id
      ? await shopifyRequest('GET', `orders/${completeRes.draft_order.order_id}.json`).then(r => r.order)
      : null;

    if (!realOrder?.id) {
      return NextResponse.json({
        success: false,
        error: 'Draft complete hua but real order fetch nahi ho saka',
        draft_id: draft.id,
      }, { status: 500 });
    }

    // Step 4: Upsert in ERP DB (so user can navigate immediately;
    // webhook bhi fire hoga aur upsert se safe handle hoga)
    const erpOrder = await upsertOrderInERP(supabase, realOrder);

    return NextResponse.json({
      success: true,
      shopify_order_id: realOrder.id,
      shopify_order_name: realOrder.name,
      order_number: realOrder.name?.replace('#', 'ZEVAR-'),
      total: parseFloat(realOrder.total_price || 0),
      erp_order_id: erpOrder?.id || null,
    });

  } catch (e) {
    console.error('[create] Error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
