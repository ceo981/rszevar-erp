// ============================================================================
// RS ZEVAR ERP — Customer Credits — Record Payment + Auto-Allocate
// POST /api/credits/payment
// May 2 2026 · Step 3 of 6 · File 3 of 5
// ----------------------------------------------------------------------------
// PURPOSE:
//   Records a payment received from a credit customer and allocates it to
//   their unpaid/partial orders. FIFO (oldest first) by default, manual
//   override supported.
//
// REQUEST BODY:
//   {
//     customer_phone: "03001234567"  (required)
//     customer_name: "Saima Wholesale"  (snapshot)
//     amount: 13700  (required, > 0)
//     paid_at: "2026-05-01T14:43:00Z"  (optional, defaults to now)
//     method: "JazzCash"  (optional)
//     receipt_url: "https://..."  (optional, from upload-receipt endpoint)
//     note: "JazzCash transfer — confirmed via call"  (optional)
//
//     // Allocation strategy:
//     allocation_mode: "fifo" | "manual"  (default: "fifo")
//     manual_allocations: [  (only used if mode === "manual")
//       { order_id: "uuid", amount: 8700 },
//       { order_id: "uuid", amount: 5000 }
//     ]
//
//     created_by: "uuid"  (optional, from auth context)
//     created_by_name: "Abdul Rehman"  (snapshot)
//   }
//
// LOGIC:
//   1. Validate input
//   2. INSERT customer_payments row
//   3. If mode === "fifo":
//      - Fetch unpaid+partial orders for this phone, ORDER BY created_at ASC
//      - Iterate, allocating remaining amount until exhausted
//   4. If mode === "manual":
//      - Validate sum of manual_allocations.amount === total amount
//      - Validate each order belongs to this customer
//      - Validate each allocation doesn't exceed order's outstanding balance
//   5. INSERT payment_allocations rows (DB trigger auto-updates orders.paid_amount + payment_status)
//   6. Return: payment + allocations + updated_orders
//
// RESPONSE:
//   {
//     success: true,
//     payment: { id, amount, allocated_total, unallocated, ... },
//     allocations: [{ order_id, order_number, amount }],
//     orders_now_paid: [{ id, order_number }],     // orders that just flipped to paid
//     orders_now_partial: [{ id, order_number, balance }],
//     unallocated_amount: 0  // excess amount that couldn't be allocated
//   }
//
// EDGE CASES:
//   - Payment amount > total outstanding → excess saved as `unallocated`,
//     used later automatically when new orders come (or kept for refund)
//   - No unpaid orders → payment recorded but unallocated = full amount
//   - Manual allocation total !== amount → error (must match exactly)
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ACTIVE_STATUSES = [
  'pending', 'confirmed', 'on_packing', 'packed',
  'dispatched', 'attempted', 'hold', 'delivered',
];

export async function POST(request) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    // ── 1. Validate input ──
    const phone = (body.customer_phone || '').trim();
    const amount = parseFloat(body.amount);
    const mode = body.allocation_mode || 'fifo';

    if (!phone) {
      return NextResponse.json({ success: false, error: 'customer_phone required' }, { status: 400 });
    }
    if (!amount || amount <= 0 || isNaN(amount)) {
      return NextResponse.json({ success: false, error: 'amount must be > 0' }, { status: 400 });
    }
    if (!['fifo', 'manual'].includes(mode)) {
      return NextResponse.json({ success: false, error: 'allocation_mode must be fifo or manual' }, { status: 400 });
    }

    // ── 2. Fetch customer's unpaid+partial CREDIT orders ──
    // FILTER: is_credit_order = true — payments only allocate to udhaar orders.
    // Regular COD orders (pending courier settlement) MUST NOT be allocated
    // accidentally — those get marked paid via Leopards/PostEx settlement
    // sync, not via this manual payment flow.
    const { data: openOrders, error: ordersErr } = await supabase
      .from('orders')
      .select('id, order_number, total_amount, paid_amount, payment_status, status, created_at')
      .eq('customer_phone', phone)
      .eq('is_credit_order', true)
      .in('payment_status', ['unpaid', 'partial'])
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: true });  // FIFO order

    if (ordersErr) throw ordersErr;
    const orders = openOrders || [];

    // ── 3. Compute allocations BEFORE inserting payment ──
    // (so we can validate manual mode and detect over-allocation upfront)
    let allocationsToInsert = [];
    let unallocatedAmount = 0;

    if (mode === 'manual') {
      const manualAllocs = Array.isArray(body.manual_allocations) ? body.manual_allocations : [];
      if (manualAllocs.length === 0) {
        return NextResponse.json(
          { success: false, error: 'manual_allocations required when mode=manual' },
          { status: 400 },
        );
      }

      // Validate sum
      const sumManual = manualAllocs.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
      if (Math.abs(sumManual - amount) > 0.01) {
        return NextResponse.json(
          { success: false, error: `Manual allocations sum (${sumManual}) must equal payment amount (${amount})` },
          { status: 400 },
        );
      }

      const orderById = new Map(orders.map(o => [o.id, o]));
      for (const ma of manualAllocs) {
        const allocAmount = parseFloat(ma.amount);
        if (!ma.order_id || !allocAmount || allocAmount <= 0) {
          return NextResponse.json(
            { success: false, error: 'Each manual allocation needs valid order_id + amount' },
            { status: 400 },
          );
        }
        const ord = orderById.get(ma.order_id);
        if (!ord) {
          return NextResponse.json(
            { success: false, error: `Order ${ma.order_id} doesn't belong to ${phone} or isn't open` },
            { status: 400 },
          );
        }
        const balance = (ord.total_amount || 0) - (ord.paid_amount || 0);
        if (allocAmount > balance + 0.01) {
          return NextResponse.json(
            { success: false, error: `Allocation Rs ${allocAmount} exceeds order ${ord.order_number} balance Rs ${balance.toFixed(2)}` },
            { status: 400 },
          );
        }
        allocationsToInsert.push({
          order_id: ord.id,
          amount: allocAmount,
          allocation_type: 'manual',
        });
      }
    } else {
      // FIFO mode — iterate oldest first, allocate remaining amount
      let remaining = amount;
      for (const ord of orders) {
        if (remaining <= 0.01) break;
        const balance = (ord.total_amount || 0) - (ord.paid_amount || 0);
        if (balance <= 0.01) continue;  // already paid (shouldn't happen but safety)

        const allocAmount = Math.min(remaining, balance);
        allocationsToInsert.push({
          order_id: ord.id,
          amount: Math.round(allocAmount * 100) / 100,
          allocation_type: 'fifo',
        });
        remaining -= allocAmount;
      }
      unallocatedAmount = Math.round(remaining * 100) / 100;
    }

    // ── 4. INSERT customer_payments row ──
    const { data: payment, error: payErr } = await supabase
      .from('customer_payments')
      .insert({
        customer_phone: phone,
        customer_name: body.customer_name || null,
        amount,
        paid_at: body.paid_at || new Date().toISOString(),
        method: body.method || null,
        receipt_url: body.receipt_url || null,
        note: body.note || null,
        created_by: body.created_by || null,
        created_by_name: body.created_by_name || null,
      })
      .select('*')
      .single();

    if (payErr) throw payErr;

    // ── 5. INSERT allocations (DB trigger updates orders.paid_amount + payment_status) ──
    let insertedAllocations = [];
    if (allocationsToInsert.length > 0) {
      const allocRows = allocationsToInsert.map(a => ({
        payment_id: payment.id,
        order_id: a.order_id,
        amount: a.amount,
        allocation_type: a.allocation_type,
      }));

      const { data: allocs, error: allocErr } = await supabase
        .from('payment_allocations')
        .insert(allocRows)
        .select('*');

      if (allocErr) {
        // Allocation failed — rollback payment to keep DB consistent
        await supabase.from('customer_payments').delete().eq('id', payment.id);
        throw new Error(`Allocation failed (payment rolled back): ${allocErr.message}`);
      }
      insertedAllocations = allocs || [];
    }

    // ── 6. Fetch updated orders to know which flipped status ──
    const allocatedOrderIds = insertedAllocations.map(a => a.order_id);
    let ordersNowPaid = [];
    let ordersNowPartial = [];

    if (allocatedOrderIds.length > 0) {
      const { data: updatedOrders } = await supabase
        .from('orders')
        .select('id, order_number, total_amount, paid_amount, payment_status')
        .in('id', allocatedOrderIds);

      for (const o of updatedOrders || []) {
        if (o.payment_status === 'paid') {
          ordersNowPaid.push({ id: o.id, order_number: o.order_number });
        } else if (o.payment_status === 'partial') {
          ordersNowPartial.push({
            id: o.id,
            order_number: o.order_number,
            balance: Math.max(0, (o.total_amount || 0) - (o.paid_amount || 0)),
          });
        }
      }
    }

    // ── 7. Build allocation response with order numbers ──
    const orderById = new Map(orders.map(o => [o.id, o]));
    const allocationsOut = insertedAllocations.map(a => ({
      id: a.id,
      order_id: a.order_id,
      order_number: orderById.get(a.order_id)?.order_number || a.order_id,
      amount: a.amount,
      allocation_type: a.allocation_type,
    }));

    return NextResponse.json({
      success: true,
      payment: {
        id: payment.id,
        amount: payment.amount,
        paid_at: payment.paid_at,
        method: payment.method,
        receipt_url: payment.receipt_url,
        note: payment.note,
        allocated_total: amount - unallocatedAmount,
        unallocated: unallocatedAmount,
      },
      allocations: allocationsOut,
      orders_now_paid: ordersNowPaid,
      orders_now_partial: ordersNowPartial,
      unallocated_amount: unallocatedAmount,
    });
  } catch (e) {
    console.error('[POST /api/credits/payment] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
