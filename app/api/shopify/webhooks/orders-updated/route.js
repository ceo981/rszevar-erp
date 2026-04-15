import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyShopifyWebhook, handleOrderWebhook } from '@/lib/shopify-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const rawBody = await request.text();
  const hmac = request.headers.get('x-shopify-hmac-sha256');

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  let shopifyOrder;
  try { shopifyOrder = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const supabase = createServerClient();
  const tags = (shopifyOrder.tags || '').split(',').map(t => t.trim().toLowerCase());
  const shopifyOrderId = String(shopifyOrder.id);

  const { data: erpOrder } = await supabase
    .from('orders')
    .select('id, status')
    .eq('shopify_order_id', shopifyOrderId)
    .single();

  if (erpOrder) {
    const isFulfilled = shopifyOrder.fulfillment_status === 'fulfilled' || shopifyOrder.fulfillment_status === 'partial';
    const isActiveStatus = ['confirmed', 'on_packing'].includes(erpOrder.status);

    // order_confirmed tag hata diya → pending pe wapas + assignment cancel
    // Sirf tab jab fulfillment nahi hua
    if (isActiveStatus && !tags.includes('order_confirmed') && !isFulfilled) {
      await supabase.from('orders').update({
        status: 'pending',
        confirmed_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', erpOrder.id);

      await supabase.from('order_assignments').delete().eq('order_id', erpOrder.id);
      await supabase.from('order_activity_log').insert({
        order_id: erpOrder.id,
        action: 'unconfirmed',
        notes: 'Shopify se order_confirmed tag hata diya — status pending, assignment cancel',
        performed_at: new Date().toISOString(),
      });
    }

    // packing:* tag hata diya → assignment cancel
    if (isActiveStatus && !isFulfilled && !tags.some(t => t.startsWith('packing:'))) {
      await supabase.from('order_assignments').delete().eq('order_id', erpOrder.id);
      await supabase.from('order_activity_log').insert({
        order_id: erpOrder.id,
        action: 'unassigned',
        notes: 'Shopify se packing tag hata diya — assignment cancel',
        performed_at: new Date().toISOString(),
      });
    }
  }

  // HAMESHA handleOrderWebhook call karo taake tags, tracking sab update ho
  const req2 = new Request(request.url, {
    method: 'POST',
    headers: {
      'x-shopify-hmac-sha256': hmac || '',
      'x-shopify-shop-domain': request.headers.get('x-shopify-shop-domain') || '',
      'content-type': 'application/json',
    },
    body: rawBody,
  });
  const { status, body } = await handleOrderWebhook(req2, { topic: 'orders/updated', insertLineItems: false });
  return NextResponse.json(body, { status });
}
