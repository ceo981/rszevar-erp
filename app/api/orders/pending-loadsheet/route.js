// ============================================================================
// RS ZEVAR ERP — Pending Loadsheet Orders Route (May 6 2026 v2)
// GET /api/orders/pending-loadsheet
// ----------------------------------------------------------------------------
// Returns orders that are flagged as `loadsheet_pending = TRUE`. Ye flag
// SIRF tab set hota hai jab order dispatch-scan page se actively scan/manual
// entry kiya jata hai. Agar order kisi aur tarike se dispatched hua (Shopify
// auto, manual status change, etc.) to ye flag FALSE rehta hai — wo orders
// is page pe nahi dikhenge.
//
// Older history (before this flag was added): default FALSE → never appears.
// Used by dispatch-scan page to:
//   1. Populate live list on page load (cross-device session continuity)
//   2. Poll every 30s to catch scans from other devices/dispatchers
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServerClient();

  try {
    // Fetch only orders flagged as loadsheet_pending = TRUE
    const { data: orders, error: ordErr } = await supabase
      .from('orders')
      .select('id, order_number, tracking_number, dispatched_courier, customer_name, customer_city, total_amount, payment_method, payment_status, dispatched_at')
      .eq('loadsheet_pending', true)
      .order('dispatched_at', { ascending: false })
      .limit(500);
    if (ordErr) throw ordErr;

    // Defense-in-depth: filter out any that somehow have flag=true AND are
    // already in a loadsheet (shouldn't happen, but bug-resistant).
    let filtered = orders || [];
    if (filtered.length > 0) {
      const orderIds = filtered.map(o => o.id);
      const { data: linkedRows } = await supabase
        .from('loadsheet_orders')
        .select('order_id')
        .in('order_id', orderIds);
      const linkedSet = new Set((linkedRows || []).map(r => r.order_id));
      filtered = filtered.filter(o => !linkedSet.has(o.id));
    }

    // Build summary objects (match scan-dispatch buildOrderSummary shape)
    const summaries = filtered.map(o => ({
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
