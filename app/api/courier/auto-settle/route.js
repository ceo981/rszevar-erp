import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  // Settlement summary per courier
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

  // Unsettled delivered bookings
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

export async function POST(request) {
  const { courier, amount, reference, date } = await request.json();

  // Mark a batch as disbursed (courier paid us)
  const { data: pending } = await supabase
    .from('settlements')
    .select('id, cod_amount')
    .eq('courier_name', courier)
    .eq('status', 'pending_disbursement');

  if (!pending || pending.length === 0) {
    return NextResponse.json({ success: false, error: 'No pending settlements found' });
  }

  // Mark all pending as disbursed
  const ids = pending.map(p => p.id);
  await supabase.from('settlements').update({
    status: 'disbursed',
    disbursed_at: date || new Date().toISOString(),
    disbursement_reference: reference || '',
    disbursement_amount: amount,
  }).in('id', ids);

  // Mark bookings as settled
  const { data: bookings } = await supabase
    .from('courier_bookings')
    .select('id')
    .eq('courier_name', courier)
    .eq('status', 'delivered')
    .eq('cod_settled', false);

  if (bookings?.length) {
    await supabase.from('courier_bookings')
      .update({ cod_settled: true })
      .in('id', bookings.map(b => b.id));
  }

  return NextResponse.json({ success: true, settled: ids.length });
}
