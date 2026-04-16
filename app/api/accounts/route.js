import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  try {
    // COD orders total
    const { data: codOrders } = await supabase
      .from('orders')
      .select('total_amount, payment_status, dispatched_courier')
      .eq('payment_method', 'COD');

    const totalCOD = codOrders?.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0) || 0;

    // Settlements summary
    const { data: settlements } = await supabase
      .from('settlements')
      .select('amount, status, courier_name, settled_at');

    const totalSettled = settlements
      ?.filter(s => s.status === 'settled')
      .reduce((sum, s) => sum + parseFloat(s.amount || 0), 0) || 0;

    const pendingSettlement = totalCOD - totalSettled;

    // By courier
    const couriers = ['PostEx', 'Kangaroo', 'Leopards'];
    const byCourier = {};
    for (const courier of couriers) {
      const courierOrders = codOrders?.filter(o => o.dispatched_courier === courier) || [];
      const courierSettled = settlements
        ?.filter(s => s.courier_name === courier && s.status === 'settled')
        .reduce((sum, s) => sum + parseFloat(s.amount || 0), 0) || 0;
      const courierTotal = courierOrders.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
      byCourier[courier] = {
        total: courierTotal,
        settled: courierSettled,
        pending: courierTotal - courierSettled,
        orders: courierOrders.length,
      };
    }

    // Expenses
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount, category, expense_date');

    const totalExpenses = expenses?.reduce((s, e) => s + parseFloat(e.amount || 0), 0) || 0;

    // This month's expenses
    const thisMonth = new Date();
    const monthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1).toISOString();
    const monthExpenses = expenses
      ?.filter(e => e.expense_date >= monthStart)
      .reduce((s, e) => s + parseFloat(e.amount || 0), 0) || 0;

    // Vendor outstanding
    const { data: vendors } = await supabase
      .from('vendor_payments')
      .select('amount, payment_type');

    const vendorPurchases = vendors?.filter(v => v.payment_type === 'purchase')
      .reduce((s, v) => s + parseFloat(v.amount || 0), 0) || 0;
    const vendorPaid = vendors?.filter(v => v.payment_type === 'payment')
      .reduce((s, v) => s + parseFloat(v.amount || 0), 0) || 0;
    const vendorOutstanding = vendorPurchases - vendorPaid;

    return NextResponse.json({
      success: true,
      summary: {
        total_cod: totalCOD,
        total_settled: totalSettled,
        pending_settlement: pendingSettlement,
        total_expenses: totalExpenses,
        month_expenses: monthExpenses,
        vendor_outstanding: vendorOutstanding,
        net_received: totalSettled - totalExpenses,
      },
      by_courier: byCourier,
    });
  } catch (error) {
    console.error('Accounts summary error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
