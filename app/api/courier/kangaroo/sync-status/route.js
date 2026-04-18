// ============================================================================
// Kangaroo — Bulk Status Sync
// ----------------------------------------------------------------------------
// 2 phases in each run:
//   1. RECLASSIFY — orders jinka tracking 'KL%' se shuru hota hai magar
//      dispatched_courier 'Other'/null hai → mark them as 'Kangaroo'.
//   2. SYNC — har Kangaroo order ke liye Kangaroo API se tracking status
//      fetch karo, courier_status_raw save karo, and (if safe) office
//      status ko update karo. Same protocol-violation guards as Leopards.
//
// Kangaroo API per-order hi tracking deta hai (no bulk endpoint) — isliye
// we iterate with a small delay between calls (handled in lib/kangaroo.js).
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { trackKangarooBatch, mapKangarooStatus } from '../../../../../lib/kangaroo';
import { getSettings } from '../../../../../lib/settings';
import { evaluateAutomatedTransition } from '../../../../../lib/order-status';

const DEFAULT_LOCKED = ['delivered', 'returned', 'rto', 'cancelled', 'refunded'];
const DEFAULT_MAX_ORDERS = 50; // safety cap for 60s Vercel timeout

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── Phase 1: Reclassify ───────────────────────────────────────
// KL-prefix tracking numbers jo abhi 'Other'/null/'Kangaroo Logistics' etc.
// ke under hain, unhe proper 'Kangaroo' mein convert karo.
async function reclassifyKangarooOrders(supabase) {
  const { data: candidates, error } = await supabase
    .from('orders')
    .select('id, order_number, tracking_number, dispatched_courier')
    .not('tracking_number', 'is', null)
    .ilike('tracking_number', 'KL%')
    .or('dispatched_courier.is.null,dispatched_courier.neq.Kangaroo')
    .limit(1000);

  if (error) return { reclassified: 0, error: error.message };
  if (!candidates || candidates.length === 0) return { reclassified: 0 };

  const ids = candidates.map(c => c.id);
  const { error: updErr } = await supabase
    .from('orders')
    .update({ dispatched_courier: 'Kangaroo', updated_at: new Date().toISOString() })
    .in('id', ids);

  if (updErr) return { reclassified: 0, error: updErr.message };

  // Activity log entries — best-effort
  const logs = candidates.map(c => ({
    order_id: c.id,
    action: 'courier_reclassified',
    notes: `Tracking '${c.tracking_number}' → Kangaroo (was '${c.dispatched_courier || 'null'}')`,
    performed_by: 'Kangaroo Auto-Detect',
    performed_at: new Date().toISOString(),
  }));
  try {
    await supabase.from('order_activity_log').insert(logs);
  } catch (e) {
    console.error('[kangaroo-reclassify] log insert failed:', e.message);
  }

  return { reclassified: candidates.length };
}

// ─── Helper: extract raw status from Kangaroo API response ─────
// Kangaroo response shape varies — try common paths
function extractRawStatus(kangarooData) {
  if (!kangarooData) return null;
  // Most common: { status: 200, data: { booking_status / status / ... } }
  const d = kangarooData.data || kangarooData;
  return (
    d?.booking_status ||
    d?.status_name ||
    d?.current_status ||
    (typeof d?.status === 'string' ? d.status : null) ||
    null
  );
}

function extractDeliveryDate(kangarooData) {
  if (!kangarooData) return null;
  const d = kangarooData.data || kangarooData;
  return d?.delivered_at || d?.delivery_date || d?.delivered_on || null;
}

// ─── Phase 2: Sync status ──────────────────────────────────────
async function runSync({ triggered_by = 'manual', lockedStatuses, maxOrders }) {
  const startTime = Date.now();
  const supabase = createServerClient();

  // Phase 1 — reclassify first so we can sync them in Phase 2
  const reclassifyResult = await reclassifyKangarooOrders(supabase);

  // Phase 2 — fetch Kangaroo orders that need status check
  // Skip locked statuses at DB level to avoid wasting API calls
  const notInList = `(${lockedStatuses.join(',')})`;
  const { data: kangarooOrders, error: fetchErr } = await supabase
    .from('orders')
    .select('id, order_number, tracking_number, status, payment_status, courier_status_raw, courier_last_synced_at')
    .eq('dispatched_courier', 'Kangaroo')
    .not('tracking_number', 'is', null)
    .not('status', 'in', notInList)
    .order('updated_at', { ascending: false })
    .limit(maxOrders);

  if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);

  if (!kangarooOrders || kangarooOrders.length === 0) {
    // Still log the run so cron history is visible
    await supabase.from('courier_sync_log').insert({
      courier: 'Kangaroo',
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
      reclassified: reclassifyResult.reclassified,
      total_kangaroo_orders: 0,
      status_changes: 0,
      duration_ms: Date.now() - startTime,
      message: `${reclassifyResult.reclassified} reclassified · 0 Kangaroo orders to sync`,
    };
  }

  // Call Kangaroo API for each order (library handles per-call delay)
  const trackingNumbers = kangarooOrders.map(o => o.tracking_number);
  let trackResults;
  try {
    trackResults = await trackKangarooBatch(trackingNumbers);
  } catch (e) {
    throw new Error(`Kangaroo API batch failed: ${e.message}`);
  }

  const trackMap = new Map();
  for (const r of trackResults) trackMap.set(r.tracking, r);

  // Build per-order patches
  const updates = [];
  const protocolViolations = [];
  const skipped = [];
  const apiErrors = [];

  for (const order of kangarooOrders) {
    const trackRes = trackMap.get(order.tracking_number);
    if (!trackRes) continue;

    if (!trackRes.success) {
      apiErrors.push({ tracking: order.tracking_number, error: trackRes.error });
      continue;
    }

    const rawStatus = extractRawStatus(trackRes.data);
    const mappedStatus = mapKangarooStatus(rawStatus);

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

    // Locked status — passive update only
    if (lockedStatuses.includes(order.status)) {
      updates.push(patch);
      continue;
    }

    // Transition guard — same as Leopards
    const decision = evaluateAutomatedTransition(order.status, mappedStatus, 'courier_sync');

    if (decision.apply) {
      if (mappedStatus !== order.status) {
        patch.status = mappedStatus;
        if (mappedStatus === 'delivered') {
          const delDate = extractDeliveryDate(trackRes.data) || new Date().toISOString();
          patch.courier_delivered_at = delDate;
          patch.delivered_at = delDate;
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
        `Kangaroo says "${v.raw}" (mapped=${v.courier_says}) but office status is "${v.office_status}". ` +
        `Office flow skip hua — confirm/packed click nahi kiya. Office status unchanged.`,
      performed_by: 'Kangaroo Cron',
      performed_at: new Date().toISOString(),
    }));
    try {
      await supabase.from('order_activity_log').insert(violationLogs);
    } catch (e) {
      console.error('[kangaroo-sync] violation log insert failed:', e.message);
    }
  }

  // Final sync log
  const allErrors = [...apiErrors, ...dbErrors];
  await supabase.from('courier_sync_log').insert({
    courier: 'Kangaroo',
    sync_type: 'status',
    from_date: null,
    to_date: null,
    total_fetched: trackResults.length,
    matched_orders: kangarooOrders.length,
    updated_orders: statusChangedCount,
    errors: allErrors.length > 0 ? allErrors.slice(0, 10) : null,
    duration_ms: Date.now() - startTime,
    triggered_by,
    raw_sample: trackResults.slice(0, 3).map(r => ({
      tracking: r.tracking,
      success: r.success,
      raw_status: r.success ? extractRawStatus(r.data) : null,
    })),
  });

  return {
    success: true,
    reclassified: reclassifyResult.reclassified,
    total_kangaroo_orders: kangarooOrders.length,
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
    message: `${statusChangedCount} status changes · ${reclassifyResult.reclassified} reclassified · ${protocolViolations.length} protocol violations blocked`,
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
      .eq('courier', 'Kangaroo')
      .eq('sync_type', 'status')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { count: kangarooTotal } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'Kangaroo');

    const { count: kangarooDelivered } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'Kangaroo')
      .eq('status', 'delivered');

    return NextResponse.json({
      success: true,
      last_sync: lastLog,
      total_kangaroo_orders: kangarooTotal || 0,
      kangaroo_delivered: kangarooDelivered || 0,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
