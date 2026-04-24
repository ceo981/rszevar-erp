import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase';
import { fetchAllOrdersSince, transformOrder, transformLineItems } from '../../../../lib/shopify';
import { getSettings } from '../../../../lib/settings';

// LOCKED_STATUSES also read from settings now, with sensible fallback
// confirmed, processing, packed, dispatched, in_transit etc — sab manually set hote hain
// Shopify sync ko inhe KABHI overwrite nahi karna chahiye
const DEFAULT_LOCKED = ['confirmed', 'on_packing', 'processing', 'packed', 'dispatched', 'in_transit', 'attempted', 'hold', 'delivered', 'returned', 'rto', 'cancelled', 'refunded'];

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  const startTime = Date.now();
  const debug = { stage: 'init', steps: [] };

  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));

    // Read sync window from settings (fallback to 3 days)
    const rules = await getSettings('business_rules');
    const configuredDays = rules['rules.shopify_sync_window_days'] ?? 3;
    const lockedStatuses = rules['rules.locked_statuses'] ?? DEFAULT_LOCKED;

    const days = body.days || configuredDays;
    const sinceDate = body.since || new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    debug.stage = 'fetching_shopify';
    debug.steps.push({ step: 'fetch_start', since: sinceDate, days, locked_count: lockedStatuses.length });

    // 1. Fetch from Shopify
    const shopifyOrders = await fetchAllOrdersSince(sinceDate);
    debug.steps.push({ step: 'fetch_done', count: shopifyOrders.length });

    if (shopifyOrders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No new orders found',
        synced: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    // 2. Batch fetch existing
    debug.stage = 'fetching_existing';
    const shopifyOrderIds = shopifyOrders.map(o => String(o.id));
    const { data: existingOrders, error: existingError } = await supabase
      .from('orders')
      .select('id, shopify_order_id, status, payment_status')
      .in('shopify_order_id', shopifyOrderIds);

    if (existingError) {
      return NextResponse.json({
        success: false,
        stage: 'fetch_existing_orders',
        error: existingError.message,
        debug,
      }, { status: 500 });
    }

    const existingMap = new Map();
    (existingOrders || []).forEach(o => existingMap.set(o.shopify_order_id, o));

    // 3. Transform (now async — each call reads settings but cache makes it fast)
    debug.stage = 'transforming';
    const ordersToUpsert = [];
    const customersToUpsert = [];
    const customerIdsSeen = new Set();
    const transformErrors = [];

    for (const shopifyOrder of shopifyOrders) {
      try {
        const orderData = await transformOrder(shopifyOrder);
        const existing = existingMap.get(orderData.shopify_order_id);

        if (existing) {
          if (lockedStatuses.includes(existing.status)) delete orderData.status;
          if (existing.payment_status === 'paid' && orderData.payment_status === 'unpaid') delete orderData.payment_status;
          if (existing.payment_status === 'refunded') delete orderData.payment_status;

          // confirmed → on_packing when Shopify tracking exists
          if (existing.status === 'confirmed') {
            const fulfillments = shopifyOrder.fulfillments || [];
            const hasTracking = fulfillments.some(
              f => f.tracking_number && f.status !== 'cancelled'
            );
            if (hasTracking) orderData.status = 'on_packing';
          }
        }

        ordersToUpsert.push(orderData);

        if (shopifyOrder.customer && !customerIdsSeen.has(shopifyOrder.customer.id)) {
          customerIdsSeen.add(shopifyOrder.customer.id);
          const c = shopifyOrder.customer;
          customersToUpsert.push({
            shopify_customer_id: String(c.id),
            name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown',
            phone: c.phone || null,
            email: c.email || null,
            city: shopifyOrder.shipping_address?.city || null,
            address: shopifyOrder.shipping_address?.address1 || null,
          });
        }
      } catch (e) {
        transformErrors.push({ order: shopifyOrder.name, error: e.message });
      }
    }

    debug.steps.push({
      step: 'transform_done',
      orders_to_upsert: ordersToUpsert.length,
      customers_to_upsert: customersToUpsert.length,
      transform_errors: transformErrors.length,
    });

    // 4. Dedupe (Shopify pagination overlap)
    const dedupMap = new Map();
    for (const o of ordersToUpsert) dedupMap.set(o.shopify_order_id, o);
    const dedupedOrders = Array.from(dedupMap.values());
    debug.steps.push({
      step: 'dedup_done',
      before: ordersToUpsert.length,
      after: dedupedOrders.length,
      removed: ordersToUpsert.length - dedupedOrders.length,
    });

    // 5. Upsert
    debug.stage = 'upserting_orders';
    let synced = 0;
    let upsertedOrders = [];
    if (dedupedOrders.length > 0) {
      const { data, error: upsertError } = await supabase
        .from('orders')
        .upsert(dedupedOrders, { onConflict: 'shopify_order_id' })
        .select('id, shopify_order_id');

      if (upsertError) {
        return NextResponse.json({
          success: false,
          stage: 'upsert_orders',
          error: upsertError.message,
          code: upsertError.code,
          hint: upsertError.hint,
          sample_order_keys: Object.keys(dedupedOrders[0] || {}),
          debug,
        }, { status: 500 });
      }
      upsertedOrders = data || [];
      synced = upsertedOrders.length;
    }

    // 6. Upsert customers
    let customerError = null;
    if (customersToUpsert.length > 0) {
      const { error } = await supabase
        .from('customers')
        .upsert(customersToUpsert, { onConflict: 'shopify_customer_id' });
      if (error) {
        customerError = { message: error.message, code: error.code };
      }
    }

    // 7. Line items — NEW orders + existing orders missing items
    const newOrdersMap = new Map();
    upsertedOrders.forEach(o => {
      if (!existingMap.has(o.shopify_order_id)) {
        newOrdersMap.set(o.shopify_order_id, o.id);
      }
    });

    // Also track existing orders for items backfill
    const existingNoItemsMap = new Map();
    upsertedOrders.forEach(o => {
      if (existingMap.has(o.shopify_order_id)) {
        existingNoItemsMap.set(o.shopify_order_id, o.id);
      }
    });

    // Pre-fetch SKU → image_url map from products table
    // Taake Shopify null image wale items bhi sahi image payein
    let skuImageMap = {};
    try {
      const { data: productImages } = await supabase
        .from('products')
        .select('sku, image_url')
        .not('sku', 'is', null)
        .not('image_url', 'is', null);
      for (const p of productImages || []) {
        if (p.sku && p.image_url && !skuImageMap[p.sku]) {
          skuImageMap[p.sku] = p.image_url;
        }
      }
    } catch (e) { /* silent fallback */ }

    let itemsError = null;
    let itemsInserted = 0;

    // New orders — insert items
    if (newOrdersMap.size > 0) {
      const allItems = [];
      for (const shopifyOrder of shopifyOrders) {
        const dbId = newOrdersMap.get(String(shopifyOrder.id));
        if (!dbId) continue;
        const items = transformLineItems(shopifyOrder, skuImageMap).map(i => ({ ...i, order_id: dbId }));
        allItems.push(...items);
      }
      if (allItems.length > 0) {
        const { error } = await supabase.from('order_items').insert(allItems);
        if (error) itemsError = { message: error.message, code: error.code };
        else itemsInserted = allItems.length;
      }
    }

    // Existing orders — fill missing items (or re-sync if counts don't match).
    //
    // FIX Apr 2026 — Shopify edits now properly reflected in bulk sync:
    // Pehle sirf count === 0 pe items backfill hote the. Ab agar Shopify
    // ka line_items count aur DB ka order_items count alag ho (matlab
    // order edit hua Shopify mein — items add/removed), hum purane items
    // delete karke fresh insert karte hain. Ye webhook-missed edits ko
    // bhi catch kar leta hai.
    //
    // PERFORMANCE FIX Apr 2026 — Pehle har existing order ke liye alag
    // count query fire hoti thi (N queries for N orders). 500+ orders
    // ke liye ye Vercel ka 60s timeout cross kar jati thi aur 500 return
    // hoti thi. Ab ek hi query mein sab counts le aate hain, phir local
    // JavaScript se compare karte hain. 500 queries → 1 query.
    //
    // SAFETY: Re-sync SIRF tab karte hain jab Shopify bhi non-empty list
    // bhejta ho (shopifyCount > 0). Agar Shopify malformed payload bheje
    // (line_items missing), hum DB ko wipe nahi karte — stale state safer
    // hota hai empty state se.
    if (existingNoItemsMap.size > 0) {
      // Bulk fetch all order_items counts in ONE query.
      // Chunk into batches of 500 to avoid URL length limits on .in() clauses.
      const existingDbIds = Array.from(existingNoItemsMap.values());
      const countByOrderId = {};
      const CHUNK = 500;
      for (let i = 0; i < existingDbIds.length; i += CHUNK) {
        const chunk = existingDbIds.slice(i, i + CHUNK);
        const { data: chunkRows, error: chunkErr } = await supabase
          .from('order_items')
          .select('order_id')
          .in('order_id', chunk);
        if (chunkErr) {
          console.error('[sync] bulk count chunk failed:', chunkErr.message);
          continue;
        }
        for (const row of chunkRows || []) {
          countByOrderId[row.order_id] = (countByOrderId[row.order_id] || 0) + 1;
        }
      }

      // Now process orders using pre-fetched counts — no per-order count queries.
      for (const shopifyOrder of shopifyOrders) {
        const dbId = existingNoItemsMap.get(String(shopifyOrder.id));
        if (!dbId) continue;
        const dbCount = countByOrderId[dbId] || 0;
        const shopifyCount = Array.isArray(shopifyOrder.line_items) ? shopifyOrder.line_items.length : 0;

        // Case 1: DB has no items → backfill (original behavior)
        // Case 2: Both sides have items but counts differ → order was edited,
        //         delete stale and insert fresh.
        // NOTE: We do NOT trigger re-sync if Shopify side is empty — that
        // would wipe DB items based on potentially malformed payload.
        const needsBackfill = dbCount === 0 && shopifyCount > 0;
        const needsResync   = dbCount > 0 && shopifyCount > 0 && shopifyCount !== dbCount;

        if (needsBackfill || needsResync) {
          // Transform first — only touch DB if we have valid items to insert.
          const items = transformLineItems(shopifyOrder, skuImageMap).map(i => ({ ...i, order_id: dbId }));

          if (items.length > 0) {
            if (needsResync) {
              const { error: delError } = await supabase
                .from('order_items').delete().eq('order_id', dbId);
              if (delError) {
                console.error(`[sync] delete old items failed for order ${dbId}:`, delError.message);
                continue; // Skip insert if delete failed — avoid duplicates
              }
              console.log(`[sync] re-syncing line items for edited order ${shopifyOrder.name} (was ${dbCount}, now ${shopifyCount})`);
            }
            const { error: insError } = await supabase.from('order_items').insert(items);
            if (insError) {
              console.error(`[sync] insert items failed for order ${dbId}:`, insError.message);
            } else {
              itemsInserted += items.length;
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      total_fetched: shopifyOrders.length,
      synced,
      items_inserted: itemsInserted,
      transform_errors: transformErrors.length > 0 ? transformErrors.slice(0, 5) : undefined,
      customer_error: customerError,
      items_error: itemsError,
      sync_window_days: days,
      duration_ms: Date.now() - startTime,
      message: `${synced} orders synced in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    });

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        stage: debug.stage,
        error: error.message,
        stack: error.stack,
        debug,
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const supabase = createServerClient();

    const { count: totalOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    const { data: lastSynced } = await supabase
      .from('orders')
      .select('shopify_synced_at, order_number')
      .not('shopify_synced_at', 'is', null)
      .order('shopify_synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      total_orders: totalOrders || 0,
      last_synced: lastSynced?.shopify_synced_at || null,
      last_order: lastSynced?.order_number || null,
    });

  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
