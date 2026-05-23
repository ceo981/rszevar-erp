// ============================================================================
// RS ZEVAR ERP — Payment Method helper (May 22 2026 v2)
// ----------------------------------------------------------------------------
// Pure JS helper — no env vars, no server-only imports. Isi liye yeh file
// dono jagah safe import hoti hai:
//   - Server-side: lib/shopify.js (webhook transform path)
//   - Client-side: app/orders/[id]/page.js (display fallback for old orders
//     jinka payment_method DB mein generic 'COD' save hua hua hai)
//
// Logic detail aur priority lib/payment-method.js mein hi rakhi hai taa ke
// ek hi source of truth ho — server aur client dono mein.
// ============================================================================

// ── Constants ──────────────────────────────────────────────────────────────
// User ke 3 main payment buckets (UI display ke liye), plus mark-paid receipt
// methods (Bank Alfalah / Meezan Bank / Easypaisa / JazzCash / Cash) jo
// post-payment confirmation pe payment_method column overwrite karte hain.
//
// Yeh list export hoti hai taa ke create order page aur webhook validation
// dono same source se padhein.
export const SHOPIFY_PAYMENT_BUCKETS = ['COD', 'Bank Transfer', 'Card'];

// "Receipt methods" = mark-paid endpoint ke through set ki gayi values. In
// par webhook ka koi adjustment nahi hona chahiye (yeh staff ki manual
// payment recording hai, Shopify webhook se nahi aati).
export const RECEIPT_METHODS = new Set([
  'Cash', 'Bank Alfalah', 'Meezan Bank', 'Easypaisa', 'JazzCash', 'Manual',
]);

// ── Main derivation function ───────────────────────────────────────────────
// Multi-signal detection, priority order:
//   1. credit_card_company set (root.payment_details ya transactions[*])
//      → DEFINITIVE 'Card' signal. Pakistani processors pe gateway naam
//        unknown ho to bhi yeh field reliable hai jab payment capture hua ho.
//   2. Gateway naam:
//      a. COD patterns                      → 'COD'
//      b. manual / bank / deposit / transfer → 'Bank Transfer'
//      c. card processors + PK wallets       → 'Card'
//   3. Unknown gateway → as-is pass through + console log
export function derivePaymentMethod(shopifyOrder) {
  if (!shopifyOrder || typeof shopifyOrder !== 'object') return 'COD';

  // STEP 1 — credit_card_company (definitive Card signal) ─────────────────
  const rootCc = shopifyOrder.payment_details && shopifyOrder.payment_details.credit_card_company;
  if (rootCc && typeof rootCc === 'string' && rootCc.trim().length > 0) {
    return 'Card';
  }
  if (Array.isArray(shopifyOrder.transactions)) {
    for (const txn of shopifyOrder.transactions) {
      const txnCc = txn && txn.payment_details && txn.payment_details.credit_card_company;
      if (txnCc && typeof txnCc === 'string' && txnCc.trim().length > 0) {
        return 'Card';
      }
    }
  }

  // STEP 2 — Gateway / payment_gateway_names ───────────────────────────────
  const names = Array.isArray(shopifyOrder.payment_gateway_names)
    ? shopifyOrder.payment_gateway_names
    : [];
  const primary = String(names[0] || shopifyOrder.gateway || '').trim();
  if (!primary) return 'COD';

  const lower = primary.toLowerCase();

  // COD patterns
  if (
    lower === 'cod' ||
    lower.includes('cash on delivery') ||
    lower.includes('cash_on_delivery')
  ) {
    return 'COD';
  }

  // Bank-related — manual gateway + any name containing bank/deposit/transfer
  if (
    lower === 'manual' ||
    lower.includes('bank') ||
    lower.includes('deposit') ||
    lower.includes('transfer')
  ) {
    return 'Bank Transfer';
  }

  // Card / instant electronic payment (incl. Pakistani wallets)
  if (
    lower.includes('shopify_payments') ||
    lower.includes('shopify payments') ||
    lower.includes('stripe') ||
    lower.includes('paypal') ||
    lower === 'card' ||
    lower.includes('credit') ||
    lower.includes('debit') ||
    lower.includes('jazzcash') ||
    lower.includes('jazz cash') ||
    lower.includes('easypaisa') ||
    lower.includes('easy paisa') ||
    lower.includes('sadapay') ||
    lower.includes('nayapay') ||
    lower === 'checkout' ||
    lower.includes('2c2p') ||
    lower.includes('payfast') ||
    lower.includes('foree')
  ) {
    return 'Card';
  }

  // Unknown → log + pass through
  if (typeof console !== 'undefined' && console.log) {
    console.log(`[derivePaymentMethod] unknown gateway "${primary}" — passing through (order id: ${shopifyOrder.id || 'unknown'})`);
  }
  return primary;
}

// ── Effective display method (UI helper) ────────────────────────────────────
// Order detail page is se "actual" payment method derive karta hai. Priority:
//
//   1. Receipt method stored (Cash / Bank Alfalah / JazzCash / etc.) → trust it.
//      Yeh staff ki manual recording hai mark-paid se, authoritative.
//
//   2. Stored = ek valid bucket (COD / Bank Transfer / Card) → ALSO trust it.
//      Yeh ya to:
//        (a) ERP create order page se user ki explicit choice (sahi value),
//        (b) ya webhook se properly derive ho ke aaya (Shopify gateway clear tha).
//      Webhook lock (lib/shopify-webhook.js) iska preserve karta hai jab
//      Shopify se empty gateway ya conflicting derive ho.
//
//   3. Stored value generic/missing/legacy hai (e.g. blank, "Manual", purana
//      gibberish) AUR shopify_raw available hai → us se fresh derive karo.
//      Yeh purane stuck orders ke liye fallback hai jinka DB value reliable
//      nahi hai (e.g. purane buggy code se sab orders 'COD' save hote the).
//
//   4. Last resort: stored value as-is, ya 'COD'.
//
// IMPORTANT BUG FIX (May 22 2026 v3):
// Pehli version (v2) shopify_raw ko stored ke UPAR prefer karta tha. Iska
// natija: ERP-created COD orders display pe "Bank Transfer" dikhate the
// (kyunki Shopify side `gateway='manual'` set kar deta hai jab draft order
// `payment_pending=true` ke saath complete hota hai — Shopify COD/Bank
// Transfer dono ko "manual" gateway type deta hai). DB sahi tha (COD), bas
// display galat tha. Ab stored bucket-value ko fresh derive ke UPAR trust
// karte hain.
export function effectivePaymentMethod(order) {
  if (!order) return 'COD';
  const stored = order.payment_method;

  // STEP 1: Receipt methods always win (staff-set, authoritative)
  if (stored && RECEIPT_METHODS.has(stored)) return stored;

  // STEP 2: Valid bucket stored? Trust it. (Yeh user ki explicit choice hai
  // ERP create page se, ya webhook ka clean derive — dono cases mein DB
  // reliable hai.)
  if (stored && SHOPIFY_PAYMENT_BUCKETS.includes(stored)) return stored;

  // STEP 3: Stored value generic/missing → shopify_raw se fresh derive.
  // Yeh purane stuck orders ke liye safety net hai (e.g. DB mein blank,
  // null, ya garbage value).
  if (order.shopify_raw && typeof order.shopify_raw === 'object') {
    const fromRaw = derivePaymentMethod(order.shopify_raw);
    if (fromRaw) return fromRaw;
  }

  // STEP 4: Last resort
  return stored || 'COD';
}
