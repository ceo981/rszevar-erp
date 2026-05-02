// ============================================================================
// RS ZEVAR ERP — Customer Credits — Single Customer Khaata
// GET /api/credits/[phone]
// May 2 2026 · Step 3 of 6 · File 2 of 5
// ----------------------------------------------------------------------------
// PURPOSE:
//   Returns full khaata for ONE customer (identified by phone).
//   Powers the per-customer detail page /credits/[phone].
//
// LOGIC:
//   1. Fetch all orders matching customer_phone (any status)
//   2. Split into "credit-relevant" (active, unpaid/partial) vs "history" (paid/cancelled)
//   3. Fetch all payments for this phone (with allocations)
//   4. Compute summary: outstanding, total billed, total received
//
// RESPONSE:
//   {
//     success: true,
//     customer: { phone, name, first_seen },
//     summary: { outstanding, total_billed, total_received },
//     orders: [
//       { id, order_number, total_amount, paid_amount, balance, status, payment_status,
//         created_at, items_count, items_summary }
//     ],
//     payments: [
//       { id, amount, paid_at, method, receipt_url, note, allocated_total,
//         unallocated, voided_at, allocations: [{ order_id, order_number, amount }] }
//     ]
//   }
//
// PHONE NORMALIZATION:
//   Pakistan numbers can be '03001234567', '+923001234567', '923001234567'.
//   We match on the raw stored value (no normalization here — UI passes
//   exact phone from the dashboard list, which already groups by stored value).
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request, { params }) {
  try {
    const { phone: phoneEncoded } = await params;
    const phone = decodeURIComponent(phoneEncoded || '').trim();

    if (!phone) {
      return NextResponse.json(
        { success: false, error: 'Phone parameter required' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    // ── 1. Fetch ALL orders for this customer (chunked) ──
    // Include paid orders too — needed for total_billed + total_received calc.
    const allOrders = [];
    const PAGE = 1000;
    let off = 0;
    while (off < 5000) {
      const { data: chunk, error } = await supabase
        .from('orders')
        .select('id, order_number, customer_name, customer_phone, total_amount, paid_amount, payment_status, status, tags, created_at, confirmed_at')
        .eq('customer_phone', phone)
        .order('created_at', { ascending: false })
        .range(off, off + PAGE - 1);

      if (error) throw error;
      if (!chunk || chunk.length === 0) break;
      allOrders.push(...chunk);
      if (chunk.length < PAGE) break;
      off += PAGE;
    }

    if (allOrders.length === 0) {
      return NextResponse.json({
        success: true,
        customer: { phone, name: '', first_seen: null },
        summary: { outstanding: 0, total_billed: 0, total_received: 0 },
        orders: [],
        payments: [],
      });
    }

    // ── 2. Fetch order items for items_summary ──
    const orderIds = allOrders.map(o => o.id);
    const { data: items } = await supabase
      .from('order_items')
      .select('order_id, title, quantity')
      .in('order_id', orderIds);

    const itemsByOrder = new Map();
    for (const it of items || []) {
      if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
      itemsByOrder.get(it.order_id).push(it);
    }

    // ── 3. Fetch all payments for this phone ──
    const { data: payments, error: payErr } = await supabase
      .from('customer_payments')
      .select('id, amount, paid_at, method, receipt_url, note, allocated_total, unallocated, voided_at, voided_reason, created_by_name, created_at')
      .eq('customer_phone', phone)
      .order('paid_at', { ascending: false });

    if (payErr) throw payErr;

    // ── 4. Fetch allocations for these payments ──
    const paymentIds = (payments || []).map(p => p.id);
    let allocations = [];
    if (paymentIds.length > 0) {
      const { data: allocs } = await supabase
        .from('payment_allocations')
        .select('id, payment_id, order_id, amount, allocation_type, created_at')
        .in('payment_id', paymentIds);
      allocations = allocs || [];
    }

    // Build map: payment_id → [allocations]
    const allocsByPayment = new Map();
    const orderNumByOrderId = new Map(allOrders.map(o => [o.id, o.order_number]));
    for (const a of allocations) {
      if (!allocsByPayment.has(a.payment_id)) allocsByPayment.set(a.payment_id, []);
      allocsByPayment.get(a.payment_id).push({
        order_id: a.order_id,
        order_number: orderNumByOrderId.get(a.order_id) || a.order_id,
        amount: a.amount,
      });
    }

    // ── 5. Build response payloads ──
    const ordersOut = allOrders.map(o => {
      const orderItems = itemsByOrder.get(o.id) || [];
      const totalQty = orderItems.reduce((s, it) => s + (it.quantity || 0), 0);
      const itemsSummary = orderItems.length === 0
        ? '—'
        : orderItems.length <= 2
          ? orderItems.map(it => it.title).join(', ')
          : `${orderItems[0].title} + ${orderItems.length - 1} more`;

      return {
        id: o.id,
        order_number: o.order_number,
        total_amount: o.total_amount || 0,
        paid_amount: o.paid_amount || 0,
        balance: Math.max(0, (o.total_amount || 0) - (o.paid_amount || 0)),
        status: o.status,
        payment_status: o.payment_status,
        tags: o.tags,
        items_count: totalQty,
        items_summary: itemsSummary,
        created_at: o.created_at,
        confirmed_at: o.confirmed_at,
      };
    });

    const paymentsOut = (payments || []).map(p => ({
      id: p.id,
      amount: p.amount,
      paid_at: p.paid_at,
      method: p.method,
      receipt_url: p.receipt_url,
      note: p.note,
      allocated_total: p.allocated_total || 0,
      unallocated: p.unallocated || 0,
      voided_at: p.voided_at,
      voided_reason: p.voided_reason,
      created_by_name: p.created_by_name,
      created_at: p.created_at,
      allocations: allocsByPayment.get(p.id) || [],
    }));

    // ── 6. Summary ──
    // total_billed = sum of all order totals (including cancelled? No — exclude cancelled)
    const billableOrders = allOrders.filter(o => o.status !== 'cancelled');
    const totalBilled = billableOrders.reduce((s, o) => s + (o.total_amount || 0), 0);

    // total_received = sum of all NON-VOIDED payments
    const totalReceived = (payments || [])
      .filter(p => !p.voided_at)
      .reduce((s, p) => s + (p.amount || 0), 0);

    // outstanding = sum of (total - paid_amount) for unpaid/partial active orders
    const ACTIVE_STATUSES = ['pending', 'confirmed', 'on_packing', 'packed', 'dispatched', 'attempted', 'hold', 'delivered'];
    const outstanding = allOrders
      .filter(o => ACTIVE_STATUSES.includes(o.status) && ['unpaid', 'partial'].includes(o.payment_status))
      .reduce((s, o) => s + Math.max(0, (o.total_amount || 0) - (o.paid_amount || 0)), 0);

    // Customer name + first_seen (oldest order date)
    const customerName = allOrders.find(o => o.customer_name)?.customer_name || '';
    const firstSeen = allOrders.length > 0
      ? allOrders[allOrders.length - 1].created_at  // sorted desc, last = oldest
      : null;

    return NextResponse.json({
      success: true,
      customer: { phone, name: customerName, first_seen: firstSeen },
      summary: {
        outstanding: Math.round(outstanding * 100) / 100,
        total_billed: Math.round(totalBilled * 100) / 100,
        total_received: Math.round(totalReceived * 100) / 100,
      },
      orders: ordersOut,
      payments: paymentsOut,
    });
  } catch (e) {
    console.error('[GET /api/credits/[phone]] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
