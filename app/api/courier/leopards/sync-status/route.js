// ============================================================================
// Leopards — Bulk Status Sync
// ============================================================================
// Pulls all packets in a date range from Leopards API, matches them against
// orders by tracking_number, and updates orders.status + courier_status_raw.
//
// Default: last 10 days
// Body (optional): { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', days: 10, triggered_by: 'manual' }
//
// Safe to run repeatedly — idempotent. Uses LOCKED_STATUSES protection
// (delivered/rto/cancelled/refunded never overwritten with weaker status).
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchLeopardsStatuses, mapLeopardsStatus } from '@/lib/leopards';

const LOCKED_STATUSES = ['delivered', 'returned', 'rto', 'cancelled', 'refunded'];

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function formatDate(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function runSync({ from, to, triggered_by = 'manual' }) {
  const startTime = Date.now();
  const supabase = createServerClient();

  // 1. Fetch from Leopards
  const packets = await fetchLeopardsStatuses(from, to);

  if (packets.length === 0) {
    return {
      success: true,
      total_fetched: 0,
      matched_orders: 0,
      updated_orders: 0,
      from,
      to,
      duration_ms: Date.now() - startTime,
      message: 'No packets returned from Leopards for this date range',
    };
  }

  // 2. Build map: tracking_number → latest packet
  //    (API may return multiple entries for same packet; keep last)
  const packetMap = new Map();
  for (const p of packets) {
    if (p.tracking_number) {
      packetMap.set(String(p.tracking_number).trim(), p);
    }
  }
  const trackingNumbers = Array.from(packetMap.keys());

  // 3. Fetch matching orders from DB (in chunks to stay under query size limits)
  const existingOrders = [];
  for (let i = 0; i < trackingNumbers.length; i += 500) {
    const chunk = trackingNumbers.slice(i, i + 500);
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, tracking_number, status, payment_status, courier_status_raw')
      .in('tracking_number', chunk);
    if (error) throw new Error(`DB fetch error: ${error.message}`);
    if (data) existingOrders.push(...data);
  }

  // 4. Build updates
  const updates = [];
  const skipped = [];

  for (const order of existingOrders) {
    const packet = packetMap.get(order.tracking_number);
    if (!packet) continue;

    const rawStatus = packet.booked_packet_status || null;
    const mappedStatus = mapLeopardsStatus(rawStatus);

    const patch = {
      id: order.id,
      courier_status_raw: rawStatus,
      courier_last_synced_at: new Date().toISOString(),
    };

    // Only update ERP status if:
    // 1. We successfully mapped the raw text to an ERP status
    // 2. Current status is not locked (don't downgrade delivered → dispatched)
    if (mappedStatus && !LOCKED_STATUSES.includes(order.status)) {
      if (mappedStatus !== order.status) {
        patch.status = mappedStatus;
        if (mappedStatus === 'delivered') {
          patch.courier_delivered_at = packet.delivery_date || new Date().toISOString();
          patch.delivered_at = packet.delivery_date || new Date().toISOString();
        }
      }
    } else if (!mappedStatus) {
      skipped.push({ tracking: order.tracking_number, raw: rawStatus, reason: 'unmapped' });
    }

    updates.push(patch);
  }

  // 5. Apply updates one by one (can't bulk update with per-row values easily)
  //    Batching would need an RPC function; for 150 rows this is fine
  let updatedCount = 0;
  const errors = [];
  for (const u of updates) {
    const { id, ...patch } = u;
    const { error } = await supabase.from('orders').update(patch).eq('id', id);
    if (error) {
      errors.push({ order_id: id, error: error.message });
    } else {
      updatedCount++;
    }
  }

  // 6. Log the sync run
  await supabase.from('courier_sync_log').insert({
    courier: 'Leopards',
    sync_type: 'status',
    from_date: from,
    to_date: to,
    total_fetched: packets.length,
    matched_orders: existingOrders.length,
    updated_orders: updatedCount,
    errors: errors.length > 0 ? errors.slice(0, 10) : null,
    duration_ms: Date.now() - startTime,
    triggered_by,
    raw_sample: packets.slice(0, 3),
  });

  return {
    success: true,
    from,
    to,
    total_fetched: packets.length,
    unique_packets: packetMap.size,
    matched_orders: existingOrders.length,
    updated_orders: updatedCount,
    skipped_unmapped: skipped.length,
    skipped_sample: skipped.slice(0, 5),
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    duration_ms: Date.now() - startTime,
    message: `${updatedCount} orders updated from ${packets.length} Leopards packets`,
  };
}

// ─── POST — manual trigger ──────────────────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const days = body.days || 10;
    const now = new Date();
    const from = body.from || formatDate(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
    const to = body.to || formatDate(now);
    const triggered_by = body.triggered_by || 'manual';

    const result = await runSync({ from, to, triggered_by });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}

// ─── GET — simple check / last sync info ────────────────────────────────────
export async function GET() {
  try {
    const supabase = createServerClient();
    const { data: lastLog } = await supabase
      .from('courier_sync_log')
      .select('*')
      .eq('courier', 'Leopards')
      .eq('sync_type', 'status')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { count: leopardsTotal } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'Leopards');

    const { count: leopardsDelivered } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'Leopards')
      .eq('status', 'delivered');

    return NextResponse.json({
      success: true,
      last_sync: lastLog,
      total_leopards_orders: leopardsTotal || 0,
      leopards_delivered: leopardsDelivered || 0,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
