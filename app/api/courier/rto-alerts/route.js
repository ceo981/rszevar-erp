import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  // RTOs from last 7 days that haven't been acknowledged
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rtoList } = await supabase
    .from('courier_bookings')
    .select('id, tracking_number, courier_name, customer_name, customer_phone, city, cod_amount, courier_status_raw, updated_at, rto_acknowledged')
    .eq('status', 'rto')
    .gte('updated_at', sevenDaysAgo)
    .order('updated_at', { ascending: false });

  const unacknowledged = (rtoList || []).filter(r => !r.rto_acknowledged);
  const acknowledged = (rtoList || []).filter(r => r.rto_acknowledged);

  // COD at risk (in transit bookings older than 10 days)
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const { data: stale } = await supabase
    .from('courier_bookings')
    .select('id, tracking_number, courier_name, customer_name, city, cod_amount, last_tracked_at')
    .in('status', ['booked', 'in_transit'])
    .lte('last_tracked_at', tenDaysAgo);

  return NextResponse.json({
    unacknowledged_rto: unacknowledged,
    acknowledged_rto: acknowledged,
    stale_shipments: stale || [],
    rto_count: unacknowledged.length,
    stale_count: (stale || []).length,
    cod_at_risk: (stale || []).reduce((s, r) => s + parseFloat(r.cod_amount || 0), 0),
  });
}

export async function POST(request) {
  const { id, action } = await request.json();

  if (action === 'acknowledge') {
    await supabase.from('courier_bookings').update({ rto_acknowledged: true }).eq('id', id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' });
}
