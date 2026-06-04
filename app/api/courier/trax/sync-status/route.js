// ============================================================================
// Trax (Sonic) — Bulk Status Sync
// ----------------------------------------------------------------------------
// FILE PATH: app/api/courier/trax/sync-status/route.js
// ----------------------------------------------------------------------------
// Sonic ka koi bulk-by-date-range status endpoint nahi hai (Leopards jaisa),
// isliye Kangaroo wala pattern: har active Trax order ke liye per-call status
// fetch karo (lib/sonic.js delay handle karta hai).
//
// PROTOCOL GUARD (same as Leopards/Kangaroo): ye cron silently pre-dispatch
// order ka office status nahi badlega. Agar staff ne ERP confirm/packed click
// kiye bina seedha Trax pe book kar diya, to sirf courier_status_raw save hoga
// aur order_activity_log mein "protocol_violation" record jayega.
//
// dispatched_courier='Trax' lib/shopify.js fulfillment sync se set hota hai
// (Shopify tracking_company = "Trax"). Manual fulfill / dispatch bhi set karte.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { fetchSonicStatusBatch, mapSonicStatus } from '../../../../../lib/sonic';
import { getSettings } from '../../../../../lib/settings';
import { evaluateAutomatedTransition } from '../../../../../lib/order-status';

const DEFAULT_LOCKED = ['delivered', 'returned', 'rto', 'cancelled', 'refunded'];
const DEFAULT_MAX_ORDERS = 50; // safety cap for 60s Vercel timeout (per-call API)

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function runSync({ triggered_by = 'manual', lockedStatuses, maxOrders }) {
  const startTime = Date.now();
  const supabase = createServerClient();

  // Fetch Trax orders that still need a status check (skip locked at DB level)
  const notInList = `(${lockedStatuses.join(',')})`;
  const { data: traxOrders, error: fetchErr } = await supabase
    .from('orders')
    .select('id, order_number, tracking_number, status, payment_status, courier_status_raw, courier_last_synced_at')
    .eq('dispatched_courier', 'Trax')
    .not('tracking_number', 'is', null)
    .not('status', 'in', notInList)
    .order('updated_at', { ascending: false })
    .limit(maxOrders);

  if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);

  if (!traxOrders || traxOrders.length === 0) {
    await supabase.from('courier_sync_log').insert({
      courier: 'Trax',
      sync_type: 'status',
      from_date: null,
      to_date: null,
      total_fetched: 0,
      matched_orders: 0,
      updated_orders: 0,
      errors: null,
      duration_ms: Date.now() - startTime,
      triggered_by,
      raw_sample: null,
    });

    return {
      success: true,
      total_trax_orders: 0,
      status_changes: 0,
      duration_ms: Date.now() - startTime,
      message: '0 Trax orders to sync',
    };
  }

  // Per-order status fetch (Sonic has no bulk endpoint)
  const trackingNumbers = traxOrders.map(o => o.tracking_number);
  let trackResults;
  try {
    trackResults = await fetchSonicStatusBatch(trackingNumbers);
  } catch (e) {
    throw new Error(`Sonic API batch failed: ${e.message}`);
  }

  const trackMap = new Map();
  for (const r of trackResults) trackMap.set(r.tracking, r);

  const updates = [];
  const protocolViolations = [];
  const skipped = [];
  const apiErrors = [];

  for (const order of traxOrders) {
    const trackRes = trackMap.get(order.tracking_number);
    if (!trackRes) continue;

    if (!trackRes.success) {
      apiErrors.push({ tracking: order.tracking_number, error: trackRes.error });
      continue;
    }

    const rawStatus = trackRes.status || null;
    const mappedStatus = mapSonicStatus(rawStatus);

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

    // Locked status — passive update only (don't touch office status)
    if (lockedStatuses.includes(order.status)) {
      updates.push(patch);
      continue;
    }

    // Transition guard — same as Leopards/Kangaroo
    const decision = evaluateAutomatedTransition(order.status, mappedStatus, 'courier_sync');

    if (decision.apply) {
      if (mappedStatus !== order.status) {
        patch.status = mappedStatus;
        if (mappedStatus === 'delivered') {
          const now = new Date().toISOString();
          patch.courier_delivered_at = now;
          patch.delivered_at = now;
        }
      }
    } else if (decision.blocked) {
      protocolViolations.push({
        order_id: order.id,
        order_number: order.order_number,
        office_status: order.status,
        courier_says: mappedStatus,
        raw: rawStatus,
        reason: decision.reason,
      });
    }

    updates.push(patch);
  }

  // Apply DB updates
  let updatedCount = 0;
  let statusChangedCount = 0;
  const dbErrors = [];
  for (const u of updates) {
    const { id, ...patch } = u;
    const { error } = await supabase.from('orders').update(patch).eq('id', id);
    if (error) dbErrors.push({ order_id: id, error: error.message });
    else {
      updatedCount++;
      if (patch.status) statusChangedCount++;
    }
  }

  // Protocol violation logs
  if (protocolViolations.length > 0) {
    const violationLogs = protocolViolations.map(v => ({
      order_id: v.order_id,
      action: 'protocol_violation:courier_ahead_of_office',
      notes:
        `Trax says "${v.raw}" (mapped=${v.courier_says}) but office status is "${v.office_status}". ` +
        `Office flow skip hua — confirm/packed click nahi kiya. Office status unchanged.`,
      performed_by: 'Trax Cron',
      performed_at: new Date().toISOString(),
    }));
    try {
      await supabase.from('order_activity_log').insert(violationLogs);
    } catch (e) {
      console.error('[trax-sync] violation log insert failed:', e.message);
    }
  }

  // Final sync log
  const allErrors = [...apiErrors, ...dbErrors];
  await supabase.from('courier_sync_log').insert({
    courier: 'Trax',
    sync_type: 'status',
    from_date: null,
    to_date: null,
    total_fetched: trackResults.length,
    matched_orders: traxOrders.length,
    updated_orders: statusChangedCount,
    errors: allErrors.length > 0 ? allErrors.slice(0, 10) : null,
    duration_ms: Date.now() - startTime,
    triggered_by,
    raw_sample: trackResults.slice(0, 3).map(r => ({
      tracking: r.tracking,
      success: r.success,
      raw_status: r.success ? r.status : null,
    })),
  });

  return {
    success: true,
    total_trax_orders: traxOrders.length,
    rows_touched: updatedCount,
    status_changes: statusChangedCount,
    protocol_violations: protocolViolations.length,
    protocol_violations_sample: protocolViolations.slice(0, 5),
    api_errors: apiErrors.length,
    api_errors_sample: apiErrors.slice(0, 5),
    skipped_unmapped: skipped.length,
    skipped_sample: skipped.slice(0, 5),
    db_errors: dbErrors.length,
    duration_ms: Date.now() - startTime,
    message: `${statusChangedCount} status changes · ${protocolViolations.length} protocol violations blocked`,
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rules = await getSettings('business_rules');
    const lockedStatuses = rules['rules.locked_statuses'] ?? DEFAULT_LOCKED;
    const triggered_by = body.triggered_by || 'manual';
    const maxOrders = Math.min(body.max_orders || DEFAULT_MAX_ORDERS, 100);

    const result = await runSync({ triggered_by, lockedStatuses, maxOrders });
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
      .eq('courier', 'Trax')
      .eq('sync_type', 'status')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { count: traxTotal } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'Trax');

    const { count: traxDelivered } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'Trax')
      .eq('status', 'delivered');

    return NextResponse.json({
      success: true,
      last_sync: lastLog,
      total_trax_orders: traxTotal || 0,
      trax_delivered: traxDelivered || 0,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
