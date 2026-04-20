// ============================================================================
// RS ZEVAR ERP — Single Order Fetch Route
// GET /api/orders/[id] → returns one order row + its items (enriched)
// Used by: /orders/[id]/page.js (new-tab single order view)
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

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

    // ── Image enrichment for items with null image_url (SKU → products) ──
    const items = order.order_items || [];
    const missingSkus = [...new Set(items.filter(i => !i.image_url && i.sku).map(i => i.sku))];
    if (missingSkus.length > 0) {
      const { data: prods } = await supabase
        .from('products')
        .select('sku, image_url')
        .in('sku', missingSkus)
        .not('image_url', 'is', null);

      const skuMap = {};
      for (const p of prods || []) {
        if (p.sku && p.image_url && !skuMap[p.sku]) skuMap[p.sku] = p.image_url;
      }

      // Apply enrichment in-memory
      for (const item of items) {
        if (!item.image_url && item.sku && skuMap[item.sku]) {
          item.image_url = skuMap[item.sku];
        }
      }
    }

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
