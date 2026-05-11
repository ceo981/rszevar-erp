// ============================================================================
// RS ZEVAR ERP — Order Line Item Helpers
// ----------------------------------------------------------------------------
// Shared utilities for matching DB `order_items` rows to their corresponding
// Shopify `shopify_raw.line_items` entries, and enriching them with discount
// metadata (original_unit_price, effective_unit_price, line_discount).
//
// FIX May 2026 — Variant cross-matching bug:
// Previous inline matching logic used an OR'd `find()` predicate where one
// branch was `item.title.startsWith(r.title)`. Shopify line_items expose the
// product title and variant_title as SEPARATE fields (line_item.title is the
// base product name, line_item.variant_title is the variant). When an order
// contained multiple variants of the same product, both raw line items shared
// an identical `title` value, so the title-prefix check would match against
// whichever raw item happened to come first in iteration.
//
// Repro: Order ZEVAR-119281 had 2 variants of "Traditional Kashmiri Chand
// Bali Earrings with Ghungroo" — Antique (qty 2, total_discount Rs 700) and
// Silver (qty 1, total_discount Rs 350). Silver was getting matched to
// Antique's raw row, picking up Rs 700 of discount on its single unit,
// displaying effective price as Rs 150 (correct: Rs 500).
//
// Fix: priority-ordered matching (strictest first), with title-prefix kept
// only as a last resort and ONLY when exactly one candidate matches — so a
// genuinely unique single-line title fallback still works for legacy data,
// but multi-variant orders no longer cross-match.
// ============================================================================

/**
 * Active line item filter — excludes items removed via Shopify Order Edit
 * (current_quantity === 0). Removed items stay in the line_items array for
 * history but should not participate in pricing/display.
 */
export function isActiveRawLineItem(it) {
  if (it?.current_quantity !== undefined && it?.current_quantity !== null) {
    return it.current_quantity > 0;
  }
  return (it?.quantity || 0) > 0;
}

/**
 * Find the Shopify raw line item that corresponds to a DB order_items row.
 * Tries match strategies in priority order — most reliable first.
 *
 * @param {object} item            — DB order_items row (or shaped equivalent)
 * @param {Array}  rawLineItems    — already filtered list of active raw items
 * @returns {object|null}
 */
export function findMatchingRawLineItem(item, rawLineItems) {
  if (!rawLineItems || rawLineItems.length === 0) return null;

  // Priority 1 — shopify_line_item_id (exact, most reliable)
  if (item.shopify_line_item_id) {
    const byId = rawLineItems.find(
      (r) => String(r.id) === String(item.shopify_line_item_id),
    );
    if (byId) return byId;
  }

  // Priority 2 — SKU + quantity (uniquely pins down a variant in most orders)
  if (item.sku) {
    const bySkuQty = rawLineItems.find(
      (r) => r.sku === item.sku && r.quantity === item.quantity,
    );
    if (bySkuQty) return bySkuQty;

    // Priority 3 — SKU alone (handles cases where qty was edited post-sync)
    const bySku = rawLineItems.find((r) => r.sku === item.sku);
    if (bySku) return bySku;
  }

  // Priority 4 — full title incl. variant (handles SKU-less / legacy items)
  if (item.title) {
    const byFullTitle = rawLineItems.find((r) => {
      const fullRawTitle =
        (r.title || '') + (r.variant_title ? ` - ${r.variant_title}` : '');
      return fullRawTitle === item.title;
    });
    if (byFullTitle) return byFullTitle;

    // Priority 5 (last resort) — title prefix, ONLY if exactly one candidate
    // matches. Prevents cross-variant matching when multiple raw items share
    // a base product title (the original bug). Single-candidate prefix is
    // still safe for legacy orders where variant_title may be missing.
    const prefixCandidates = rawLineItems.filter(
      (r) => r.title && item.title.startsWith(r.title),
    );
    if (prefixCandidates.length === 1) return prefixCandidates[0];
  }

  return null;
}

/**
 * Enrich a DB order_items row with discount metadata sourced from its
 * matching Shopify raw line item.
 *
 * Added fields on returned object:
 *   - original_unit_price : raw.price (Shopify line item unit price)
 *   - effective_unit_price: original − (line_discount / qty)
 *   - line_discount       : raw.total_discount (line-level discount sum)
 *   - has_line_discount   : true when line_discount > 0.01
 *
 * @param {object} item         — DB order_items row
 * @param {Array}  rawLineItems — active raw line items for the order
 * @returns {object}            — `item` shallow-copied with added fields
 */
export function enrichItemWithDiscount(item, rawLineItems) {
  const raw = findMatchingRawLineItem(item, rawLineItems);
  const rawDiscount = raw ? parseFloat(raw.total_discount) || 0 : 0;
  const rawPrice = raw
    ? parseFloat(raw.price) || 0
    : parseFloat(item.unit_price || 0);
  const qty = item.quantity || 1;
  const effectiveUnitPrice =
    qty > 0 ? rawPrice - rawDiscount / qty : rawPrice;
  return {
    ...item,
    original_unit_price: rawPrice,
    effective_unit_price: effectiveUnitPrice,
    line_discount: rawDiscount,
    has_line_discount: rawDiscount > 0.01,
  };
}

/**
 * Compute the GROSS subtotal — sum of (original_unit_price × quantity) across
 * all line items. Use this for display when you want the pre-discount value
 * so that `Subtotal − Discount = Total` math reads correctly in the UI.
 *
 * Shopify's `current_subtotal_price` is POST line-item discounts, while
 * `current_total_discounts` is the full discount sum — displaying both as-is
 * makes the math look broken (subtotal − discount ≠ total). Gross subtotal
 * derived from enriched line items fixes that and matches what users see in
 * the items list above.
 *
 * Items MUST be already enriched via `enrichItemWithDiscount` so that
 * `original_unit_price` is populated. Falls back to `unit_price` if missing.
 *
 * @param {Array} items — enriched line items
 * @returns {number}
 */
export function computeGrossSubtotal(items) {
  if (!items || items.length === 0) return 0;
  return items.reduce(
    (sum, it) =>
      sum +
      (parseFloat(it.original_unit_price) ||
        parseFloat(it.unit_price) ||
        0) *
        (parseInt(it.quantity) || 0),
    0,
  );
}
