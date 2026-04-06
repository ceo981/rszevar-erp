import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchAllProducts, transformProducts } from '@/lib/shopify';

export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = createServerClient();
    const shopifyProducts = await fetchAllProducts();

    if (shopifyProducts.length === 0) {
      return NextResponse.json({ success: true, message: 'No products found', synced: 0 });
    }

    // Transform all products into flat array of variants
    let allVariants = [];
    for (const product of shopifyProducts) {
      const variants = transformProducts(product);
      allVariants = allVariants.concat(variants);
    }

    // Batch upsert - 50 at a time (much faster than one by one)
    let synced = 0;
    let errors = [];
    for (let i = 0; i < allVariants.length; i += 50) {
      const batch = allVariants.slice(i, i + 50);
      const { error } = await supabase
        .from('products')
        .upsert(batch, { onConflict: 'shopify_product_id', ignoreDuplicates: false });

      if (error) {
        errors.push({ batch: i, error: error.message });
      } else {
        synced += batch.length;
      }
    }

    return NextResponse.json({
      success: true,
      total_fetched: shopifyProducts.length,
      total_variants: allVariants.length,
      synced,
      errors: errors.length > 0 ? errors : undefined,
      message: `${synced} products synced from Shopify`,
    });
  } catch (error) {
    console.error('Product sync error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = createServerClient();
    const { count } = await supabase.from('products').select('*', { count: 'exact', head: true });
    return NextResponse.json({ success: true, total_products: count || 0 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
