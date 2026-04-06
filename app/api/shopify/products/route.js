import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchAllProducts, transformProducts } from '@/lib/shopify';

export async function POST() {
  try {
    const supabase = createServerClient();

    // Fetch all products from Shopify
    const shopifyProducts = await fetchAllProducts();

    if (shopifyProducts.length === 0) {
      return NextResponse.json({ success: true, message: 'No products found', synced: 0 });
    }

    let synced = 0;
    let errors = [];

    for (const shopifyProduct of shopifyProducts) {
      try {
        const variants = transformProducts(shopifyProduct);

        for (const variant of variants) {
          const { error } = await supabase
            .from('products')
            .upsert(variant, { onConflict: 'shopify_variant_id' });

          if (error) {
            // If shopify_variant_id column doesn't exist, try shopify_product_id
            const { error: err2 } = await supabase
              .from('products')
              .upsert({
                shopify_product_id: variant.shopify_product_id,
                title: variant.title,
                sku: variant.sku,
                barcode: variant.barcode,
                category: variant.category,
                vendor: variant.vendor,
                cost_price: variant.cost_price,
                selling_price: variant.selling_price,
                stock_quantity: variant.stock_quantity,
                image_url: variant.image_url,
                is_active: variant.is_active,
                updated_at: variant.updated_at,
              }, { onConflict: 'shopify_product_id' });

            if (err2) {
              errors.push({ product: variant.title, error: err2.message });
              continue;
            }
          }
          synced++;
        }
      } catch (e) {
        errors.push({ product: shopifyProduct.title, error: e.message });
      }
    }

    return NextResponse.json({
      success: true,
      total_fetched: shopifyProducts.length,
      synced,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
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
