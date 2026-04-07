import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createShopifyFulfillment } from '@/lib/shopify';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Courier API Helpers ────────────────────────────────────────────────────

async function bookPostEx(order, courier_notes) {
  const token = process.env.POSTEX_API_TOKEN;
  const storeId = process.env.POSTEX_STORE_ID;
  if (!token) throw new Error('PostEx API token missing');

  const res = await fetch('https://api.postex.pk/services/integration/api/order/v3/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'token': token },
    body: JSON.stringify({
      orderRefNumber: order.order_number || String(order.id),
      orderType: 'Normal',
      paymentType: 'COD',
      invoicePayment: String(order.total_amount || 0),
      customerName: order.customer_name || '',
      customerPhone: order.customer_phone || '',
      customerAddress: order.customer_address || '',
      cityName: order.customer_city || 'Karachi',
      storeId: storeId || '',
      itemDescription: courier_notes || 'Jewelry',
    }),
  });

  const data = await res.json();
  if (data.statusCode === '200' || data.dist?.trackingNumber) {
    return { tracking: data.dist?.trackingNumber || data.dist?.orderRefNumber, raw: data };
  }
  throw new Error(data.message || 'PostEx booking failed');
}

async function bookKangaroo(order, courier_notes) {
  const clientId = process.env.KANGAROO_CLIENT_ID || '549';
  const pass = process.env.KANGAROO_API_PASSWORD;
  if (!pass) throw new Error('Kangaroo API password missing');

  const res = await fetch('https://kangaroo.pk/orderapi.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientid: clientId,
      pass: pass,
      request: 'neworder',
      consignee: order.customer_name || '',
      phone: order.customer_phone || '',
      address: order.customer_address || '',
      city: order.customer_city || 'Karachi',
      cod: String(order.total_amount || 0),
      description: courier_notes || 'Jewelry',
      ref: order.order_number || String(order.id),
    }),
  });

  const data = await res.json();
  if (data.status === 'success' || data.cn) {
    return { tracking: data.cn || data.tracking_no, raw: data };
  }
  throw new Error(data.message || 'Kangaroo booking failed');
}

async function bookLeopards(order, courier_notes) {
  const apiKey = process.env.LEOPARDS_API_KEY;
  const apiPwd = process.env.LEOPARDS_API_PASSWORD;
  const shipperId = process.env.LEOPARDS_SHIPPER_ID;
  if (!apiKey) throw new Error('Leopards API key missing');

  const res = await fetch('https://merchantapi.leopardscourier.com/api/createPacket/format/json/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      api_password: apiPwd,
      shipment_type_id: 1,
      consignee_name: order.customer_name || '',
      consignee_email: '',
      consignee_address: order.customer_address || '',
      consignee_phone: order.customer_phone || '',
      consignee_city: order.customer_city || 'Karachi',
      shipment_amount: String(order.total_amount || 0),
      pieces_quantity: 1,
      order_id: order.order_number || String(order.id),
      comments: courier_notes || 'Jewelry',
      shipper_id: shipperId || '',
    }),
  });

  const data = await res.json();
  if (data.error === '0' && data.track_number) {
    return { tracking: data.track_number, raw: data };
  }
  throw new Error(data.error_description || 'Leopards booking failed');
}

// ─── Main Dispatch Handler ──────────────────────────────────────────────────

export async function POST(request) {
  try {
    const { order_id, courier, courier_notes } = await request.json();
    if (!order_id || !courier) {
      return NextResponse.json({ success: false, error: 'order_id and courier required' }, { status: 400 });
    }

    // Fetch order details
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // ── 1. Book with courier API ──
    let tracking = null;
    let bookingError = null;

    try {
      let result;
      if (courier === 'PostEx') result = await bookPostEx(order, courier_notes);
      else if (courier === 'Kangaroo') result = await bookKangaroo(order, courier_notes);
      else if (courier === 'Leopards') result = await bookLeopards(order, courier_notes);
      tracking = result?.tracking;
    } catch (e) {
      bookingError = e.message;
      // Continue — manual tracking can be added
    }

    // ── 2. Update order status in DB ──
    await supabase.from('orders').update({
      status: 'dispatched',
      dispatched_at: new Date().toISOString(),
      dispatched_courier: courier,
      tracking_number: tracking || null,
      updated_at: new Date().toISOString(),
    }).eq('id', order_id);

    // ── 3. Insert courier_bookings record (with correct column names) ──
    await supabase.from('courier_bookings').insert({
      order_id,
      order_name: order.order_number,
      tracking_number: tracking || `MANUAL-${order_id}-${Date.now()}`,
      courier_name: courier,
      customer_name: order.customer_name || '',
      customer_phone: order.customer_phone || '',
      address: order.customer_address || '',
      city: order.customer_city || '',
      cod_amount: order.total_amount || 0,
      status: 'booked',
      api_booked: !bookingError,
      cod_settled: false,
      rto_acknowledged: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // ── 4. PUSH FULFILLMENT TO SHOPIFY (best-effort) ──
    // This makes Shopify auto-email the customer with tracking info.
    // Skip if: no Shopify order link, no tracking, or already pushed.
    let shopifyFulfillmentId = null;
    let shopifyPushError = null;

    if (order.shopify_order_id && tracking && !order.shopify_fulfillment_id) {
      try {
        const fulfillment = await createShopifyFulfillment(
          order.shopify_order_id,
          tracking,
          courier
        );
        shopifyFulfillmentId = fulfillment?.id ? String(fulfillment.id) : null;

        if (shopifyFulfillmentId) {
          await supabase.from('orders').update({
            shopify_fulfillment_id: shopifyFulfillmentId,
            shopify_fulfilled_at: new Date().toISOString(),
          }).eq('id', order_id);
        }
      } catch (e) {
        shopifyPushError = e.message;
        console.error('[dispatch] Shopify fulfillment push failed:', e.message);
        // Don't fail the dispatch — order is already marked dispatched in ERP
      }
    }

    // ── 5. Activity log ──
    const logNotes = [
      `Courier: ${courier}`,
      tracking ? `Tracking: ${tracking}` : null,
      bookingError ? `Booking API error: ${bookingError}` : null,
      shopifyFulfillmentId ? `Shopify fulfilled: ${shopifyFulfillmentId}` : null,
      shopifyPushError ? `Shopify push error: ${shopifyPushError}` : null,
    ].filter(Boolean).join(' | ');

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'dispatched',
      notes: logNotes,
      performed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      tracking,
      courier,
      api_booked: !bookingError,
      shopify_fulfilled: !!shopifyFulfillmentId,
      shopify_fulfillment_id: shopifyFulfillmentId,
      warnings: {
        booking: bookingError || null,
        shopify_push: shopifyPushError || null,
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
