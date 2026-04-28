// ============================================================================
// RS ZEVAR ERP — Orders API Route
// Phase 6: Added `type` filter (wholesale/international/walkin) and
//          improved `courier` filter (PostEx/Leopards/Kangaroo/Other).
//          Stats counts are filter-AWARE — show counts within current filter.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { isActiveLineItem, getEffectiveQuantity } from '@/lib/shopify';

export async function GET(request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    // ── Order items fetch ──
    const action = searchParams.get('action');
    if (action === 'items') {
      const order_id = searchParams.get('order_id');
      if (!order_id) return NextResponse.json({ items: [] });

      // Try order_items table first
      const { data: dbItems } = await supabase
        .from('order_items')
        .select('title, sku, quantity, unit_price, total_price, image_url')
        .eq('order_id', order_id)
        .order('id');

      let rows = dbItems || [];

      // Fallback: shopify_raw.line_items for old orders where order_items
      // was never backfilled. Needed so drawer/single-page can show images.
      // FIX Apr 2026 — Filter out items removed via Shopify Order Edit
      // (current_quantity === 0). See lib/shopify.js#isActiveLineItem.
      if (rows.length === 0) {
        const { data: orderRow } = await supabase
          .from('orders')
          .select('shopify_raw')
          .eq('id', order_id)
          .maybeSingle();
        const rawItems = (orderRow?.shopify_raw?.line_items || []).filter(isActiveLineItem);
        rows = rawItems.map(it => {
          const qty = getEffectiveQuantity(it);
          return {
            title: (it.title || '') + (it.variant_title ? ` - ${it.variant_title}` : ''),
            sku: it.sku || null,
            quantity: qty,
            unit_price: parseFloat(it.price) || 0,
            total_price: (parseFloat(it.price) || 0) * qty,
            image_url: it.image?.src || null,
          };
        });
      }

      // Enrich: items jinka image_url null ho, products table se SKU match karke image lao
      const missingSkus = [...new Set(rows.filter(i => !i.image_url && i.sku).map(i => i.sku))];
      if (missingSkus.length > 0) {
        const { data: prods } = await supabase
          .from('products')
          .select('sku, image_url')
          .in('sku', missingSkus)
          .not('image_url', 'is', null);

        const skuMap = {};
        for (const p of prods || []) {
          if (p.sku && p.image_url && !skuMap[p.sku]) skuMap[p.sku] = p.image_url;
        }

        // Apply enrichment + save back to DB (so future loads are instant)
        // Only persist if the item came from order_items (has a DB row), not
        // from shopify_raw fallback (no row to update).
        const cameFromDb = (dbItems || []).length > 0;
        const updates = [];
        for (const item of rows) {
          if (!item.image_url && item.sku && skuMap[item.sku]) {
            item.image_url = skuMap[item.sku];
            if (cameFromDb) updates.push({ sku: item.sku, image_url: skuMap[item.sku] });
          }
        }

        // Persist found images to order_items table (best effort, non-blocking)
        if (updates.length > 0) {
          for (const u of updates) {
            supabase
              .from('order_items')
              .update({ image_url: u.image_url })
              .eq('order_id', order_id)
              .eq('sku', u.sku)
              .is('image_url', null)
              .then(() => {}) // fire and forget
              .catch(() => {});
          }
        }
      }

      return NextResponse.json({ items: rows });
    }

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const courier = searchParams.get('courier');   // PostEx | Leopards | Kangaroo | Other
    const type = searchParams.get('type');         // wholesale | international | walkin
    const payment = searchParams.get('payment');   // paid | unpaid | refunded
    const review = searchParams.get('review');     // wa_cancelled (whatsapp cancel review)
    const fulfillment = searchParams.get('fulfillment'); // unfulfilled — Shopify side (NEW)
    // Apr 27 2026 — Payment state filter (Paid / Pending Payment tabs)
    //   paid             → payment_status='paid' (settled by courier)
    //   pending_payment  → status='delivered' AND payment_status != 'paid' (delivered but money pending)
    const payment_state = searchParams.get('payment_state');
    const dateFrom = searchParams.get('from');
    const dateTo = searchParams.get('to');
    const sort = searchParams.get('sort') || 'created_at';
    const order = searchParams.get('order') || 'desc';

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Helper to apply shared filters to any query (main + stats)
    const applyFilters = (q) => {
      if (status && status !== 'all') q = q.eq('status', status);
      if (courier && courier !== 'all') {
        if (courier === 'Other') {
          // "Other" = anything that's not PostEx/Leopards/Kangaroo (including null)
          q = q.or('dispatched_courier.is.null,and(dispatched_courier.neq.PostEx,dispatched_courier.neq.Leopards,dispatched_courier.neq.Kangaroo)');
        } else {
          q = q.eq('dispatched_courier', courier);
        }
      }
      if (type === 'wholesale') q = q.eq('is_wholesale', true);
      if (type === 'international') q = q.eq('is_international', true);
      if (type === 'walkin') q = q.eq('is_walkin', true);
      if (payment && payment !== 'all') q = q.eq('payment_status', payment);
      if (review === 'wa_cancelled') {
        // WhatsApp-cancelled orders pending team review
        q = q.eq('status', 'cancelled').contains('tags', '["whatsapp_cancelled"]');
      }
      // FIX Apr 2026 — Shopify "unfulfilled" filter: order Shopify side pe abhi
      // tak fulfill nahi hua. JSONB query: shopify_raw.fulfillment_status null
      // hai (no fulfillment) ya 'partial' (kuch items reh gaye). Yeh ERP status
      // ke alag hai — yahan Shopify ki nazar se filter ho raha.
      //
      // 3 exclusions for clean operational view:
      //   (a) ERP status cancelled — local cancel
      //   (b) Shopify cancelled_at set — Shopify side cancelled (catches
      //       orphan orders jahan webhook miss ho gaya aur ERP status update
      //       nahi hua)
      //   (c) fulfillment_status null/partial — kya Shopify ne fulfill kiya
      if (fulfillment === 'unfulfilled') {
        q = q.neq('status', 'cancelled')
             .is('shopify_raw->>cancelled_at', null)
             .or('shopify_raw->>fulfillment_status.is.null,shopify_raw->>fulfillment_status.eq.partial');
      }
      // Apr 27 2026 — Payment state filter
      if (payment_state === 'paid') {
        q = q.eq('payment_status', 'paid');
      } else if (payment_state === 'pending_payment') {
        // Delivered + courier ne abhi paisa settle nahi kiya
        q = q.eq('status', 'delivered').neq('payment_status', 'paid');
      }
      if (dateFrom) q = q.gte('created_at', dateFrom);
      if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59');
      if (search) {
        q = q.or(`order_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,customer_city.ilike.%${search}%,tracking_number.ilike.%${search}%`);
      }
      return q;
    };

    // ── Main query (paginated list) ──
    let query = supabase
      .from('orders')
      .select('*, order_items(*)', { count: 'exact' });
    query = applyFilters(query);
    query = query.order(sort, { ascending: order === 'asc' }).range(from, to);

    const { data: orders, count, error } = await query;
    if (error) throw error;

    // ── Stats queries ──
    // 1. GLOBAL stats (ignore filters, always show totals) — for filter dropdown counts
    // 2. FILTERED stats (current filter applied) — for summary cards
    // We do both in parallel.

    const filteredStatQueries = await Promise.all([
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })),
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })).eq('status', 'pending'),
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })).eq('status', 'confirmed'),
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })).eq('status', 'dispatched'),
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })).eq('status', 'delivered'),
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })).eq('status', 'returned'),
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })).eq('status', 'cancelled'),
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })).eq('status', 'rto'),
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })).eq('payment_status', 'paid'),
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })).eq('payment_status', 'unpaid'),
      applyFilters(supabase.from('orders').select('total_amount').eq('payment_method', 'COD').in('status', ['pending', 'confirmed', 'dispatched'])),
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })).eq('status', 'attempted'),
      applyFilters(supabase.from('orders').select('*', { count: 'exact', head: true })).eq('status', 'hold'),
    ]);

    const codOrders = filteredStatQueries[10].data || [];
    const totalCOD = codOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);

    const orderStats = {
      total: filteredStatQueries[0].count || 0,
      pending: filteredStatQueries[1].count || 0,
      confirmed: filteredStatQueries[2].count || 0,
      dispatched: filteredStatQueries[3].count || 0,
      delivered: filteredStatQueries[4].count || 0,
      returned: filteredStatQueries[5].count || 0,
      cancelled: filteredStatQueries[6].count || 0,
      rto: filteredStatQueries[7].count || 0,
      paid: filteredStatQueries[8].count || 0,
      unpaid: filteredStatQueries[9].count || 0,
      total_cod: totalCOD,
      attempted: filteredStatQueries[11].count || 0,
      hold: filteredStatQueries[12].count || 0,
    };

    // ── GLOBAL type/courier/status counts for dropdown (ignore current filters) ──
    // Apr 28 2026 — Date-aware counts.
    // Pehle saare counts global hote the (DB ka full snapshot). Ab agar user
    // date range select kare, toh tabs ke counts bhi usi range ke liye dikhte
    // hain (warna "Pending: 25" sab dates ka dikhata, jo confusing tha).
    //
    // applyDateRange() har count query mein date filter apply karta hai —
    // sirf created_at column par. Agar from/to dono missing hain to no-op.
    const applyDateRange = (q) => {
      if (dateFrom) q = q.gte('created_at', dateFrom);
      if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59');
      return q;
    };
    const baseCount = () => applyDateRange(
      supabase.from('orders').select('*', { count: 'exact', head: true })
    );

    const [
      { count: wholesaleCount },
      { count: internationalCount },
      { count: walkinCount },
      { count: leopardsCount },
      { count: postexCount },
      { count: kangarooCount },
      { count: gPending },
      { count: gConfirmed },
      { count: gOnPacking },
      { count: gDispatched },
      { count: gDelivered },
      { count: gRto },
      { count: gCancelled },
      { count: gAttempted },
      { count: gHold },
      { count: gPacked },
      { count: gPaid },
      { count: gUnpaid },
      { count: gWaCancelled },
      { count: gUnfulfilled },
      { count: gPendingPayment },
    ] = await Promise.all([
      baseCount().eq('is_wholesale', true),
      baseCount().eq('is_international', true),
      baseCount().eq('is_walkin', true),
      baseCount().eq('dispatched_courier', 'Leopards'),
      baseCount().eq('dispatched_courier', 'PostEx'),
      baseCount().eq('dispatched_courier', 'Kangaroo'),
      baseCount().eq('status', 'pending'),
      baseCount().eq('status', 'confirmed'),
      baseCount().eq('status', 'on_packing'),
      baseCount().eq('status', 'dispatched'),
      baseCount().eq('status', 'delivered'),
      baseCount().eq('status', 'rto'),
      baseCount().eq('status', 'cancelled'),
      baseCount().eq('status', 'attempted'),
      baseCount().eq('status', 'hold'),
      baseCount().eq('status', 'packed'),
      baseCount().eq('payment_status', 'paid'),
      baseCount().eq('payment_status', 'unpaid'),
      baseCount().eq('status', 'cancelled').contains('tags', '["whatsapp_cancelled"]'),
      // FIX Apr 2026 — Shopify "unfulfilled" count (operational view).
      // Match karta hai applyFilters mein wala logic — 3 exclusions.
      baseCount()
        .neq('status', 'cancelled')
        .is('shopify_raw->>cancelled_at', null)
        .or('shopify_raw->>fulfillment_status.is.null,shopify_raw->>fulfillment_status.eq.partial'),
      // Apr 27 2026 — Pending Payment count (delivered but payment NOT received yet)
      baseCount()
        .eq('status', 'delivered')
        .neq('payment_status', 'paid'),
    ]);

    const globalCounts = {
      wholesale: wholesaleCount || 0,
      international: internationalCount || 0,
      walkin: walkinCount || 0,
      leopards: leopardsCount || 0,
      postex: postexCount || 0,
      kangaroo: kangarooCount || 0,
      pending: gPending || 0,
      confirmed: gConfirmed || 0,
      on_packing: gOnPacking || 0,
      dispatched: gDispatched || 0,
      delivered: gDelivered || 0,
      rto: gRto || 0,
      cancelled: gCancelled || 0,
      attempted: gAttempted || 0,
      hold: gHold || 0,
      packed: gPacked || 0,
      paid: gPaid || 0,
      unpaid: gUnpaid || 0,
      wa_cancelled: gWaCancelled || 0,
      unfulfilled: gUnfulfilled || 0,
      pending_payment: gPendingPayment || 0,
    };

    // ── Batch-fetch assignments for these orders ──
    let ordersWithAssignment = orders || [];
    if (ordersWithAssignment.length > 0) {
      const orderIds = ordersWithAssignment.map(o => o.id);
      const { data: assignments } = await supabase
        .from('order_assignments')
        .select('order_id, employee:assigned_to(name)')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false }); // latest first
      if (assignments && assignments.length > 0) {
        const aMap = {};
        // latest assignment jeet-ta hai (created_at DESC se already sorted)
        assignments.forEach(a => {
          if (a.order_id && a.employee?.name && !aMap[a.order_id]) {
            aMap[a.order_id] = a.employee.name;
          }
        });
        ordersWithAssignment = ordersWithAssignment.map(o => ({ ...o, assigned_to_name: aMap[o.id] || null }));
      }
      // ── Fallback: Shopify packing:NAME tags se assigned naam lo ──
      ordersWithAssignment = ordersWithAssignment.map(o => {
        if (o.assigned_to_name) return o; // already found from DB
        const tags = Array.isArray(o.tags) ? o.tags : [];
        const packingTag = tags.find(t => String(t).toLowerCase().startsWith('packing:'));
        if (packingTag) {
          const rawName = packingTag.split(':')[1] || '';
          const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
          return { ...o, assigned_to_name: name, assigned_from_tag: true };
        }
        return o;
      });
    }

    return NextResponse.json({
      success: true,
      orders: ordersWithAssignment,
      total: count || 0,
      page,
      limit,
      total_pages: Math.ceil((count || 0) / limit),
      stats: orderStats,
      global_counts: globalCounts,
    });

  } catch (error) {
    console.error('Orders fetch error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
