import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search');
    const category = searchParams.get('category');
    const stockFilter = searchParams.get('stock'); // low, out, all
    const sort = searchParams.get('sort') || 'title';
    const order = searchParams.get('order') || 'asc';

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('products')
      .select('*', { count: 'exact' });

    // Filters
    if (search) {
      query = query.or(`title.ilike.%${search}%,sku.ilike.%${search}%,category.ilike.%${search}%,vendor.ilike.%${search}%`);
    }
    if (category && category !== 'all') query = query.eq('category', category);
    if (stockFilter === 'out') query = query.eq('stock_quantity', 0);
    if (stockFilter === 'low') query = query.lte('stock_quantity', 5).gt('stock_quantity', 0);

    query = query.order(sort, { ascending: order === 'asc' }).range(from, to);

    const { data: products, count, error } = await query;
    if (error) throw error;

    // Stats
    const statsQueries = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('stock_quantity', 0),
      supabase.from('products').select('*', { count: 'exact', head: true }).lte('stock_quantity', 5).gt('stock_quantity', 0),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('products').select('stock_quantity, selling_price'),
    ]);

    // Calculate total stock value
    const allProducts = statsQueries[4].data || [];
    const totalStockValue = allProducts.reduce((sum, p) => sum + (p.stock_quantity || 0) * (p.selling_price || 0), 0);
    const totalUnits = allProducts.reduce((sum, p) => sum + (p.stock_quantity || 0), 0);

    // Get unique categories
    const { data: cats } = await supabase.from('products').select('category').not('category', 'is', null);
    const categories = [...new Set((cats || []).map(c => c.category).filter(Boolean))].sort();

    const productStats = {
      total: statsQueries[0].count || 0,
      out_of_stock: statsQueries[1].count || 0,
      low_stock: statsQueries[2].count || 0,
      active: statsQueries[3].count || 0,
      total_stock_value: totalStockValue,
      total_units: totalUnits,
    };

    return NextResponse.json({
      success: true,
      products: products || [],
      total: count || 0,
      page,
      limit,
      total_pages: Math.ceil((count || 0) / limit),
      stats: productStats,
      categories,
    });

  } catch (error) {
    console.error('Products fetch error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
