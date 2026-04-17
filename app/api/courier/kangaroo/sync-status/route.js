// ============================================================================
// Leopards — Bulk Status Sync (Chunk 3: reads window from settings)
// ----------------------------------------------------------------------------
// PROTOCOL FIX (Apr 2026): Is cron ab silently pre-dispatch orders ka office
// status nahi badlega. Agar staff ne ERP mein confirm/packed click kiye bina
// directly courier pe book kar diya to cron sirf courier_status_raw save
// karega aur order_activity_log mein "protocol_violation" record daalega.
// Wahan se tum CEO dashboard pe Exception Alerts dekh sakte ho.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { fetchLeopardsStatuses, mapLeopardsStatus } from '../../../../../lib/leopards';
import { getSettings } from '../../../../../lib/settings';
import { evaluateAutomatedTransition } from '../../../../../lib/order-status';

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
      protocol_violations: 0,
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
  const protocolViolations = []; // pending/confirmed orders jinpe courier move hua
  const skipped = [];

  for (const order of existingOrders) {
    const packet = packetMap.get(order.tracking_number);
    if (!packet) continue;

    const rawStatus = packet.booked_packet_status || null;
    const mappedStatus = mapLeopardsStatus(rawStatus);

    // Hamesha courier_status_raw save karo — ye passive info hai
    const patch = {
      id: order.id,
      courier_status_raw: rawStatus,
      courier_last_synced_at: new Date().toISOString(),
    };

    if (!mappedStatus) {
      skipped.push({ tracking: order.tracking_number, raw: rawStatus, reason: 'unmapped' });
      updates.push(patch);
      continue;
    }

    // Pehle se locked (delivered/rto/etc.) — status touch nahi karo
    if (lockedStatuses.includes(order.status)) {
      updates.push(patch);
      continue;
    }

    // Transition guard — automated source se change allowed hai ya nahi?
    const decision = evaluateAutomatedTransition(order.status, mappedStatus, 'courier_sync');

    if (decision.apply) {
      // Allowed transition (e.g. packed → dispatched agar manual book hua ho,
      // ya dispatched → delivered). Safe to overwrite.
      if (mappedStatus !== order.status) {
        patch.status = mappedStatus;
        if (mappedStatus === 'delivered') {
          patch.courier_delivered_at = packet.delivery_date || new Date().toISOString();
          patch.delivered_at = packet.delivery_date || new Date().toISOString();
        }
      }
    } else if (decision.blocked) {
      // PROTOCOL VIOLATION — staff ne ERP flow skip kiya.
      // Office status CHANGE NAHI HOGA. Sirf courier_status_raw save hoga
      // aur log mein exception daal denge.
      protocolViolations.push({
        order_id: order.id,
        order_number: order.order_number,
        office_status: order.status,
        courier_says: mappedStatus,
        raw: rawStatus,
        reason: decision.reason,
      });
    }
    // else: decision denies but not a violation (e.g. noop) — just skip status write

    updates.push(patch);
  }

  // Apply updates
  let updatedCount = 0;
  let statusChangedCount = 0;
  const errors = [];
  for (const u of updates) {
    const { id, ...patch } = u;
    const { error } = await supabase.from('orders').update(patch).eq('id', id);
    if (error) errors.push({ order_id: id, error: error.message });
    else {
      updatedCount++;
      if (patch.status) statusChangedCount++;
    }
  }

  // Log protocol violations to order_activity_log — CEO can review these
  if (protocolViolations.length > 0) {
    const violationLogs = protocolViolations.map(v => ({
      order_id: v.order_id,
      action: 'protocol_violation:courier_ahead_of_office',
      notes: `Leopards says "${v.raw}" (mapped=${v.courier_says}) but office status is "${v.office_status}". ` +
             `Office flow skip hua — confirm/packed click nahi kiya gaya. ` +
             `Office status unchanged (${v.office_status}).`,
      performed_by: 'Leopards Cron',
      performed_at: new Date().toISOString(),
    }));
    // best-effort insert
    try {
      await supabase.from('order_activity_log').insert(violationLogs);
    } catch (e) {
      console.error('[leopards-sync] violation log insert failed:', e.message);
    }
  }

  // Log sync summary
  await supabase.from('courier_sync_log').insert({
    courier: 'Leopards',
    sync_type: 'status',
    from_date: from,
    to_date: to,
    total_fetched: packets.length,
    matched_orders: existingOrders.length,
    updated_orders: statusChangedCount,
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
    rows_touched: updatedCount, // all rows where courier_status_raw updated
    status_changes: statusChangedCount, // rows where office status actually changed
    protocol_violations: protocolViolations.length,
    violations_sample: protocolViolations.slice(0, 5),
    skipped_unmapped: skipped.length,
    skipped_sample: skipped.slice(0, 5),
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    duration_ms: Date.now() - startTime,
    message: `${statusChangedCount} office statuses updated, ${protocolViolations.length} protocol violations blocked (office flow skip)`,
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
