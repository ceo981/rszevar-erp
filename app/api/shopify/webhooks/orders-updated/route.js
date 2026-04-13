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
    const updates = {};

    // order_confirmed tag hata diya → pending pe wapas + assignment cancel
    if (erpOrder.status === 'confirmed' && !tags.includes('order_confirmed')) {
      updates.status = 'pending';
      updates.confirmed_at = null;

      await supabase.from('order_assignments').delete().eq('order_id', erpOrder.id);
      await supabase.from('order_activity_log').insert({
        order_id: erpOrder.id,
        action: 'unconfirmed',
        notes: 'Shopify se order_confirmed tag hata diya — status pending',
        performed_at: new Date().toISOString(),
      });
    }

    // packing:* tag hata diya → assignment cancel (status confirmed rehta hai)
    if (erpOrder.status === 'confirmed' && !tags.some(t => t.startsWith('packing:'))) {
      await supabase.from('order_assignments').delete().eq('order_id', erpOrder.id);
      await supabase.from('order_activity_log').insert({
        order_id: erpOrder.id,
        action: 'unassigned',
        notes: 'Shopify se packing tag hata diya — assignment cancel',
        performed_at: new Date().toISOString(),
      });
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await supabase.from('orders').update(updates).eq('id', erpOrder.id);
      return NextResponse.json({ success: true, action: 'reverted', updates });
    }
  }

  // Baaki normal webhook processing
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
