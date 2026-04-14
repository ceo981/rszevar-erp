// ============================================================================
// RS ZEVAR ERP — Leopards Courier API Client
// ============================================================================
// 3 GET endpoints (safe, read-only):
//   - fetchLeopardsStatuses(from, to)  — bulk status by date range
//   - fetchLeopardsPayments(cnNumbers) — payment details (max 50 per call)
//   - fetchLeopardsProof(cnNumber)     — electronic proof of delivery
// ============================================================================

const LEOPARDS_BASE = 'https://merchantapi.leopardscourier.com/api';

function getCredentials() {
  const api_key = process.env.LEOPARDS_API_KEY;
  const api_password = process.env.LEOPARDS_API_PASSWORD;
  if (!api_key || !api_password) {
    throw new Error('Leopards credentials missing: set LEOPARDS_API_KEY and LEOPARDS_API_PASSWORD in Vercel env vars');
  }
  return { api_key, api_password };
}

async function leopardsGet(endpoint, params) {
  const { api_key, api_password } = getCredentials();
  const url = new URL(`${LEOPARDS_BASE}/${endpoint}/format/json/`);
  url.searchParams.set('api_key', api_key);
  url.searchParams.set('api_password', api_password);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Leopards API HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }

  const data = await res.json();

  // Leopards returns { status: 0, error: "..." } on error, { status: 1, ... } on success
  if (data.status === 0 || data.status === '0') {
    throw new Error(`Leopards API error: ${data.error || 'Unknown error'}`);
  }

  return data;
}

// ─── 1. Bulk Status by Date Range ──────────────────────────────────────────
// Returns: array of packets with { tracking_number, booked_packet_status, ... }
export async function fetchLeopardsStatuses(fromDate, toDate) {
  const data = await leopardsGet('getBookedPacketLastStatus', {
    from_date: fromDate,
    to_date: toDate,
  });
  return data.packet_list || [];
}

// ─── 2. Payment Details by CN Numbers ──────────────────────────────────────
// Max 50 CN numbers per call. We auto-chunk.
// Returns: array of payment records { booked_packet_cn, status, invoice_cheque_date, ... }
export async function fetchLeopardsPayments(cnNumbers) {
  if (!cnNumbers || cnNumbers.length === 0) return [];

  const allPayments = [];
  const errors = [];

  // Chunk in batches of 50
  for (let i = 0; i < cnNumbers.length; i += 50) {
    const chunk = cnNumbers.slice(i, i + 50);
    try {
      const data = await leopardsGet('getPaymentDetails', {
        cn_numbers: chunk.join(','),
      });
      const payments = data.payment_list || [];
      allPayments.push(...payments);
    } catch (e) {
      errors.push({ batch_start: i, error: e.message, cn_count: chunk.length });
    }
  }

  return { payments: allPayments, errors };
}

// ─── 3. Electronic Proof Of Delivery ───────────────────────────────────────
// Single or comma-separated CN numbers (max 50)
export async function fetchLeopardsProof(cnNumber) {
  const data = await leopardsGet('getElectronicProofOfDelivery', {
    cn_number: Array.isArray(cnNumber) ? cnNumber.join(',') : cnNumber,
  });
  return data;
}

// ============================================================================
// STATUS MAPPING — Leopards text → ERP enum
// ============================================================================
// Leopards docs don't list all possible statuses, so we normalize by keywords.
// Unknown statuses are preserved in courier_status_raw but ERP status is not changed.

export function mapLeopardsStatus(rawStatus) {
  if (!rawStatus) return null;
  const s = String(rawStatus).toLowerCase().trim();

  // Delivered — terminal state
  if (s.includes('delivered') && !s.includes('not delivered') && !s.includes('undelivered')) {
    return 'delivered';
  }

  // RTO / Return to Shipper — terminal
  if (s.includes('return to shipper') || s.includes('rts') ||
      s.includes('returned to shipper') || s.includes('rto complete')) {
    return 'rto';
  }

  // Return in progress — keep as dispatched but flag via raw status
  if (s.includes('return') && s.includes('transit')) {
    return 'dispatched'; // still in courier's hands, returning
  }

  // Cancelled by shipper
  if (s.includes('cancel')) {
    return 'cancelled';
  }

  // In transit / out for delivery / arrived / pickup done — still dispatched
  if (s.includes('transit') || s.includes('arrived') || s.includes('out for delivery') ||
      s.includes('pickup') || s.includes('received') || s.includes('departed') ||
      s.includes('loaded') || s.includes('dispatched')) {
    return 'dispatched';
  }

  // "Pickup Request not Send" / "Assign to Courier" / "Pending"
  // — order booked in Leopards system but not yet picked up
  if (s.includes('not send') || s.includes('not sent') || s.includes('awaiting') ||
      s.includes('assign to courier') || s === 'pending' || s.includes('pickup pending')) {
    return 'dispatched'; // already in ERP as dispatched, don't change
  }

  // Unknown — return null so caller doesn't overwrite ERP status
  return null;
}

// Map Leopards payment status text → boolean (is the order paid by courier?)
export function isLeopardsPaymentPaid(rawPaymentStatus) {
  if (!rawPaymentStatus) return false;
  const s = String(rawPaymentStatus).toLowerCase().trim();
  // "Paid", "Paid Through Cheque", "Paid Through Bank Transfer", etc.
  return s.includes('paid') && !s.includes('not paid') && !s.includes('unpaid');
}
// ─── City Cache ─────────────────────────────────────────────────────────────
let _cityCache = null;

export async function getLeopardsCities() {
  if (_cityCache) return _cityCache;
  const data = await leopardsGet('getAllCities', {});
  _cityCache = data.city_list || [];
  return _cityCache;
}

export async function getLeopardsCityId(cityName) {
  if (!cityName) return 'self';
  const cities = await getLeopardsCities();
  const normalized = cityName.toLowerCase().trim();
  const match = cities.find(c =>
    c.name.toLowerCase().trim() === normalized ||
    c.name.toLowerCase().includes(normalized) ||
    normalized.includes(c.name.toLowerCase().trim())
  );
  return match ? match.id : 'self';
}

// ─── Book a Packet ──────────────────────────────────────────────────────────
export async function bookLeopardPacket({
  customerName,
  customerPhone,
  customerAddress,
  customerCity,
  codAmount,
  orderId,
  specialInstructions,
  weight = 500,
  pieces = 1,
}) {
  const { api_key, api_password } = getCredentials();
  const shipmentId = process.env.LEOPARDS_SHIPPER_ID || '';

  const destinationCityId = await getLeopardsCityId(customerCity);

  const payload = {
    api_key,
    api_password,
    booked_packet_weight: weight,
    booked_packet_no_piece: pieces,
    booked_packet_collect_amount: Math.round(parseFloat(codAmount || 0)),
    booked_packet_order_id: orderId || '',
    origin_city: 'self',
    destination_city: destinationCityId,
    shipment_name_eng: 'self',
    shipment_email: 'self',
    shipment_phone: 'self',
    shipment_address: 'self',
    consignment_name_eng: customerName || '',
    consignment_email: '',
    consignment_phone: customerPhone || '',
    consignment_phone_two: '',
    consignment_phone_three: '',
    consignment_address: customerAddress || '',
    special_instructions: specialInstructions || '',
    shipment_type: 'overnight',
  };

  const res = await fetch(`${LEOPARDS_BASE}/bookPacket/format/json/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Leopards bookPacket HTTP ${res.status}`);
  }

  const data = await res.json();

  if (data.status === 0 || data.status === '0') {
    throw new Error(`Leopards booking failed: ${data.error || 'Unknown error'}`);
  }

  return {
    tracking: data.track_number,
    slip_url: data.slip_link || null,
    tracking_url: data.track_number ? `https://lcs.appsbymoose.com/track/${data.track_number}` : null,
    raw: data,
  };
}
