import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { evaluateAutomatedTransition } from '@/lib/order-status';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function trackPostEx(tracking) {
  const res = await fetch(`https://api.postex.pk/services/integration/api/order/track-order/${tracking}`, {
    headers: { 'token': process.env.POSTEX_API_TOKEN || '' },
  });
  const data = await res.json();
  if (data.statusCode === '200') {
    return {
      status: data.dist?.orderStatus || 'unknown',
      events: data.dist?.orderStatusHistory || [],
      raw: data,
    };
  }
  throw new Error(data.message || 'PostEx tracking failed');
}

async function trackLeopards(tracking) {
  const url = `https://merchantapi.leopardscourier.com/api/trackBookedPacket/format/json/?api_key=${process.env.LEOPARDS_API_KEY}&api_password=${process.env.LEOPARDS_API_PASSWORD}&track_numbers=${tracking}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 1) {
    const pkt = data.packet_list?.[0];
    return {
      status: pkt?.booked_packet_status || 'unknown',
      events: pkt?.packet_activity_detail || [],
      raw: data,
    };
  }
  throw new Error(data.error || 'Leopards tracking failed');
}

async function trackKangaroo(tracking) {
  const res = await fetch(`https://kangarologistics.pk/api/tracking/${tracking}`, {
    headers: { 'Authorization': `Bearer ${process.env.KANGAROO_API_KEY || ''}` },
  });
  const data = await res.json();
  if (data.success) {
    return {
      status: data.status || 'unknown',
      events: data.events || [],
      raw: data,
    };
  }
  throw new Error(data.message || 'Kangaroo tracking failed');
}

// Map courier status to our standard status
function normalizeStatus(courierName, rawStatus) {
  const s = (rawStatus || '').toLowerCase();
  if (s.includes('deliver') || s.includes('delivered')) return 'delivered';
  if (s.includes('return') || s.includes('rto') || s.includes('undeliver')) return 'rto';
  if (s.includes('transit') || s.includes('dispatch') || s.includes('out for')) return 'in_transit';
  if (s.includes('booked') || s.includes('picked') || s.includes('collected')) return 'booked';
  return 'in_transit';
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tracking = searchParams.get('tracking');
    const courier = searchParams.get('courier');
    const bookingId = searchParams.get('id');

    if (!tracking || !courier) {
      return NextResponse.json({ success: false, error: 'tracking and courier required' }, { status: 400 });
    }

    let result;
    try {
      if (courier === 'PostEx') result = await trackPostEx(tracking);
      else if (courier === 'Leopards') result = await trackLeopards(tracking);
      else if (courier === 'Kangaroo') result = await trackKangaroo(tracking);
      else throw new Error('Unknown courier');
    } catch (apiErr) {
      return NextResponse.json({ success: false, error: apiErr.message });
    }

    const normalStatus = normalizeStatus(courier, result.status);

    // Update DB if booking ID provided
    if (bookingId) {
      await supabase.from('courier_bookings').update({
        status: normalStatus,
        last_tracked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', bookingId);

      // FIX Apr 2026 — Phase 1 flow refactor.
      // Pehle: courier API se "delivered"/"rto" mile to seedha orders.status overwrite ho jata tha.
      // Yeh canTransition guard skip karta tha — confirmed/on_packing orders ka status
      // bhi galti se delivered ho sakta tha.
      // Ab: evaluateAutomatedTransition se check karte hain. Sirf agar valid forward
      // progression hai (e.g. dispatched → delivered), tab status update hota hai.
      // Otherwise sirf courier_bookings.status update hota hai (informational).

      if (normalStatus === 'delivered' || normalStatus === 'rto') {
        const targetStatus = normalStatus === 'rto' ? 'returned' : 'delivered';
        const { data: booking } = await supabase
          .from('courier_bookings')
          .select('order_id')
          .eq('id', bookingId)
          .single();

        if (booking?.order_id) {
          // Fetch current order status to evaluate transition
          const { data: orderRow } = await supabase
            .from('orders')
            .select('status')
            .eq('id', booking.order_id)
            .single();

          if (orderRow) {
            const decision = evaluateAutomatedTransition(orderRow.status, targetStatus, 'courier_sync');
            if (decision.apply) {
              const patch = { status: targetStatus, updated_at: new Date().toISOString() };
              if (targetStatus === 'delivered') patch.delivered_at = new Date().toISOString();
              if (targetStatus === 'returned') patch.rto_at = new Date().toISOString();
              await supabase.from('orders').update(patch).eq('id', booking.order_id);
            } else if (decision.blocked) {
              // Pre-dispatch order me courier "delivered" mile — protocol violation.
              // Office status untouched. Log for review.
              await supabase.from('order_activity_log').insert({
                order_id: booking.order_id,
                action: 'protocol_violation:courier_track_ahead_of_office',
                notes:
                  `Courier API "${normalStatus}" report kar raha hai magar office status abhi "${orderRow.status}" pe hai. ` +
                  `Office status unchanged — staff ne ERP flow skip kiya.`,
                performed_by: 'Courier Track',
                performed_at: new Date().toISOString(),
              });
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      tracking,
      courier,
      raw_status: result.status,
      normalized_status: normalStatus,
      events: result.events,
    });

  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
