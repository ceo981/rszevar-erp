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
    const monthEnd   = `${month}-31`;

    // ── 1. THIS MONTH: New orders placed ─────────────────────
    const { data: monthOrders } = await supabase
      .from('orders')
      .select('total_amount, status, payment_status, dispatched_courier, shipping_fee')
      .gte('created_at', monthStart)
      .lte('created_at', monthEnd + 'T23:59:59');

    const mo = monthOrders || [];
    const totalOrdersMonth = mo.length;

    // ── 2. ALL-TIME: Paid + Dispatched totals ─────────────────
    // Paid orders (COD received) — all time
    const { data: paidOrders } = await supabase
      .from('orders')
      .select('total_amount, dispatched_courier')
      .eq('payment_status', 'paid');

    const cashCollected = (paidOrders || [])
      .reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

    // Dispatched (in-transit) orders — pending COD
    const { data: dispatchedOrders } = await supabase
      .from('orders')
      .select('total_amount, dispatched_courier')
      .eq('status', 'dispatched')
      .eq('payment_status', 'unpaid');

    const pendingRevenue = (dispatchedOrders || [])
      .reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

    // Delivered (but not yet paid) — awaiting settlement
    const { data: deliveredUnpaid } = await supabase
      .from('orders')
      .select('total_amount, dispatched_courier')
      .eq('status', 'delivered')
      .eq('payment_status', 'unpaid');

    const awaitingSettlement = (deliveredUnpaid || [])
      .reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

    // Total dispatched + delivered (all in courier's hands or done)
    const { count: totalDispatched } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'dispatched');

    const { count: totalDelivered } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'delivered');

    // ── 3. Courier breakdown (all-time paid orders) ───────────
    const couriers = ['PostEx', 'Leopards', 'Kangaroo'];
    const byCourier = {};
    for (const c of couriers) {
      const paid   = (paidOrders || []).filter(o => o.dispatched_courier === c);
      const disptd = (dispatchedOrders || []).filter(o => o.dispatched_courier === c);
      byCourier[c] = {
        orders: paid.length + disptd.length,
        delivered: paid.length,
        revenue: paid.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0),
      };
    }

    // ── 4. Settlements from courier_settlements table ─────────
    // This month's settlements
    const { data: csMonth } = await supabase
      .from('courier_settlements')
      .select('courier, net_amount, total_cod_collected, courier_charges, invoice_date, created_at')
      .or(`invoice_date.gte.${monthStart},created_at.gte.${monthStart}`)
      .or(`invoice_date.lte.${monthEnd},created_at.lte.${monthEnd + 'T23:59:59'}`);

    // All-time settlements per courier
    const { data: csAll } = await supabase
      .from('courier_settlements')
      .select('courier, net_amount, total_cod_collected, courier_charges');

    const settledThisMonth = (csMonth || [])
      .reduce((s, x) => s + parseFloat(x.net_amount || 0), 0);

    const settlementsByCourier = {};
    for (const c of couriers) {
      settlementsByCourier[c] = (csAll || [])
        .filter(s => s.courier === c)
        .reduce((s, x) => s + parseFloat(x.net_amount || 0), 0);
    }

    const totalSettledAllTime = (csAll || [])
      .reduce((s, x) => s + parseFloat(x.net_amount || 0), 0);

    // ── 5. THIS MONTH: Operations expenses ───────────────────
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

    // ── 6. THIS MONTH: Personal expenses ─────────────────────
    const { data: personalExp } = await supabase
      .from('personal_expenses')
      .select('amount, category')
      .gte('expense_date', monthStart)
      .lte('expense_date', monthEnd);

    const personalExpenses = (personalExp || [])
      .reduce((s, e) => s + parseFloat(e.amount || 0), 0);

    // ── 7. THIS MONTH: Salaries paid ─────────────────────────
    const { data: salaries } = await supabase
      .from('salary_records')
      .select('net_salary, paid_at, status')
      .eq('status', 'paid')
      .gte('paid_at', monthStart)
      .lte('paid_at', monthEnd + 'T23:59:59');

    const salariesPaid = (salaries || [])
      .reduce((s, r) => s + parseFloat(r.net_salary || 0), 0);

    // ── 8. Vendor outstanding (all time) ─────────────────────
    const { data: vendorPayments } = await supabase
      .from('vendor_payments')
      .select('amount, payment_type');

    const totalPurchased  = (vendorPayments || [])
      .filter(v => v.payment_type === 'purchase')
      .reduce((s, v) => s + parseFloat(v.amount || 0), 0);
    const totalVendorPaid = (vendorPayments || [])
      .filter(v => v.payment_type === 'payment')
      .reduce((s, v) => s + parseFloat(v.amount || 0), 0);
    const vendorOutstanding = totalPurchased - totalVendorPaid;

    // ── 9. Inventory value — PAGINATED (all variants) ────────
    let inventoryValue = 0;
    let invPage = 0;
    const invPageSize = 1000;
    while (true) {
      const { data: products } = await supabase
        .from('products')
        .select('current_stock, stock_quantity, selling_price, cost_price, is_active')
        .eq('is_active', true)
        .range(invPage * invPageSize, (invPage + 1) * invPageSize - 1);

      if (!products || products.length === 0) break;

      for (const p of products) {
        const qty   = parseFloat(p.current_stock || p.stock_quantity || 0);
        const price = parseFloat(p.selling_price || 0);
        inventoryValue += qty * price;
      }

      if (products.length < invPageSize) break;
      invPage++;
    }

    // ── 10. P&L (this month) ─────────────────────────────────
    const monthRevenue     = mo.filter(o => o.payment_status === 'paid')
                               .reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
    const totalExpensesAll = opsExpenses + personalExpenses + salariesPaid;
    const netPL            = monthRevenue - totalExpensesAll;

    return NextResponse.json({
      success: true,
      month,
      orders: {
        total_this_month: totalOrdersMonth,
        delivered: totalDelivered || 0,
        dispatched: totalDispatched || 0,
        cash_collected: cashCollected,
        pending_revenue: pendingRevenue,
        awaiting_settlement: awaitingSettlement,
        by_courier: byCourier,
      },
      settlements: {
        received_this_month: settledThisMonth,
        total_all_time: totalSettledAllTime,
        by_courier: settlementsByCourier,
      },
      expenses: {
        operations: opsExpenses,
        personal:   personalExpenses,
        salaries:   salariesPaid,
        advances:   advancesGiven,
        total:      totalExpensesAll,
        by_category: expByCategory,
      },
      vendors: {
        outstanding:     vendorOutstanding,
        total_purchased: totalPurchased,
        total_paid:      totalVendorPaid,
      },
      inventory: {
        value: inventoryValue,
      },
      pl: {
        revenue:        monthRevenue,
        total_expenses: totalExpensesAll,
        net:            netPL,
        margin: monthRevenue > 0 ? ((netPL / monthRevenue) * 100).toFixed(1) : 0,
      },
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
