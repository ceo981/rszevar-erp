// RS ZEVAR ERP — Auto Product Sync
// Shopify webhook: products/update
// Jab bhi Shopify mein product update ho → ERP automatically sync ho

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServerClient } from '@/lib/supabase';
import { transformProducts } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!hmacHeader || !secret) return false;
  try {
    const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
    const a = Buffer.from(computed);
    const b = Buffer.from(hmacHeader);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

export async function POST(request) {
  const rawBody = await request.text();
  const hmac = request.headers.get('x-shopify-hmac-sha256');

  if (!verifyHmac(rawBody, hmac)) {
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  let shopifyProduct;
  try { shopifyProduct = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const supabase = createServerClient();

  // Transform into variant rows
  const variants = transformProducts(shopifyProduct);
  if (variants.length === 0) {
    return NextResponse.json({ success: true, skipped: 'no_variants' });
  }

  const { error } = await supabase
    .from('products')
    .upsert(variants, { onConflict: 'shopify_variant_id' });

  if (error) {
    console.error('[webhook:products/update] upsert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    product: shopifyProduct.title,
    variants_synced: variants.length,
  });
}
