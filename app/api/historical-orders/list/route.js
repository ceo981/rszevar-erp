// ============================================================================
// RS ZEVAR ERP — Historical Orders — List Endpoint
// GET /api/historical-orders/list
// May 5 2026
// ----------------------------------------------------------------------------
// PURPOSE:
//   Paginated list of archive orders with search + filter support. Powers the
//   Browse Archive tab on /historical-orders page.
//
// QUERY PARAMS:
//   ?search=string            (matches order_number, customer_name, customer_phone, customer_email)
//   ?status=all|fulfilled|unfulfilled|cancelled|paid|voided
//   ?page=1                   (default 1)
//   ?limit=50                 (default 50, max 200)
//   ?sort=newest|oldest       (default: newest)
//
// RESPONSE:
//   {
//     success: true,
//     total: 9799,
//     page: 1,
//     limit: 50,
//     orders: [...],
//     global_counts: {
//       all: 9799,
//       fulfilled: 8856,
//       unfulfilled: 943,
//       cancelled: 1842,
//       paid: 643,
//       voided: 1721,
//     }
//   }
//
// AUTH: Authenticated read-only (RLS allows authenticated users to SELECT).
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

    const search = (searchParams.get('search') || '').trim();
    const status = (searchParams.get('status') || 'all').trim().toLowerCase();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const sort = (searchParams.get('sort') || 'newest').toLowerCase();

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // ── Build query ──
    let query = supabase
      .from('historical_orders')
      .select(`
        id, order_number, shopify_order_id,
        customer_name, customer_phone, customer_email,
        financial_status, fulfillment_status,
        created_at, paid_at, fulfilled_at, cancelled_at,
        total_amount, items_count, items_summary,
        shipping_city, shipping_name,
        payment_method, tags,
        tracking_number, tracking_company
      `, { count: 'exact' });

    // Search filter — across multiple text fields
    if (search) {
      const safe = search.replace(/[%_,]/g, ' ').trim();
      if (safe) {
        // Pakistani phone format normalization for search — strip leading 0 / +92
        const phoneVariants = [];
        const digitsOnly = safe.replace(/\D/g, '');
        if (digitsOnly.length >= 4) {
          phoneVariants.push(digitsOnly);
          if (digitsOnly.startsWith('0')) phoneVariants.push(digitsOnly.slice(1));
          if (digitsOnly.startsWith('92')) phoneVariants.push('0' + digitsOnly.slice(2));
        }

        const orParts = [
          `order_number.ilike.%${safe}%`,
          `customer_name.ilike.%${safe}%`,
          `customer_email.ilike.%${safe}%`,
          `shipping_name.ilike.%${safe}%`,
        ];
        for (const v of phoneVariants) {
          orParts.push(`customer_phone.ilike.%${v}%`);
          orParts.push(`shipping_phone.ilike.%${v}%`);
        }
        query = query.or(orParts.join(','));
      }
    }

    // Status filter
    if (status === 'fulfilled')        query = query.eq('fulfillment_status', 'fulfilled').is('cancelled_at', null);
    else if (status === 'unfulfilled') query = query.in('fulfillment_status', ['unfulfilled', null]).is('cancelled_at', null);
    else if (status === 'cancelled')   query = query.not('cancelled_at', 'is', null);
    else if (status === 'paid')        query = query.eq('financial_status', 'paid');
    else if (status === 'voided')      query = query.eq('financial_status', 'voided');
    // 'all' → no status filter

    // Sort
    if (sort === 'oldest') query = query.order('created_at', { ascending: true });
    else                   query = query.order('created_at', { ascending: false });

    query = query.range(from, to);

    const { data: orders, count, error } = await query;
    if (error) throw error;

    // ── Global counts (for tab badges) — separate count queries, one per filter ──
    // Run in parallel for speed
    const [
      allCount,
      fulfilledCount,
      unfulfilledCount,
      cancelledCount,
      paidCount,
      voidedCount,
    ] = await Promise.all([
      supabase.from('historical_orders').select('*', { count: 'exact', head: true }),
      supabase.from('historical_orders').select('*', { count: 'exact', head: true })
        .eq('fulfillment_status', 'fulfilled').is('cancelled_at', null),
      supabase.from('historical_orders').select('*', { count: 'exact', head: true })
        .in('fulfillment_status', ['unfulfilled']).is('cancelled_at', null),
      supabase.from('historical_orders').select('*', { count: 'exact', head: true })
        .not('cancelled_at', 'is', null),
      supabase.from('historical_orders').select('*', { count: 'exact', head: true })
        .eq('financial_status', 'paid'),
      supabase.from('historical_orders').select('*', { count: 'exact', head: true })
        .eq('financial_status', 'voided'),
    ]);

    return NextResponse.json({
      success: true,
      total: count || 0,
      page,
      limit,
      orders: orders || [],
      global_counts: {
        all: allCount.count || 0,
        fulfilled: fulfilledCount.count || 0,
        unfulfilled: unfulfilledCount.count || 0,
        cancelled: cancelledCount.count || 0,
        paid: paidCount.count || 0,
        voided: voidedCount.count || 0,
      },
    });
  } catch (e) {
    console.error('[GET /api/historical-orders/list] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
