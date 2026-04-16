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

  // HAMESHA handleOrderWebhook pehle — ye locked statuses respect karta hai
  // on_packing, confirmed, packed etc. locked hain to status nahi badlega
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
