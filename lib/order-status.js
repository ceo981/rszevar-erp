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
