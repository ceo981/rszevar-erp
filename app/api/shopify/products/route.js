import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchAllProducts } from '@/lib/shopify';

export async function POST() {
  try {
    const supabase = createServerClient();
    const shopifyProducts = await fetchAllProducts();

    if (shopifyProducts.length === 0) {
      return NextResponse.json({ success: true, message: 'No products found', synced: 0 });
    }

    // One row per product, deduplicated
    const seen = new Set();
    const products = [];
    for (const p of shopifyProducts) {
      const pid = String(p.id);
      if (seen.has(pid)) continue;
      seen.add(pid);
      const v = p.variants?.[0] || {};
      const totalStock = (p.variants || []).reduce((sum, vr) => sum + (vr.inventory_quantity || 0), 0);
      products.push({
        shopify_product_id: pid,
        title: p.title || 'Untitled',
        sku: v.sku || null,
        barcode: v.barcode || null,
        category: p.product_type || null,
        vendor: p.vendor || null,
        cost_price: parseFloat(v.compare_at_price) || 0,
        selling_price: parseFloat(v.price) || 0,
        stock_quantity: totalStock,
        image_url: p.image?.src || null,
        is_active: p.status === 'active',
        updated_at: new Date().toISOString(),
      });
    }

    // Insert 20 at a time to avoid conflicts
    let synced = 0, errors = [];
    for (let i = 0; i < products.length; i += 20) {
      const batch = products.slice(i, i + 20);
      const { error } = await supabase
        .from('products')
        .upsert(batch, { onConflict: 'shopify_product_id' });
      if (error) errors.push({ batch: i, error: error.message });
      else synced += batch.length;
    }

    return NextResponse.json({
      success: true,
      total_fetched: products.length,
      synced,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      message: `${synced} products synced from Shopify`,
    });
  } catch (error) {
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
