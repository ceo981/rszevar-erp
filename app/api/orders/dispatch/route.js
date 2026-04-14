import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createShopifyFulfillment } from '@/lib/shopify';
import { sendOrderDispatched } from '@/lib/whatsapp';

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
  const { getKangarooToken } = await import('../../../../lib/kangaroo.js');
  const { token, userId } = await getKangarooToken();

  const res = await fetch('https://api.kangaroo.pk/order/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Service': 'kangaroo',
      'Auth-Key': 'kangaroo',
      'Auth-Token': token,
      'User-ID': userId,
    },
    body: JSON.stringify({
      orders: [{
        cname: order.customer_name || '',
        caddress: order.customer_address || '',
        cnumber: order.customer_phone || '',
        amount: String(Math.round(parseFloat(order.total_amount || order.total_price || 0))),
        invoice: order.order_number || String(order.id),
        city: order.customer_city || 'Karachi',
        Productname: courier_notes || 'Jewelry',
        Productcode: '',
        comments: '',
        Ordertype: 'COD',
      }],
    }),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`Kangaroo API invalid response: ${text.slice(0, 100)}`); }

  if (data.status === 201 || data.status === '201') {
    // Response: { orders: { "KN123456789": { print: url } } }
    const orderKeys = Object.keys(data.orders || {});
    if (orderKeys.length > 0) {
      const trackingNumber = orderKeys[0];
      const printUrl = data.orders[trackingNumber]?.print || null;
      return { tracking: trackingNumber, print_url: printUrl, raw: data };
    }
  }
  throw new Error(data.message || `Kangaroo booking failed: ${JSON.stringify(data)}`);
}

async function bookLeopards(order, courier_notes, weight, pieces) {
  const { bookLeopardPacket } = await import('../../../../lib/leopards.js');

  const result = await bookLeopardPacket({
    customerName: order.customer_name || '',
    customerPhone: order.customer_phone || '',
    customerAddress: order.customer_address || '',
    customerCity: order.customer_city || 'Karachi',
    codAmount: order.total_amount || order.total_price || 0,
    orderId: order.order_number || String(order.id),
    specialInstructions: courier_notes || 'Jewelry',
    weight: parseInt(weight || 500),
    pieces: parseInt(pieces || 1),
  });

  return { tracking: result.tracking, print_url: result.slip_url, raw: result.raw };
}

// ─── Main Dispatch Handler ──────────────────────────────────────────────────

export async function POST(request) {
  try {
    const { order_id, courier, courier_notes, override_name, override_phone, override_address, override_city, override_amount, override_weight, override_pieces } = await request.json();
    if (!order_id || !courier) {
      return NextResponse.json({ success: false, error: 'order_id and courier required' }, { status: 400 });
    }

    // Fetch order details
    const { data: orderRaw, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .single();

    if (fetchErr || !orderRaw) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Apply overrides (Kangaroo modal edits)
    const order = {
      ...orderRaw,
      customer_name: override_name || orderRaw.customer_name,
      customer_phone: override_phone || orderRaw.customer_phone,
      customer_address: override_address || orderRaw.customer_address,
      customer_city: override_city || orderRaw.customer_city,
      total_amount: override_amount || orderRaw.total_amount || orderRaw.total_price,
    };

    // ── 1. Book with courier API ──
    let tracking = null;
    let bookingError = null;
    let printUrl = null;

    try {
      let result;
      if (courier === 'PostEx') result = await bookPostEx(order, courier_notes);
      else if (courier === 'Kangaroo') result = await bookKangaroo(order, courier_notes);
      else if (courier === 'Leopards') result = await bookLeopards(order, courier_notes, override_weight, override_pieces);
      tracking = result?.tracking;
      printUrl = result?.print_url || result?.tracking_url || null;
      // For Leopards, also store tracking URL separately
      if (result?.tracking_url) {
        await supabase.from('orders').update({ courier_tracking_url: result.tracking_url }).eq('id', order_id);
      }
    } catch (e) {
      bookingError = e.message;
      // Kangaroo: STRICT — do not proceed if booking failed
      if (courier === 'Kangaroo') {
        return NextResponse.json({
          success: false,
          error: `Kangaroo booking failed: ${e.message}`,
          booking_failed: true,
        }, { status: 400 });
      }
      // Leopards: STRICT — do not proceed if booking failed
      if (courier === 'Leopards') {
        return NextResponse.json({
          success: false,
          error: `Leopards booking failed: ${e.message}`,
          booking_failed: true,
        }, { status: 400 });
      }
      // PostEx: soft fail — continue with manual tracking
    }

    // ── 2. Update order status in DB ──
    const updatePayload = {
      status: 'dispatched',
      dispatched_at: new Date().toISOString(),
      dispatched_courier: courier,
      tracking_number: tracking || null,
      updated_at: new Date().toISOString(),
    };
    if (printUrl) updatePayload.courier_tracking_url = printUrl;
    await supabase.from('orders').update(updatePayload).eq('id', order_id);

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
          courier,
          printUrl
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

    // ── 6. WhatsApp dispatch notification (best-effort) ──
    if (order.customer_phone) {
      try {
        // Fetch order items
        const { data: orderItems } = await supabase
          .from('order_items')
          .select('title, variant_title, quantity')
          .eq('order_id', order_id);

        const itemsText = (orderItems || [])
          .map(i => `${i.title}${i.variant_title ? ` (${i.variant_title})` : ''} x${i.quantity}`)
          .join(', ') || 'N/A';

        await sendOrderDispatched({
          phone: order.customer_phone,
          customer_name: order.customer_name,
          order_number: order.order_number,
          items: itemsText,
          courier,
          tracking_number: tracking,
        });
      } catch (e) {
        console.error('[dispatch] WhatsApp error:', e.message);
      }
    }

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
