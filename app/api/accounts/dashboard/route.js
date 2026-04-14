import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-31`;

    // ── 1. Orders this month ──────────────────────────────────
    const { data: orders } = await supabase
      .from('orders')
      .select('total_price, status, payment_status, courier_name, created_at, shipping_fee')
      .gte('created_at', monthStart)
      .lte('created_at', monthEnd + 'T23:59:59');

    const allOrders = orders || [];
    const totalOrders = allOrders.length;
    const deliveredOrders = allOrders.filter(o => o.status === 'delivered');
    const dispatchedOrders = allOrders.filter(o => o.status === 'dispatched');
    const revenue = deliveredOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
    const pendingRevenue = dispatchedOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
    const paidOrders = allOrders.filter(o => o.payment_status === 'paid');
    const totalPaid = paidOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
    const deliveryCharges = allOrders.reduce((s, o) => s + parseFloat(o.shipping_fee || 0), 0);

    // ── 2. Courier breakdown ──────────────────────────────────
    const couriers = ['PostEx', 'Leopards', 'Kangaroo'];
    const byCourier = {};
    for (const c of couriers) {
      const co = allOrders.filter(o => o.courier_name === c);
      byCourier[c] = {
        orders: co.length,
        delivered: co.filter(o => o.status === 'delivered').length,
        revenue: co.filter(o => o.status === 'delivered').reduce((s, o) => s + parseFloat(o.total_price || 0), 0),
      };
    }

    // ── 3. Settlements received this month ───────────────────
    const { data: settlements } = await supabase
      .from('settlements')
      .select('amount, courier_name, settled_at, status')
      .gte('settled_at', monthStart)
      .lte('settled_at', monthEnd);

    const settledThisMonth = (settlements || [])
      .filter(s => s.status === 'settled')
      .reduce((s, x) => s + parseFloat(x.amount || 0), 0);

    const settlementsByCourier = {};
    for (const c of couriers) {
      settlementsByCourier[c] = (settlements || [])
        .filter(s => s.courier_name === c && s.status === 'settled')
        .reduce((s, x) => s + parseFloat(x.amount || 0), 0);
    }

    // ── 4. Operations expenses this month ────────────────────
    const { data: opsLogs } = await supabase
      .from('operations_cash_log')
      .select('amount, type, category, status, date')
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .eq('status', 'approved');

    const opsExpenses = (opsLogs || [])
      .filter(l => l.type === 'expense')
      .reduce((s, l) => s + parseFloat(l.amount || 0), 0);

    const advancesGiven = (opsLogs || [])
      .filter(l => l.type === 'advance')
      .reduce((s, l) => s + parseFloat(l.amount || 0), 0);

    const expByCategory = {};
    (opsLogs || []).filter(l => l.type === 'expense').forEach(l => {
      expByCategory[l.category || 'Other'] = (expByCategory[l.category || 'Other'] || 0) + parseFloat(l.amount || 0);
    });

    // ── 5. Personal expenses this month ──────────────────────
    const { data: personalExp } = await supabase
      .from('personal_expenses')
      .select('amount, category')
      .gte('expense_date', monthStart)
      .lte('expense_date', monthEnd);

    const personalExpenses = (personalExp || []).reduce((s, e) => s + parseFloat(e.amount || 0), 0);

    // ── 6. Salaries paid this month ──────────────────────────
    const { data: salaries } = await supabase
      .from('salary_records')
      .select('net_salary, paid_at, status')
      .eq('status', 'paid')
      .gte('paid_at', monthStart)
      .lte('paid_at', monthEnd + 'T23:59:59');

    const salariesPaid = (salaries || []).reduce((s, r) => s + parseFloat(r.net_salary || 0), 0);

    // ── 7. Vendor outstanding (all time) ─────────────────────
    const { data: vendorPayments } = await supabase
      .from('vendor_payments')
      .select('amount, payment_type');

    const totalPurchased = (vendorPayments || [])
      .filter(v => v.payment_type === 'purchase')
      .reduce((s, v) => s + parseFloat(v.amount || 0), 0);

    const totalVendorPaid = (vendorPayments || [])
      .filter(v => v.payment_type === 'payment')
      .reduce((s, v) => s + parseFloat(v.amount || 0), 0);

    const vendorOutstanding = totalPurchased - totalVendorPaid;

    // ── 8. Inventory value (from products table) ─────────────
    const { data: products } = await supabase
      .from('products')
      .select('stock_quantity, selling_price');

    const inventoryValue = (products || [])
      .reduce((s, p) => s + (parseFloat(p.stock_quantity || 0) * parseFloat(p.selling_price || 0)), 0);

    // ── 9. P&L ───────────────────────────────────────────────
    const totalExpensesAll = opsExpenses + personalExpenses + salariesPaid;
    const netPL = revenue - totalExpensesAll;

    return NextResponse.json({
      success: true,
      month,
      orders: {
        total: totalOrders,
        delivered: deliveredOrders.length,
        dispatched: dispatchedOrders.length,
        revenue,
        pending_revenue: pendingRevenue,
        total_paid: totalPaid,
        by_courier: byCourier,
        delivery_charges: deliveryCharges,
      },
      settlements: {
        received_this_month: settledThisMonth,
        by_courier: settlementsByCourier,
      },
      expenses: {
        operations: opsExpenses,
        personal: personalExpenses,
        salaries: salariesPaid,
        advances: advancesGiven,
        total: totalExpensesAll,
        by_category: expByCategory,
      },
      vendors: {
        outstanding: vendorOutstanding,
        total_purchased: totalPurchased,
        total_paid: totalVendorPaid,
      },
      inventory: {
        value: inventoryValue,
      },
      pl: {
        revenue,
        total_expenses: totalExpensesAll,
        net: netPL,
        margin: revenue > 0 ? ((netPL / revenue) * 100).toFixed(1) : 0,
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
