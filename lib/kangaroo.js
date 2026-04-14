// ============================================================================
// RS ZEVAR ERP — Kangaroo Courier API Client
// ============================================================================

const KANGAROO_BASE = 'https://api.kangaroo.pk';

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

export async function getKangarooToken() {
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

export async function trackKangarooBatch(trackingNumbers) {
  const results = [];
  for (const tn of trackingNumbers) {
    try {
      const data = await trackKangarooOrder(tn);
      results.push({ tracking: tn, data, success: true });
    } catch (err) {
      results.push({ tracking: tn, error: err.message, success: false });
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

export function mapKangarooStatus(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();

  if (s.includes('delivered') || s === 'delivered') return 'delivered';
  if (s.includes('return') || s.includes('rto') || s.includes('undelivered')) return 'returned';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('dispatch') || s.includes('transit') || s.includes('picked') || s.includes('out for')) return 'dispatched';
  if (s.includes('pending') || s.includes('booked') || s.includes('created')) return 'dispatched';

  return null;
}
