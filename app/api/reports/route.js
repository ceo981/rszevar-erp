import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'daily'; // daily | weekly | monthly
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

  let fromDate, toDate, label;
  const d = new Date(date);

  if (type === 'daily') {
    fromDate = date;
    toDate = date;
    label = `Daily Report — ${date}`;
  } else if (type === 'weekly') {
    const day = d.getDay();
    const mon = new Date(d); mon.setDate(d.getDate() - day + 1);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    fromDate = mon.toISOString().split('T')[0];
    toDate = sun.toISOString().split('T')[0];
    label = `Weekly Report — ${fromDate} to ${toDate}`;
  } else {
    fromDate = `${date.slice(0, 7)}-01`;
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    toDate = lastDay.toISOString().split('T')[0];
    label = `Monthly Report — ${date.slice(0, 7)}`;
  }

  const fromISO = fromDate + 'T00:00:00.000Z';
  const toISO = toDate + 'T23:59:59.999Z';

  // Orders
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
    .order('created_at', { ascending: false });

  const all = orders || [];
  const delivered = all.filter(o => o.status === 'delivered');
  const rto = all.filter(o => o.status === 'rto' || o.status === 'returned');
  const pending = all.filter(o => o.status === 'pending');
  const dispatched = all.filter(o => o.status === 'dispatched');
  const cancelled = all.filter(o => o.status === 'cancelled');

  const totalCOD = all.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
  const deliveredCOD = delivered.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
  const rtoCOD = rto.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

  // City breakdown
  const byCity = {};
  for (const o of all) {
    const city = o.customer_city || 'Unknown';
    if (!byCity[city]) byCity[city] = { city, orders: 0, cod: 0 };
    byCity[city].orders++;
    byCity[city].cod += parseFloat(o.total_amount || 0);
  }
  const cityBreakdown = Object.values(byCity).sort((a, b) => b.orders - a.orders).slice(0, 10);

  // Courier breakdown
  const byCourier = {};
  for (const o of all) {
    const c = o.dispatched_courier || 'Unassigned';
    if (!byCourier[c]) byCourier[c] = { courier: c, orders: 0, delivered: 0, rto: 0 };
    byCourier[c].orders++;
    if (o.status === 'delivered') byCourier[c].delivered++;
    if (o.status === 'rto' || o.status === 'returned') byCourier[c].rto++;
  }

  // Complaints in range
  const { data: complaints } = await supabase
    .from('complaints')
    .select('category, status')
    .gte('created_at', fromISO)
    .lte('created_at', toISO);

  return NextResponse.json({
    success: true,
    label,
    type,
    fromDate,
    toDate,
    generated_at: new Date().toISOString(),
    summary: {
      total_orders: all.length,
      total_cod: totalCOD,
      delivered: delivered.length,
      delivered_cod: deliveredCOD,
      rto: rto.length,
      rto_cod: rtoCOD,
      pending: pending.length,
      dispatched: dispatched.length,
      cancelled: cancelled.length,
      delivery_rate: all.length ? ((delivered.length / all.length) * 100).toFixed(1) : 0,
      rto_rate: all.length ? ((rto.length / all.length) * 100).toFixed(1) : 0,
      avg_order: all.length ? (totalCOD / all.length).toFixed(0) : 0,
      complaints: (complaints || []).length,
    },
    orders: all,
    city_breakdown: cityBreakdown,
    courier_breakdown: Object.values(byCourier),
    complaints: complaints || [],
  });
}
