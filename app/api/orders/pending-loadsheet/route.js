// ============================================================================
// RS ZEVAR ERP — Pending Loadsheet Orders Route (May 6 2026)
// GET /api/orders/pending-loadsheet
// ----------------------------------------------------------------------------
// Returns dispatched orders that have NOT yet been assigned to any loadsheet.
// Used by dispatch-scan page to:
//   1. Populate live list on page load (cross-device session continuity)
//   2. Poll every 30s to catch scans from other devices/dispatchers
//
// Logic:
//   1. Fetch all rows from loadsheet_orders → set of "linked" order_ids
//   2. Fetch recent dispatched orders (last 200 for sane bound)
//   3. Filter out those already linked
//
// Returned shape mirrors scan-dispatch buildOrderSummary() so the scan page
// can drop these straight into its `scannedOrders` state.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServerClient();

  try {
    // ── 1. Fetch all linked order IDs (in any loadsheet) ──────────────────
    const { data: linkedRows, error: linkedErr } = await supabase
      .from('loadsheet_orders')
      .select('order_id');
    if (linkedErr) throw linkedErr;
    const linkedIds = new Set((linkedRows || []).map(r => r.order_id));

    // ── 2. Fetch recent dispatched orders ─────────────────────────────────
    // Cap at 200 — defensive bound. Realistically there shouldn't be more
    // than ~50 pending at any time (one day's dispatch volume).
    const { data: orders, error: ordErr } = await supabase
      .from('orders')
      .select('id, order_number, tracking_number, dispatched_courier, customer_name, customer_city, total_amount, payment_method, payment_status, dispatched_at')
      .eq('status', 'dispatched')
      .order('dispatched_at', { ascending: false })
      .limit(200);
    if (ordErr) throw ordErr;

    // ── 3. Filter out those already in a loadsheet ────────────────────────
    const pending = (orders || []).filter(o => !linkedIds.has(o.id));

    // ── 4. Build summary objects (match scan-dispatch shape) ──────────────
    const summaries = pending.map(o => ({
      id: o.id,
      order_number: o.order_number,
      tracking_number: o.tracking_number || null,
      courier: o.dispatched_courier || null,
      customer_name: o.customer_name || '',
      customer_city: o.customer_city || '',
      cod_amount: (o.payment_method === 'COD' && o.payment_status !== 'paid')
        ? Number(o.total_amount || 0)
        : 0,
      total_amount: Number(o.total_amount || 0),
      payment_status: o.payment_status,
      scanned_at: o.dispatched_at || new Date().toISOString(),
    }));

    return NextResponse.json({
      success: true,
      orders: summaries,
      count: summaries.length,
    });

  } catch (e) {
    console.error('[pending-loadsheet] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
