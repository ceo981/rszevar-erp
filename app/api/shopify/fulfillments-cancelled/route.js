import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyShopifyWebhook } from '@/lib/shopify-webhook';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const rawBody = await request.text();
    const hmac = request.headers.get('x-shopify-hmac-sha256');
    if (!verifyShopifyWebhook(rawBody, hmac)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const fulfillment = JSON.parse(rawBody);
    const shopifyOrderId = String(fulfillment.order_id);

    // Find order in ERP
    const { data: order } = await supabase
      .from('orders')
      .select('id, status, order_number')
      .eq('shopify_order_id', shopifyOrderId)
      .maybeSingle();

    if (!order) {
      return NextResponse.json({ success: true, message: 'Order not found in ERP' });
    }

    // Only revert if currently dispatched (not delivered/returned)
    if (order.status === 'dispatched') {
      await supabase.from('orders').update({
        status: 'confirmed',
        tracking_number: null,
        dispatched_courier: null,
        dispatched_at: null,
        shopify_fulfillment_id: null,
        shopify_fulfilled_at: null,
        courier_tracking_url: null,
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);

      await supabase.from('order_activity_log').insert({
        order_id: order.id,
        action: 'fulfillment_cancelled',
        notes: `Shopify fulfillment cancelled — status reverted to confirmed`,
        performed_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Fulfillment cancel webhook error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
