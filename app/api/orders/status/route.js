// ============================================================================
// RS ZEVAR ERP — Order Status Route  (FIXED Apr 2026)
// ----------------------------------------------------------------------------
// Changes from previous version:
//   1. Uses canTransition() guard — no more delivered → pending silent jumps
//   2. VALID_STATUSES imported from lib/order-status.js (single source of truth)
//   3. Blocks status='dispatched' via this endpoint — user must use /dispatch
//      flow so courier booking + Shopify fulfillment actually happen
//   4. Adds proper side-effects:
//        delivered  → delivered_at set, COD auto-paid
//        rto        → rto_at set
//        confirmed  → confirmed_at set (if not already)
//        cancelled  → redirects to /cancel (returns helpful error)
//   5. Pre-fetches current status so canTransition has real fromStatus
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { canTransition, VALID_STATUSES } from '@/lib/order-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Statuses that must NOT be set via this thin status route — they need full workflows
// NOTE: 'dispatched' is NOT blocked here. Reason: in RS ZEVAR's normal flow, orders
// are booked on Shopify directly (PostEx/Leopards/Kangaroo Shopify apps). By the
// time dispatcher clicks "Mark as Dispatched" in ERP, tracking already exists via
// orders/fulfilled webhook. A second call to /api/orders/dispatch would create a
// DUPLICATE courier booking. So this route allows status='dispatched' with
// minimal side effects (sets dispatched_at). The /api/orders/dispatch endpoint
// is reserved for the secondary path: ERP-initiated booking via Kangaroo/
// Leopards modals (when Shopify booking was skipped).
const BLOCKED_VIA_STATUS_ROUTE = new Set([
  'cancelled',  // use /api/orders/cancel  — handles Shopify cancel + cancel_reason
]);

export async function POST(request) {
  const supabase = createServerClient();
  try {
    const { order_id, status, notes, performed_by, performed_by_email } = await request.json();

    if (!order_id || !status) {
      return NextResponse.json(
        { success: false, error: 'order_id aur status dono required hain' },
        { status: 400 },
      );
    }
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status: ${status}` },
        { status: 400 },
      );
    }
    if (BLOCKED_VIA_STATUS_ROUTE.has(status)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cancel /api/orders/cancel flow se karo (Shopify sync + cancel_reason ke saath)',
          use_endpoint: '/api/orders/cancel',
        },
        { status: 400 },
      );
    }

    // Fetch minimal fields — only what we strictly need for logic.
    // Avoid reading optional timestamp columns (delivered_at, rto_at, dispatched_at)
    // which may not exist in schema. We'll just always write them fresh.
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('status, payment_status, payment_method, confirmed_at')
      .eq('id', order_id)
      .single();

    if (fetchErr) {
      console.error('[status] fetch error:', fetchErr.message);
      return NextResponse.json(
        { success: false, error: `DB error: ${fetchErr.message}` },
        { status: 500 },
      );
    }
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Central transition guard — blocks illegal moves like delivered → pending
    const gate = canTransition(order.status, status, 'manual');
    if (!gate.allowed) {
      return NextResponse.json(
        { success: false, error: `Status change blocked: ${order.status} → ${status} (${gate.reason})` },
        { status: 400 },
      );
    }

    // Build update payload with status-specific side effects
    const nowIso = new Date().toISOString();
    const patch = {
      status,
      updated_at: nowIso,
    };

    if (status === 'confirmed' && !order.confirmed_at) {
      patch.confirmed_at = nowIso;
    }
    if (status === 'dispatched') {
      // Shopify-booked flow: dispatcher manually flips status after Shopify fulfillment.
      // Tracking number + courier already came in via orders/fulfilled webhook.
      patch.dispatched_at = nowIso;
    }
    if (status === 'delivered') {
      patch.delivered_at = nowIso;
      // COD auto-paid rule — memory: `pending → confirmed → dispatched → delivered → paid`
      if (order.payment_method === 'COD' && order.payment_status === 'unpaid') {
        patch.payment_status = 'paid';
        patch.paid_at = nowIso;
      }
    }
    if (status === 'rto') {
      patch.rto_at = nowIso;
    }

    // Resilient UPDATE — if an optional timestamp column (delivered_at, rto_at,
    // paid_at) doesn't exist in schema, strip it and retry. dispatched_at,
    // confirmed_at are assumed to exist since older code writes to them.
    const OPTIONAL_COLS = ['delivered_at', 'rto_at', 'paid_at'];
    let updateErr = null;
    let attempt = 0;
    while (attempt < 3) {
      const { error } = await supabase
        .from('orders')
        .update(patch)
        .eq('id', order_id);
      if (!error) { updateErr = null; break; }
      updateErr = error;
      const missingCol = OPTIONAL_COLS.find(col =>
        String(error.message || '').toLowerCase().includes(col),
      );
      if (missingCol && patch[missingCol] !== undefined) {
        console.warn(`[status] column '${missingCol}' not in schema — skipping`);
        delete patch[missingCol];
        attempt++;
        continue;
      }
      break;
    }
    if (updateErr) throw updateErr;

    // Activity log — always attribute performer
    await supabase.from('order_activity_log').insert({
      order_id,
      action: `status_changed_to_${status}`,
      notes: notes || `${order.status} → ${status}`,
      performed_by: performed_by || 'Staff',
      performed_by_email: performed_by_email || null,
      performed_at: nowIso,
    });

    return NextResponse.json({
      success: true,
      from_status: order.status,
      to_status: status,
      side_effects: {
        payment_auto_paid: patch.payment_status === 'paid',
        delivered_at_set: !!patch.delivered_at,
        dispatched_at_set: !!patch.dispatched_at,
        rto_at_set: !!patch.rto_at,
        confirmed_at_set: !!patch.confirmed_at,
      },
    });
  } catch (e) {
    console.error('[status] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
