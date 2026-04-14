// ============================================================================
// RS ZEVAR ERP — Kangaroo Courier API Client
// ============================================================================
// Endpoints used (read-only for ERP tracker):
//   - getKangarooToken()          — auth token lao (auto-cached)
//   - trackKangarooOrder(orderId) — single order status
//   - trackKangarooBatch(ids[])   — multiple orders (sequential)
// ============================================================================

const KANGAROO_BASE = 'https://api.kangaroo.pk';

// In-memory token cache (per Vercel instance)
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

// ─── Generate / Refresh Token ──────────────────────────────────────────────
export async function getKangarooToken() {
  // Return cached if still valid (with 5 min buffer)
  if (_cachedToken && _tokenExpiry && Date.now() < _tokenExpiry - 5 * 60 * 1000) {
    return { token: _cachedToken, userId: _cachedUserId };
  }

  const { username, password } = getCredentials();

  const res = await fetch(`${KANGAROO_BASE}/auth/login`, {
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

  const data = await res.json();

  if (data.status !== 200 && data.status !== '200') {
    throw new Error(`Kangaroo auth failed: ${data.message || JSON.stringify(data)}`);
  }

  _cachedToken = data.key;
  _cachedUserId = String(data.id);
  // Parse expiry — format: "2020-01-01 03:16:31"
  _tokenExpiry = data.expiring_at ? new Date(data.expiring_at).getTime() : Date.now() + 23 * 60 * 60 * 1000;

  return { token: _cachedToken, userId: _cachedUserId };
}

// ─── Track Single Order ────────────────────────────────────────────────────
// orderId = Kangaroo tracking number e.g. KN123456789
export async function trackKangarooOrder(trackingNumber) {
  const { token, userId } = await getKangarooToken();

  const res = await fetch(`${KANGAROO_BASE}/order/track/${encodeURIComponent(trackingNumber)}`, {
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

  const data = await res.json();
  return data; // { orderid, transaction_id, Clientname, Orderstatus }
}

// ─── Track Multiple Orders (sequential with delay) ─────────────────────────
export async function trackKangarooBatch(trackingNumbers) {
  const results = [];
  for (const tn of trackingNumbers) {
    try {
      const data = await trackKangarooOrder(tn);
      results.push({ tracking: tn, data, success: true });
    } catch (err) {
      results.push({ tracking: tn, error: err.message, success: false });
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

// ─── Map Kangaroo Status → ERP Status ──────────────────────────────────────
export function mapKangarooStatus(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();

  // Delivered
  if (s.includes('delivered') || s.includes('delivery') || s === 'delivered') return 'delivered';

  // Returned / RTO
  if (s.includes('return') || s.includes('rto') || s.includes('undelivered')) return 'returned';

  // Cancelled
  if (s.includes('cancel')) return 'cancelled';

  // In transit / dispatched
  if (
    s.includes('dispatch') || s.includes('transit') || s.includes('picked') ||
    s.includes('out for') || s.includes('in transit') || s.includes('shipment')
  ) return 'dispatched';

  // Pending
  if (s.includes('pending') || s.includes('booked') || s.includes('created')) return 'dispatched';

  return null; // unknown
}
