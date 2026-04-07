import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchAllProducts, transformProducts } from '@/lib/shopify';

// Sync ALL products + variants from Shopify
// One DB row per VARIANT (uses shopify_variant_id as unique key)
// Inventory comes from variant.inventory_quantity (current stock at time of fetch)

export async function POST() {
  const startTime = Date.now();
  try {
    const supabase = createServerClient();
    const shopifyProducts = await fetchAllProducts();

    if (shopifyProducts.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No products found in Shopify',
        synced: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    // Flatten products → variant rows
    const allVariants = [];
    for (const p of shopifyProducts) {
      allVariants.push(...transformProducts(p));
    }

    // Deduplicate by shopify_variant_id (safety — Shopify shouldn't return dupes)
    const seen = new Set();
    const uniqueVariants = allVariants.filter(v => {
      if (seen.has(v.shopify_variant_id)) return false;
      seen.add(v.shopify_variant_id);
      return true;
    });

    // Batch upsert (50 at a time to keep transactions small)
    let synced = 0;
    const errors = [];
    for (let i = 0; i < uniqueVariants.length; i += 50) {
      const batch = uniqueVariants.slice(i, i + 50);
      const { error } = await supabase
        .from('products')
        .upsert(batch, { onConflict: 'shopify_variant_id' });

      if (error) {
        errors.push({ batch_start: i, error: error.message });
      } else {
        synced += batch.length;
      }
    }

    return NextResponse.json({
      success: true,
      total_products: shopifyProducts.length,
      total_variants: uniqueVariants.length,
      synced,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      duration_ms: Date.now() - startTime,
      message: `${synced} variants synced from ${shopifyProducts.length} products in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    });
  } catch (error) {
    console.error('[products/sync] error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// GET — quick stats
export async function GET() {
  try {
    const supabase = createServerClient();

    const { count: totalVariants } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });

    const { count: activeVariants } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    return NextResponse.json({
      success: true,
      total_variants: totalVariants || 0,
      active_variants: activeVariants || 0,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
