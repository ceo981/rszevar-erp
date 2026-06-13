// ============================================================================
// RS ZEVAR ERP — Single Order Fetch Route
// GET /api/orders/[id] → returns one order row + its items (enriched)
// Used by: /orders/[id]/page.js (new-tab single order view)
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { isActiveLineItem, getEffectiveQuantity } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────────────────────
// Phone variant generator for cross-order customer matching (PK numbers).
//
// FIX May 2026 — Customer ka phone Shopify webhook se without normalization
// store hota hai (lib/shopify.js line 230). Same customer ke alag-alag
// orders me phone alag format me store ho sakta hai:
//   - Order A: '+923326347131' (E.164, jab customer ne +92 ke saath enter kiya)
//   - Order B: '03326347131'   (local, jab leading 0 ke saath enter kiya)
//   - Order C: '923326347131'  (intl without +, rare)
//   - Order D: '3326347131'    (bare national, very rare)
//
// Pehla buggy logic sirf 2 variants effectively try karta tha aur ek invalid
// `+0...` variant generate karta tha. Sania Saqlain ke case me: dono orders
// orders table me hain but alag formats me — count 1 dikha jab actual 2 hai.
//
// Ye function digits extract karke "national part" (last 10 digits) identify
// karta hai aur saare 4 standard PK formats generate karta hai — guaranteed
// match across formats.
//
// Note: long-term ye lib/phone.js me centralize karna chahiye aur
// lib/whatsapp-inbox.js, app/api/whatsapp/inbox/messages, etc. me bhi use
// karna chahiye. Abhi inline rakha hai taa ke kewal yeh file deploy ho.
// ────────────────────────────────────────────────────────────────────────────
function buildPhoneVariants(rawPhone) {
  if (!rawPhone) return [];
  const digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return [rawPhone];
  // Extract national part (typically 10 digits for PK mobile numbers)
  let national;
  if (digits.startsWith('92') && digits.length >= 12) {
    national = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length >= 11) {
    national = digits.slice(1);
  } else {
    // Already national part or unknown — pass through
    national = digits;
  }
  // Generate all standard PK formats, include original (handles spaces/dashes)
  return [...new Set([
    rawPhone,
    `+92${national}`,
    `92${national}`,
    `0${national}`,
    national,
  ])];
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Order id required' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    // ── Fetch order + items in parallel ──
    const [orderRes, itemsRes] = await Promise.all([
      supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('id', id)
        .maybeSingle(),
      // Placeholder — items come through `order_items(*)` above.
      // Kept the pattern matching list route for consistency.
      Promise.resolve(null),
    ]);

    const { data: order, error: orderErr } = orderRes;

    if (orderErr) throw orderErr;
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 },
      );
    }

    // ── Resolve items: prefer order_items table, fallback to shopify_raw ──
    // FIX Apr 2026 — Filter out items removed via Shopify Order Edit
    // (current_quantity === 0). See lib/shopify.js#isActiveLineItem.
    let items = [];
    if (order.order_items && order.order_items.length > 0) {
      items = order.order_items.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
    } else if (order.shopify_raw?.line_items) {
      // Old orders where order_items was never backfilled
      items = order.shopify_raw.line_items.filter(isActiveLineItem).map(it => {
        const qty = getEffectiveQuantity(it);
        return {
          title: (it.title || '') + (it.variant_title ? ` - ${it.variant_title}` : ''),
          sku: it.sku || null,
          quantity: qty,
          unit_price: parseFloat(it.price) || 0,
          total_price: (parseFloat(it.price) || 0) * qty,
          image_url: it.image?.src || null,
        };
      });
    }

    // ── Variant_id + SKU → product enrichment (image + product_id) ──
    // FIX May 8 2026 — Variant-id-aware lookup.
    // Pehle sirf SKU se lookup hota tha. Lekin RS ZEVAR ke jewelry products
    // mein typically Golden/Silver variants ka SKU same hota hai, jiski wajah
    // se SKU-based lookup ambiguous tha (random variant ki image dikhti).
    // Ab priority:
    //   1) item.shopify_variant_id (unique per variant) — exact match
    //   2) item.sku (only when variant_id missing — old order_items rows that
    //      were synced before May 8 2026)
    //
    // FIX Apr 2026 — Single query fetches BOTH shopify_product_id (for direct
    // product page navigation from order items — /inventory/[id] route is
    // keyed by shopify_product_id, NOT the table UUID) AND image_url (for
    // items missing thumbnails). Replaces previous image-only enrichment.
    const allVariantIds = [...new Set(items.filter(i => i.shopify_variant_id).map(i => i.shopify_variant_id))];
    const allSkus       = [...new Set(items.filter(i => i.sku && !i.shopify_variant_id).map(i => i.sku))];

    // Step 1: Primary lookup by variant_id (accurate, no SKU collisions)
    const productByVariant = {};
    if (allVariantIds.length > 0) {
      const { data: prodsByVariant } = await supabase
        .from('products')
        .select('shopify_product_id, shopify_variant_id, sku, image_url')
        .in('shopify_variant_id', allVariantIds);

      for (const p of prodsByVariant || []) {
        if (p.shopify_variant_id) productByVariant[p.shopify_variant_id] = p;
      }
    }

    // Step 2: Fallback lookup by SKU (only for items where variant_id missing —
    // typically pre-May-8-2026 order_items that haven't been backfilled).
    const productBySku = {};
    if (allSkus.length > 0) {
      const { data: prodsBySku } = await supabase
        .from('products')
        .select('shopify_product_id, sku, image_url')
        .in('sku', allSkus);

      for (const p of prodsBySku || []) {
        if (p.sku && !productBySku[p.sku]) productBySku[p.sku] = p;
      }
    }

    // Apply enrichment to each item (variant_id wins, SKU fallback)
    for (const item of items) {
      let prod = null;
      if (item.shopify_variant_id && productByVariant[item.shopify_variant_id]) {
        prod = productByVariant[item.shopify_variant_id];
      } else if (item.sku && productBySku[item.sku]) {
        prod = productBySku[item.sku];
      }
      if (prod) {
        item.product_id = prod.shopify_product_id;
        if (!item.image_url && prod.image_url) {
          item.image_url = prod.image_url;
        }
      }
    }

    // Replace order.order_items with resolved+enriched list (page just reads this)
    order.order_items = items;

    // ── Fetch latest assignment (for assigned_to_name + packing team flag) ──
    const { data: assignments } = await supabase
      .from('order_assignments')
      .select('order_id, assigned_to, notes, employee:assigned_to(name)')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(1);

    let assigned_to_name = null;
    let assigned_via_team = false;  // true = "Packing Team" shared assignment
    if (assignments?.[0]) {
      const a = assignments[0];
      // Case 1: Packing Team (shared) — notes='packing_team', assigned_to=NULL
      if (a.notes === 'packing_team' || (!a.assigned_to && a.notes?.toLowerCase().includes('packing team'))) {
        assigned_to_name = 'Packing Team';
        assigned_via_team = true;
      } else if (a.employee?.name) {
        // Case 2: Individual packer
        assigned_to_name = a.employee.name;
      }
    }
    // Case 3 (fallback): Shopify packing:NAME tag
    if (!assigned_to_name && Array.isArray(order.tags)) {
      const packingTag = order.tags.find(t => String(t).toLowerCase().startsWith('packing:'));
      if (packingTag) {
        const rawName = packingTag.split(':')[1] || '';
        assigned_to_name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      }
    }

    // ── Customer's total order count (for "Nth order" display) ──
    // FIX May 2026 — Two bugs fixed:
    //
    // Bug 1 (phone format): Pichla logic sirf 2 effective variants try karta
    // tha aur ek invalid `+0...` variant generate karta tha. Same customer ke
    // 2 orders agar alag phone formats me Shopify se aaye (+92... vs 0...) to
    // count galat aata tha. Now `buildPhoneVariants()` saare 4 standard PK
    // formats generate karta hai — guaranteed cross-format matching.
    //
    // Bug 2 (historical orders missing): Count sirf `orders` table se aata
    // tha, jis se pre-ERP CSV-imported historical orders ignore ho jate the.
    // Now dono tables parallel me count karte hain. historical_orders ke
    // dedup trigger ki wajah se overlap nahi hai, so simple addition safe hai.
    let customer_order_count = 0;
    if (order.customer_phone) {
      const phoneVariants = buildPhoneVariants(order.customer_phone);

      if (phoneVariants.length > 0) {
        const [liveRes, histRes] = await Promise.all([
          supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .in('customer_phone', phoneVariants),
          supabase
            .from('historical_orders')
            .select('*', { count: 'exact', head: true })
            .in('customer_phone', phoneVariants),
        ]);

        const liveCount = liveRes.count || 0;
        // Defensive: if historical_orders query errors (table missing on a
        // fresh environment), don't fail the whole order detail — just use live.
        const histCount = histRes.error ? 0 : (histRes.count || 0);
        if (histRes.error) {
          console.warn('[api/orders/id] historical_orders count failed:', histRes.error.message);
        }

        customer_order_count = liveCount + histCount;
      }

      // Guard: current order is always in `orders` table, so count should never
      // be zero — if it is, phone format is weird/edge — still show 1.
      if (customer_order_count === 0) customer_order_count = 1;
    }

    return NextResponse.json({
      success: true,
      order: { ...order, assigned_to_name, assigned_via_team, customer_order_count },
    }, {
      // Browser/CDN ko is response ko cache karne se roko — warna edit ke baad
      // loadOrder ko stale order milta tha.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[api/orders/id] error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
