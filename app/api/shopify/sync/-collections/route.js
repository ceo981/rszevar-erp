// =====================================================================
// RS ZEVAR ERP — Sync Collections via GraphQL
// File path: app/api/shopify/sync-collections/route.js
//
// Lightweight endpoint: fetches ONLY product → collections mapping
// via GraphQL (no variants, no images). Updates products.collections
// column in batches. Fast: ~5-10 seconds for 1200+ products.
//
// Called automatically after main product sync, or manually.
// =====================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchProductCollections } from '@/lib/shopify';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST() {
  const startTime = Date.now();
  try {
    const supabase = createServerClient();

    // 1. Fetch product → collections mapping from Shopify GraphQL
    const collectionMap = await fetchProductCollections();
    // collectionMap: Map<shopify_product_id, [{handle, title}]>

    if (collectionMap.size === 0) {
      return NextResponse.json({
        success: true,
        message: 'No collections found in Shopify',
        updated: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    // 2. Batch update products table
    let updated = 0;
    let errors = 0;
    const entries = Array.from(collectionMap.entries());

    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);

      // Update each product's collections column
      for (const [productId, collections] of batch) {
        const { error } = await supabase
          .from('products')
          .update({ collections })
          .eq('shopify_product_id', productId);

        if (error) {
          errors++;
        } else {
          updated++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Collections synced for ${updated} products`,
      total_with_collections: collectionMap.size,
      updated,
      errors,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[sync-collections] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST();
}
