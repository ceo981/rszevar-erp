// ============================================================================
// Trax (Sonic) — Payment Reconciliation
// ----------------------------------------------------------------------------
// FILE PATH: app/api/courier/trax/sync-payments/route.js
// ----------------------------------------------------------------------------
// 1. Delivered Trax orders dhoondo jo abhi unpaid hain
// 2. Unke tracking numbers Sonic /api/payments ko bhejo (bulk, chunked 50)
// 3. Jiska Sonic "Processed/Paid" bole, ERP mein payment_status='paid' karo
//    + cheque/method/date note mein save
//
// Safe & idempotent — sirf unpaid → paid flip karta hai.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchSonicPayments, isSonicPaymentPaid } from '@/lib/sonic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function runPaymentSync({ triggered_by = 'manual', limit = 500 } = {}) {
  const startTime = Date.now();
  const supabase = createServerClient();

  // 1. Unpaid delivered Trax orders with tracking numbers
  const { data: candidates, error: fetchErr } = await supabase
    .from('orders')
    .select('id, order_number, tracking_number, total_amount, payment_status')
    .eq('dispatched_courier', 'Trax')
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
      message: 'No unpaid delivered Trax orders to check',
    };
  }

  // 2. tracking → order map
  const trackingToOrder = new Map();
  for (const o of candidates) {
    trackingToOrder.set(String(o.tracking_number).trim(), o);
  }
  const trackingNumbers = Array.from(trackingToOrder.keys());

  // 3. Bulk payment fetch (chunked)
  const { payments, errors: apiErrors } = await fetchSonicPayments(trackingNumbers);

  // 4. Process each payment record
  let markedPaid = 0;
  let stillPending = 0;
  const updateErrors = [];
  const samples = [];

  for (const payment of payments) {
    const cn = String(payment.tracking || '').trim();
    const order = trackingToOrder.get(cn);
    if (!order) continue;

    if (samples.length < 3) samples.push(payment);

    if (isSonicPaymentPaid(payment.payment_status)) {
      const paymentNote = [
        `Trax payment received`,
        payment.payment_method ? `Method: ${payment.payment_method}` : null,
        payment.payment_date ? `Date: ${payment.payment_date}` : null,
        payment.payment_id ? `Ref: ${payment.payment_id}` : null,
      ].filter(Boolean).join(' | ');

      const { error } = await supabase
        .from('orders')
        .update({
          payment_status: 'paid',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id)
        .eq('payment_status', 'unpaid'); // guard: only unpaid → paid

      if (error) {
        updateErrors.push({ order_id: order.id, tracking: cn, error: error.message });
      } else {
        markedPaid++;
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

  // 5. Log the run
  await supabase.from('courier_sync_log').insert({
    courier: 'Trax',
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

export async function GET() {
  try {
    const supabase = createServerClient();

    const { data: lastLog } = await supabase
      .from('courier_sync_log')
      .select('*')
      .eq('courier', 'Trax')
      .eq('sync_type', 'payments')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { count: pending } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'Trax')
      .eq('status', 'delivered')
      .eq('payment_status', 'unpaid');

    const { count: paid } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'Trax')
      .eq('payment_status', 'paid');

    return NextResponse.json({
      success: true,
      last_sync: lastLog,
      trax_delivered_unpaid: pending || 0,
      trax_paid: paid || 0,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
