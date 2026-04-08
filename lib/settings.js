// ============================================================================
// RS ZEVAR ERP — Settings Library
// ============================================================================
// Centralized read/write for erp_settings_v2 with 60-second in-memory cache.
// Server-side only (uses service role key).
//
// Usage:
//   import { getSetting, getSettings, setSetting } from '@/lib/settings';
//
//   const walkinAutoDeliver = await getSetting('rules.walkin_auto_deliver', true);
//   const allRules = await getSettings('business_rules');
//   await setSetting('store.name', 'RS ZEVAR', { userId, email });
// ============================================================================

import { createServerClient } from './supabase';

// ─── 60-second cache ───────────────────────────────────────────────────────
// Settings rarely change. Caching avoids a DB query on every API call.
// Cache is per serverless instance — will be warm after first hit.
let cache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 1000;

async function loadAllSettings() {
  if (cache && Date.now() < cacheExpiry) return cache;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('erp_settings_v2')
    .select('key, value, category');

  if (error) {
    console.error('[settings] load error:', error.message);
    return cache || {}; // fall back to stale cache if available
  }

  const map = {};
  (data || []).forEach(row => {
    map[row.key] = { value: row.value, category: row.category };
  });

  cache = map;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return map;
}

export function invalidateSettingsCache() {
  cache = null;
  cacheExpiry = 0;
}

// ─── Get a single setting ──────────────────────────────────────────────────
// Returns the jsonb value directly (unwrapped).
// fallback is used if key doesn't exist in DB.
export async function getSetting(key, fallback = null) {
  const all = await loadAllSettings();
  if (!all[key]) return fallback;
  return all[key].value;
}

// ─── Get all settings in a category ───────────────────────────────────────
// Returns { key: value } object.
export async function getSettings(category = null) {
  const all = await loadAllSettings();
  const result = {};
  Object.entries(all).forEach(([key, row]) => {
    if (!category || row.category === category) {
      result[key] = row.value;
    }
  });
  return result;
}

// ─── Get all settings with full metadata (for settings UI) ────────────────
export async function getAllSettingsWithMeta() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('erp_settings_v2')
    .select('*')
    .order('category', { ascending: true })
    .order('key', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ─── Update a single setting ──────────────────────────────────────────────
// user = { id, email, role } — required for audit trail
// Only super_admin is allowed at API route level; this lib doesn't enforce,
// the API route must check permissions before calling.
export async function setSetting(key, value, user) {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('erp_settings_v2')
    .update({
      value,
      updated_at: new Date().toISOString(),
      updated_by: user?.id || null,
      updated_by_email: user?.email || null,
    })
    .eq('key', key)
    .select()
    .single();

  if (error) throw error;

  invalidateSettingsCache();
  return data;
}

// ─── Bulk update (for settings page save-all) ─────────────────────────────
// updates = { 'store.name': 'RS ZEVAR', 'rules.cod_overdue_days': 20 }
export async function setSettingsBulk(updates, user) {
  const supabase = createServerClient();
  const results = [];
  const errors = [];

  for (const [key, value] of Object.entries(updates)) {
    const { data, error } = await supabase
      .from('erp_settings_v2')
      .update({
        value,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
        updated_by_email: user?.email || null,
      })
      .eq('key', key)
      .select()
      .maybeSingle();

    if (error) {
      errors.push({ key, error: error.message });
    } else if (data) {
      results.push(data);
    }
  }

  invalidateSettingsCache();
  return { results, errors };
}

// ─── Convenience helpers for common checks ────────────────────────────────

export async function isWalkinAutoDeliver() {
  return await getSetting('rules.walkin_auto_deliver', true);
}

export async function isWalkinAutoPaid() {
  return await getSetting('rules.walkin_auto_paid', true);
}

export async function isAutoConfirmPaid() {
  return await getSetting('rules.auto_confirm_paid_orders', true);
}

export async function isAutoConfirmTagged() {
  return await getSetting('rules.auto_confirm_tagged_orders', true);
}

export async function getLockedStatuses() {
  return await getSetting('rules.locked_statuses', ['delivered', 'returned', 'rto', 'cancelled', 'refunded']);
}

export async function getShopifySyncWindowDays() {
  return await getSetting('rules.shopify_sync_window_days', 3);
}

export async function getLeopardsSyncWindowDays() {
  return await getSetting('rules.leopards_sync_window_days', 10);
}
