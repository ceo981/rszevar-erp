// ============================================================================
// RS ZEVAR ERP — Tag Definitions Library
// ============================================================================
// Reads tag_definitions table with a 60-second cache.
// Used by lib/shopify.js (transformOrder) to dynamically apply auto-actions
// based on tags, and by filter dropdown to build its menu.
// ============================================================================

import { createServerClient } from './supabase';

let cache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 1000;

async function loadTags() {
  if (cache && Date.now() < cacheExpiry) return cache;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('tag_definitions')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[tags] load error:', error.message);
    return cache || [];
  }

  cache = data || [];
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cache;
}

export function invalidateTagCache() {
  cache = null;
  cacheExpiry = 0;
}

// Get all active tag definitions
export async function getTagDefinitions() {
  return await loadTags();
}

// Get a single tag by key (lowercase lookup)
export async function getTagByKey(tagKey) {
  if (!tagKey) return null;
  const tags = await loadTags();
  return tags.find(t => t.tag_key === String(tagKey).toLowerCase()) || null;
}

// Given an array of Shopify tags, return matching definitions
export async function matchTagDefinitions(shopifyTags) {
  if (!Array.isArray(shopifyTags) || shopifyTags.length === 0) return [];
  const tags = await loadTags();
  const tagKeys = shopifyTags.map(t => String(t).toLowerCase().trim());
  return tags.filter(t => tagKeys.includes(t.tag_key));
}

// Apply auto-actions from tags to an order payload.
// `orderData` is the object we're about to upsert to DB.
// Mutates orderData in place AND returns it.
//
// Auto-action fields supported:
//   set_status    → orders.status
//   set_payment   → orders.payment_status
//   set_courier   → orders.dispatched_courier
//   set_flag      → orders.is_wholesale / is_international / is_walkin
//
// Also populates is_wholesale / is_international / is_walkin based on tag_key
// matching those specific keys (backward compat with filter system).
export async function applyTagActions(orderData, shopifyTags, businessRules = {}) {
  if (!Array.isArray(shopifyTags)) shopifyTags = [];
  const matched = await matchTagDefinitions(shopifyTags);

  // Type flags (these are hard-coded boolean columns in orders table)
  orderData.is_wholesale     = shopifyTags.includes('wholesale');
  orderData.is_international = shopifyTags.includes('international');
  orderData.is_walkin        = shopifyTags.includes('walkin');

  // Apply auto-actions — but respect business rules toggles
  for (const tag of matched) {
    const action = tag.auto_action || {};

    // Special case: walkin respects business rules toggles
    if (tag.tag_key === 'walkin') {
      if (action.set_status === 'delivered' && businessRules['rules.walkin_auto_deliver'] !== false) {
        orderData.status = 'delivered';
      }
      if (action.set_payment === 'paid' && businessRules['rules.walkin_auto_paid'] !== false) {
        orderData.payment_status = 'paid';
      }
      continue;
    }

    // Special case: order_confirmed respects toggle
    if (tag.tag_key === 'order_confirmed') {
      if (businessRules['rules.auto_confirm_tagged_orders'] !== false) {
        if (!orderData.status || orderData.status === 'pending') {
          orderData.status = 'confirmed';
        }
      }
      continue;
    }

    // Generic apply for custom tags
    if (action.set_status && !orderData.status) {
      orderData.status = action.set_status;
    }
    if (action.set_payment && (!orderData.payment_status || orderData.payment_status === 'unpaid')) {
      orderData.payment_status = action.set_payment;
    }
    if (action.set_courier) {
      orderData.dispatched_courier = action.set_courier;
    }
  }

  return orderData;
}
