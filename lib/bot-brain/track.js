// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR — lib/bot-brain/track.js
// Order tracking for the storefront bot. Mirrors the public /api/public/track
// lookup (order_number variants OR phone), uses ERP stored status as the
// backbone (kept fresh by the courier sync cron) and live-refreshes Leopards
// + Trax when dispatched. Never throws to the caller.
// ════════════════════════════════════════════════════════════════════════════

import { fetchLeopardsStatusByTracking } from '../leopards';
import { fetchSonicStatus } from '../sonic';

const FRIENDLY = {
  pending: 'Order received — being confirmed',
  confirmed: 'Confirmed — preparing for dispatch',
  on_packing: 'Being packed',
  packed: 'Packed — ready for courier pickup',
  dispatched: 'Dispatched — on the way to you',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  rto: 'Returned to sender (RTO)',
  hold: 'On hold',
  attempted: 'Delivery attempted',
};

function trackingUrl(courier, tracking) {
  if (!tracking) return null;
  const map = {
    Leopards: `https://leopardsfulfillment.leopardscourier.com/Track/Index?Cn=${tracking}`,
    PostEx: `https://postex.pk/track-order?trackingId=${tracking}`,
    Kangaroo: `https://www.kangaroo.pk/track?cn=${tracking}`,
    Trax: `https://sonic.pk/tracking?tracking_number=${tracking}`,
  };
  return map[courier] || null;
}

export async function trackOrder(db, identifier) {
  const id = String(identifier || '').trim();
  if (id.length < 3) {
    return { found: false, error: 'need_identifier', message: 'Order number ya phone number chahiye tracking ke liye.' };
  }

  const digits = id.replace(/\D/g, '');
  const isPhone = digits.length >= 10;

  let query = db
    .from('orders')
    .select('order_number, status, payment_status, customer_city, dispatched_courier, tracking_number, created_at, updated_at, is_walkin')
    .order('created_at', { ascending: false })
    .limit(5);

  if (isPhone) {
    query = query.ilike('customer_phone', `%${digits.slice(-10)}%`);
  } else {
    const cleaned = id.replace(/^#/, '').trim();
    const variants = Array.from(new Set([id, cleaned, `#${cleaned}`]));
    query = query.in('order_number', variants);
  }

  let orders;
  try {
    const { data, error } = await query;
    if (error) throw error;
    orders = data || [];
  } catch (e) {
    return { found: false, error: 'db_error', message: 'Abhi order check nahi ho pa raha. Thori der baad try karein.' };
  }

  if (orders.length === 0) {
    return { found: false, error: 'not_found', message: 'Is number se koi order nahi mila. Order number ya phone dobara check karein.' };
  }

  const results = await Promise.all(orders.map(async (o) => {
    let liveCourierStatus = null;
    if (o.tracking_number && o.status === 'dispatched' && o.dispatched_courier) {
      try {
        if (o.dispatched_courier === 'Leopards') {
          const p = await fetchLeopardsStatusByTracking(o.tracking_number);
          if (p && p[0]) liveCourierStatus = p[0].booked_packet_status || null;
        } else if (o.dispatched_courier === 'Trax') {
          const st = await fetchSonicStatus(o.tracking_number);
          if (st) liveCourierStatus = st;
        }
      } catch (e) {
        // live refresh is best-effort; fall back to stored status
      }
    }

    return {
      order_number: o.order_number,
      status: FRIENDLY[o.status] || o.status,
      raw_status: o.status,
      courier: o.dispatched_courier || null,
      tracking_number: o.tracking_number || null,
      tracking_url: trackingUrl(o.dispatched_courier, o.tracking_number),
      live_courier_status: liveCourierStatus,
      city: o.customer_city || null,
      payment_status: o.payment_status || null,
      order_date: o.created_at,
    };
  }));

  return { found: true, count: results.length, orders: results };
}
