// ============================================================================
// RS ZEVAR ERP — Manual Fulfill Route (Apr 2026)
// POST /api/orders/manual-fulfill
//   { order_id, tracking_number?, courier?, courier_tracking_url?,
//     notify_customer?, reason?, performed_by?, performed_by_email? }
// ----------------------------------------------------------------------------
// Marks an order as fulfilled WITHOUT auto-booking with any courier API.
// Used for:
//   1. Tracking already exists (e.g. Kangaroo manually booked in Shopify, or
//      team booked Leopards/Kangaroo via the courier's own portal). Just
//      record the tracking number in ERP + push to Shopify fulfillment.
//   2. Walk-in / wholesale / pickup orders with NO tracking. Just mark
//      fulfilled (Shopify line items move to fulfilled state without a
//      shipping email).
//
// This route is SEPARATE from /api/orders/dispatch — that one auto-books with
// PostEx/Leopards/Kangaroo APIs. This one trusts whatever the user enters.
//
// Smart courier auto-detection: if courier param is empty/null, we infer from
// tracking number prefix:
//   - "KI..." → Leopards
//   - "KL..." → Kangaroo
//   - else    → "Other" (no API integration, just record)
// User can override by passing courier explicitly.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { canTransition } from '@/lib/order-status';
import {
  createShopifyFulfillment,
  detectCourierFromTracking,
} from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Compute a tracking URL from courier + tracking number (mirrors dispatch route)
function buildTrackingUrl(courier, tracking) {
  if (!tracking) return null;
  if (courier === 'Leopards') return `https://lcs.appsbymoose.com/track/${tracking}`;
  if (courier === 'Kangaroo') return `https://kangaroo.pk/track/${tracking}`;
  if (courier === 'PostEx')   return `https://postex.pk/tracking/${tracking}`;
  return null;
}

export async function POST(request) {
  try {
    const {
      order_id,
      tracking_number,
      courier: courierInput,
      courier_tracking_url,
      notify_customer = true,
      reason,
      performed_by,
      performed_by_email,
    } = await request.json();

    if (!order_id) {
      return NextResponse.json(
        { success: false, error: 'order_id required' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();
    const performer = performed_by || 'Staff';
    const performerEmail = performed_by_email || null;

    // ── Fetch order ──
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // ── Transition guard: must be in confirmed/on_packing/hold/attempted ──
    // Target is now 'on_packing' (was 'dispatched'). Manual mode allows any
    // non-terminal transition, so this check still passes for our use case.
    const gate = canTransition(order.status, 'on_packing', 'manual');
    if (!gate.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Manual fulfill blocked: status '${order.status}' se fulfill nahi ho sakta (${gate.reason})`,
        },
        { status: 400 },
      );
    }

    // ── Already-fulfilled guard ──
    // If a Shopify fulfillment already exists, don't create another. User can
    // cancel-fulfillment first if they want to redo.
    if (order.shopify_fulfillment_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Order already has a Shopify fulfillment. Use Cancel Fulfillment first if you want to redo.',
        },
        { status: 400 },
      );
    }

    // ── Smart courier resolution ──
    // Priority: explicit courier param → auto-detect from tracking → "Other"
    const trimmedTracking = tracking_number ? String(tracking_number).trim() : null;
    let courier = courierInput && String(courierInput).trim();
    if (!courier && trimmedTracking) {
      courier = detectCourierFromTracking(trimmedTracking);
    }
    if (!courier) {
      courier = trimmedTracking ? 'Other' : 'Pickup';
    }

    const trackingUrl = courier_tracking_url || buildTrackingUrl(courier, trimmedTracking);
    const nowIso = new Date().toISOString();

    // ── Step 1: Push to Shopify (best-effort) ──
    // For Shopify-linked orders, create a fulfillment. Tracking is optional —
    // tracking-less fulfillment marks line items fulfilled without shipping email.
    let shopifyFulfillmentId = null;
    let shopifyPushError = null;

    if (order.shopify_order_id) {
      try {
        const fulfillment = await createShopifyFulfillment(
          order.shopify_order_id,
          trimmedTracking,
          courier,
          trackingUrl,
          { notify_customer: !!notify_customer && !!trimmedTracking },
          // ↑ Notify only when there's a tracking — otherwise customer gets
          //   an empty-tracking shipping email, which is confusing.
        );
        shopifyFulfillmentId = fulfillment?.id ? String(fulfillment.id) : null;
      } catch (e) {
        shopifyPushError = e.message;
        console.error('[manual-fulfill] Shopify fulfillment failed:', e.message);
        // Continue anyway — ERP update is the source of truth for our team.
      }
    }

    // ── Step 2: Update order in ERP DB ──
    // FIX Apr 2026 — Fulfillment now lands in 'on_packing', NOT 'dispatched'.
    // New flow philosophy:
    //   "Fulfilled" = courier slip printed, parcel still in office.
    //   "Dispatched" = parcel left the office (set later by dispatcher's
    //                  Dispatch button in /orders/[id] page).
    // So we record tracking + courier + fulfillment_id (the metadata that
    // ARRIVED with the slip), but office_status moves only one step forward
    // to on_packing — where the packer takes over. dispatched_at stays null
    // until the actual dispatch action.
    const updatePayload = {
      status: 'on_packing',
      dispatched_courier: courier,
      tracking_number: trimmedTracking || null,
      courier_tracking_url: trackingUrl || null,
      updated_at: nowIso,
    };
    if (shopifyFulfillmentId) {
      updatePayload.shopify_fulfillment_id = shopifyFulfillmentId;
      updatePayload.shopify_fulfilled_at = nowIso;
    }

    const { error: updErr } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', order_id);

    if (updErr) {
      throw new Error(`DB update failed: ${updErr.message}`);
    }

    // ── Step 3: courier_bookings record (so settlements/reports include this) ──
    // Use a manual-prefix fake tracking if none provided, just so the row has
    // a unique ID (mirrors dispatch route fallback pattern).
    await supabase.from('courier_bookings').insert({
      order_id,
      order_name: order.order_number,
      tracking_number: trimmedTracking || `MANUAL-${order_id}-${Date.now()}`,
      courier_name: courier,
      customer_name: order.customer_name || '',
      customer_phone: order.customer_phone || '',
      address: order.customer_address || '',
      city: order.customer_city || '',
      cod_amount: order.total_amount || 0,
      status: 'booked',
      api_booked: false,                   // manual fulfill — no API booking
      cod_settled: false,
      rto_acknowledged: false,
      created_at: nowIso,
      updated_at: nowIso,
    });

    // ── Step 4: Activity log ──
    const reasonNote = reason ? ` Reason: ${reason}.` : '';
    const trackingNote = trimmedTracking
      ? `Tracking: ${trimmedTracking} (${courier}).`
      : `Manually fulfilled without tracking (${courier}).`;
    const shopifyNote = order.shopify_order_id
      ? (shopifyFulfillmentId
        ? ' Shopify synced.'
        : (shopifyPushError ? ` Shopify push failed: ${shopifyPushError}.` : ' Shopify sync skipped.'))
      : ' (Manual order, no Shopify sync.)';

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'manually_fulfilled',
      notes: `Manually fulfilled by ${performer}. ${trackingNote}${shopifyNote}${reasonNote}`,
      performed_by: performer,
      performed_by_email: performerEmail,
      performed_at: nowIso,
    });

    return NextResponse.json({
      success: true,
      order_id,
      order_number: order.order_number,
      status: 'on_packing',
      tracking_number: trimmedTracking,
      courier,
      shopify_synced: !!shopifyFulfillmentId,
      shopify_fulfillment_id: shopifyFulfillmentId,
      warning: shopifyPushError || null,
    });
  } catch (e) {
    console.error('[manual-fulfill] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
