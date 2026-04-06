import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── POSTEX BOOKING ────────────────────────────────────────────
async function bookPostEx(data) {
  const payload = {
    orderRefNumber: data.order_name,
    transactionNotes: data.note || '',
    requestType: 1,
    deliveryTypeId: 1,
    collectionAmount: data.cod_amount,
    pieceQuantity: data.pieces || 1,
    weight: data.weight || 0.5,
    customerName: data.customer_name,
    customerPhone: data.customer_phone,
    customerAddress: data.address,
    cityName: data.city,
    storeId: process.env.POSTEX_STORE_ID || '',
  };

  const res = await fetch('https://api.postex.pk/services/integration/api/order/create-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'token': process.env.POSTEX_API_TOKEN || '',
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (result.statusCode === '200') {
    return { success: true, tracking: result.dist?.trackingNumber, raw: result };
  }
  throw new Error(result.message || 'PostEx booking failed');
}

// ── LEOPARDS BOOKING ──────────────────────────────────────────
async function bookLeopards(data) {
  const payload = {
    api_key: process.env.LEOPARDS_API_KEY || '',
    api_password: process.env.LEOPARDS_API_PASSWORD || '',
    booked_packet_weight: data.weight || 0.5,
    booked_packet_no_piece: data.pieces || 1,
    booked_packet_collect_amount: data.cod_amount,
    booked_packet_order_id: data.order_name,
    origin_city: 'Karachi',
    destination_city: data.city,
    shipment_type_id: 2, // COD
    consignee_name: data.customer_name,
    consignee_phone: data.customer_phone,
    consignee_address: data.address,
    consignee_email_address: '',
    special_instructions: data.note || '',
    shipper_id: process.env.LEOPARDS_SHIPPER_ID || '',
  };

  const res = await fetch('https://merchantapi.leopardscourier.com/api/bookPacket/format/json/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (result.status === 1) {
    return { success: true, tracking: result.packet_info?.track_number, raw: result };
  }
  throw new Error(result.error || 'Leopards booking failed');
}

// ── KANGAROO BOOKING ──────────────────────────────────────────
async function bookKangaroo(data) {
  const payload = {
    api_key: process.env.KANGAROO_API_KEY || '',
    consignee_name: data.customer_name,
    consignee_phone: data.customer_phone,
    consignee_address: data.address,
    destination_city: data.city,
    cod_amount: data.cod_amount,
    weight: data.weight || 0.5,
    order_id: data.order_name,
    pieces: data.pieces || 1,
    remarks: data.note || '',
  };

  const res = await fetch('https://kangarologistics.pk/api/booking/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.KANGAROO_API_KEY || ''}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (result.success) {
    return { success: true, tracking: result.tracking_number, raw: result };
  }
  throw new Error(result.message || 'Kangaroo booking failed');
}

// ── MAIN HANDLER ──────────────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json();
    const { courier_name, ...bookingData } = body;

    if (!courier_name) {
      return NextResponse.json({ success: false, error: 'courier_name required' }, { status: 400 });
    }

    let result;

    // Call the appropriate courier API
    try {
      if (courier_name === 'PostEx') {
        result = await bookPostEx(bookingData);
      } else if (courier_name === 'Leopards') {
        result = await bookLeopards(bookingData);
      } else if (courier_name === 'Kangaroo') {
        result = await bookKangaroo(bookingData);
      } else {
        throw new Error('Unknown courier');
      }
    } catch (apiError) {
      // If API fails, save as manual booking without tracking number
      console.warn(`${courier_name} API error:`, apiError.message);
      result = { success: false, tracking: null, error: apiError.message };
    }

    // Save booking to DB regardless of API success
    const { data: booking, error: dbError } = await supabase
      .from('courier_bookings')
      .insert([{
        order_name: bookingData.order_name,
        order_id: bookingData.order_id,
        courier_name,
        tracking_number: result.tracking || null,
        customer_name: bookingData.customer_name,
        customer_phone: bookingData.customer_phone,
        city: bookingData.city,
        address: bookingData.address,
        cod_amount: parseFloat(bookingData.cod_amount || 0),
        weight: parseFloat(bookingData.weight || 0.5),
        pieces: parseInt(bookingData.pieces || 1),
        status: result.tracking ? 'booked' : 'manual',
        note: bookingData.note || '',
        api_booked: !!result.tracking,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (dbError) throw dbError;

    // Update order status
    if (bookingData.order_id) {
      await supabase.from('orders').update({
        status: 'dispatched',
        courier_name,
        courier_tracking_number: result.tracking,
      }).eq('id', bookingData.order_id);
    }

    return NextResponse.json({
      success: true,
      booking,
      tracking_number: result.tracking,
      api_booked: !!result.tracking,
      api_error: result.error || null,
    });

  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
