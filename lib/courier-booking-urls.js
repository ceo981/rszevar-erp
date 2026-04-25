// ============================================================================
// RS ZEVAR ERP — Courier Booking URL Helpers
// ----------------------------------------------------------------------------
// PHASE: Temporary bridge — jab tak ERP mein direct Leopards/PostEx booking
// APIs integrate na ho jayein. Staff ko Shopify access band karne ke baad,
// yahan se directly courier app khol sakte hain (Shopify admin ke andar
// jo embedded app hai), order data automatically pre-fill ho jata hai.
//
// USAGE: openCourierBooking('leopards', order.shopify_order_id)
//        Naya tab khulta hai → Shopify admin → courier app → all data prefilled
//
// URL pattern:
//   admin.shopify.com/store/{STORE_HANDLE}/apps/{APP_PATH}/...?id={ORDER_ID}
//   &shop={MYSHOPIFY_DOMAIN}
//
// MAINTAIN: Agar Shopify app updates kare ya app handle change ho, yahan URLs
// update kar lo. Sab callers automatically updated URLs use karenge.
// ============================================================================

// RS ZEVAR specific config — agar store change ho ya app rename ho toh yahan
// update karna hai (sirf 1 jagah, sab pages se share hota hai).
const STORE_HANDLE     = 'rszevar';
const MYSHOPIFY_DOMAIN = 'shades-shop-offical.myshopify.com';

const URL_TEMPLATES = {
  // Leopards — verified from screenshot Apr 25, 2026
  leopards: `https://admin.shopify.com/store/${STORE_HANDLE}/apps/leopards-courier-3/DirectBook/DirectManualBook?id={ORDER_ID}&shop=${MYSHOPIFY_DOMAIN}`,

  // PostEx — verified from screenshot Apr 25, 2026
  // App handle: postex-official
  // Path: couriers/postex/postex-booking.php
  // Note: PostEx ke URL mein shop param nahi hai (Shopify app khud handle karta).
  postex: `https://admin.shopify.com/store/${STORE_HANDLE}/apps/postex-official/couriers/postex/postex-booking.php?id={ORDER_ID}`,
};

/**
 * Constructs Shopify admin app URL for direct courier booking.
 * @param {'leopards'|'postex'} courier
 * @param {string|number} shopifyOrderId — ERP ke `shopify_order_id` column se
 * @returns {string|null} URL or null if courier not supported / order ID missing
 */
export function getCourierBookingUrl(courier, shopifyOrderId) {
  const template = URL_TEMPLATES[courier];
  if (!template) return null;
  if (!shopifyOrderId) return null;
  return template.replace('{ORDER_ID}', String(shopifyOrderId));
}

/**
 * Opens courier booking in a new tab.
 * @param {'leopards'|'postex'} courier
 * @param {string|number} shopifyOrderId
 * @returns {boolean} true if opened, false if URL couldn't be built
 */
export function openCourierBooking(courier, shopifyOrderId) {
  const url = getCourierBookingUrl(courier, shopifyOrderId);
  if (!url) {
    alert(`${courier.toUpperCase()} booking URL nahi bana — order ka shopify_order_id missing ho ya courier supported nahi.`);
    return false;
  }
  window.open(url, '_blank', 'noopener');
  return true;
}

// Display labels for UI
export const COURIER_LABELS = {
  leopards: 'Book at Leopards',
  postex:   'Book at PostEx',
};
