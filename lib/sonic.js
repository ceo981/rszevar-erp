// ============================================================================
// RS ZEVAR ERP — Trax (Sonic) Courier API Client
// ----------------------------------------------------------------------------
// Trax ka public-facing API "Sonic" kehlata hai (base: https://sonic.pk).
// Booking Shopify-embedded "Sonic - Trax" app se hoti hai (lib/courier-booking-urls.js).
// Yeh client SIRF read/reconcile karta hai — tracker, not booker:
//   - fetchSonicStatus(tracking)            — single shipment current status
//   - fetchSonicStatusBatch(trackingNumbers)— loop (no bulk-status endpoint)
//   - fetchSonicTracking(tracking)          — full tracking history
//   - fetchSonicPayments(cnNumbers)         — bulk payment details (chunked)
//   - mapSonicStatus / isSonicPaymentPaid   — normalize to ERP enums
//   - getSonicCities / getSonicCityId       — city lookup (future booking use)
//
// IMPORTANT — Sonic API success convention:
//   Leopards success = status:1. Kangaroo success = status:200.
//   **Sonic success = status:0** (zero). Non-zero = error. Mat bhoolna.
//
// AUTH: header `Authorization: <SONIC_API_KEY>` (raw key, no "Bearer ").
//       Key Sonic portal → Profile → API Key se milti hai.
// ============================================================================

const SONIC_BASE = 'https://sonic.pk';

function getCredentials() {
  const api_key = process.env.SONIC_API_KEY;
  if (!api_key) {
    throw new Error('Sonic/Trax credentials missing: set SONIC_API_KEY in Vercel env vars');
  }
  return { api_key };
}

// ─── Core GET helper ────────────────────────────────────────────────────────
// params object → query string. Arrays become repeated `key[]=v` pairs
// (Sonic payments endpoint expects tracking_number[]=X&tracking_number[]=Y).
async function sonicGet(endpoint, params) {
  const { api_key } = getCredentials();
  const url = new URL(`${SONIC_BASE}/${endpoint}`);

  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== undefined && item !== null) url.searchParams.append(`${k}[]`, String(item));
      }
    } else {
      url.searchParams.set(k, String(v));
    }
  });

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': api_key,
    },
  });

  if (!res.ok) {
    throw new Error(`Sonic API HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }

  const text = await res.text();
  if (!text || text.trim() === '') {
    throw new Error(`Sonic API: empty response from ${endpoint}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Sonic API: invalid JSON from ${endpoint} — ${text.slice(0, 120)}`);
  }

  // Sonic success = status 0. Anything else is an error.
  if (data.status !== 0 && data.status !== '0') {
    throw new Error(`Sonic API error (${endpoint}): ${data.message || JSON.stringify(data).slice(0, 120)}`);
  }

  return data;
}

// ─── 1. Current Status of a single shipment ────────────────────────────────
// GET /api/shipment/status?tracking_number=X&type=0
// Returns the `current_status` string (e.g. "Shipment - Delivered").
export async function fetchSonicStatus(trackingNumber) {
  const data = await sonicGet('api/shipment/status', {
    tracking_number: trackingNumber,
    type: 0, // shipper-related tracking
  });
  return data.current_status || null;
}

// ─── 2. Batch status (no bulk endpoint — loop with small delay) ────────────
// Mirrors lib/kangaroo.js#trackKangarooBatch. Returns array of
// { tracking, status, success } / { tracking, error, success:false }.
export async function fetchSonicStatusBatch(trackingNumbers) {
  const list = Array.isArray(trackingNumbers) ? trackingNumbers : [trackingNumbers];
  const valid = list.filter(Boolean).map(String);
  const results = [];

  for (const tn of valid) {
    try {
      const status = await fetchSonicStatus(tn);
      results.push({ tracking: tn, status, success: true });
    } catch (err) {
      results.push({ tracking: tn, error: err.message, success: false });
    }
    // gentle pacing to avoid rate limits (same as Kangaroo client)
    await new Promise(r => setTimeout(r, 200));
  }

  return results;
}

// ─── 3. Full tracking history of a shipment ────────────────────────────────
// GET /api/shipment/track?tracking_number=X&type=0
// Returns the `details` object (includes tracking_history[]).
export async function fetchSonicTracking(trackingNumber, type = 0) {
  const data = await sonicGet('api/shipment/track', {
    tracking_number: trackingNumber,
    type,
  });
  return data.details || null;
}

// ─── 4. Bulk Payment Details ───────────────────────────────────────────────
// GET /api/payments?tracking_number[]=X&tracking_number[]=Y
// Response: { payments: { "<cn>": [ { payment_status, payment_method, ... } ] } }
// We flatten to an array of { tracking, payment_status, payment_method, payment_date, ... }.
// Chunked in batches of 50 (defensive — doc doesn't state a hard cap).
export async function fetchSonicPayments(cnNumbers) {
  if (!cnNumbers || cnNumbers.length === 0) return { payments: [], errors: [] };

  const allPayments = [];
  const errors = [];

  for (let i = 0; i < cnNumbers.length; i += 50) {
    const chunk = cnNumbers.slice(i, i + 50);
    try {
      const data = await sonicGet('api/payments', { tracking_number: chunk });
      const paymentsObj = data.payments || {};
      for (const [cn, records] of Object.entries(paymentsObj)) {
        const list = Array.isArray(records) ? records : [records];
        // take the latest payment record per CN (first in array per samples)
        for (const rec of list) {
          allPayments.push({
            tracking: String(cn),
            payment_status: rec.payment_status || null,
            billing_method: rec.billing_method || null,
            payment_date: rec.payment_date || null,
            payment_method: rec.payment_method || null,
            payment_type: rec.payment_type || null,
            payment_id: rec.payment_id || null,
          });
        }
      }
    } catch (e) {
      errors.push({ batch_start: i, error: e.message, cn_count: chunk.length });
    }
    await new Promise(r => setTimeout(r, 200));
  }

  return { payments: allPayments, errors };
}

// ============================================================================
// STATUS MAPPING — Sonic/Trax text → ERP enum
// ============================================================================
// Sonic statuses arrive in two shapes:
//   current_status:   "Shipment - Delivered", "Replacement-Exchanged", ...
//   tracking_history: "Shipment - Out for Delivery", "Shipment - Booked", ...
// We normalize by keyword. Unknown → null (caller does NOT overwrite ERP status).
export function mapSonicStatus(rawStatus) {
  if (!rawStatus) return null;
  const s = String(rawStatus).toLowerCase().trim();

  // Delivered — terminal. (Exclude "unsuccessful"/"not delivered".)
  if (s.includes('deliver') && !s.includes('unsuccess') && !s.includes('not deliver') &&
      !s.includes('undeliver') && !s.includes('out for')) {
    return 'delivered';
  }

  // Return / RTO — terminal
  if (s.includes('return to shipper') || s.includes('returned to shipper') ||
      s.includes('rto') || s.includes('return - delivered') ||
      (s.includes('return') && (s.includes('complete') || s.includes('received') || s.includes('confirm')))) {
    return 'rto';
  }

  // Cancelled
  if (s.includes('cancel')) {
    return 'cancelled';
  }

  // In motion — out for delivery, in transit, arrived, departed, picked up,
  // arrival service center, delivery unsuccessful (still in courier hands), etc.
  if (s.includes('out for delivery') || s.includes('in transit') || s.includes('transit') ||
      s.includes('arrived') || s.includes('arrival') || s.includes('departed') ||
      s.includes('out for') || s.includes('picked') || s.includes('pickup') ||
      s.includes('on route') || s.includes('onroute') || s.includes('en route') ||
      s.includes('dispatched') || s.includes('unsuccess') || s.includes('attempt') ||
      s.includes('return') /* return-in-progress, not yet terminal above */) {
    return 'dispatched';
  }

  // Booked / created / pending — early stage; do not promote office status.
  // (Raw status still saved to courier_status_raw for visibility.)
  if (s.includes('booked') || s.includes('created') || s.includes('pending') ||
      s.includes('confirm')) {
    return 'dispatched'; // already dispatched in ERP terms; don't change forward
  }

  return null;
}

// Map Sonic payment status → boolean. "Processed" / "Paid" = paid.
export function isSonicPaymentPaid(rawPaymentStatus) {
  if (!rawPaymentStatus) return false;
  const s = String(rawPaymentStatus).toLowerCase().trim();
  if (s.includes('not paid') || s.includes('unpaid') || s.includes('pending') ||
      s.includes('hold') || s.includes('process - pending')) {
    return false;
  }
  return s.includes('processed') || s.includes('paid') || s.includes('disbursed') ||
         s.includes('cleared') || s.includes('complete');
}

// ─── City Cache (for future direct-booking; booking is via Shopify app now) ──
let _cityCache = null;

export async function getSonicCities() {
  if (_cityCache) return _cityCache;
  const data = await sonicGet('api/cities', {});
  _cityCache = data.cities || [];
  return _cityCache;
}

export async function getSonicCityId(cityName) {
  if (!cityName) throw new Error('City name required hai');
  const cities = await getSonicCities();
  const normalized = cityName.toLowerCase().trim();
  const match = cities.find(c =>
    c.name && (
      c.name.toLowerCase().trim() === normalized ||
      c.name.toLowerCase().includes(normalized) ||
      normalized.includes(c.name.toLowerCase().trim())
    )
  );
  if (!match) {
    throw new Error(`City "${cityName}" Sonic/Trax mein nahi mili. Sahi city naam likhein (e.g. Karachi, Lahore, Islamabad)`);
  }
  return match.id;
}

// ─── Air Waybill (slip) URL helper ──────────────────────────────────────────
// On-demand consignment note. type=1 → PDF, type=0 → JPEG.
// NOTE: This endpoint needs the Authorization header, so it can't be opened
// directly in a browser tab. Use a server proxy if you need to surface it.
export function getSonicAirWaybillEndpoint(trackingNumber, type = 1) {
  return `${SONIC_BASE}/api/shipment/air_waybill?tracking_number=${encodeURIComponent(trackingNumber)}&type=${type}`;
}
