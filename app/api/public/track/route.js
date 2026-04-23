// ============================================================================
// RS ZEVAR ERP — Public Order Tracking Endpoint
// ============================================================================
// Path: app/api/public/track/route.js  (CREATE this new file)
//
// PUBLIC endpoint — no auth required. Called from rszevar.com/pages/track-order
// Accepts order number OR phone number.
// Returns: RS Zevar internal status + live Leopards courier status.
//
// Security:
//   - Rate limited 20 req/hour per IP (in-memory, resets on cold start)
//   - CORS restricted to rszevar.com + www.rszevar.com
//   - Only exposes non-sensitive fields (no amounts, no products, no email)
//   - Phone matches only return last 5 orders for that phone
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { fetchLeopardsStatusByTracking } from '../../../../lib/leopards';

// ─── CORS ──────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://rszevar.com',
  'https://www.rszevar.com',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://rszevar.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
  };
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// ─── Rate Limiting (in-memory, per IP) ─────────────────────────────────────
const rateMap = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function rateLimitCheck(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  const hits = (rateMap.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  rateMap.set(key, hits);
  return true;
}

// ─── Tracking URL Builder ──────────────────────────────────────────────────
function buildTrackingUrl(courier, tracking) {
  if (!tracking) return null;
  const map = {
    'Leopards': `https://lcs.appsbymoose.com/track/${tracking}`,
    'PostEx':   `https://postex.pk/track-order?trackingId=${tracking}`,
    'Kangaroo': `https://www.kangaroo.pk/track?cn=${tracking}`,
  };
  return map[courier] || null;
}

// ─── RS ZEVAR Timeline Builder ─────────────────────────────────────────────
function buildRsZevarTimeline(order) {
  // Walk-in orders: simple single-step
  if (order.is_walkin) {
    return [{
      step: 'walkin',
      label: 'Walk-in Purchase',
      description: 'In-store purchase — no courier delivery involved.',
      done: true,
      date: order.created_at,
    }];
  }

  // Cancelled orders: show cancellation
  if (order.status === 'cancelled') {
    return [
      { step: 'received',  label: 'Order Received',  done: true,  date: order.created_at },
      { step: 'cancelled', label: 'Order Cancelled', done: true,  date: order.updated_at, is_error: true },
    ];
  }

  const isConfirmed  = ['confirmed', 'dispatched', 'delivered'].includes(order.status);
  const isDispatched = ['dispatched', 'delivered'].includes(order.status);
  const isDelivered  = order.status === 'delivered';

  return [
    {
      step: 'received',
      label: 'Order Received',
      done: true,
      date: order.created_at,
    },
    {
      step: 'confirmed',
      label: 'Order Confirmed',
      done: isConfirmed,
      date: order.confirmed_at || (isConfirmed ? order.updated_at : null),
    },
    {
      step: 'dispatched',
      label: 'Dispatched to Courier',
      done: isDispatched,
      date: order.dispatched_at || (isDispatched ? order.updated_at : null),
    },
    {
      step: 'delivered',
      label: 'Delivered',
      done: isDelivered,
      date: isDelivered ? order.updated_at : null,
    },
  ];
}

// ─── Main POST Handler ─────────────────────────────────────────────────────
export async function POST(request) {
  const origin = request.headers.get('origin') || '';
  const baseHeaders = { ...corsHeaders(origin), 'Content-Type': 'application/json' };

  // Rate limit
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
             request.headers.get('x-real-ip') || 'unknown';

  if (!rateLimitCheck(ip)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Too many requests. Please wait a while and try again.' }),
      { status: 429, headers: baseHeaders }
    );
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid request format' }),
      { status: 400, headers: baseHeaders }
    );
  }

  const identifier = String(body.identifier || '').trim();
  if (!identifier || identifier.length < 3) {
    return new Response(
      JSON.stringify({ success: false, error: 'Please enter your order number or phone number' }),
      { status: 400, headers: baseHeaders }
    );
  }

  // Supabase client (service role — public endpoint server-side, bypasses RLS)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Detect: is this a phone number or an order number?
  // Phone = 10+ digits (allow +92, 92, 03 prefixes)
  const digitsOnly = identifier.replace(/\D/g, '');
  const isPhone = digitsOnly.length >= 10;

  // Build query
  let query = supabase
    .from('orders')
    .select(`
      shopify_order_id,
      order_number,
      status,
      payment_status,
      customer_city,
      customer_phone,
      dispatched_courier,
      tracking_number,
      dispatched_at,
      confirmed_at,
      created_at,
      updated_at,
      is_walkin,
      is_wholesale
    `)
    .order('created_at', { ascending: false })
    .limit(5);

  if (isPhone) {
    // Match last 10 digits of phone as substring
    const last10 = digitsOnly.slice(-10);
    query = query.ilike('customer_phone', `%${last10}%`);
  } else {
    // Order number match — try common formats
    const raw     = identifier;
    const cleaned = identifier.replace(/^#/, '').trim();
    const variants = Array.from(new Set([raw, cleaned, `#${cleaned}`]));
    query = query.in('order_number', variants);
  }

  const { data: orders, error } = await query;

  if (error) {
    console.error('[public/track] DB error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: 'Unable to search orders right now. Please try again.' }),
      { status: 500, headers: baseHeaders }
    );
  }

  if (!orders || orders.length === 0) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'No order found. Please check your order number or phone number and try again.'
      }),
      { status: 404, headers: baseHeaders }
    );
  }

  // For each order: build timeline + fetch live courier status if in transit
  const results = await Promise.all(orders.map(async (order) => {
    const rszevarTimeline = buildRsZevarTimeline(order);
    let courierStatus = null;

    // Live fetch ONLY for dispatched orders with a Leopards tracking number.
    // Delivered / pending / other couriers → use DB data (no point calling API).
    const shouldFetchLive =
      order.tracking_number &&
      order.dispatched_courier === 'Leopards' &&
      order.status === 'dispatched';

    if (shouldFetchLive) {
      try {
        const packets = await fetchLeopardsStatusByTracking(order.tracking_number);
        if (packets && packets.length > 0) {
          const p = packets[0];
          courierStatus = {
            provider: 'Leopards',
            tracking_number: order.tracking_number,
            current_status: p.booked_packet_status || 'In Transit',
            last_updated: p.booked_packet_date || null,
            origin_city: p.origin_city_name || null,
            destination_city: p.destination_city_name || null,
            tracking_url: buildTrackingUrl('Leopards', order.tracking_number),
            fetched_live: true,
          };
        }
      } catch (e) {
        console.error('[public/track] Leopards live fetch failed:', e.message);
        // Fall through to DB fallback below
      }
    }

    // Fallback for: non-Leopards couriers, delivered orders, API errors
    if (!courierStatus && order.tracking_number) {
      let displayStatus = null;
      if (order.status === 'delivered')  displayStatus = 'Delivered';
      else if (order.status === 'dispatched') displayStatus = 'In Transit';

      courierStatus = {
        provider: order.dispatched_courier,
        tracking_number: order.tracking_number,
        current_status: displayStatus,
        last_updated: order.updated_at,
        tracking_url: buildTrackingUrl(order.dispatched_courier, order.tracking_number),
        fetched_live: false,
      };
    }

    // Response shape — deliberately NO customer_phone, no amounts, no products
    return {
      order_number: order.order_number,
      rszevar_status: order.status,
      payment_status: order.payment_status,
      city: order.customer_city,
      is_walkin: order.is_walkin,
      is_wholesale: order.is_wholesale,
      rszevar_timeline: rszevarTimeline,
      courier_status: courierStatus,
      order_date: order.created_at,
    };
  }));

  return new Response(
    JSON.stringify({ success: true, count: results.length, orders: results }),
    { status: 200, headers: baseHeaders }
  );
}
