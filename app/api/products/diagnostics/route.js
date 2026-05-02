// ============================================================================
// RS ZEVAR ERP — Inventory Diagnostics (May 2026)
// GET /api/products/diagnostics
// ----------------------------------------------------------------------------
// Finds inventory data integrity issues — primarily products where ERP shows
// zero images but Shopify likely has them. Used by the inventory page warning
// banner so Abdul can see + bulk-fix products that didn't sync properly.
//
// QUERY:
//   ?check=missing_images  (default; only check supported right now)
//
// RESPONSE (missing_images):
//   {
//     success: true,
//     check: 'missing_images',
//     count: 12,
//     products: [
//       { shopify_product_id, parent_title, sku, vendor, last_sync },
//       ...
//     ]
//   }
//
// HOW IT'S USED:
//   - Inventory page calls this on mount, shows a banner if count > 0
//   - Banner has "Refresh from Shopify" button per-product (uses existing
//     /api/products/[id]/refresh endpoint) OR "Refresh All Missing"
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const check = searchParams.get('check') || 'missing_images';

    if (check !== 'missing_images') {
      return NextResponse.json(
        { success: false, error: `Unknown check: '${check}'` },
        { status: 400 },
      );
    }

    // Find products where:
    //   - is_active = true (skip drafts/archived — they're expected to lack images)
    //   - image_url is null OR images_data is empty/null
    //   - shopify_product_id is set (so we can refresh via /refresh)
    //
    // We use distinct shopify_product_id grouping by picking the first row per
    // group (variants share product-level fields). Done client-side because
    // Supabase doesn't expose DISTINCT cleanly.
    //
    // PAGINATED — Supabase silently caps at 1000 rows per call. With ~5000
    // variants in the products table, a single .select() would miss most rows
    // and the diagnostic would under-report. Loop until we either get an empty
    // page or hit the safety ceiling.
    const rows = [];
    const PAGE = 1000;
    let off = 0;
    while (off < 20000) {
      const { data: chunk, error } = await supabase
        .from('products')
        .select('shopify_product_id, parent_title, sku, vendor, image_url, images_data, shopify_synced_at')
        .eq('is_active', true)
        .not('shopify_product_id', 'is', null)
        .range(off, off + PAGE - 1);

      if (error) throw error;
      if (!chunk || chunk.length === 0) break;
      rows.push(...chunk);
      if (chunk.length < PAGE) break;
      off += PAGE;
    }

    // Pick first row per shopify_product_id; check missing-images condition
    const seen = new Set();
    const missing = [];
    for (const r of rows || []) {
      const pid = String(r.shopify_product_id);
      if (seen.has(pid)) continue;
      seen.add(pid);

      const hasImageUrl   = !!r.image_url && r.image_url.trim();
      const hasImagesData = Array.isArray(r.images_data) && r.images_data.length > 0;
      // Treat as "missing" when BOTH are empty — strict condition.
      // If just image_url is missing but images_data has entries, that's a
      // separate (variant-image-mapping) issue and not the user's reported case.
      if (!hasImageUrl && !hasImagesData) {
        missing.push({
          shopify_product_id: pid,
          parent_title: r.parent_title || '(untitled)',
          sku: r.sku || null,
          vendor: r.vendor || null,
          last_sync: r.shopify_synced_at || null,
        });
      }
    }

    // Sort: oldest sync first (most likely to be stale)
    missing.sort((a, b) => {
      const ta = a.last_sync ? new Date(a.last_sync).getTime() : 0;
      const tb = b.last_sync ? new Date(b.last_sync).getTime() : 0;
      return ta - tb;
    });

    return NextResponse.json({
      success: true,
      check: 'missing_images',
      count: missing.length,
      total_active_products: seen.size,
      products: missing.slice(0, 200),  // cap at 200 to keep response light
      truncated: missing.length > 200,
    });
  } catch (e) {
    console.error('[products/diagnostics] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
