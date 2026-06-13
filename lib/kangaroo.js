// ============================================================================
// RS ZEVAR ERP — Kangaroo Courier API Client
// ----------------------------------------------------------------------------
// JUN 2026 HARDENING: per-call AbortController timeout (8s) taake ek hangi call
// poora budget na khaye, aur trackKangarooBatch ab sequential 200ms-delay loop
// ke bajaye concurrency pool + optional deadline use karta hai (Trax/Sonic jaisa).
// Isse Kangaroo sync 60s Vercel timeout (504) cross nahi karta.
// ============================================================================

const KANGAROO_BASE = 'https://api.kangaroo.pk';

const DEFAULT_TIMEOUT_MS = 8000;

let _cachedToken = null;
let _cachedUserId = null;
let _tokenExpiry = null;

function getCredentials() {
  const username = process.env.KANGAROO_USERNAME;
  const password = process.env.KANGAROO_PASSWORD;
  if (!username || !password) {
    throw new Error('Kangaroo credentials missing: set KANGAROO_USERNAME and KANGAROO_PASSWORD in Vercel env vars');
  }
  return { username, password };
}

// fetch with AbortController timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      const err = new Error(`Kangaroo request timeout after ${timeoutMs}ms`);
      err.kind = 'timeout';
      throw err;
    }
    if (e && e.kind === undefined) e.kind = 'network';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function getKangarooToken() {
  if (_cachedToken && _tokenExpiry && Date.now() < _tokenExpiry - 5 * 60 * 1000) {
    return { token: _cachedToken, userId: _cachedUserId };
  }

  const { username, password } = getCredentials();

  const res = await fetchWithTimeout(`${KANGAROO_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Client-Service': 'kangaroo',
      'Auth-Key': 'kangaroo',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(`Kangaroo auth HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }

  const text = await res.text();
  if (!text || text.trim() === '') {
    throw new Error('Kangaroo auth: empty response (check credentials)');
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Kangaroo auth: invalid JSON — ${text.slice(0, 100)}`);
  }

  if (data.status !== 200 && data.status !== '200') {
    throw new Error(`Kangaroo auth failed: ${data.message || JSON.stringify(data)}`);
  }

  _cachedToken = data.key;
  _cachedUserId = String(data.id); // numeric ID e.g. "549"
  _tokenExpiry = data.expiring_at ? new Date(data.expiring_at).getTime() : Date.now() + 23 * 60 * 60 * 1000;

  return { token: _cachedToken, userId: _cachedUserId };
}

export async function trackKangarooOrder(trackingNumber) {
  const { token, userId } = await getKangarooToken();

  const res = await fetchWithTimeout(`${KANGAROO_BASE}/order/track/${encodeURIComponent(trackingNumber)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Client-Service': 'kangaroo',
      'Auth-Key': 'kangaroo',
      'Auth-Token': token,
      'User-ID': userId,
    },
  });

  if (!res.ok) {
    throw new Error(`Kangaroo track HTTP ${res.status} for ${trackingNumber}`);
  }

  const text = await res.text();
  if (!text || text.trim() === '') {
    throw new Error(`Kangaroo track: empty response for ${trackingNumber}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Kangaroo track: invalid JSON for ${trackingNumber} — ${text.slice(0, 100)}`);
  }
}

// ─── Batch — concurrency pool with optional time budget ─────────────────────
// Pehle: sequential loop + 200ms delay (50 orders ≈ 60s+, Vercel 504 timeout).
// Ab: chunks of `concurrency` (default 5) parallel. `deadlineMs` ke baad naye
// calls issue nahi hote — jo reh gaye agle run mein (caller sirf un orders ko
// update karta hai jinka result mila). Token cached hai, to concurrency safe.
export async function trackKangarooBatch(trackingNumbers, opts = {}) {
  const concurrency = Math.max(1, opts.concurrency || 5);
  const deadlineMs = opts.deadlineMs || 0;

  const list = Array.isArray(trackingNumbers) ? trackingNumbers : [trackingNumbers];
  const valid = list.filter(Boolean).map(String);
  const results = [];
  const startedAt = Date.now();
  let budgetHit = false;

  // Pre-warm token once (so concurrent calls don't all race to auth)
  try {
    await getKangarooToken();
  } catch (e) {
    // token fail → har call waise bhi fail karegi; mark all and return
    for (const tn of valid) {
      results.push({ tracking: tn, error: `auth failed: ${e.message}`, kind: e.kind || 'auth', success: false });
    }
    results.budgetHit = false;
    results.attempted = results.length;
    results.total = valid.length;
    return results;
  }

  for (let i = 0; i < valid.length; i += concurrency) {
    if (deadlineMs && Date.now() - startedAt > deadlineMs) {
      budgetHit = true;
      break;
    }

    const chunk = valid.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map(tn => trackKangarooOrder(tn)));

    settled.forEach((s, idx) => {
      const tn = chunk[idx];
      if (s.status === 'fulfilled') {
        results.push({ tracking: tn, data: s.value, success: true });
      } else {
        const reason = s.reason;
        results.push({
          tracking: tn,
          error: (reason && reason.message) ? reason.message : String(reason),
          kind: (reason && reason.kind) ? reason.kind : 'unknown',
          success: false,
        });
      }
    });
  }

  results.budgetHit = budgetHit;
  results.attempted = results.length;
  results.total = valid.length;
  return results;
}

export function mapKangarooStatus(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();

  // Terminal states — authoritative
  if (s === 'delivered' || s.includes('delivered')) return 'delivered';
  if (s.includes('return') || s.includes('rto') || s.includes('undelivered') || s.includes('refused')) return 'rto';
  if (s.includes('cancel')) return 'cancelled';

  // Active delivery states — parcel is definitively moving
  if (s.includes('out for') || s.includes('transit') || s.includes('shipped')) return 'dispatched';
  if (s.includes('picked') || s.includes('pickup')) return 'dispatched';
  if (s.includes('dispatch')) return 'dispatched';
  // Kangaroo-specific — "Onroute" / "On Route" / "Enroute" = rider has parcel, en route to customer
  if (s.includes('onroute') || s.includes('on route')) return 'dispatched';
  if (s.includes('enroute') || s.includes('en route')) return 'dispatched';

  // Exception states
  if (s.includes('attempt')) return 'attempted';
  if (s.includes('hold')) return 'hold';

  // "Confirm" / "Booked" / "Created" / "Pending" — early-stage courier states.
  // These states can exist BEFORE the parcel is physically picked up. We do
  // NOT auto-promote office status on these. Raw status still visible in UI
  // via courier_status_raw column. When Kangaroo transitions to Picked/Transit/
  // Delivered/RTO, office status updates automatically.

  return null;
}
