import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  try {
    const { data: bookings } = await supabase
      .from('courier_bookings')
      .select('courier_name, status, cod_amount, created_at');

    const couriers = ['PostEx', 'Kangaroo', 'Leopards'];
    const byCourier = {};

    for (const c of couriers) {
      const cb = (bookings || []).filter(b => b.courier_name === c);
      byCourier[c] = {
        total: cb.length,
        booked: cb.filter(b => b.status === 'booked').length,
        in_transit: cb.filter(b => b.status === 'in_transit').length,
        delivered: cb.filter(b => b.status === 'delivered').length,
        rto: cb.filter(b => b.status === 'rto').length,
        cod_total: cb.reduce((s, b) => s + parseFloat(b.cod_amount || 0), 0),
      };
    }

    const all = bookings || [];
    const summary = {
      total_bookings: all.length,
      in_transit: all.filter(b => b.status === 'in_transit').length,
      delivered: all.filter(b => b.status === 'delivered').length,
      rto: all.filter(b => b.status === 'rto').length,
      booked_today: all.filter(b => b.created_at?.startsWith(new Date().toISOString().split('T')[0])).length,
      rto_rate: all.length ? Math.round((all.filter(b => b.status === 'rto').length / all.length) * 100) : 0,
    };

    return NextResponse.json({ success: true, summary, by_courier: byCourier });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
