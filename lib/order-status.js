// ============================================================================
// ORDER STATUS — Central transition guard
// ----------------------------------------------------------------------------
// Rule (CEO protocol): Office status change tabhi hoga jab koi ERP button
// explicitly click kare. Koi bhi AUTOMATED source (courier cron / Shopify
// webhook) office status ko PRE_DISPATCH zone se POST_DISPATCH zone mein
// promote nahi kar sakta. Agar courier bahar se tracking bhej de magar ERP
// mein click nahi hua to sirf courier_status_raw save hoga, office status
// untouched rahega aur ek "protocol violation" log ho jayega.
// ============================================================================

// All valid ERP office statuses
export const VALID_STATUSES = [
  'pending', 'confirmed', 'on_packing', 'processing', 'packed',
  'dispatched', 'delivered', 'attempted', 'hold',
  'cancelled', 'rto', 'returned', 'refunded',
];

// Pre-dispatch zone — changes here MUST be manual UI clicks
export const PRE_DISPATCH_STATUSES = [
  'pending', 'confirmed', 'on_packing', 'processing', 'packed', 'hold',
];

// Post-dispatch zone — courier-driven progression is OK here
export const POST_DISPATCH_STATUSES = [
  'dispatched', 'attempted', 'delivered', 'rto', 'returned',
];

// Terminal — automated sources can't revert these
export const TERMINAL_STATUSES = [
  'delivered', 'cancelled', 'rto', 'returned', 'refunded',
];

/**
 * Decide if a status transition is allowed from a given source.
 *
 * @param {string} fromStatus - current order.status
 * @param {string} toStatus - proposed new status
 * @param {'manual'|'courier_sync'|'shopify_webhook'} source
 * @returns {{allowed: boolean, reason?: string}}
 */
export function canTransition(fromStatus, toStatus, source = 'manual') {
  if (!toStatus || !VALID_STATUSES.includes(toStatus)) {
    return { allowed: false, reason: `invalid_target_status:${toStatus}` };
  }
  if (!fromStatus) {
    // new row — any valid target is fine
    return { allowed: true };
  }
  if (fromStatus === toStatus) {
    return { allowed: false, reason: 'noop' };
  }

  // -------------------------------------------------------------------------
  // MANUAL — user ne ERP ka button click kiya. UI already button visibility
  // se flow gate karta hai (Mark as Packed sirf on_packing pe, Mark as
  // Dispatched sirf packed pe, etc). Sirf terminal states ko lock karte hain.
  // -------------------------------------------------------------------------
  if (source === 'manual') {
    // cancelled se dobara open karna allowed — CEO override scenarios
    if (TERMINAL_STATUSES.includes(fromStatus) && fromStatus !== 'cancelled') {
      return { allowed: false, reason: `terminal_status:${fromStatus}` };
    }
    return { allowed: true };
  }

  // -------------------------------------------------------------------------
  // AUTOMATED (courier_sync, shopify_webhook)
  // -------------------------------------------------------------------------

  // HARD RULE: pre-dispatch se post-dispatch promote karna BANNED from automation
  // Ye tumhara main scenario hai — confirm button daba na ho, courier pe tracking
  // lagi, cron ne pending → dispatched mar diya. Ye block hoga.
  if (
    PRE_DISPATCH_STATUSES.includes(fromStatus) &&
    POST_DISPATCH_STATUSES.includes(toStatus)
  ) {
    return {
      allowed: false,
      reason: `protocol_violation:${source}_cannot_promote_${fromStatus}_to_${toStatus}`,
    };
  }

  // Pre-dispatch se pre-dispatch bhi automation se nahi badle
  // (e.g. automation confirmed → on_packing nahi kar sakti)
  if (
    PRE_DISPATCH_STATUSES.includes(fromStatus) &&
    PRE_DISPATCH_STATUSES.includes(toStatus)
  ) {
    return {
      allowed: false,
      reason: `${source}_cannot_change_pre_dispatch:${fromStatus}_to_${toStatus}`,
    };
  }

  // Post-dispatch zone ke andar forward progression allowed
  // (dispatched → attempted → delivered, etc.)
  if (
    POST_DISPATCH_STATUSES.includes(fromStatus) &&
    POST_DISPATCH_STATUSES.includes(toStatus)
  ) {
    // Terminal se revert silently nahi hoga
    if (TERMINAL_STATUSES.includes(fromStatus)) {
      return { allowed: false, reason: `cannot_revert_from_terminal:${fromStatus}` };
    }
    return { allowed: true };
  }

  // Post-dispatch se pre-dispatch (e.g. Shopify fulfillment cancelled)
  // Ye sirf specific webhooks se hota hai — un mein source ko 'manual' treat
  // karo kyunki wo explicit order-lifecycle event hai.
  if (
    POST_DISPATCH_STATUSES.includes(fromStatus) &&
    PRE_DISPATCH_STATUSES.includes(toStatus)
  ) {
    return {
      allowed: false,
      reason: `${source}_cannot_revert_post_dispatch:${fromStatus}_to_${toStatus}`,
    };
  }

  return { allowed: false, reason: 'unknown_transition' };
}

/**
 * Convenience: for courier/shopify sync code, apply a proposed status update
 * safely. Returns { apply, blocked, reason } so the caller knows whether to
 * write `patch.status = toStatus` or skip the status write (but still save
 * courier_status_raw).
 *
 * @param {string} fromStatus
 * @param {string} toStatus
 * @param {'courier_sync'|'shopify_webhook'} source
 */
export function evaluateAutomatedTransition(fromStatus, toStatus, source) {
  const result = canTransition(fromStatus, toStatus, source);
  return {
    apply: result.allowed,
    blocked: !result.allowed && result.reason?.startsWith('protocol_violation'),
    reason: result.reason || null,
  };
}

// ============================================================================
// Apr 2026 — Status downgrade side-effect cleanup
// ============================================================================
// When a user FORCE-changes status (via /api/orders/status or bulk route) to
// an earlier point in the workflow, the side-effects from later stages should
// be reverted too. Otherwise a dispatched-then-reverted-to-confirmed order
// keeps tracking + dispatched_at + assignment + packing_log credit — wrong
// state for a "back to confirmed" intent.
//
// Levels in the office workflow (chronological):
//   Level 1 — pending          (no fulfillment, no assignment, no tracking)
//   Level 2 — confirmed        (no fulfillment, no assignment, no tracking)
//   Level 3 — on_packing       (fulfilled — has tracking + assignment valid)
//   Level 4 — packed           (assignment + packing_log credit valid)
//   Level 5 — dispatched       (dispatched_at set)
//   Level 6 — delivered/rto    (delivered_at / rto_at set)
//
// Exception states (hold/attempted) treated as Level 2-equivalent — they're
// pre-fulfillment side branches.
//
// Returns { patchAdditions, deleteAssignments, deletePackingLog } for the
// caller to apply alongside its main UPDATE.
export function computeStatusRevertSideEffects(fromStatus, toStatus) {
  const result = {
    patchAdditions: {},     // extra fields to set null on the orders row
    deleteAssignments: false,
    deletePackingLog: false,
    cleared: [],            // human-readable list for activity log
  };

  // Level mapping
  const LEVEL = {
    pending: 1, confirmed: 2, hold: 2, attempted: 2,
    on_packing: 3, processing: 3,
    packed: 4,
    dispatched: 5,
    delivered: 6, rto: 6, returned: 6, refunded: 6,
    cancelled: 1,        // cancel route handles its own cleanup; treat as level 1
  };

  const fromLevel = LEVEL[fromStatus] ?? 0;
  const toLevel   = LEVEL[toStatus]   ?? 0;

  // Only act if going BACKWARDS in the workflow
  if (toLevel >= fromLevel) return result;

  // Always: if going below dispatched (level 5), clear dispatched_at + delivered_at + rto_at
  if (toLevel < 5 && fromLevel >= 5) {
    result.patchAdditions.dispatched_at = null;
    result.cleared.push('dispatched_at');
  }
  if (toLevel < 6 && fromLevel >= 6) {
    result.patchAdditions.delivered_at = null;
    result.patchAdditions.rto_at = null;
    result.cleared.push('delivered_at', 'rto_at');
  }

  // Going below on_packing (level 3): no longer fulfilled — clear fulfillment
  // metadata (tracking, courier, fulfillment_id) regardless of how it got set.
  if (toLevel < 3) {
    result.patchAdditions.tracking_number = null;
    result.patchAdditions.dispatched_courier = null;
    result.patchAdditions.courier_tracking_url = null;
    result.patchAdditions.shopify_fulfillment_id = null;
    result.patchAdditions.shopify_fulfilled_at = null;
    result.cleared.push('tracking_number', 'dispatched_courier', 'shopify_fulfillment_id');
  }

  // Going below packed (level 4): packing credit no longer valid
  if (toLevel < 4 && fromLevel >= 4) {
    result.deletePackingLog = true;
    result.cleared.push('packing_log_credit');
  }

  // Going below on_packing (level 3): assignment no longer valid (pre-fulfill)
  if (toLevel < 3) {
    result.deleteAssignments = true;
    result.cleared.push('order_assignments');
  }

  return result;
}

// Convenience: apply the revert side-effects (writes to DB + adds patch fields).
// Returns { revertedFields: [...], rowsRemoved: { assignments, packing_log } }.
// Caller should merge `patchAdditions` into its own UPDATE patch BEFORE calling
// this — so we hit the DB once for the orders row. This helper handles the
// auxiliary tables (order_assignments, packing_log) only.
export async function applyStatusRevertSideEffects(supabase, orderId, sideEffects) {
  const { deleteAssignments, deletePackingLog } = sideEffects;
  const removed = { assignments: 0, packing_log: 0 };

  if (deleteAssignments) {
    const { count } = await supabase
      .from('order_assignments')
      .delete({ count: 'exact' })
      .eq('order_id', orderId);
    removed.assignments = count || 0;
  }

  if (deletePackingLog) {
    const { count } = await supabase
      .from('packing_log')
      .delete({ count: 'exact' })
      .eq('order_id', orderId);
    removed.packing_log = count || 0;
  }

  return { revertedFields: sideEffects.cleared, rowsRemoved: removed };
}
