// ============================================================================
// RS ZEVAR ERP — Convert Order to Credit (Udhaar)
// POST /api/orders/[id]/convert-to-credit       → mark as credit
// POST /api/orders/[id]/convert-to-credit?revert=true → unmark (revert)
// May 2 2026 · Step 6 of 6
// ----------------------------------------------------------------------------
// PURPOSE:
//   Toggle is_credit_order flag on an order. When enabled:
//     - is_credit_order = true
//     - status auto-flips to 'delivered' (real-time fulfillment for credit
//       customer who already has the goods)
//     - payment_status STAYS unpaid (will become partial/paid via payments)
//     - Activity log entry written
//
//   When reverted (revert=true):
//     - is_credit_order = false
//     - Status NOT auto-reverted (admin can manually change back if needed)
//     - WARN if there are existing payment_allocations on this order
//       (revert ko block nahi karte but admin ko bata dete hain)
//
// REQUEST BODY:
//   {
//     performed_by: "Abdul Rehman",
//     performed_by_email: "abdul@rszevar.com",
//     reason: "Customer ne udhaar request kiya"  (optional)
//   }
//
// RESPONSE:
//   {
//     success: true,
//     order: { id, order_number, is_credit_order, status, payment_status },
//     warnings: [...]  // e.g. existing allocations on revert
//   }
//
// AUTH:
//   - Frontend asserts super_admin before showing button (existing pattern)
//   - Backend allows authenticated calls (existing codebase pattern)
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const revert = searchParams.get('revert') === 'true';

    if (!id) {
      return NextResponse.json({ success: false, error: 'Order id required' }, { status: 400 });
    }

    let body = {};
    try { body = await request.json(); } catch {}

    const performer = body.performed_by || 'Staff';
    const performerEmail = body.performed_by_email || null;
    const reason = body.reason || null;

    const supabase = createServerClient();

    // ── 1. Fetch current order ──
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, status, payment_status, is_credit_order, customer_phone, customer_name, total_amount, paid_amount')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    const warnings = [];

    if (revert) {
      // ── REVERT FLOW ──
      if (!order.is_credit_order) {
        return NextResponse.json(
          { success: false, error: 'Order is already not a credit order' },
          { status: 400 },
        );
      }

      // Check for existing payment allocations (warn, don't block)
      const { data: allocs } = await supabase
        .from('payment_allocations')
        .select('id, amount, payment_id')
        .eq('order_id', id);

      if (allocs && allocs.length > 0) {
        warnings.push(
          `${allocs.length} payment allocation(s) exist on this order (Rs ${allocs.reduce((s, a) => s + (a.amount || 0), 0).toFixed(2)} total). Reverting will NOT delete payments — they will remain in customer's khaata. Consider voiding payments first if needed.`
        );
      }

      const { data: updated, error: updateErr } = await supabase
        .from('orders')
        .update({
          is_credit_order: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('id, order_number, is_credit_order, status, payment_status')
        .single();

      if (updateErr) throw updateErr;

      // Activity log
      try {
        await supabase.from('order_activity').insert({
          order_id: id,
          action: 'credit_reverted',
          performed_by: performer,
          performed_by_email: performerEmail,
          notes: reason || 'Reverted from credit order',
        });
      } catch (e) {
        console.warn('[convert-to-credit] activity log failed:', e.message);
      }

      return NextResponse.json({
        success: true,
        order: updated,
        warnings,
        message: 'Order reverted from credit',
      });
    }

    // ── CONVERT FLOW (default) ──
    if (order.is_credit_order) {
      return NextResponse.json(
        { success: false, error: 'Order is already marked as credit' },
        { status: 400 },
      );
    }

    if (order.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'Cancelled orders cannot be converted to credit' },
        { status: 400 },
      );
    }

    if (order.payment_status === 'paid') {
      warnings.push('Order is already fully paid — converting to credit but no balance to track.');
    }

    // Mark as credit + auto-deliver
    const updates = {
      is_credit_order: true,
      updated_at: new Date().toISOString(),
    };

    // Auto-deliver: if not already delivered/cancelled, mark as delivered
    // (real-time fulfillment — credit customer pe maal physically pohanch chuka hai)
    const TERMINAL_STATUSES = ['delivered', 'cancelled', 'returned'];
    let statusChanged = false;
    if (!TERMINAL_STATUSES.includes(order.status)) {
      updates.status = 'delivered';
      updates.delivered_at = new Date().toISOString();
      statusChanged = true;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select('id, order_number, is_credit_order, status, payment_status')
      .single();

    if (updateErr) throw updateErr;

    // Activity log
    try {
      const actionMsg = statusChanged
        ? `Converted to credit order · auto-delivered (was: ${order.status})`
        : 'Converted to credit order';
      await supabase.from('order_activity').insert({
        order_id: id,
        action: 'credit_converted',
        performed_by: performer,
        performed_by_email: performerEmail,
        notes: reason ? `${actionMsg} — ${reason}` : actionMsg,
      });
    } catch (e) {
      console.warn('[convert-to-credit] activity log failed:', e.message);
    }

    return NextResponse.json({
      success: true,
      order: updated,
      warnings,
      status_changed: statusChanged,
      previous_status: order.status,
      message: statusChanged
        ? `Order converted to credit + delivered (was ${order.status})`
        : 'Order converted to credit',
    });
  } catch (e) {
    console.error('[POST /api/orders/[id]/convert-to-credit] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
