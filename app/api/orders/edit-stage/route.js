// ============================================================================
// RS ZEVAR ERP — Stage Order Edit Change
// POST /api/orders/edit-stage  { calculated_order_id, action, ...params }
// ----------------------------------------------------------------------------
// Routes a single staged edit to the appropriate Shopify mutation.
// Does NOT commit — the real order is untouched until /edit-commit.
//
// Supported actions:
//   - set_quantity   { line_item_id, quantity, restock? }
//   - add_variant    { variant_id, quantity }
//   - add_custom     { title, price, quantity, taxable?, requires_shipping? }
//   - add_discount   { line_item_id, discount_type, discount_value, description? }
//   - update_ship    { shipping_line_id, price }
//   - add_ship       { title, price }   ← NEW (May 2 2026): shipping line jab order pe nahi
//
// Returns the updated calculatedOrder state (normalized).
// ============================================================================

import { NextResponse } from 'next/server';
import {
  stageSetQuantity,
  stageAddVariant,
  stageAddCustomItem,
  stageAddLineDiscount,
  stageUpdateShipping,
  stageAddShipping,
} from '@/lib/shopify-order-edit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();
    const { calculated_order_id, action, ...params } = body;

    if (!calculated_order_id) {
      return NextResponse.json({ success: false, error: 'calculated_order_id required' }, { status: 400 });
    }
    if (!action) {
      return NextResponse.json({ success: false, error: 'action required' }, { status: 400 });
    }

    let updated;
    switch (action) {
      case 'set_quantity':
        updated = await stageSetQuantity({
          calculated_order_id,
          line_item_id: params.line_item_id,
          quantity: Number(params.quantity),
          restock: params.restock !== false, // default true
        });
        break;

      case 'add_variant':
        updated = await stageAddVariant({
          calculated_order_id,
          variant_id: params.variant_id,
          quantity: Number(params.quantity) || 1,
        });
        break;

      case 'add_custom':
        updated = await stageAddCustomItem({
          calculated_order_id,
          title: params.title,
          price: params.price,
          quantity: Number(params.quantity) || 1,
          taxable: !!params.taxable,
          requires_shipping: params.requires_shipping !== false, // default true
        });
        break;

      case 'add_discount':
        updated = await stageAddLineDiscount({
          calculated_order_id,
          line_item_id: params.line_item_id,
          discount_type: params.discount_type,
          discount_value: Number(params.discount_value),
          description: params.description,
        });
        break;

      case 'update_ship':
        updated = await stageUpdateShipping({
          calculated_order_id,
          shipping_line_id: params.shipping_line_id,
          price: Number(params.price),
        });
        break;

      case 'add_ship':
        updated = await stageAddShipping({
          calculated_order_id,
          title: params.title || 'Shipping',
          price: Number(params.price),
        });
        break;

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ success: true, ...updated });
  } catch (e) {
    console.error('[edit-stage] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
