// ============================================================================
// RS ZEVAR ERP — Cancel Fulfillment Route
// POST /api/orders/cancel-fulfillment
// ----------------------------------------------------------------------------
// Yahan se ERP se direct Shopify ki "Cancel Fulfillment" trigger hoti hai.
// Pehle staff Shopify admin pe jakar manually cancel karta tha — ab ERP se
// hi ek button click pe ho jata hai (Shopify Orders page access band karne
// ke baad zaroori hai).
//
// Workflow:
//   1. Order Shopify pe fulfilled/booked tha (tracking lagi thi)
//   2. Realize hua ke kuch ghalat hai (courier change, double booking, etc.)
//   3. ERP me "Cancel Fulfillment" button click → yeh route call hota hai
//   4. Shopify pe fulfillment cancel hoti hai (tracking removed)
//   5. ERP fields clear: tracking_number, dispatched_courier, dispatched_at,
//      shopify_fulfillment_id, shopify_fulfilled_at, courier_tracking_url,
//      courier_status_raw
//   6. Status reverted: dispatched → confirmed (warna jo bhi hai wahi rahe)
//   7. Activity log mein clearly track hota hai
//
// Note: Shopify side se cancel hone par `fulfillments/cancelled` webhook bhi
// fire karega — yeh same cleanup kar dega (idempotent). Race-safe.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { cancelShopifyFulfillment } from '@/lib/shopify';
import { computeStatusRevertSideEffects, applyStatusRevertSideEffects } from '@/lib/order-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const supabase = createServerClient();
  try {
    const { order_id, reason, performed_by, performed_by_email } = await request.json();

    if (!order_id) {
      return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });
    }

    const performer = performed_by || 'Staff';

    // Fetch order
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, shopify_order_id, shopify_fulfillment_id, status, order_number, tracking_number, dispatched_courier')
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Validate: kuch hai bhi cancel karne ke liye?
    const hasFulfillment = !!order.shopify_fulfillment_id || !!order.tracking_number || !!order.dispatched_courier;
    if (!hasFulfillment) {
      return NextResponse.json({
        success: false,
        error: 'Is order pe koi fulfillment/tracking nahi hai. Cancel karne ko kuch nahi.',
      }, { status: 400 });
    }

    // Call Shopify to cancel fulfillment (only if we have the ID)
    let shopifyError = null;
    let shopifyCancelled = false;
    if (order.shopify_fulfillment_id) {
      try {
        await cancelShopifyFulfillment(order.shopify_fulfillment_id);
        shopifyCancelled = true;
      } catch (e) {
        shopifyError = e.message;
        console.error('[cancel-fulfillment] Shopify error:', e.message);
        // Agar Shopify pehle se cancelled keh raha hai, ya 404 dey raha hai
        // (fulfillment delete ho gayi), ERP cleanup proceed kare. Otherwise fail.
        const lowered = e.message.toLowerCase();
        const okToProceed = lowered.includes('already') || lowered.includes('not found') || lowered.includes('404');
        if (!okToProceed) {
          return NextResponse.json({
            success: false,
            error: `Shopify fulfillment cancel failed: ${e.message}`,
          }, { status: 500 });
        }
      }
    }

    // Update ERP — clear all dispatch/courier fields (same fields as the
    // fulfillments/cancelled webhook handler, kept consistent).
    //
    // FIX Apr 2026 — Phase 1 flow refactor.
    // Pehle: sirf 'dispatched' status → 'confirmed' revert hoti thi.
    // Ab: on_packing/packed/dispatched/delivered/rto — saare post-fulfillment
    //     states ko 'confirmed' pe revert karo (fulfillment cancel ho rahi hai
    //     toh status bhi pre-fulfillment pe wapis jaye).
    // Saath mein: order_assignments + packing_log credit bhi clear hote hain
    //     jab post-fulfillment se confirmed pe wapis ja rahe hain (fulfillment
    //     hi assignment ka trigger thi).
    const POST_FULFILL_STATUSES = ['on_packing', 'packed', 'dispatched', 'delivered', 'rto'];
    const newStatus = POST_FULFILL_STATUSES.includes(order.status) ? 'confirmed' : order.status;
    const nowIso = new Date().toISOString();

    // Compute auxiliary reverts (assignment + packing_log) using Phase 2 helper.
    // computeStatusRevertSideEffects returns deleteAssignments=true,
    // deletePackingLog=true when going from post-fulfill → confirmed.
    const revert = computeStatusRevertSideEffects(order.status, newStatus);

    const { error: updateErr } = await supabase.from('orders').update({
      status: newStatus,
      tracking_number: null,
      dispatched_courier: null,
      dispatched_at: null,
      shopify_fulfillment_id: null,
      shopify_fulfilled_at: null,
      courier_tracking_url: null,
      courier_status_raw: null,
      updated_at: nowIso,
    }).eq('id', order_id);

    if (updateErr) throw updateErr;

    // Apply auxiliary table reverts (best-effort — order row already cleaned)
    let revertResult = { revertedFields: [], rowsRemoved: { assignments: 0, packing_log: 0 } };
    if (revert.deleteAssignments || revert.deletePackingLog) {
      try {
        revertResult = await applyStatusRevertSideEffects(supabase, order_id, revert);
      } catch (e) {
        console.error('[cancel-fulfillment] auxiliary revert failed:', e.message);
      }
    }

    // Activity log — include all revert details for transparency
    const auxRevertNotes = [];
    if (revertResult.rowsRemoved.assignments > 0) auxRevertNotes.push('assignment removed');
    if (revertResult.rowsRemoved.packing_log > 0) auxRevertNotes.push(`packing credit removed (${revertResult.rowsRemoved.packing_log} rows)`);

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'fulfillment_cancelled',
      notes: [
        reason || 'No reason given',
        shopifyCancelled ? '+ Shopify fulfillment cancelled' : null,
        shopifyError ? `Shopify warning: ${shopifyError}` : null,
        order.tracking_number ? `Tracking removed: ${order.tracking_number}` : null,
        order.dispatched_courier ? `Courier was: ${order.dispatched_courier}` : null,
        `Status: ${order.status} → ${newStatus}`,
        auxRevertNotes.length > 0 ? `Side-effects: ${auxRevertNotes.join(', ')}` : null,
      ].filter(Boolean).join(' | '),
      performed_by: performer,
      performed_by_email: performed_by_email || null,
      performed_at: nowIso,
    });

    return NextResponse.json({
      success: true,
      shopify_cancelled: shopifyCancelled,
      from_status: order.status,
      to_status: newStatus,
      cleared: {
        tracking: order.tracking_number,
        courier:  order.dispatched_courier,
      },
      warning: shopifyError ? `ERP cleared but Shopify side issue: ${shopifyError}` : null,
    });
  } catch (e) {
    console.error('[cancel-fulfillment] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
