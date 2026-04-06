import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') || '30'; // days

  const fromDate = new Date(Date.now() - parseInt(range) * 24 * 60 * 60 * 1000).toISOString();

  try {
    // All orders in range
    const { data: orders } = await supabase
      .from('orders')
      .select('id, status, total_amount, customer_city, created_at, dispatched_courier, order_items')
      .gte('created_at', fromDate)
      .order('created_at', { ascending: true });

    const all = orders || [];

    // ── Revenue by day ──────────────────────────────────────
    const byDay = {};
    for (const o of all) {
      const day = o.created_at?.split('T')[0];
      if (!day) continue;
      if (!byDay[day]) byDay[day] = { date: day, orders: 0, revenue: 0, delivered: 0, rto: 0 };
      byDay[day].orders++;
      byDay[day].revenue += parseFloat(o.total_amount || 0);
      if (o.status === 'delivered') byDay[day].delivered++;
      if (o.status === 'rto' || o.status === 'returned') byDay[day].rto++;
    }
    const dailyData = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

    // ── City breakdown ───────────────────────────────────────
    const byCity = {};
    for (const o of all) {
      const city = (o.customer_city || 'Unknown').trim();
      if (!byCity[city]) byCity[city] = { city, orders: 0, revenue: 0, delivered: 0, rto: 0 };
      byCity[city].orders++;
      byCity[city].revenue += parseFloat(o.total_amount || 0);
      if (o.status === 'delivered') byCity[city].delivered++;
      if (o.status === 'rto' || o.status === 'returned') byCity[city].rto++;
    }
    const cityData = Object.values(byCity)
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 15);

    // ── Top products ─────────────────────────────────────────
    const byProduct = {};
    for (const o of all) {
      const items = o.order_items || [];
      for (const item of items) {
        const key = item.title || item.name || 'Unknown';
        if (!byProduct[key]) byProduct[key] = { title: key, qty: 0, revenue: 0 };
        byProduct[key].qty += item.quantity || 1;
        byProduct[key].revenue += parseFloat(item.total_price || item.price || 0);
      }
    }
    const topProducts = Object.values(byProduct)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    // ── Courier breakdown ────────────────────────────────────
    const byCourier = {};
    for (const o of all) {
      const c = o.dispatched_courier || 'Unassigned';
      if (!byCourier[c]) byCourier[c] = { courier: c, orders: 0, delivered: 0, rto: 0 };
      byCourier[c].orders++;
      if (o.status === 'delivered') byCourier[c].delivered++;
      if (o.status === 'rto' || o.status === 'returned') byCourier[c].rto++;
    }

    // ── Summary stats ────────────────────────────────────────
    const delivered = all.filter(o => o.status === 'delivered');
    const rto = all.filter(o => o.status === 'rto' || o.status === 'returned');
    const totalRevenue = all.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
    const deliveredRevenue = delivered.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

    const summary = {
      total_orders: all.length,
      total_revenue: totalRevenue,
      delivered_count: delivered.length,
      delivered_revenue: deliveredRevenue,
      rto_count: rto.length,
      rto_rate: all.length ? ((rto.length / all.length) * 100).toFixed(1) : 0,
      delivery_rate: all.length ? ((delivered.length / all.length) * 100).toFixed(1) : 0,
      avg_order_value: all.length ? (totalRevenue / all.length).toFixed(0) : 0,
      pending_count: all.filter(o => o.status === 'pending').length,
      cancelled_count: all.filter(o => o.status === 'cancelled').length,
    };

    return NextResponse.json({
      success: true,
      summary,
      daily: dailyData,
      cities: cityData,
      top_products: topProducts,
      couriers: Object.values(byCourier),
    });

  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
