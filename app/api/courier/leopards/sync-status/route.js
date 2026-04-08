// ============================================================================
// Leopards — Bulk Status Sync (Chunk 3: reads window from settings)
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { fetchLeopardsStatuses, mapLeopardsStatus } from '../../../../../lib/leopards';
import { getSettings } from '../../../../../lib/settings';

const DEFAULT_LOCKED = ['delivered', 'returned', 'rto', 'cancelled', 'refunded'];

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

async function runSync({ from, to, triggered_by = 'manual', lockedStatuses }) {
  const startTime = Date.now();
  const supabase = createServerClient();

  const packets = await fetchLeopardsStatuses(from, to);

  if (packets.length === 0) {
    return {
      success: true,
      total_fetched: 0,
      matched_orders: 0,
      updated_orders: 0,
      from, to,
      duration_ms: Date.now() - startTime,
      message: 'No packets returned from Leopards for this date range',
    };
  }

  // Build map: tracking → packet
  const packetMap = new Map();
  for (const p of packets) {
    if (p.tracking_number) {
      packetMap.set(String(p.tracking_number).trim(), p);
    }
  }
  const trackingNumbers = Array.from(packetMap.keys());

  // Fetch matching orders
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

  // Build updates
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

    if (mappedStatus && !lockedStatuses.includes(order.status)) {
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

  // Apply
  let updatedCount = 0;
  const errors = [];
  for (const u of updates) {
    const { id, ...patch } = u;
    const { error } = await supabase.from('orders').update(patch).eq('id', id);
    if (error) errors.push({ order_id: id, error: error.message });
    else updatedCount++;
  }

  // Log
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
    from, to,
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

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    // Read sync window + locked statuses from settings
    const rules = await getSettings('business_rules');
    const configuredDays = rules['rules.leopards_sync_window_days'] ?? 10;
    const lockedStatuses = rules['rules.locked_statuses'] ?? DEFAULT_LOCKED;

    const days = body.days || configuredDays;
    const now = new Date();
    const from = body.from || formatDate(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
    const to = body.to || formatDate(now);
    const triggered_by = body.triggered_by || 'manual';

    const result = await runSync({ from, to, triggered_by, lockedStatuses });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}

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
