import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { pushRelatedMetafield } from '@/lib/shopify-metafields';

// Push rszevar.related_products metafield for a single product
// Body: { shopify_product_id, force }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  const startTime = Date.now();
  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));
    const { shopify_product_id, force = false } = body;

    if (!shopify_product_id) {
      return NextResponse.json(
        { success: false, error: 'shopify_product_id required' },
        { status: 400 }
      );
    }

    // Read product + picks
    const { data: product, error: pErr } = await supabase
      .from('products')
      .select('shopify_product_id, parent_title, related_products, related_metafield_pushed_at')
      .eq('shopify_product_id', String(shopify_product_id))
      .limit(1)
      .maybeSingle();

    if (pErr) throw new Error(`DB read failed: ${pErr.message}`);
    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Product not found in ERP' },
        { status: 404 }
      );
    }

    const picks = product.related_products?.picks || [];
    if (picks.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No related_products.picks generated for this product yet' },
        { status: 400 }
      );
    }

    if (product.related_metafield_pushed_at && !force) {
      return NextResponse.json({
        success: true,
        skipped: true,
        title: product.parent_title,
        reason: 'Already pushed — pass force:true to re-push',
        pushed_at: product.related_metafield_pushed_at,
      });
    }

    const pickIds = picks.map(p => p.shopify_product_id).filter(Boolean);
    if (pickIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'picks present but no shopify_product_ids inside' },
        { status: 400 }
      );
    }

    // Push to Shopify
    const result = await pushRelatedMetafield(product.shopify_product_id, pickIds);

    // Update tracking
    const nowIso = new Date().toISOString();
    const { error: uErr } = await supabase
      .from('products')
      .update({
        related_metafield_pushed_at: nowIso,
        related_metafield_id: result.metafield_id,
      })
      .eq('shopify_product_id', product.shopify_product_id);
    if (uErr) console.error('[push-related-one] DB update warning:', uErr.message);

    return NextResponse.json({
      success: true,
      shopify_product_id: product.shopify_product_id,
      title: product.parent_title,
      pushed_ids: pickIds,
      metafield_id: result.metafield_id,
      created: result.created,
      pushed_at: nowIso,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[push-related-one]', err.message);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
