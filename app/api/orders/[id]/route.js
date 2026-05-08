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
    let customer_order_count = 0;
    if (order.customer_phone) {
      const phoneVariants = [
        order.customer_phone,
        '+' + order.customer_phone.replace(/^\+/, ''),
        '0' + order.customer_phone.replace(/^(\+?92|0)/, ''),
      ];
      const { count } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('customer_phone', phoneVariants);
      customer_order_count = count || 1;
    }

    return NextResponse.json({
      success: true,
      order: { ...order, assigned_to_name, assigned_via_team, customer_order_count },
    });
  } catch (error) {
    console.error('[api/orders/id] error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
