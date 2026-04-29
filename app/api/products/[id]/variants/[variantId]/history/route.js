// ============================================================================
// RS ZEVAR ERP — Variant Adjustment History API (Phase 3 — Apr 2026)
// Route: /api/products/[id]/variants/[variantId]/history
// ----------------------------------------------------------------------------
// Combines TWO sources into one timeline:
//   1. Manual adjustments — from inventory_adjustments table
//      (stock/price/sku/barcode/weight changes via ERP variant edit page)
//   2. Order-driven events — derived from orders + order_items
//      (committed/on_hand/available changes when orders flow through lifecycle)
//
// Returns sorted DESC by timestamp. Limit 200 most recent events by default.
// ============================================================================

import { NextResponse } from 'next/server';
// Relative import to dodge Next.js 16 Turbopack alias resolution issues for new files
import { createServerClient } from '../../../../../../../lib/supabase.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Build human-readable event from one orders row + qty
// Returns array of 0-3 events depending on which lifecycle timestamps are populated.
function deriveOrderEvents(order, qty) {
  const events = [];
  const orderNum = order.order_number || `#${order.id}`;
  const courier  = order.dispatched_courier || 'Courier';

  // 1. Order CREATED — stock got reserved by Shopify
  // committed +qty, available -qty, on_hand unchanged
  if (order.created_at) {
    events.push({
      id: `order_${order.id}_created`,
      timestamp: order.created_at,
      activity: 'order_created',
      description: `Order created (${orderNum})`,
      performed_by: order.is_walkin ? 'Walk-in sale' : 'Online Store',
      committed_delta: qty,
      available_delta: -qty,
      on_hand_delta: 0,
      order_number: orderNum,
      order_status: order.status,
      source: 'order',
    });
  }

  // 2. Order DISPATCHED — physical stock left, reservation cleared
  // committed -qty, on_hand -qty, available unchanged (was already minus)
  if (order.dispatched_at) {
    events.push({
      id: `order_${order.id}_dispatched`,
      timestamp: order.dispatched_at,
      activity: 'order_dispatched',
      description: `Order dispatched (${orderNum})`,
      performed_by: courier,
      committed_delta: -qty,
      on_hand_delta: -qty,
      available_delta: 0,
      order_number: orderNum,
      order_status: order.status,
      source: 'order',
    });
  }

  // 3. Order CANCELLED before dispatch — reservation released
  // committed -qty, available +qty, on_hand unchanged (never left)
  // Note: if cancel happened AFTER dispatch (rare), we don't reverse on_hand here —
  // RTO event handles that separately.
  if (order.cancelled_at && !order.dispatched_at) {
    events.push({
      id: `order_${order.id}_cancelled`,
      timestamp: order.cancelled_at,
      activity: 'order_cancelled',
      description: `Order cancelled (${orderNum})`,
      performed_by: 'Order Cancellation',
      committed_delta: -qty,
      available_delta: qty,
      on_hand_delta: 0,
      order_number: orderNum,
      order_status: order.status,
      source: 'order',
    });
  }

  // 4. RTO — stock physically returned
  // on_hand +qty, available +qty, committed unchanged
  if (order.rto_at) {
    events.push({
      id: `order_${order.id}_rto`,
      timestamp: order.rto_at,
      activity: 'rto',
      description: `RTO returned to stock (${orderNum})`,
      performed_by: `${courier} RTO`,
      committed_delta: 0,
      on_hand_delta: qty,
      available_delta: qty,
      order_number: orderNum,
      order_status: order.status,
      source: 'order',
    });
  }

  return events;
}

// Convert one inventory_adjustments row into a unified event shape
function mapManualAdjustment(row) {
  let on_hand_delta = 0;
  let committed_delta = 0;
  let available_delta = 0;

  // Stock activity has explicit deltas. Other activities (price/sku/etc) don't move stock.
  if (row.activity === 'stock' && typeof row.stock_delta === 'number') {
    on_hand_delta   = row.stock_delta;
    available_delta = row.stock_delta;     // available moves with on_hand when no committed change
  }

  return {
    id: `manual_${row.id}`,
    timestamp: row.performed_at,
    activity: row.activity,                    // 'stock' | 'price' | 'sku' | etc.
    description: row.description || row.activity,
    performed_by: row.performed_by || 'Staff',
    performed_by_email: row.performed_by_email || null,
    reason: row.reason || null,
    field_name: row.field_name || null,
    old_value: row.old_value,
    new_value: row.new_value,
    stock_before: row.stock_before,
    stock_after:  row.stock_after,
    on_hand_delta,
    committed_delta,
    available_delta,
    source: 'manual',
  };
}

export async function GET(request, { params }) {
  try {
    const { id, variantId } = await params;
    if (!id || !variantId) {
      return NextResponse.json({ success: false, error: 'productId and variantId required' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500);

    const supabase = createServerClient();

    // ── Step 1: Look up the variant to get SKU + product_title ──────────────
    // Variant data lives on the products table (one row per variant in this schema).
    const { data: variantRow, error: vErr } = await supabase
      .from('products')
      .select('sku, parent_title, title, shopify_inventory_item_id')
      .eq('shopify_variant_id', String(variantId))
      .eq('shopify_product_id', String(id))
      .maybeSingle();

    if (vErr) {
      console.error('[history] variant lookup error', vErr);
    }
    if (!variantRow) {
      return NextResponse.json({
        success: true,
        events: [],
        meta: { reason: 'Variant not found in DB. New variant?' },
      });
    }

    const variantSku = variantRow.sku || null;
    const variantLabel = variantRow.title || '';
    const productTitle = variantRow.parent_title || '';

    // ── Step 2: Fetch manual adjustments (always by shopify_variant_id) ─────
    const { data: manualRows, error: mErr } = await supabase
      .from('inventory_adjustments')
      .select('*')
      .eq('shopify_variant_id', String(variantId))
      .order('performed_at', { ascending: false })
      .limit(limit);

    if (mErr) {
      // Table may not exist if migration wasn't run yet — return order events only.
      console.error('[history] manual adjustments query error', mErr);
    }

    const manualEvents = (manualRows || []).map(mapManualAdjustment);

    // ── Step 3: Fetch order events (by SKU). Skip if no SKU. ────────────────
    let orderEvents = [];
    if (variantSku) {
      // Get all order_items rows with this SKU, then JOIN orders for timestamps
      const { data: itemRows, error: iErr } = await supabase
        .from('order_items')
        .select(`
          quantity,
          orders:order_id (
            id,
            order_number,
            status,
            created_at,
            confirmed_at,
            dispatched_at,
            delivered_at,
            cancelled_at,
            rto_at,
            dispatched_courier,
            is_walkin
          )
        `)
        .eq('sku', variantSku)
        .order('id', { ascending: false })
        .limit(limit);

      if (iErr) {
        console.error('[history] order_items query error', iErr);
      }

      // Some `orders` columns are optional in older schemas (rto_at, delivered_at).
      // Supabase returns null for missing fields rather than erroring, so we just
      // proceed and let deriveOrderEvents skip events where the timestamp is null.
      for (const item of itemRows || []) {
        if (!item.orders) continue;     // dangling order_item with no order
        const qty = Number(item.quantity) || 1;
        orderEvents = orderEvents.concat(deriveOrderEvents(item.orders, qty));
      }
    }

    // ── Step 4: Merge + sort DESC + limit ───────────────────────────────────
    const allEvents = [...manualEvents, ...orderEvents]
      .filter(e => e.timestamp)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    return NextResponse.json({
      success: true,
      events: allEvents,
      meta: {
        variant_sku: variantSku,
        variant_label: variantLabel,
        product_title: productTitle,
        manual_count: manualEvents.length,
        order_count: orderEvents.length,
        total_returned: allEvents.length,
        limit,
      },
    });
  } catch (err) {
    console.error('[GET /api/products/[id]/variants/[variantId]/history]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
