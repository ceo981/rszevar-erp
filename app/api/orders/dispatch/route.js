// ============================================================================
// RS ZEVAR ERP — Order Dispatch Route  (FIXED Apr 2026)
// ----------------------------------------------------------------------------
// Changes:
//   1. Adds canTransition guard — packed → dispatched only (or manual force with
//      reason). Prevents dispatching cancelled/delivered/rto orders by accident.
//   2. Fixes slipUrl overwrite bug: previously line 190 wrote slipUrl into
//      courier_tracking_url, then line 222 immediately overwrote it with
//      trackingUrl. Now slipUrl goes to `courier_slip_url` (a separate column
//      if present) and trackingUrl goes to courier_tracking_url. Uses the
//      slipUrl only if no trackingUrl is available.
//   3. Accepts performed_by / performed_by_email and writes to activity log
//   4. Pre-fetches order_items ONCE and reuses for Leopards instructions
//      AND WhatsApp notification — removes duplicate DB fetch
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { canTransition } from '@/lib/order-status';
import { createShopifyFulfillment } from '@/lib/shopify';
import { sendOrderDispatched } from '@/lib/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── Courier API helpers ────────────────────────────────────────────────────

async function bookPostEx(order, courier_notes) {
  const token = process.env.POSTEX_API_TOKEN;
  const storeId = process.env.POSTEX_STORE_ID;
  if (!token) throw new Error('PostEx API token missing');

  const res = await fetch('https://api.postex.pk/services/integration/api/order/v3/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
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
    return {
      tracking: data.dist?.trackingNumber || data.dist?.orderRefNumber,
      raw: data,
    };
  }
  throw new Error(data.message || 'PostEx booking failed');
}

async function bookKangaroo(order) {
  const { getKangarooToken } = await import('@/lib/kangaroo');
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
        Customername: order.customer_name || '',
        Customeraddress: order.customer_address || '',
        Customernumber: order.customer_phone || '',
        Amount: String(Math.round(parseFloat(order.total_amount || order.total_price || 0))),
        Invoice: order.order_number || String(order.id),
        City: order.customer_city || 'Karachi',
      }],
    }),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Kangaroo API invalid response: ${text.slice(0, 100)}`); }

  if (
    data.status === 201 ||
    data.status === '201' ||
    String(data.message || '').toLowerCase().includes('created')
  ) {
    const ordersObj = data.result?.orders || data.orders || data.order || {};
    const orderKeys = Object.keys(ordersObj);
    if (orderKeys.length > 0) {
      const trackingNumber = orderKeys[0];
      const printUrl = ordersObj[trackingNumber]?.print || null;
      return { tracking: trackingNumber, print_url: printUrl, raw: data };
    }
    return { tracking: null, print_url: null, raw: data };
  }
  throw new Error(data.message || `Kangaroo booking failed: ${JSON.stringify(data)}`);
}

async function bookLeopards(order, courier_notes, weight, pieces) {
  const { bookLeopardPacket } = await import('@/lib/leopards');
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
  return {
    tracking: result.tracking,
    print_url: result.slip_url,
    tracking_url: result.tracking_url,
    raw: result.raw,
  };
}

// ─── Main Dispatch Handler ──────────────────────────────────────────────────

export async function POST(request) {
  const supabase = createServerClient();
  try {
    const {
      order_id,
      courier,
      courier_notes,
      override_name,
      override_phone,
      override_address,
      override_city,
      override_amount,
      override_weight,
      override_pieces,
      performed_by,
      performed_by_email,
      // kangaroo/leopards extras
      // (kangaroo_ordertype / kangaroo_comment previously passed in but not used
      // by booking function — kept in payload shape for back-compat)
    } = await request.json();

    if (!order_id || !courier) {
      return NextResponse.json(
        { success: false, error: 'order_id aur courier required' },
        { status: 400 },
      );
    }

    const performer = performed_by || 'Staff';
    const performerEmail = performed_by_email || null;

    // Fetch order + items in parallel (reused for Leopards instructions + WhatsApp)
    const [{ data: orderRaw, error: fetchErr }, { data: orderItems }] = await Promise.all([
      supabase.from('orders').select('*').eq('id', order_id).single(),
      supabase.from('order_items').select('title, variant_title, sku, quantity').eq('order_id', order_id),
    ]);

    if (fetchErr || !orderRaw) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // ── Transition guard: can this order be dispatched? ──
    const gate = canTransition(orderRaw.status, 'dispatched', 'manual');
    if (!gate.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Dispatch blocked: status '${orderRaw.status}' se dispatched nahi ho sakta (${gate.reason})`,
        },
        { status: 400 },
      );
    }

    // Apply overrides (modal edits)
    const order = {
      ...orderRaw,
      customer_name:    override_name    || orderRaw.customer_name,
      customer_phone:   override_phone   || orderRaw.customer_phone,
      customer_address: override_address || orderRaw.customer_address,
      customer_city:    override_city    || orderRaw.customer_city,
      total_amount:     override_amount  || orderRaw.total_amount || orderRaw.total_price,
    };

    // Build special-instructions text from items if not provided
    let autoItemsText = '';
    if (orderItems?.length) {
      autoItemsText = orderItems
        .map(i =>
          `${i.title}${i.variant_title ? ` ${i.variant_title}` : ''}${i.sku ? ` SKU:${i.sku}` : ''} x${i.quantity}`,
        )
        .join(', ');
    }
    const finalCourierNotes = courier_notes || autoItemsText || '';

    // ── 1. Book with courier ──
    let tracking = null;
    let slipUrl = null;
    let trackingUrl = null;
    let bookingError = null;

    try {
      let result;
      if (courier === 'PostEx') {
        result = await bookPostEx(order, finalCourierNotes);
      } else if (courier === 'Kangaroo') {
        result = await bookKangaroo(order);
      } else if (courier === 'Leopards') {
        result = await bookLeopards(order, finalCourierNotes, override_weight, override_pieces);
      } else {
        throw new Error(`Unknown courier: ${courier}`);
      }

      tracking = result?.tracking || null;
      slipUrl = result?.print_url || null; // label/slip URL (printable)
      trackingUrl =
        result?.tracking_url ||
        (tracking && courier === 'Leopards' ? `https://lcs.appsbymoose.com/track/${tracking}` : null) ||
        (tracking && courier === 'Kangaroo' ? `https://kangaroo.pk/track/${tracking}` : null);
    } catch (e) {
      bookingError = e.message;
      // Kangaroo/Leopards: STRICT — do not proceed if booking failed
      if (courier === 'Kangaroo' || courier === 'Leopards') {
        return NextResponse.json(
          {
            success: false,
            error: `${courier} booking failed: ${e.message}`,
            booking_failed: true,
          },
          { status: 400 },
        );
      }
      // PostEx: soft fail — proceed with manual tracking
    }

    // ── 2. Update order ──
    // FIX: single courier_tracking_url write. Prefer tracking URL, fall back to
    // slip URL. The separate slip URL (if any) goes to courier_slip_url.
    const nowIso = new Date().toISOString();
    const updatePayload = {
      status: 'dispatched',
      dispatched_at: nowIso,
      dispatched_courier: courier,
      tracking_number: tracking || null,
      courier_tracking_url: trackingUrl || slipUrl || null,
      updated_at: nowIso,
    };
    // Add slip URL separately if both exist AND the column exists.
    // We attempt the write; if the column doesn't exist the update silently
    // ignores unknown fields… actually Supabase errors — so guard with try/catch.
    if (slipUrl && trackingUrl && slipUrl !== trackingUrl) {
      updatePayload.courier_slip_url = slipUrl;
    }

    const { error: updErr } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', order_id);

    if (updErr) {
      // If courier_slip_url column doesn't exist, retry without it
      if (String(updErr.message).toLowerCase().includes('courier_slip_url')) {
        delete updatePayload.courier_slip_url;
        await supabase.from('orders').update(updatePayload).eq('id', order_id);
      } else {
        throw updErr;
      }
    }

    // ── 3. courier_bookings record ──
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
      created_at: nowIso,
      updated_at: nowIso,
    });

    // ── 4. Shopify fulfillment (best-effort) ──
    let shopifyFulfillmentId = null;
    let shopifyPushError = null;

    if (order.shopify_order_id && tracking && !order.shopify_fulfillment_id) {
      try {
        const fulfillment = await createShopifyFulfillment(
          order.shopify_order_id,
          tracking,
          courier,
          trackingUrl,
        );
        shopifyFulfillmentId = fulfillment?.id ? String(fulfillment.id) : null;

        if (shopifyFulfillmentId) {
          await supabase.from('orders').update({
            shopify_fulfillment_id: shopifyFulfillmentId,
            shopify_fulfilled_at: nowIso,
          }).eq('id', order_id);
        }
      } catch (e) {
        shopifyPushError = e.message;
        console.error('[dispatch] Shopify fulfillment push failed:', e.message);
      }
    }

    // ── 5. Activity log (with performer attribution) ──
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
      performed_by: performer,
      performed_by_email: performerEmail,
      performed_at: nowIso,
    });

    // ── 6. WhatsApp notification (best-effort; skip if booking failed) ──
    if (order.customer_phone && tracking && !bookingError) {
      try {
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
      tracking_url: trackingUrl,
      slip_url: slipUrl,
      api_booked: !bookingError,
      shopify_fulfilled: !!shopifyFulfillmentId,
      shopify_fulfillment_id: shopifyFulfillmentId,
      warnings: {
        booking: bookingError || null,
        shopify_push: shopifyPushError || null,
      },
    });
  } catch (e) {
    console.error('[dispatch] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
