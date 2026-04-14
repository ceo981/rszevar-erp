import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function clearFulfillment(shopifyOrderId) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, order_number')
    .eq('shopify_order_id', String(shopifyOrderId))
    .maybeSingle();

  if (!order) return { found: false };

  // Clear tracking and revert to confirmed if dispatched
  await supabase.from('orders').update({
    status: order.status === 'dispatched' ? 'confirmed' : order.status,
    tracking_number: null,
    dispatched_courier: null,
    dispatched_at: null,
    shopify_fulfillment_id: null,
    shopify_fulfilled_at: null,
    courier_tracking_url: null,
    courier_status_raw: null,
    updated_at: new Date().toISOString(),
  }).eq('id', order.id);

  await supabase.from('order_activity_log').insert({
    order_id: order.id,
    action: 'fulfillment_cancelled',
    notes: 'Shopify fulfillment cancel — tracking, courier, dispatch status clear kar diya',
    performed_at: new Date().toISOString(),
  });

  return { found: true, order_number: order.order_number };
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    const data = JSON.parse(rawBody);

    // Handle both fulfillments/cancelled and fulfillment_orders/cancelled
    const shopifyOrderId = data.order_id || data.fulfillment?.order_id;

    if (!shopifyOrderId) {
      return NextResponse.json({ success: false, error: 'No order_id found' });
    }

    const result = await clearFulfillment(shopifyOrderId);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error('Fulfillment cancel webhook error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
