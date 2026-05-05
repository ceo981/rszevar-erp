// ============================================================================
// RS ZEVAR ERP — Customer Credits — Single Customer Khaata
// GET /api/credits/[phone]
// May 2 2026 · Step 3 of 6 · File 2 of 5
// May 5 2026 · UPDATED — includes manually-imported orders (credit_khaata_phone)
// ----------------------------------------------------------------------------
// PURPOSE:
//   Returns full khaata for ONE customer (identified by phone).
//   Powers the per-customer detail page /credits/[phone].
//
// LOGIC:
//   1. Fetch all credit orders matching this khaata. An order belongs to
//      this khaata if EITHER:
//        - customer_phone = phone AND credit_khaata_phone IS NULL (natural)
//        - credit_khaata_phone = phone (manually imported)
//      An order with credit_khaata_phone = OTHER does NOT belong here, even
//      if its customer_phone = this phone (it was moved out).
//   2. Fetch payments for all relevant source phones + the khaata phone
//      (catches historical payments recorded before import)
//   3. Compute summary: outstanding, total billed, total received
//
// RESPONSE:
//   {
//     success: true,
//     customer: { phone, name, first_seen },
//     summary: { outstanding, total_billed, total_received },
//     orders: [ {..., is_imported, source_phone} ],
//     payments: [...]
//   }
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

    // ── 1. Fetch credit orders for this khaata ──
    // Two queries (kept simple for safety with PostgREST .or() escaping):
    //   A) customer_phone = phone AND credit_khaata_phone IS NULL
    //   B) credit_khaata_phone = phone
    // Then merge + dedupe by id.

    const PAGE = 1000;

    // Query A — natural khaata members
    const naturalOrders = [];
    let offA = 0;
    while (offA < 5000) {
      const { data: chunk, error } = await supabase
        .from('orders')
        .select('id, order_number, customer_name, customer_phone, credit_khaata_phone, credit_imported_at, credit_imported_by_name, total_amount, paid_amount, payment_status, status, tags, created_at, confirmed_at')
        .eq('customer_phone', phone)
        .is('credit_khaata_phone', null)
        .eq('is_credit_order', true)
        .order('created_at', { ascending: false })
        .range(offA, offA + PAGE - 1);
      if (error) throw error;
      if (!chunk || chunk.length === 0) break;
      naturalOrders.push(...chunk);
      if (chunk.length < PAGE) break;
      offA += PAGE;
    }

    // Query B — imported into this khaata
    const importedOrders = [];
    let offB = 0;
    while (offB < 5000) {
      const { data: chunk, error } = await supabase
        .from('orders')
        .select('id, order_number, customer_name, customer_phone, credit_khaata_phone, credit_imported_at, credit_imported_by_name, total_amount, paid_amount, payment_status, status, tags, created_at, confirmed_at')
        .eq('credit_khaata_phone', phone)
        .eq('is_credit_order', true)
        .order('created_at', { ascending: false })
        .range(offB, offB + PAGE - 1);
      if (error) throw error;
      if (!chunk || chunk.length === 0) break;
      importedOrders.push(...chunk);
      if (chunk.length < PAGE) break;
      offB += PAGE;
    }

    // Merge + dedupe (defensive; the two queries shouldn't overlap by design)
    const seenIds = new Set();
    const allOrders = [];
    for (const o of [...naturalOrders, ...importedOrders]) {
      if (seenIds.has(o.id)) continue;
      seenIds.add(o.id);
      allOrders.push(o);
    }
    // Sort by created_at desc
    allOrders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

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

    // ── 3. Fetch all payments relevant to this khaata ──
    // Includes: payments under khaata phone (most common) AND payments under
    // source phones of any imported orders (historical, pre-import payments).
    const phoneSet = new Set([phone]);
    for (const o of allOrders) {
      if (o.customer_phone) phoneSet.add(o.customer_phone.trim());
    }

    const { data: payments, error: payErr } = await supabase
      .from('customer_payments')
      .select('id, amount, customer_phone, paid_at, method, receipt_url, note, allocated_total, unallocated, voided_at, voided_reason, created_by_name, created_at')
      .in('customer_phone', [...phoneSet])
      .order('paid_at', { ascending: false });

    if (payErr) throw payErr;

    // Filter payments to ONLY those whose allocations touch orders in THIS khaata,
    // OR were recorded directly against the khaata phone (unallocated counts).
    const orderIdSet = new Set(orderIds);
    const paymentIds = (payments || []).map(p => p.id);
    const { data: allAllocations } = paymentIds.length > 0
      ? await supabase
          .from('payment_allocations')
          .select('id, payment_id, order_id, amount, allocation_type, created_at')
          .in('payment_id', paymentIds)
      : { data: [] };

    const allocsByPayment = new Map();
    const orderNumByOrderId = new Map(allOrders.map(o => [o.id, o.order_number]));
    for (const a of allAllocations || []) {
      if (!allocsByPayment.has(a.payment_id)) allocsByPayment.set(a.payment_id, []);
      allocsByPayment.get(a.payment_id).push({
        order_id: a.order_id,
        order_number: orderNumByOrderId.get(a.order_id) || a.order_id,
        amount: a.amount,
        belongs_to_khaata: orderIdSet.has(a.order_id),
      });
    }

    // Keep payment if:
    //   - customer_phone === khaata phone (direct deposit on this khaata), OR
    //   - has at least one allocation to an order in this khaata
    const relevantPayments = (payments || []).filter(p => {
      if (p.customer_phone === phone) return true;
      const allocs = allocsByPayment.get(p.id) || [];
      return allocs.some(a => a.belongs_to_khaata);
    });

    // ── 4. Build response payloads ──
    const ordersOut = allOrders.map(o => {
      const orderItems = itemsByOrder.get(o.id) || [];
      const totalQty = orderItems.reduce((s, it) => s + (it.quantity || 0), 0);
      const itemsSummary = orderItems.length === 0
        ? '—'
        : orderItems.length <= 2
          ? orderItems.map(it => it.title).join(', ')
          : `${orderItems[0].title} + ${orderItems.length - 1} more`;

      const isImported = !!o.credit_khaata_phone;
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
        // May 5: import metadata
        is_imported: isImported,
        source_phone: isImported ? o.customer_phone : null,
        imported_at: o.credit_imported_at || null,
        imported_by_name: o.credit_imported_by_name || null,
      };
    });

    const paymentsOut = relevantPayments.map(p => {
      // For payments not directly on this khaata, only show allocations that
      // belong here (other allocations are noise — they're for other khaatas).
      const allocs = allocsByPayment.get(p.id) || [];
      const filteredAllocs = p.customer_phone === phone
        ? allocs
        : allocs.filter(a => a.belongs_to_khaata);

      return {
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
        // If payment was on a different phone, surface that
        recorded_under_phone: p.customer_phone !== phone ? p.customer_phone : null,
        allocations: filteredAllocs.map(a => ({
          order_id: a.order_id,
          order_number: a.order_number,
          amount: a.amount,
        })),
      };
    });

    // ── 5. Summary ──
    // total_billed = sum of all order totals (excluding cancelled)
    const billableOrders = allOrders.filter(o => o.status !== 'cancelled');
    const totalBilled = billableOrders.reduce((s, o) => s + (o.total_amount || 0), 0);

    // total_received = sum of NON-VOIDED allocations to orders in this khaata,
    //                  PLUS unallocated portion of payments directly on this khaata
    let totalReceived = 0;
    for (const p of relevantPayments) {
      if (p.voided_at) continue;
      if (p.customer_phone === phone) {
        // Direct deposit — full amount counts toward this khaata
        totalReceived += (p.amount || 0);
      } else {
        // Indirect — only allocations to this khaata's orders count
        const allocs = allocsByPayment.get(p.id) || [];
        for (const a of allocs) {
          if (a.belongs_to_khaata) totalReceived += (a.amount || 0);
        }
      }
    }

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
