// ============================================================================
// RS ZEVAR ERP — Orders API Route
// Phase 6: Added `type` filter (wholesale/international/walkin) and
//          improved `courier` filter (PostEx/Leopards/Kangaroo/Other).
//          Stats counts are filter-AWARE — show counts within current filter.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    // ── Order items fetch ──
    const action = searchParams.get('action');
    if (action === 'items') {
      const order_id = searchParams.get('order_id');
      if (!order_id) return NextResponse.json({ items: [] });
      const { data } = await supabase
        .from('order_items')
        .select('title, sku, quantity, unit_price, total_price, image_url')
        .eq('order_id', order_id)
        .order('id');
      return NextResponse.json({ items: data || [] });
    }

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const courier = searchParams.get('courier');   // PostEx | Leopards | Kangaroo | Other
    const type = searchParams.get('type');         // wholesale | international | walkin
    const payment = searchParams.get('payment');   // paid | unpaid | refunded
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
    };

    // ── GLOBAL type/courier counts for dropdown (ignore current filters) ──
    const [
      { count: wholesaleCount },
      { count: internationalCount },
      { count: walkinCount },
      { count: leopardsCount },
      { count: postexCount },
      { count: kangarooCount },
    ] = await Promise.all([
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('is_wholesale', true),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('is_international', true),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('is_walkin', true),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('dispatched_courier', 'Leopards'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('dispatched_courier', 'PostEx'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('dispatched_courier', 'Kangaroo'),
    ]);

    const globalCounts = {
      wholesale: wholesaleCount || 0,
      international: internationalCount || 0,
      walkin: walkinCount || 0,
      leopards: leopardsCount || 0,
      postex: postexCount || 0,
      kangaroo: kangarooCount || 0,
    };

    return NextResponse.json({
      success: true,
      orders: orders || [],
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
