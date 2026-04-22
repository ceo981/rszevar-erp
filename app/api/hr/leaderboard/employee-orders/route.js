// RS ZEVAR ERP — Leaderboard drill-down: per-employee order list
// GET /api/hr/leaderboard/employee-orders?employee_id=X&month=YYYY-MM
//
// Returns list of orders that a given employee packed in the given month,
// along with ZEVAR-XXXXXX order_number, customer name, status, and amount.
// Super_admin only (ye CEO ke liye hai — amount + order details dono sensitive)

import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { getCurrentUser } from '../../../../../lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  // ── Auth check — super_admin only ──
  const user = await getCurrentUser();
  if (!user || user.profile?.role !== 'super_admin') {
    return NextResponse.json(
      { success: false, error: 'Only super admin can view employee order details' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const employee_id = searchParams.get('employee_id');
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);

  if (!employee_id) {
    return NextResponse.json(
      { success: false, error: 'employee_id required' },
      { status: 400 }
    );
  }

  // ── Date range (same logic as main leaderboard route) ──
  const start = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;

  const supabase = createServerClient();

  // ── 1. Packing log entries for this employee + month ──
  const { data: logs, error: logErr } = await supabase
    .from('packing_log')
    .select('order_id, items_packed, items_amount, completed_at, notes')
    .eq('employee_id', employee_id)
    .gte('completed_at', start)
    .lte('completed_at', end + 'T23:59:59')
    .order('completed_at', { ascending: false });

  if (logErr) {
    return NextResponse.json({ success: false, error: logErr.message }, { status: 500 });
  }

  // ── 2. Fetch order details (ZEVAR-XXXXXX name, customer, status) ──
  const orderIds = [...new Set((logs || []).map(l => l.order_id).filter(Boolean))];
  const orderMap = {};

  if (orderIds.length > 0) {
    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, status, payment_status, total_amount')
      .in('id', orderIds);

    for (const o of orders || []) orderMap[o.id] = o;
  }

  // ── 3. Fetch employee name (for header) ──
  const { data: emp } = await supabase
    .from('employees')
    .select('id, name, role')
    .eq('id', employee_id)
    .maybeSingle();

  // ── 4. Merge log + order data ──
  const orders = (logs || []).map(log => {
    const ord = orderMap[log.order_id] || {};
    return {
      order_id: log.order_id,
      order_number: ord.order_number || `#${log.order_id}`,
      customer_name: ord.customer_name || '—',
      status: ord.status || null,
      payment_status: ord.payment_status || null,
      order_total: parseFloat(ord.total_amount) || 0,
      items_packed: log.items_packed,
      items_amount: parseFloat(log.items_amount) || 0,
      completed_at: log.completed_at,
      notes: log.notes,
      // Flag: shared (team packing) vs solo
      is_shared: (log.notes || '').includes('Packing Team'),
    };
  });

  // ── 5. Aggregate totals ──
  const totals = orders.reduce(
    (acc, o) => {
      acc.total_orders += 1;
      acc.total_items += o.items_packed || 0;
      acc.total_amount += o.items_amount || 0;
      return acc;
    },
    { total_orders: 0, total_items: 0, total_amount: 0 }
  );

  totals.total_amount = Math.round(totals.total_amount * 100) / 100;

  return NextResponse.json({
    success: true,
    employee: emp || { id: Number(employee_id), name: 'Unknown', role: '' },
    month,
    orders,
    totals,
  });
}
