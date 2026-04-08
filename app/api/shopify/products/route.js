import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchAllProducts, transformProducts } from '@/lib/shopify';

// Sync ALL products + variants from Shopify
// DEBUG VERSION — surfaces any upsert error directly in the UI banner

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  const startTime = Date.now();
  try {
    const supabase = createServerClient();

    // ── Env check (if service key missing, fail loudly) ──
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({
        success: false,
        error: 'SUPABASE_SERVICE_ROLE_KEY env var missing on Vercel',
      }, { status: 500 });
    }

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

    // Deduplicate by shopify_variant_id
    const seen = new Set();
    const uniqueVariants = allVariants.filter(v => {
      if (seen.has(v.shopify_variant_id)) return false;
      seen.add(v.shopify_variant_id);
      return true;
    });

    if (uniqueVariants.length === 0) {
      return NextResponse.json({
        success: false,
        error: `Got ${shopifyProducts.length} products from Shopify but transformProducts produced 0 variants`,
        sample_product_keys: Object.keys(shopifyProducts[0] || {}),
        sample_variants_count: (shopifyProducts[0]?.variants || []).length,
      });
    }

    // ── SINGLE-ROW TEST FIRST ──
    // Try inserting just the first variant on its own. If this fails, we get
    // the full Postgres error message without 30+ batches hiding it.
    const firstRow = uniqueVariants[0];
    const { error: singleErr, data: singleData } = await supabase
      .from('products')
      .upsert([firstRow], { onConflict: 'shopify_variant_id' })
      .select();

    if (singleErr) {
      return NextResponse.json({
        success: false,
        error: `SINGLE ROW TEST FAILED: ${singleErr.message}`,
        error_code: singleErr.code,
        error_details: singleErr.details,
        error_hint: singleErr.hint,
        sample_row_keys: Object.keys(firstRow),
        sample_row: firstRow,
      }, { status: 500 });
    }

    // ── Full batch upsert ──
    let synced = 1; // already got the single test row
    const errors = [];
    for (let i = 1; i < uniqueVariants.length; i += 50) {
      const batch = uniqueVariants.slice(i, i + 50);
      const { error } = await supabase
        .from('products')
        .upsert(batch, { onConflict: 'shopify_variant_id' });

      if (error) {
        errors.push({ batch_start: i, error: error.message, code: error.code });
      } else {
        synced += batch.length;
      }
    }

    // If batches had any errors, surface them loudly
    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        error: `${synced} synced but ${errors.length} batches failed. First error: ${errors[0].error}`,
        errors_sample: errors.slice(0, 3),
        synced,
        total_variants: uniqueVariants.length,
        duration_ms: Date.now() - startTime,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      total_products: shopifyProducts.length,
      total_variants: uniqueVariants.length,
      synced,
      duration_ms: Date.now() - startTime,
      message: `${synced} variants synced from ${shopifyProducts.length} products in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    });
  } catch (error) {
    console.error('[products/sync] fatal:', error);
    return NextResponse.json(
      {
        success: false,
        error: `FATAL: ${error.message}`,
        stack: error.stack?.split('\n').slice(0, 5).join(' | '),
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
