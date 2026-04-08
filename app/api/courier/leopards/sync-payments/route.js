// ============================================================================
// Leopards — Payment Reconciliation
// ============================================================================
// 1. Find all delivered Leopards orders that are still unpaid
// 2. Batch their tracking numbers (50 per call) to Leopards getPaymentDetails
// 3. For each packet Leopards says is "Paid", mark order payment_status = 'paid'
//    and save cheque number + date + method in notes
//
// Safe & idempotent. Only flips unpaid → paid (never touches refunded/already paid).
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchLeopardsPayments, isLeopardsPaymentPaid } from '@/lib/leopards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function runPaymentSync({ triggered_by = 'manual', limit = 500 } = {}) {
  const startTime = Date.now();
  const supabase = createServerClient();

  // 1. Find unpaid delivered Leopards orders with tracking numbers
  const { data: candidates, error: fetchErr } = await supabase
    .from('orders')
    .select('id, order_number, tracking_number, total_amount, payment_status')
    .eq('dispatched_courier', 'Leopards')
    .eq('status', 'delivered')
    .eq('payment_status', 'unpaid')
    .not('tracking_number', 'is', null)
    .limit(limit);

  if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);

  if (!candidates || candidates.length === 0) {
    return {
      success: true,
      candidates: 0,
      checked: 0,
      marked_paid: 0,
      duration_ms: Date.now() - startTime,
      message: 'No unpaid delivered Leopards orders to check',
    };
  }

  // 2. Build tracking → order map
  const trackingToOrder = new Map();
  for (const o of candidates) {
    trackingToOrder.set(String(o.tracking_number).trim(), o);
  }
  const trackingNumbers = Array.from(trackingToOrder.keys());

  // 3. Fetch payment details in chunks of 50
  const { payments, errors: apiErrors } = await fetchLeopardsPayments(trackingNumbers);

  // 4. Process each payment record
  let markedPaid = 0;
  let stillPending = 0;
  const updateErrors = [];
  const samples = [];

  for (const payment of payments) {
    const cn = String(payment.booked_packet_cn || '').trim();
    const order = trackingToOrder.get(cn);
    if (!order) continue;

    if (samples.length < 3) samples.push(payment);

    if (isLeopardsPaymentPaid(payment.status)) {
      // Mark as paid in ERP
      const paymentNote = [
        `Leopards payment received`,
        payment.invoice_cheque_no ? `Cheque: ${payment.invoice_cheque_no}` : null,
        payment.invoice_cheque_date ? `Date: ${payment.invoice_cheque_date}` : null,
        payment.payment_method ? `Method: ${payment.payment_method}` : null,
      ].filter(Boolean).join(' | ');

      const { error } = await supabase
        .from('orders')
        .update({
          payment_status: 'paid',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id)
        .eq('payment_status', 'unpaid'); // Guard: only flip unpaid → paid

      if (error) {
        updateErrors.push({ order_id: order.id, tracking: cn, error: error.message });
      } else {
        markedPaid++;

        // Activity log (best effort)
        try {
          await supabase.from('order_activity_log').insert({
            order_id: order.id,
            action: 'payment_received',
            notes: paymentNote,
            performed_at: new Date().toISOString(),
          });
        } catch {}
      }
    } else {
      stillPending++;
    }
  }

  // 5. Log the sync run
  await supabase.from('courier_sync_log').insert({
    courier: 'Leopards',
    sync_type: 'payments',
    total_fetched: payments.length,
    matched_orders: candidates.length,
    marked_paid: markedPaid,
    errors: [...apiErrors, ...updateErrors].length > 0
      ? [...apiErrors, ...updateErrors].slice(0, 10)
      : null,
    duration_ms: Date.now() - startTime,
    triggered_by,
    raw_sample: samples,
  });

  return {
    success: true,
    candidates: candidates.length,
    checked: payments.length,
    marked_paid: markedPaid,
    still_pending: stillPending,
    api_errors: apiErrors.length > 0 ? apiErrors.slice(0, 5) : undefined,
    update_errors: updateErrors.length > 0 ? updateErrors.slice(0, 5) : undefined,
    duration_ms: Date.now() - startTime,
    message: `${markedPaid} orders marked paid out of ${candidates.length} checked`,
  };
}

// ─── POST — manual trigger ──────────────────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runPaymentSync({
      triggered_by: body.triggered_by || 'manual',
      limit: body.limit || 500,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}

// ─── GET — stats + last sync ────────────────────────────────────────────────
export async function GET() {
  try {
    const supabase = createServerClient();

    const { data: lastLog } = await supabase
      .from('courier_sync_log')
      .select('*')
      .eq('courier', 'Leopards')
      .eq('sync_type', 'payments')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { count: pending } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'Leopards')
      .eq('status', 'delivered')
      .eq('payment_status', 'unpaid');

    const { count: paid } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'Leopards')
      .eq('payment_status', 'paid');

    return NextResponse.json({
      success: true,
      last_sync: lastLog,
      leopards_delivered_unpaid: pending || 0,
      leopards_paid: paid || 0,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
