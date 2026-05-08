// ============================================================================
// RS ZEVAR ERP — Fix Order Items Images
// POST /api/orders/fix-images
// ----------------------------------------------------------------------------
// Two modes:
//
//   1. PASSIVE (default): only fills image_url where it's currently NULL.
//      Body: {} or no body.
//      Use case: sab order_items pe images set ho jayein, koi pehle se
//      sahi value overwrite na ho.
//
//   2. FORCE RESYNC (May 8 2026): re-fetches image_url for ALL matching
//      items, overwriting existing values. Used when products table ki
//      image_url update ho gayi hai (e.g. variant→image link Shopify mein
//      fix karne ke baad) aur purane order_items ko refresh karna hai.
//      Body: { force_resync: true, sku?: "AD083", order_id?: "uuid" }
//
//      Optional filters:
//        - sku: sirf is SKU wale items refresh karo
//        - order_id: sirf is order ke items refresh karo (UUID, not order_number)
//        - shopify_order_id: same as above but Shopify ID se
//      Filters AND ho jate hain (all must match).
//
// ----------------------------------------------------------------------------
// FIX May 8 2026 — Variant-id-aware lookups + auto-backfill of variant_id.
//
// Pehle SKU-based lookup hota tha. RS ZEVAR ke jewelry products mein
// typically Golden/Silver variants ka SKU same hota hai (parent SKU shared
// across variants), jiski wajah se SKU-based lookup ambiguous tha — random
// variant ki image pakad leta tha (first-hit-wins). Issue example:
// ZEVAR-119241 mein Golden variant (SKU AD083) ki jaga Silver image dikhi.
//
// Ab priority:
//   1) order_items.shopify_variant_id se products.shopify_variant_id match
//      (unique, no collision)
//   2) Agar order_items.shopify_variant_id NULL hai (purane orders pre-May-8),
//      shopify_raw.line_items[i].variant_id se backfill karo + use karo
//   3) SKU-based lookup last fallback
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  const startTime = Date.now();
  const supabase = createServerClient();
  try {
    // ── Parse body (gracefully handle empty / no body for back-compat) ──
    let body = {};
    try {
      const raw = await request.text();
      if (raw && raw.trim()) body = JSON.parse(raw);
    } catch {
      body = {};
    }

    const forceResync     = body.force_resync === true;
    const skuFilter       = body.sku || null;
    const orderIdFilter   = body.order_id || null;
    const shopifyOrderId  = body.shopify_order_id ? String(body.shopify_order_id) : null;

    // ── 1. Fetch candidate order_items ──
    let q = supabase
      .from('order_items')
      .select('id, order_id, sku, shopify_variant_id, shopify_line_item_id, image_url');

    if (!forceResync) {
      q = q.is('image_url', null);
    }
    q = q.not('sku', 'is', null);

    if (skuFilter) q = q.eq('sku', skuFilter);
    if (orderIdFilter) q = q.eq('order_id', orderIdFilter);

    // shopify_order_id requires a join via orders table — do it as a separate
    // lookup to keep the main query simple.
    if (shopifyOrderId) {
      const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .select('id')
        .eq('shopify_order_id', shopifyOrderId)
        .maybeSingle();
      if (orderErr) throw orderErr;
      if (!orderRow) {
        return NextResponse.json({
          success: true,
          message: `shopify_order_id=${shopifyOrderId} se koi order nahi mila`,
          fixed: 0,
          duration_ms: Date.now() - startTime,
        });
      }
      q = q.eq('order_id', orderRow.id);
    }

    const { data: items, error: itemsErr } = await q;
    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) {
      return NextResponse.json({
        success: true,
        message: forceResync
          ? 'Filter ke mutabiq koi items nahi mile'
          : 'Sab order items ki images already set hain ✅',
        fixed: 0,
        mode: forceResync ? 'force_resync' : 'passive',
        duration_ms: Date.now() - startTime,
      });
    }

    // ── 2. Auto-backfill shopify_variant_id from shopify_raw for items
    //       that are missing it. We need parent order's shopify_raw, then
    //       match by shopify_line_item_id to extract variant_id.
    const itemsMissingVariantId = items.filter(i => !i.shopify_variant_id);
    let variantIdBackfilled = 0;

    if (itemsMissingVariantId.length > 0) {
      // Group by order_id to fetch each order's shopify_raw once
      const orderIdsNeeded = [...new Set(itemsMissingVariantId.map(i => i.order_id))];
      const { data: orders } = await supabase
        .from('orders')
        .select('id, shopify_raw')
        .in('id', orderIdsNeeded);

      const rawMap = new Map();
      for (const o of orders || []) {
        rawMap.set(o.id, o.shopify_raw?.line_items || []);
      }

      // Build per-item updates
      const updatesByVariantId = []; // { id, shopify_variant_id }
      for (const item of itemsMissingVariantId) {
        const lineItems = rawMap.get(item.order_id) || [];
        const match = lineItems.find(li => String(li.id) === String(item.shopify_line_item_id));
        if (match?.variant_id) {
          const vid = String(match.variant_id);
          updatesByVariantId.push({ id: item.id, shopify_variant_id: vid });
          // Mutate in-memory item too so step 3 lookup uses it
          item.shopify_variant_id = vid;
        }
      }

      // Batch update — Supabase doesn't support bulk UPDATE with different
      // values in a single call, so we loop in chunks of 50 in parallel.
      if (updatesByVariantId.length > 0) {
        const CHUNK = 50;
        for (let i = 0; i < updatesByVariantId.length; i += CHUNK) {
          const batch = updatesByVariantId.slice(i, i + CHUNK);
          await Promise.all(batch.map(b =>
            supabase
              .from('order_items')
              .update({ shopify_variant_id: b.shopify_variant_id })
              .eq('id', b.id)
              .then(({ error }) => {
                if (!error) variantIdBackfilled += 1;
              })
          ));
        }
      }
    }

    // ── 3. Build lookup maps from products table ──
    const allVariantIds = [...new Set(items.filter(i => i.shopify_variant_id).map(i => i.shopify_variant_id))];
    const allSkus       = [...new Set(items.map(i => i.sku).filter(Boolean))];

    // 3a. Variant_id → image_url (preferred — unique, no collision)
    const variantImageMap = {};
    if (allVariantIds.length > 0) {
      // Chunk into 500 to avoid URL length limits on .in()
      const CHUNK = 500;
      for (let i = 0; i < allVariantIds.length; i += CHUNK) {
        const chunk = allVariantIds.slice(i, i + CHUNK);
        const { data: prods, error } = await supabase
          .from('products')
          .select('shopify_variant_id, image_url')
          .in('shopify_variant_id', chunk)
          .not('image_url', 'is', null);
        if (!error) {
          for (const p of prods || []) {
            if (p.shopify_variant_id && p.image_url) {
              variantImageMap[p.shopify_variant_id] = p.image_url;
            }
          }
        }
      }
    }

    // 3b. SKU → image_url (fallback only — first-hit-wins, may be ambiguous
    //     for shared-SKU products, kept for items without variant_id)
    const skuImageMap = {};
    if (allSkus.length > 0) {
      const { data: prods, error } = await supabase
        .from('products')
        .select('sku, image_url')
        .in('sku', allSkus)
        .not('image_url', 'is', null);
      if (!error) {
        for (const p of prods || []) {
          if (p.sku && p.image_url && !skuImageMap[p.sku]) {
            skuImageMap[p.sku] = p.image_url;
          }
        }
      }
    }

    if (Object.keys(variantImageMap).length === 0 && Object.keys(skuImageMap).length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Products table mein bhi images nahi hain — pehle Inventory sync karo',
        fixed: 0,
        skus_missing_in_products: allSkus.length,
        variant_ids_missing_in_products: allVariantIds.length,
        duration_ms: Date.now() - startTime,
      });
    }

    // ── 4. Resolve final image per item + group by URL for batched updates ──
    const imageGroups = {}; // { image_url: [item.id, ...] }
    let skipped = 0;
    let resolvedByVariantId = 0;
    let resolvedBySku = 0;

    for (const item of items) {
      let img = null;
      if (item.shopify_variant_id && variantImageMap[item.shopify_variant_id]) {
        img = variantImageMap[item.shopify_variant_id];
        resolvedByVariantId += 1;
      } else if (item.sku && skuImageMap[item.sku]) {
        img = skuImageMap[item.sku];
        resolvedBySku += 1;
      }

      if (!img) { skipped += 1; continue; }

      // In passive mode: skip if same as current (avoids needless writes)
      // In force mode: always update (caller wants overwrite)
      if (!forceResync && item.image_url === img) { skipped += 1; continue; }

      if (!imageGroups[img]) imageGroups[img] = [];
      imageGroups[img].push(item.id);
    }

    // ── 5. Batch update grouped by image URL ──
    let fixed = 0;
    const BATCH = 50;
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
      mode: forceResync ? 'force_resync' : 'passive',
      message: `${fixed} order items ki images ${forceResync ? 'refresh' : 'fix'} ho gayi ✅`,
      fixed,
      skipped,
      total_candidates: items.length,
      resolved_by_variant_id: resolvedByVariantId,
      resolved_by_sku: resolvedBySku,
      variant_id_backfilled: variantIdBackfilled,
      filters: {
        sku: skuFilter,
        order_id: orderIdFilter,
        shopify_order_id: shopifyOrderId,
      },
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

// ─── GET — diagnostic: how many items still need attention ───
export async function GET() {
  const supabase = createServerClient();
  try {
    const [{ count: missingImages }, { count: missingVariantId }] = await Promise.all([
      supabase
        .from('order_items')
        .select('*', { count: 'exact', head: true })
        .is('image_url', null)
        .not('sku', 'is', null),
      supabase
        .from('order_items')
        .select('*', { count: 'exact', head: true })
        .is('shopify_variant_id', null),
    ]);

    return NextResponse.json({
      success: true,
      missing_images: missingImages || 0,
      missing_variant_id: missingVariantId || 0,
      hint: 'POST { force_resync: true } to refresh all (or with sku/order_id filters to scope)',
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
