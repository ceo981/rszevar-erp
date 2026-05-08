// ============================================================================
// RS ZEVAR ERP — Rebuild Order Edit Session (Replay)
// POST /api/orders/edit-rebuild
//   { order_id, ops: [{action, params}, ...], performed_by_email }
// ----------------------------------------------------------------------------
// Discards the current calculatedOrder draft and starts a fresh one, then
// replays the provided ops in order. Used to "edit" or "remove" a per-line
// discount — Shopify's public Order Editing API has no remove/replace mutation
// for line item discounts, so the only safe path is rebuild-from-scratch.
// Same approach Shopify Admin uses internally.
//
// Caller responsibility: filter out the ops you DON'T want replayed (e.g. the
// old discount op for the item being edited/removed) before sending.
//
// ID mapping:
//   - Original line items (existed pre-edit): IDs are stable across
//     orderEditBegin sessions, so set_quantity / add_discount on them
//     replay verbatim.
//   - Added items via add_variant / add_custom: new IDs each session. We
//     diff items list before/after each replay step to capture the new ID,
//     and rewrite subsequent ops' line_item_id via a translation map.
//   - Shipping lines added via add_ship: same mapping logic.
//
// Returns the new calculatedOrder + the new calculated_order_id (which the
// frontend must use for all subsequent stage/commit calls).
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  beginOrderEdit,
  stageSetQuantity,
  stageAddVariant,
  stageAddCustomItem,
  stageAddLineDiscount,
  stageUpdateShipping,
  stageAddShipping,
  stageRemoveShipping,
} from '@/lib/shopify-order-edit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ALLOWED_STATUSES = new Set(['pending', 'confirmed', 'on_packing', 'packed', 'hold']);
const ALLOWED_ROLES    = new Set(['super_admin', 'admin', 'manager', 'customer_support']);

async function checkRole(email) {
  if (!email) return null;
  const { data } = await supabase.from('profiles').select('role').eq('email', email).single();
  return data?.role || null;
}

// Translate an old line_item_id through the mapping. If no mapping (i.e. it's
// an original line item ID, stable across sessions), return as-is.
function mapLineId(map, oldId) {
  if (!oldId) return oldId;
  return map.get(oldId) || oldId;
}

// After a stage call, find the line_item_id that's NEW vs the previous state.
// Used to capture the ID of items added via add_variant / add_custom.
function findNewLineId(beforeIds, afterItems) {
  for (const it of afterItems || []) {
    if (it.id && !beforeIds.has(it.id)) return it.id;
  }
  return null;
}

function findNewShippingId(beforeIds, afterLines) {
  for (const sl of afterLines || []) {
    if (sl.id && !beforeIds.has(sl.id)) return sl.id;
  }
  return null;
}

export async function POST(request) {
  try {
    const { order_id, ops, performed_by_email } = await request.json();

    if (!order_id) {
      return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });
    }
    if (!Array.isArray(ops)) {
      return NextResponse.json({ success: false, error: 'ops array required' }, { status: 400 });
    }

    // Permission check
    if (performed_by_email) {
      const role = await checkRole(performed_by_email);
      if (role && !ALLOWED_ROLES.has(role)) {
        return NextResponse.json(
          { success: false, error: `Role '${role}' ko order edit ki permission nahi hai` },
          { status: 403 },
        );
      }
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, status, shopify_order_id, payment_status')
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    if (!order.shopify_order_id) {
      return NextResponse.json(
        { success: false, error: 'Manual order (no Shopify link) — rebuild not supported' },
        { status: 400 },
      );
    }
    if (!ALLOWED_STATUSES.has(order.status)) {
      return NextResponse.json(
        { success: false, error: `Status '${order.status}' edit nahi ho sakta` },
        { status: 400 },
      );
    }
    if (order.payment_status === 'refunded') {
      return NextResponse.json(
        { success: false, error: 'Refunded order edit nahi ho sakta' },
        { status: 400 },
      );
    }

    // 1. Begin a fresh calculated order — this discards the previous staged state.
    let calc = await beginOrderEdit(order.shopify_order_id);
    const lineIdMap = new Map();   // old_line_id → new_line_id (for added items)
    const shipIdMap = new Map();   // old_ship_id → new_ship_id (for added shipping)

    // 2. Replay ops sequentially. Skip silently on errors per-op so a single
    // failure (e.g. variant out of stock now) doesn't lose the rest of the
    // user's work. Failed ops are reported in the response.
    const replayErrors = [];
    let opIdx = 0;
    for (const op of ops) {
      opIdx += 1;
      const { action, params } = op || {};
      if (!action || !params) {
        replayErrors.push({ idx: opIdx, action, error: 'invalid op shape' });
        continue;
      }

      const beforeLineIds = new Set(calc.items.map(i => i.id));
      const beforeShipIds = new Set((calc.shipping_lines || []).map(s => s.id));

      try {
        switch (action) {
          case 'set_quantity':
            calc = await stageSetQuantity({
              calculated_order_id: calc.calculated_order_id,
              line_item_id: mapLineId(lineIdMap, params.line_item_id),
              quantity: Number(params.quantity),
              restock: params.restock !== false,
            });
            break;

          case 'add_variant':
            calc = await stageAddVariant({
              calculated_order_id: calc.calculated_order_id,
              variant_id: params.variant_id,
              quantity: Number(params.quantity) || 1,
            });
            {
              const newId = findNewLineId(beforeLineIds, calc.items);
              if (newId && params._original_line_id) {
                lineIdMap.set(params._original_line_id, newId);
              }
            }
            break;

          case 'add_custom':
            calc = await stageAddCustomItem({
              calculated_order_id: calc.calculated_order_id,
              title: params.title,
              price: params.price,
              quantity: Number(params.quantity) || 1,
              taxable: !!params.taxable,
              requires_shipping: params.requires_shipping !== false,
            });
            {
              const newId = findNewLineId(beforeLineIds, calc.items);
              if (newId && params._original_line_id) {
                lineIdMap.set(params._original_line_id, newId);
              }
            }
            break;

          case 'add_discount':
            calc = await stageAddLineDiscount({
              calculated_order_id: calc.calculated_order_id,
              line_item_id: mapLineId(lineIdMap, params.line_item_id),
              discount_type: params.discount_type,
              discount_value: Number(params.discount_value),
              description: params.description,
            });
            break;

          case 'update_ship':
            calc = await stageUpdateShipping({
              calculated_order_id: calc.calculated_order_id,
              shipping_line_id: shipIdMap.get(params.shipping_line_id) || params.shipping_line_id,
              price: Number(params.price),
              // Pass through fallback_title so committed-line replacement on
              // replay uses the same name (e.g. "Free Shipping" → "Free Shipping").
              fallback_title: params.fallback_title,
            });
            break;

          case 'add_ship':
            calc = await stageAddShipping({
              calculated_order_id: calc.calculated_order_id,
              title: params.title || 'Shipping',
              price: Number(params.price),
            });
            {
              const newId = findNewShippingId(beforeShipIds, calc.shipping_lines);
              if (newId && params._original_ship_id) {
                shipIdMap.set(params._original_ship_id, newId);
              }
            }
            break;

          case 'remove_ship':
            calc = await stageRemoveShipping({
              calculated_order_id: calc.calculated_order_id,
              shipping_line_id: shipIdMap.get(params.shipping_line_id) || params.shipping_line_id,
            });
            break;

          default:
            replayErrors.push({ idx: opIdx, action, error: `unknown action` });
        }
      } catch (e) {
        replayErrors.push({ idx: opIdx, action, error: e.message });
      }
    }

    return NextResponse.json({
      success: true,
      order_number: order.order_number,
      original_status: order.status,
      original_payment_status: order.payment_status,
      replay_errors: replayErrors,
      ...calc,
    });
  } catch (e) {
    console.error('[edit-rebuild] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
