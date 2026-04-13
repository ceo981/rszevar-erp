// ============================================================================
// RS ZEVAR ERP — Fix Order Items Images
// One-time + on-demand fix: match order_items.sku → products.image_url
// Run once from Settings or manually via POST /api/orders/fix-images
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  const startTime = Date.now();
  const supabase = createServerClient();
  try {
    // 1. Fetch all order_items with missing image_url but have a SKU
    const { data: items, error: itemsErr } = await supabase
      .from('order_items')
      .select('id, sku')
      .is('image_url', null)
      .not('sku', 'is', null);

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Sab order items ki images already set hain ✅',
        fixed: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    // 2. Get unique SKUs
    const uniqueSkus = [...new Set(items.map(i => i.sku).filter(Boolean))];

    // 3. Fetch matching products (one row per SKU is enough)
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('sku, image_url')
      .in('sku', uniqueSkus)
      .not('image_url', 'is', null);

    if (prodErr) throw prodErr;

    // 4. Build SKU → image_url map (first hit wins)
    const skuImageMap = {};
    for (const p of products || []) {
      if (p.sku && p.image_url && !skuImageMap[p.sku]) {
        skuImageMap[p.sku] = p.image_url;
      }
    }

    if (Object.keys(skuImageMap).length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Products table mein bhi images nahi hain — pehle Inventory sync karo',
        fixed: 0,
        skus_missing_in_products: uniqueSkus.length,
        duration_ms: Date.now() - startTime,
      });
    }

    // 5. Batch update order_items
    let fixed = 0;
    let skipped = 0;
    const BATCH = 50;

    // Group items by image_url value to minimize DB calls
    const imageGroups = {};
    for (const item of items) {
      const img = item.sku ? skuImageMap[item.sku] : null;
      if (!img) { skipped++; continue; }
      if (!imageGroups[img]) imageGroups[img] = [];
      imageGroups[img].push(item.id);
    }

    for (const [imageUrl, ids] of Object.entries(imageGroups)) {
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const { error } = await supabase
          .from('order_items')
          .update({ image_url: imageUrl })
          .in('id', batch);

        if (!error) fixed += batch.length;
      }
    }

    return NextResponse.json({
      success: true,
      message: `${fixed} order items ki images fix ho gayi ✅`,
      fixed,
      skipped,
      total_missing: items.length,
      unique_skus_found: Object.keys(skuImageMap).length,
      duration_ms: Date.now() - startTime,
    });

  } catch (err) {
    console.error('[fix-images] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message, duration_ms: Date.now() - startTime },
      { status: 500 }
    );
  }
}

// GET — check how many items are missing images
export async function GET() {
  const supabase = createServerClient();
  try {
    const { count } = await supabase
      .from('order_items')
      .select('*', { count: 'exact', head: true })
      .is('image_url', null)
      .not('sku', 'is', null);

    return NextResponse.json({
      success: true,
      missing_images: count || 0,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
