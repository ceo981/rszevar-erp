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

    // ── SKU → product_id + image enrichment from products table ──
    // FIX Apr 2026 — Single query fetches BOTH product_id (for direct
    // product page navigation from order items) AND image_url (for items
    // missing thumbnails). Replaces the previous image-only enrichment.
    const allSkus = [...new Set(items.filter(i => i.sku).map(i => i.sku))];
    if (allSkus.length > 0) {
      const { data: prods } = await supabase
        .from('products')
        .select('id, sku, image_url')
        .in('sku', allSkus);

      const productMap = {};
      for (const p of prods || []) {
        if (p.sku && !productMap[p.sku]) productMap[p.sku] = p;
      }
      for (const item of items) {
        if (item.sku && productMap[item.sku]) {
          item.product_id = productMap[item.sku].id;
          if (!item.image_url && productMap[item.sku].image_url) {
            item.image_url = productMap[item.sku].image_url;
          }
        }
      }
    }

    // Replace order.order_items with resolved+enriched list (page just reads this)
    order.order_items = items;

    // ── Fetch latest assignment (for assigned_to_name) ──
    const { data: assignments } = await supabase
      .from('order_assignments')
      .select('order_id, employee:assigned_to(name)')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(1);

    let assigned_to_name = null;
    if (assignments?.[0]?.employee?.name) {
      assigned_to_name = assignments[0].employee.name;
    } else if (Array.isArray(order.tags)) {
      // Fallback: Shopify packing:NAME tag
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
      order: { ...order, assigned_to_name, customer_order_count },
    });
  } catch (error) {
    console.error('[api/orders/id] error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
