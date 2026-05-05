// ============================================================================
// RS ZEVAR ERP — Customer Credits — Dashboard List Endpoint
// GET /api/credits
// May 2 2026 · Step 3 of 6
// May 5 2026 · UPDATED — supports manual khaata override (credit_khaata_phone)
// ----------------------------------------------------------------------------
// PURPOSE:
//   Returns list of customers (grouped by phone) with outstanding balance.
//   Powers the main /credits dashboard page.
//
// LOGIC:
//   1. Find all orders where payment_status IN ('unpaid', 'partial')
//      AND status IN ('delivered', 'confirmed', 'on_packing', 'packed', 'dispatched')
//      AND is_credit_order = true
//   2. Group by COALESCE(credit_khaata_phone, customer_phone)
//      — credit_khaata_phone (May 5) lets CEO manually move an order
//        into a different customer's khaata (same person, 2 numbers)
//   3. For each group:
//      - sum outstanding (total_amount - paid_amount)
//      - count orders (unpaid + partial)
//      - find last payment date from customer_payments
//      - count of imported orders (for "🔗" indicator on dashboard)
//   4. Also return summary stats
//
// FILTERS (query params):
//   ?search=phone_or_name (optional)
//   ?sort=outstanding|name|recent (default: outstanding desc)
//
// RESPONSE:
//   {
//     success: true,
//     summary: { total_outstanding, active_customers, this_month_received, pending_orders },
//     customers: [
//       { phone, name, outstanding, orders_count, partial_count, last_payment_at,
//         imported_count }   // ← May 5: number of orders manually imported into this khaata
//     ]
//   }
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Statuses that count as "real" orders for credit tracking
const ACTIVE_ORDER_STATUSES = [
  'pending', 'confirmed', 'on_packing', 'packed',
  'dispatched', 'attempted', 'hold', 'delivered',
];

export async function GET(request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const sort = searchParams.get('sort') || 'outstanding';

    // ── Fetch credit orders (chunked, fresh builder each iter) ──
    // CRITICAL FILTER: is_credit_order = true
    // Only orders explicitly marked as udhaar/credit show in this module.
    const allOrders = [];
    const PAGE = 1000;
    let off = 0;
    while (off < 10000) {
      const { data: chunk, error } = await supabase
        .from('orders')
        .select('id, order_number, customer_phone, credit_khaata_phone, customer_name, total_amount, paid_amount, payment_status, status, created_at')
        .eq('is_credit_order', true)
        .in('payment_status', ['unpaid', 'partial'])
        .in('status', ACTIVE_ORDER_STATUSES)
        .order('created_at', { ascending: true })
        .range(off, off + PAGE - 1);

      if (error) throw error;
      if (!chunk || chunk.length === 0) break;
      allOrders.push(...chunk);
      if (chunk.length < PAGE) break;
      off += PAGE;
    }

    // ── Group by COALESCE(credit_khaata_phone, customer_phone) ──
    // May 5 2026: credit_khaata_phone (when set) overrides customer_phone for
    // grouping purposes. Lets CEO manually consolidate orders into one khaata.
    const byPhone = new Map();
    for (const o of allOrders) {
      const naturalPhone = (o.customer_phone || '').trim();
      const overridePhone = (o.credit_khaata_phone || '').trim();
      const phone = overridePhone || naturalPhone;
      if (!phone) continue;  // skip orders without any phone

      if (!byPhone.has(phone)) {
        byPhone.set(phone, {
          phone,
          name: o.customer_name || '',
          outstanding: 0,
          orders_count: 0,
          partial_count: 0,
          imported_count: 0,
          oldest_order_at: o.created_at,
        });
      }
      const grp = byPhone.get(phone);
      const outstanding = Math.max(0, (o.total_amount || 0) - (o.paid_amount || 0));
      grp.outstanding += outstanding;
      grp.orders_count += 1;
      if (o.payment_status === 'partial') grp.partial_count += 1;
      if (overridePhone) grp.imported_count += 1;
      // Keep most recent name in case of typos in older records
      if (o.customer_name && !grp.name) grp.name = o.customer_name;
    }

    // ── Fetch last payment date per khaata ──
    // Strategy: build set of all phones that contributed to each khaata
    // (the khaata phone itself + any source phones from imported orders),
    // fetch payments for all of them, then map back to khaata phone.
    const khaataPhones = [...byPhone.keys()];
    const allRelevantPhones = new Set(khaataPhones);

    // Add source phones from imported orders so historical payments
    // (recorded against original phone before import) still surface.
    for (const o of allOrders) {
      if (o.credit_khaata_phone && o.customer_phone) {
        allRelevantPhones.add(o.customer_phone.trim());
      }
    }

    const lastPaymentByKhaata = new Map();
    if (allRelevantPhones.size > 0) {
      const { data: payments, error: payErr } = await supabase
        .from('customer_payments')
        .select('customer_phone, paid_at')
        .in('customer_phone', [...allRelevantPhones])
        .is('voided_at', null)
        .order('paid_at', { ascending: false });

      if (!payErr && payments) {
        // Build map: phone → khaata_phone (for source phones of imported orders)
        const phoneToKhaata = new Map();
        for (const o of allOrders) {
          if (o.credit_khaata_phone && o.customer_phone) {
            phoneToKhaata.set(o.customer_phone.trim(), o.credit_khaata_phone.trim());
          }
        }

        for (const p of payments) {
          const phone = (p.customer_phone || '').trim();
          // Resolve to khaata phone (if this is a source phone of an imported order)
          const khaata = phoneToKhaata.get(phone) || phone;
          if (byPhone.has(khaata) && !lastPaymentByKhaata.has(khaata)) {
            lastPaymentByKhaata.set(khaata, p.paid_at);
          }
        }
      }
    }

    // ── Build customer list with optional search filter ──
    let customers = [...byPhone.values()].map(c => ({
      phone: c.phone,
      name: c.name,
      outstanding: Math.round(c.outstanding * 100) / 100,
      orders_count: c.orders_count,
      partial_count: c.partial_count,
      imported_count: c.imported_count,
      last_payment_at: lastPaymentByKhaata.get(c.phone) || null,
    }));

    if (search) {
      customers = customers.filter(c =>
        c.phone.toLowerCase().includes(search) ||
        c.name.toLowerCase().includes(search)
      );
    }

    // ── Sort ──
    if (sort === 'name') {
      customers.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'recent') {
      customers.sort((a, b) => {
        const ta = a.last_payment_at ? new Date(a.last_payment_at).getTime() : 0;
        const tb = b.last_payment_at ? new Date(b.last_payment_at).getTime() : 0;
        return tb - ta;
      });
    } else {
      // Default: outstanding desc
      customers.sort((a, b) => b.outstanding - a.outstanding);
    }

    // ── Summary stats ──
    const totalOutstanding = customers.reduce((s, c) => s + c.outstanding, 0);
    const pendingOrders = customers.reduce((s, c) => s + c.orders_count, 0);

    // This month received (from payments table)
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { data: monthPayments } = await supabase
      .from('customer_payments')
      .select('amount')
      .gte('paid_at', monthStart.toISOString())
      .is('voided_at', null);

    const thisMonthReceived = (monthPayments || []).reduce(
      (s, p) => s + (p.amount || 0), 0
    );

    return NextResponse.json({
      success: true,
      summary: {
        total_outstanding: Math.round(totalOutstanding * 100) / 100,
        active_customers: customers.length,
        this_month_received: Math.round(thisMonthReceived * 100) / 100,
        pending_orders: pendingOrders,
      },
      customers,
    });
  } catch (e) {
    console.error('[GET /api/credits] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
