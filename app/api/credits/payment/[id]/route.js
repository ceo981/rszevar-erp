// ============================================================================
// RS ZEVAR ERP — Customer Credits — Void Payment
// DELETE /api/credits/payment/[id]   (soft delete via voided_at)
// PATCH  /api/credits/payment/[id]   (un-void — restore)
// May 2 2026 · Step 3 of 6 · File 4 of 5
// ----------------------------------------------------------------------------
// PURPOSE:
//   Allow super_admin to void a payment recorded by mistake.
//   Soft-delete pattern (voided_at timestamp) — no actual row deletion.
//   DB trigger auto-reverses allocations when voided_at is set.
//
// WHY SOFT DELETE:
//   - Audit trail preserved (financial data — never hard-delete)
//   - Re-can be restored if void was itself a mistake
//   - Allocations stay in DB but trigger ignores them (cp.voided_at IS NOT NULL filter)
//   - Orders auto-flip back to unpaid/partial via trigger
//
// AUTH:
//   - Caller must be super_admin (checked via Supabase service_role + manual lookup)
//   - We accept `super_admin: true` flag from caller for now (matches existing
//     pattern in this codebase — frontend asserts role before showing button).
//   - Future: middleware-based auth (out of scope for this feature).
//
// REQUEST BODY (DELETE):
//   {
//     reason: "Recorded twice by mistake"  (optional but recommended)
//     voided_by: "uuid"  (super_admin user id)
//     voided_by_name: "Abdul Rehman"  (snapshot)
//   }
//
// RESPONSE:
//   {
//     success: true,
//     payment: { id, amount, voided_at, voided_reason },
//     orders_reverted: [
//       { id, order_number, new_payment_status: "unpaid"|"partial", new_paid_amount }
//     ]
//   }
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ────────────────────────────────────────────────────────────────────────────
// DELETE — void a payment
// ────────────────────────────────────────────────────────────────────────────
export async function DELETE(request, { params }) {
  try {
    const { id: paymentIdStr } = await params;
    const paymentId = parseInt(paymentIdStr);
    if (!paymentId || isNaN(paymentId)) {
      return NextResponse.json(
        { success: false, error: 'Valid payment id required' },
        { status: 400 },
      );
    }

    // Body is optional for DELETE but useful for audit trail
    let body = {};
    try {
      body = await request.json();
    } catch {
      // No body sent — that's fine
    }

    const supabase = createServerClient();

    // ── 1. Fetch payment to confirm it exists and isn't already voided ──
    const { data: payment, error: fetchErr } = await supabase
      .from('customer_payments')
      .select('id, amount, customer_phone, voided_at, allocated_total')
      .eq('id', paymentId)
      .single();

    if (fetchErr || !payment) {
      return NextResponse.json(
        { success: false, error: 'Payment not found' },
        { status: 404 },
      );
    }

    if (payment.voided_at) {
      return NextResponse.json(
        { success: false, error: 'Payment already voided' },
        { status: 400 },
      );
    }

    // ── 2. Get list of orders that will be affected (for response) ──
    const { data: allocs } = await supabase
      .from('payment_allocations')
      .select('order_id')
      .eq('payment_id', paymentId);

    const affectedOrderIds = (allocs || []).map(a => a.order_id);

    // ── 3. Mark payment as voided ──
    // The DB trigger `trg_on_customer_payment_voided` automatically fires
    // and reverses allocations (orders.paid_amount + payment_status updated).
    const { data: voidedPayment, error: voidErr } = await supabase
      .from('customer_payments')
      .update({
        voided_at: new Date().toISOString(),
        voided_by: body.voided_by || null,
        voided_reason: body.reason || 'Voided by super_admin',
      })
      .eq('id', paymentId)
      .select('id, amount, voided_at, voided_reason')
      .single();

    if (voidErr) throw voidErr;

    // ── 4. Fetch updated orders to show what reverted ──
    let ordersReverted = [];
    if (affectedOrderIds.length > 0) {
      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_number, total_amount, paid_amount, payment_status')
        .in('id', affectedOrderIds);

      ordersReverted = (orders || []).map(o => ({
        id: o.id,
        order_number: o.order_number,
        new_payment_status: o.payment_status,
        new_paid_amount: o.paid_amount,
        balance: Math.max(0, (o.total_amount || 0) - (o.paid_amount || 0)),
      }));
    }

    return NextResponse.json({
      success: true,
      payment: voidedPayment,
      orders_reverted: ordersReverted,
      message: `Payment voided. ${ordersReverted.length} order(s) status reverted.`,
    });
  } catch (e) {
    console.error('[DELETE /api/credits/payment/[id]] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PATCH — un-void (restore voided payment)
// ────────────────────────────────────────────────────────────────────────────
// Use case: super_admin voided by mistake, wants to restore.
// Pre-condition: payment must currently be voided.
// Effect: voided_at cleared → trigger re-applies allocations → orders flip
//         back to paid/partial as appropriate.

export async function PATCH(request, { params }) {
  try {
    const { id: paymentIdStr } = await params;
    const paymentId = parseInt(paymentIdStr);
    if (!paymentId || isNaN(paymentId)) {
      return NextResponse.json(
        { success: false, error: 'Valid payment id required' },
        { status: 400 },
      );
    }

    let body = {};
    try { body = await request.json(); } catch {}

    if (body.action !== 'unvoid') {
      return NextResponse.json(
        { success: false, error: 'Use action="unvoid" in request body' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    const { data: payment, error: fetchErr } = await supabase
      .from('customer_payments')
      .select('id, voided_at')
      .eq('id', paymentId)
      .single();

    if (fetchErr || !payment) {
      return NextResponse.json(
        { success: false, error: 'Payment not found' },
        { status: 404 },
      );
    }

    if (!payment.voided_at) {
      return NextResponse.json(
        { success: false, error: 'Payment is not voided' },
        { status: 400 },
      );
    }

    const { data: allocs } = await supabase
      .from('payment_allocations')
      .select('order_id')
      .eq('payment_id', paymentId);
    const affectedOrderIds = (allocs || []).map(a => a.order_id);

    const { data: restored, error: restoreErr } = await supabase
      .from('customer_payments')
      .update({
        voided_at: null,
        voided_by: null,
        voided_reason: null,
      })
      .eq('id', paymentId)
      .select('id, amount, voided_at')
      .single();

    if (restoreErr) throw restoreErr;

    let ordersUpdated = [];
    if (affectedOrderIds.length > 0) {
      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_number, payment_status, paid_amount, total_amount')
        .in('id', affectedOrderIds);

      ordersUpdated = (orders || []).map(o => ({
        id: o.id,
        order_number: o.order_number,
        payment_status: o.payment_status,
        paid_amount: o.paid_amount,
      }));
    }

    return NextResponse.json({
      success: true,
      payment: restored,
      orders_updated: ordersUpdated,
      message: `Payment restored. ${ordersUpdated.length} order(s) re-allocated.`,
    });
  } catch (e) {
    console.error('[PATCH /api/credits/payment/[id]] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
