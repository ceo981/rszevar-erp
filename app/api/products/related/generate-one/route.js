import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { generateRelatedProductsForOne } from '@/lib/related-products';

// Related Products — single product (thin wrapper around lib)

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));
    const { shopify_product_id } = body;

    if (!shopify_product_id) {
      return NextResponse.json({ success: false, error: 'shopify_product_id required' }, { status: 400 });
    }

    const result = await generateRelatedProductsForOne(supabase, shopify_product_id);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[related-products one]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
