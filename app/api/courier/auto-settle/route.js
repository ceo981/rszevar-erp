import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── GET: Settlement summary per courier ────────────────────────────────────

export async function GET() {
  // Per-courier settlement summary
  const { data: settlements } = await supabase
    .from('settlements')
    .select('courier_name, status, cod_amount, settled_at')
    .order('settled_at', { ascending: false });

  const couriers = ['PostEx', 'Leopards', 'Kangaroo'];
  const byCourier = {};

  for (const c of couriers) {
    const cs = (settlements || []).filter(s => s.courier_name === c);
    byCourier[c] = {
      total_settlements: cs.length,
      total_cod: cs.reduce((a, s) => a + parseFloat(s.cod_amount || 0), 0),
      pending: cs.filter(s => s.status === 'pending_disbursement').length,
      disbursed: cs.filter(s => s.status === 'disbursed').length,
    };
  }

  // Unsettled delivered bookings (cash courier owes us)
  const { data: unsettled } = await supabase
    .from('courier_bookings')
    .select('id, tracking_number, courier_name, cod_amount, updated_at')
    .eq('status', 'delivered')
    .eq('cod_settled', false)
    .order('updated_at', { ascending: false });

  const pendingCOD = (unsettled || []).reduce((a, r) => a + parseFloat(r.cod_amount || 0), 0);

  return NextResponse.json({
    by_courier: byCourier,
    unsettled_count: (unsettled || []).length,
    pending_cod: pendingCOD,
    unsettled_list: unsettled || [],
  });
}

// ─── POST: Mark settlements as disbursed + auto-mark orders as paid ─────────

export async function POST(request) {
  const { courier, amount, reference, date } = await request.json();

  // 1. Find all pending settlements for this courier
  const { data: pending } = await supabase
    .from('settlements')
    .select('id, cod_amount')
    .eq('courier_name', courier)
    .eq('status', 'pending_disbursement');

  if (!pending || pending.length === 0) {
    return NextResponse.json({ success: false, error: 'No pending settlements found' });
  }

  // 2. Mark settlements as disbursed
  const ids = pending.map(p => p.id);
  await supabase.from('settlements').update({
    status: 'disbursed',
    disbursed_at: date || new Date().toISOString(),
    disbursement_reference: reference || '',
    disbursement_amount: amount,
  }).in('id', ids);

  // 3. Find all delivered+unsettled bookings for this courier
  const { data: bookings } = await supabase
    .from('courier_bookings')
    .select('id, order_id')
    .eq('courier_name', courier)
    .eq('status', 'delivered')
    .eq('cod_settled', false);

  let bookingsSettled = 0;
  let ordersMarkedPaid = 0;

  if (bookings?.length) {
    // 4. Mark bookings as cod_settled
    await supabase
      .from('courier_bookings')
      .update({ cod_settled: true, updated_at: new Date().toISOString() })
      .in('id', bookings.map(b => b.id));
    bookingsSettled = bookings.length;

    // 5. ✨ NEW: Auto-mark linked orders as paid
    //    Only flips unpaid → paid (preserves refunded/already-paid states)
    const orderIds = bookings.map(b => b.order_id).filter(Boolean);
    if (orderIds.length > 0) {
      const { data: updated } = await supabase
        .from('orders')
        .update({
          payment_status: 'paid',
          updated_at: new Date().toISOString(),
        })
        .in('id', orderIds)
        .eq('payment_status', 'unpaid')
        .select('id');
      ordersMarkedPaid = updated?.length || 0;
    }
  }

  return NextResponse.json({
    success: true,
    settled: ids.length,
    bookings_settled: bookingsSettled,
    orders_marked_paid: ordersMarkedPaid,
    message: `${ids.length} settlements disbursed, ${ordersMarkedPaid} orders marked paid`,
  });
}
