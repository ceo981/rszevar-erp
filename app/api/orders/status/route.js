// ============================================================================
// RS ZEVAR ERP — Order Status Route  (FIXED Apr 2026)
// ----------------------------------------------------------------------------
// Changes from previous version:
//   1. Uses canTransition() guard — no more delivered → pending silent jumps
//   2. VALID_STATUSES imported from lib/order-status.js (single source of truth)
//   3. Blocks status='dispatched' via this endpoint — user must use /dispatch
//      flow so courier booking + Shopify fulfillment actually happen
//   4. Adds proper side-effects:
//        delivered  → delivered_at set, COD auto-paid
//        rto        → rto_at set
//        confirmed  → confirmed_at set (if not already)
//        cancelled  → redirects to /cancel (returns helpful error)
//   5. Pre-fetches current status so canTransition has real fromStatus
//
// May 8 2026 — `force` flag added (super_admin only):
//   Use case: staff galti se RTO/Returned/Delivered click karde → order stuck
//   ho jata terminal state mein → canTransition manual revert block kar deta.
//   Force mode:
//     - canTransition skip (terminal lock bypass)
//     - MINIMAL side-effect cleanup (sirf relevant timestamp clear, e.g. rto_at
//       jab from=rto). Tracking, dispatched_at, assignment, packing_log SAB
//       preserved — kyun ke order actually dispatch hua tha, sirf status
//       galat lagi thi.
//     - Auto-paid revert: agar from='delivered' aur payment_status='paid' tha
//       (COD auto-paid), wapas 'unpaid' kar dete hain (paisa actually nahi
//       mila tha agar delivery hi galat thi).
//   Role check: SERVER-SIDE — sirf super_admin/admin allowed. Client agar
//   force bheje aur user CEO nahi to 403.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import {
  canTransition,
  VALID_STATUSES,
  TERMINAL_STATUSES,
  computeStatusRevertSideEffects,
  applyStatusRevertSideEffects,
} from '@/lib/order-status';
import { markShopifyOrderAsPaid } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Statuses that must NOT be set via this thin status route — they need full workflows
// NOTE: 'dispatched' is NOT blocked here. Reason: in RS ZEVAR's normal flow, orders
// are booked on Shopify directly (PostEx/Leopards/Kangaroo Shopify apps). By the
// time dispatcher clicks "Mark as Dispatched" in ERP, tracking already exists via
// orders/fulfilled webhook. A second call to /api/orders/dispatch would create a
// DUPLICATE courier booking. So this route allows status='dispatched' with
// minimal side effects (sets dispatched_at). The /api/orders/dispatch endpoint
// is reserved for the secondary path: ERP-initiated booking via Kangaroo/
// Leopards modals (when Shopify booking was skipped).
const BLOCKED_VIA_STATUS_ROUTE = new Set([
  'cancelled',  // use /api/orders/cancel  — handles Shopify cancel + cancel_reason
]);

// Server-side role check helper for `force` mode (super_admin/admin only).
async function isCEORole(supabase, email) {
  if (!email) return false;
  const { data } = await supabase.from('profiles').select('role').eq('email', email).maybeSingle();
  const r = data?.role;
  return r === 'super_admin' || r === 'admin';
}

export async function POST(request) {
  const supabase = createServerClient();
  try {
    const { order_id, status, notes, performed_by, performed_by_email, force } = await request.json();

    if (!order_id || !status) {
      return NextResponse.json(
        { success: false, error: 'order_id aur status dono required hain' },
        { status: 400 },
      );
    }
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status: ${status}` },
        { status: 400 },
      );
    }
    if (BLOCKED_VIA_STATUS_ROUTE.has(status)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cancel /api/orders/cancel flow se karo (Shopify sync + cancel_reason ke saath)',
          use_endpoint: '/api/orders/cancel',
        },
        { status: 400 },
      );
    }

    // Server-side gate for force mode — super_admin/admin only.
    const wantsForce = force === true;
    if (wantsForce) {
      const allowed = await isCEORole(supabase, performed_by_email);
      if (!allowed) {
        return NextResponse.json(
          { success: false, error: 'Force revert sirf super_admin/admin kar sakte hain' },
          { status: 403 },
        );
      }
    }

    // Fetch minimal fields — only what we strictly need for logic.
    // Avoid reading optional timestamp columns (delivered_at, rto_at, dispatched_at)
    // which may not exist in schema. We'll just always write them fresh.
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('status, payment_status, payment_method, confirmed_at, shopify_order_id, order_number')
      .eq('id', order_id)
      .single();

    if (fetchErr) {
      console.error('[status] fetch error:', fetchErr.message);
      return NextResponse.json(
        { success: false, error: `DB error: ${fetchErr.message}` },
        { status: 500 },
      );
    }
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Central transition guard — blocks illegal moves like delivered → pending.
    // SKIP guard in force mode (CEO override for accidental terminal-state).
    if (!wantsForce) {
      const gate = canTransition(order.status, status, 'manual');
      if (!gate.allowed) {
        return NextResponse.json(
          { success: false, error: `Status change blocked: ${order.status} → ${status} (${gate.reason})` },
          { status: 400 },
        );
      }
    }

    // Build update payload with status-specific side effects
    const nowIso = new Date().toISOString();
    const patch = {
      status,
      updated_at: nowIso,
    };

    if (status === 'confirmed' && !order.confirmed_at) {
      patch.confirmed_at = nowIso;
    }
    if (status === 'dispatched') {
      // Shopify-booked flow: dispatcher manually flips status after Shopify fulfillment.
      // Tracking number + courier already came in via orders/fulfilled webhook.
      patch.dispatched_at = nowIso;
    }
    if (status === 'delivered') {
      patch.delivered_at = nowIso;
      // COD auto-paid rule — memory: `pending → confirmed → dispatched → delivered → paid`
      if (order.payment_method === 'COD' && order.payment_status === 'unpaid') {
        patch.payment_status = 'paid';
        patch.paid_at = nowIso;
      }
    }
    if (status === 'rto') {
      patch.rto_at = nowIso;
    }

    // Side-effect cleanup branch:
    //   - NORMAL mode: full computeStatusRevertSideEffects (clears tracking,
    //     assignment, packing_log when going backward — appropriate for legit
    //     workflow reverts like "dispatched → confirmed because we re-fulfilled").
    //   - FORCE mode (CEO override): MINIMAL cleanup. Only clear the timestamp
    //     for the FROM status (rto_at if from=rto, delivered_at if from=delivered).
    //     Tracking + dispatched_at + assignment + packing_log preserved kyun ke
    //     order actually dispatch hua tha — sirf final status galat lagi thi.
    let revert = { patchAdditions: {}, deleteAssignments: false, deletePackingLog: false, cleared: [] };
    if (!wantsForce) {
      revert = computeStatusRevertSideEffects(order.status, status);
    } else {
      // Force mode minimal cleanup
      if (order.status === 'rto')        { revert.patchAdditions.rto_at = null;       revert.cleared.push('rto_at'); }
      if (order.status === 'delivered')  { revert.patchAdditions.delivered_at = null; revert.cleared.push('delivered_at'); }
      // Returned/refunded ke specific timestamp columns nahi hain schema mein,
      // so just status flip + nothing to clear there.

      // Auto-paid revert (only if going OUT of delivered AND COD auto-paid)
      if (
        order.status === 'delivered' &&
        order.payment_method === 'COD' &&
        order.payment_status === 'paid'
      ) {
        revert.patchAdditions.payment_status = 'unpaid';
        revert.patchAdditions.paid_at = null;
        revert.cleared.push('payment_status', 'paid_at');
      }
    }
    Object.assign(patch, revert.patchAdditions);

    // Resilient UPDATE — if an optional timestamp column (delivered_at, rto_at,
    // paid_at) doesn't exist in schema, strip it and retry. dispatched_at,
    // confirmed_at are assumed to exist since older code writes to them.
    const OPTIONAL_COLS = ['delivered_at', 'rto_at', 'paid_at'];
    let updateErr = null;
    let attempt = 0;
    while (attempt < 3) {
      const { error } = await supabase
        .from('orders')
        .update(patch)
        .eq('id', order_id);
      if (!error) { updateErr = null; break; }
      updateErr = error;
      const missingCol = OPTIONAL_COLS.find(col =>
        String(error.message || '').toLowerCase().includes(col),
      );
      if (missingCol && patch[missingCol] !== undefined) {
        console.warn(`[status] column '${missingCol}' not in schema — skipping`);
        delete patch[missingCol];
        attempt++;
        continue;
      }
      break;
    }
    if (updateErr) throw updateErr;

    // Apply auxiliary table reverts (order_assignments, packing_log).
    // Best-effort — if these fail, order status is still updated correctly.
    let revertResult = { revertedFields: [], rowsRemoved: { assignments: 0, packing_log: 0 } };
    if (revert.deleteAssignments || revert.deletePackingLog) {
      try {
        revertResult = await applyStatusRevertSideEffects(supabase, order_id, revert);
      } catch (e) {
        console.error('[status] revert side-effects failed:', e.message);
      }
    } else if (wantsForce && revert.cleared.length > 0) {
      // Force mode — record what we cleared for activity log
      revertResult = { revertedFields: revert.cleared, rowsRemoved: { assignments: 0, packing_log: 0 } };
    }

    // Phase 2 (Apr 20 2026): if auto-paid happened (COD delivered flow), also
    // mark Shopify order as paid. Best-effort: failure doesn't roll back ERP.
    let shopifyPaidSynced = false;
    let shopifyPaidError = null;
    if (patch.payment_status === 'paid' && order.shopify_order_id) {
      try {
        await markShopifyOrderAsPaid(order.shopify_order_id);
        shopifyPaidSynced = true;
      } catch (e) {
        shopifyPaidError = e.message;
        console.error('[status] Shopify mark-as-paid sync error:', e.message);
      }
    }

    // Activity log — always attribute performer
    // Apr 2026: also note any side-effects that were reverted (assignment removed,
    // packing credit removed, tracking cleared) so the timeline is honest.
    let revertNote = '';
    if (revertResult.revertedFields.length > 0) {
      const parts = [];
      if (revertResult.rowsRemoved.assignments > 0) parts.push(`assignment removed`);
      if (revertResult.rowsRemoved.packing_log > 0) parts.push(`packing credit removed (${revertResult.rowsRemoved.packing_log} rows)`);
      if (revertResult.revertedFields.some(f => f.startsWith('tracking') || f === 'shopify_fulfillment_id')) parts.push(`tracking + fulfillment cleared`);
      if (revertResult.revertedFields.includes('dispatched_at')) parts.push(`dispatched_at cleared`);
      if (revertResult.revertedFields.includes('rto_at')) parts.push(`rto_at cleared`);
      if (revertResult.revertedFields.includes('delivered_at')) parts.push(`delivered_at cleared`);
      if (revertResult.revertedFields.includes('payment_status')) parts.push(`auto-paid reverted to unpaid`);
      if (parts.length > 0) revertNote = ` Side-effects reverted: ${parts.join(', ')}.`;
    }

    const baseAction = `status_changed_to_${status}`;
    const finalAction = wantsForce ? `${baseAction}_forced` : baseAction;
    const baseNote = notes || `${order.status} → ${status}`;
    const forcePrefix = wantsForce ? '⚡ FORCE REVERT (admin override) — ' : '';

    await supabase.from('order_activity_log').insert({
      order_id,
      action: finalAction,
      notes: forcePrefix + baseNote + revertNote,
      performed_by: performed_by || 'Staff',
      performed_by_email: performed_by_email || null,
      performed_at: nowIso,
    });

    // Additional log entry for the auto-paid side-effect — makes the Shopify
    // sync visible in timeline, same as manual /mark-paid route does.
    if (patch.payment_status === 'paid') {
      await supabase.from('order_activity_log').insert({
        order_id,
        action: 'payment_marked_paid',
        notes: [
          'Auto-paid on delivery (COD)',
          order.shopify_order_id
            ? (shopifyPaidSynced ? '(Shopify synced ✓)' : `(Shopify sync failed: ${shopifyPaidError || 'unknown'})`)
            : '(no Shopify order — ERP only)',
        ].filter(Boolean).join(' '),
        performed_by: performed_by || 'System (auto)',
        performed_by_email: performed_by_email || null,
        performed_at: nowIso,
      });
    }

    return NextResponse.json({
      success: true,
      from_status: order.status,
      to_status: status,
      forced: wantsForce,
      side_effects: {
        payment_auto_paid: patch.payment_status === 'paid',
        payment_auto_paid_reverted: patch.payment_status === 'unpaid' && order.status === 'delivered',
        delivered_at_set: !!patch.delivered_at,
        delivered_at_cleared: revert.patchAdditions.delivered_at === null,
        dispatched_at_set: !!patch.dispatched_at,
        rto_at_set: !!patch.rto_at,
        rto_at_cleared: revert.patchAdditions.rto_at === null,
        confirmed_at_set: !!patch.confirmed_at,
        shopify_paid_synced: shopifyPaidSynced,
        shopify_paid_error: shopifyPaidError,
      },
    });
  } catch (e) {
    console.error('[status] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
