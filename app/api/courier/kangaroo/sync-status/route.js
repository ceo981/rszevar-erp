// ============================================================================
// Kangaroo — Status Sync Route
// POST /api/courier/kangaroo/sync-status
// GET  /api/courier/kangaroo/sync-status  (last sync info)
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { trackKangarooBatch, mapKangarooStatus } from '../../../../../lib/kangaroo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const LOCKED_STATUSES = ['delivered', 'returned', 'rto', 'cancelled', 'refunded'];

async function runSync({ triggered_by = 'manual' }) {
  const startTime = Date.now();

  // ── 1. Get all active Kangaroo orders from ERP ──
  const { data: orders, error: fetchErr } = await supabase
    .from('orders')
    .select('id, order_number, tracking_number, status, courier_name')
    .eq('courier_name', 'Kangaroo')
    .not('tracking_number', 'is', null)
    .not('tracking_number', 'eq', '')
    .not('status', 'in', '("delivered","returned","cancelled","refunded","rto")');

  if (fetchErr) throw new Error('DB fetch error: ' + fetchErr.message);

  const activeOrders = orders || [];

  if (activeOrders.length === 0) {
    return {
      success: true,
      message: 'Koi active Kangaroo order nahi mila',
      total_fetched: 0,
      updated_orders: 0,
      duration_ms: Date.now() - startTime,
    };
  }

  const trackingNumbers = activeOrders.map(o => o.tracking_number);

  // ── 2. Track all from Kangaroo API ──
  const trackResults = await trackKangarooBatch(trackingNumbers);

  // ── 3. Match + update ──
  const updates = [];
  const errors = [];
  const skipped = [];

  for (const result of trackResults) {
    if (!result.success) {
      errors.push({ tracking: result.tracking, error: result.error });
      continue;
    }

    const order = activeOrders.find(o => o.tracking_number === result.tracking);
    if (!order) continue;

    const rawStatus = result.data?.Orderstatus || result.data?.orderstatus || null;
    const mappedStatus = mapKangarooStatus(rawStatus);

    if (!mappedStatus) {
      skipped.push({ tracking: result.tracking, raw: rawStatus });
      continue;
    }

    if (LOCKED_STATUSES.includes(order.status)) continue;
    if (mappedStatus === order.status) continue;

    const patch = {
      courier_status_raw: rawStatus,
      courier_last_synced_at: new Date().toISOString(),
      status: mappedStatus,
    };

    if (mappedStatus === 'delivered') {
      patch.delivered_at = new Date().toISOString();
      patch.courier_delivered_at = new Date().toISOString();
    }

    updates.push({ id: order.id, order_number: order.order_number, patch });
  }

  // ── 4. Apply updates ──
  let updatedCount = 0;
  for (const u of updates) {
    const { error } = await supabase.from('orders').update(u.patch).eq('id', u.id);
    if (error) errors.push({ order_id: u.id, error: error.message });
    else updatedCount++;
  }

  // ── 5. Log to courier_sync_log ──
  await supabase.from('courier_sync_log').insert({
    courier: 'Kangaroo',
    sync_type: 'status',
    total_fetched: trackResults.length,
    matched_orders: activeOrders.length,
    updated_orders: updatedCount,
    errors: errors.length > 0 ? errors.slice(0, 10) : null,
    duration_ms: Date.now() - startTime,
    triggered_by,
    raw_sample: trackResults.filter(r => r.success).slice(0, 3).map(r => r.data),
  });

  return {
    success: true,
    total_active_orders: activeOrders.length,
    total_tracked: trackResults.filter(r => r.success).length,
    updated_orders: updatedCount,
    skipped_unmapped: skipped.length,
    skipped_sample: skipped.slice(0, 5),
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    duration_ms: Date.now() - startTime,
    message: `${updatedCount} orders updated out of ${activeOrders.length} active Kangaroo orders`,
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const triggered_by = body.triggered_by || 'manual';
    const result = await runSync({ triggered_by });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    // Last sync info
    const { data: lastLog } = await supabase
      .from('courier_sync_log')
      .select('*')
      .eq('courier', 'Kangaroo')
      .eq('sync_type', 'status')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { count: total } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('courier_name', 'Kangaroo');

    const { count: delivered } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('courier_name', 'Kangaroo')
      .eq('status', 'delivered');

    const { count: active } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('courier_name', 'Kangaroo')
      .not('status', 'in', '("delivered","returned","cancelled","refunded")');

    return NextResponse.json({
      success: true,
      last_sync: lastLog,
      total_kangaroo_orders: total || 0,
      kangaroo_delivered: delivered || 0,
      kangaroo_active: active || 0,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
