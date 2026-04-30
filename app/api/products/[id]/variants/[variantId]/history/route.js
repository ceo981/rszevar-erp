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

    // ── Step 3: Fetch order events ──────────────────────────────────────────
    // Strategy:
    //   A) SKU is present → fast path: match via order_items.sku index
    //   B) SKU is empty   → fallback: match via shopify_raw JSONB
    //      (Shopify line_items array has variant_id even when SKU is empty)
    let orderEvents = [];

    if (variantSku) {
      // ─── A) FAST PATH — SKU match, verified against variant_id ───
      // FIX Apr 30 2026 — Shared-SKU bug:
      // RS ZEVAR ke kuch products mein multiple variants ka SAME SKU hota hai
      // (e.g. Radiant Cubic Zirconia ke saare 8 colors ka SKU 'AD027'). Pehle
      // sirf .eq('sku', variantSku) se match hota tha — toh Purple variant ki
      // history mein White, Black sab variants ke order events bhi aa jate
      // they. Stock count to per-variant correct rehta tha (shopify_variant_id
      // pe), bus history feed mix ho jaata tha.
      //
      // Ab: SKU se shortlist karte hain, phir har match ka shopify_line_item_id
      // shopify_raw.line_items[] mein dhundte hain aur uska variant_id check
      // karte hain. Mismatch ho to skip. Agar shopify_raw mein line_item missing
      // ho (legacy/walk-in orders), to fall back to including (avoid losing
      // events).
      const { data: itemRows, error: iErr } = await supabase
        .from('order_items')
        .select(`
          quantity,
          shopify_line_item_id,
          order_id,
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
            is_walkin,
            shopify_raw
          )
        `)
        .eq('sku', variantSku)
        .order('id', { ascending: false })
        .limit(limit * 3);   // over-fetch since some may be wrong-variant

      if (iErr) {
        console.error('[history] order_items SKU query error', iErr);
      }

      const targetVariantIdStr = String(variantId);
      let kept = 0;
      let droppedDifferentVariant = 0;
      for (const item of itemRows || []) {
        if (!item.orders) continue;     // dangling order_item with no order

        // Verify this order_item actually belongs to OUR variant.
        // Look up the matching line_item in shopify_raw.line_items.
        const lineItems = item.orders.shopify_raw?.line_items || [];
        let belongsToThisVariant = true;       // default: include
        if (lineItems.length > 0) {
          // Try exact line_item_id match first (most accurate)
          let li = null;
          if (item.shopify_line_item_id) {
            li = lineItems.find(x => String(x.id) === String(item.shopify_line_item_id));
          }
          // Fallback: search by SKU
          if (!li) {
            li = lineItems.find(x => x.sku === variantSku);
          }
          if (li && li.variant_id !== undefined && li.variant_id !== null) {
            belongsToThisVariant = String(li.variant_id) === targetVariantIdStr;
          }
          // If li exists but has no variant_id (rare), assume match (legacy data)
          // If no li found at all, assume match (line_items array malformed)
        }
        // No shopify_raw at all → can't verify → include (legacy/walkin orders)

        if (!belongsToThisVariant) {
          droppedDifferentVariant++;
          continue;
        }

        const qty = Number(item.quantity) || 1;
        // Strip shopify_raw before passing to event generator (memory hygiene)
        const orderForEvent = { ...item.orders };
        delete orderForEvent.shopify_raw;
        orderEvents = orderEvents.concat(deriveOrderEvents(orderForEvent, qty));
        kept++;
        if (kept >= limit) break;     // satisfy original limit semantics
      }
      if (droppedDifferentVariant > 0) {
        console.log(`[history] Dropped ${droppedDifferentVariant} order_items that shared SKU but belonged to a different variant`);
      }
    } else {
      // ─── B) FALLBACK — variant_id match via shopify_raw JSONB ───
      // For variants without SKU, we still want to surface order events.
      // Shopify's raw line_items[] has `variant_id` (numeric) which we match
      // against shopify_variant_id. Postgres JSONB containment (`@>`) handles this.
      const variantIdNum = parseInt(variantId, 10);
      if (Number.isFinite(variantIdNum) && variantIdNum > 0) {
        const containmentJson = `[{"variant_id":${variantIdNum}}]`;
        const { data: orderRows, error: oErr } = await supabase
          .from('orders')
          .select(`
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
            is_walkin,
            shopify_raw
          `)
          .filter('shopify_raw->line_items', 'cs', containmentJson)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (oErr) {
          console.error('[history] shopify_raw variant_id query error', oErr);
        }

        for (const order of orderRows || []) {
          // Pull quantity from the matching line_item in shopify_raw
          const lineItems = order.shopify_raw?.line_items || [];
          const li = lineItems.find(x => String(x.variant_id) === String(variantId));
          // Use current_quantity if Shopify Order Edit reduced it, else original quantity.
          // 0 means the line was fully removed — skip that order entirely.
          const effQty = li
            ? (li.current_quantity !== undefined ? Number(li.current_quantity) : Number(li.quantity))
            : 0;
          if (!effQty || effQty <= 0) continue;

          // Strip shopify_raw before passing to event generator (memory hygiene)
          const orderForEvent = { ...order };
          delete orderForEvent.shopify_raw;

          orderEvents = orderEvents.concat(deriveOrderEvents(orderForEvent, effQty));
        }
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
        match_strategy: variantSku ? 'sku' : 'variant_id_fallback',
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
