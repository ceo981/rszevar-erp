import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const courier = searchParams.get('courier');
    const dateFrom = searchParams.get('from');
    const dateTo = searchParams.get('to');
    const sort = searchParams.get('sort') || 'created_at';
    const order = searchParams.get('order') || 'desc';

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('orders')
      .select('*, order_items(*)', { count: 'exact' });

    if (status && status !== 'all') query = query.eq('status', status);
    if (courier && courier !== 'all') query = query.eq('courier', courier);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59');
    if (search) {
      query = query.or(`order_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,customer_city.ilike.%${search}%,tracking_number.ilike.%${search}%`);
    }

    query = query.order(sort, { ascending: order === 'asc' }).range(from, to);

    const { data: orders, count, error } = await query;

    if (error) throw error;

    const statQueries = await Promise.all([
      supabase.from('orders').select('*', { count: 'exact', head: true }),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'confirmed'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'dispatched'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'delivered'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'returned'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'rto'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('payment_status', 'paid'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('payment_status', 'unpaid'),
      supabase.from('orders').select('total_amount').eq('payment_method', 'COD').in('status', ['pending', 'confirmed', 'dispatched']),
    ]);

    const codOrders = statQueries[10].data || [];
    const totalCOD = codOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);

    const orderStats = {
      total: statQueries[0].count || 0,
      pending: statQueries[1].count || 0,
      confirmed: statQueries[2].count || 0,
      dispatched: statQueries[3].count || 0,
      delivered: statQueries[4].count || 0,
      returned: statQueries[5].count || 0,
      cancelled: statQueries[6].count || 0,
      rto: statQueries[7].count || 0,
      paid: statQueries[8].count || 0,
      unpaid: statQueries[9].count || 0,
      total_cod: totalCOD,
    };

    return NextResponse.json({
      success: true,
      orders: orders || [],
      total: count || 0,
      page,
      limit,
      total_pages: Math.ceil((count || 0) / limit),
      stats: orderStats,
    });

  } catch (error) {
    console.error('Orders fetch error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
