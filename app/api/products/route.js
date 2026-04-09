import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// ============================================================================
// Products / Inventory API
// Supports two views:
//   ?view=grouped  → one entry per Shopify product, with variants[] nested
//   ?view=flat     → one entry per variant (old behavior, unchanged)
// Stats always include BOTH total_products (distinct Shopify products) and
// total_variants (row count).
// ============================================================================

const MAX_FETCH = 10000; // safety cap — we have ~3-4k variants in practice

function groupByProduct(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.shopify_product_id || `orphan-${r.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        group_key: key,
        id: key, // React key compatibility
        shopify_product_id: r.shopify_product_id,
        parent_title: r.parent_title || (r.title ? r.title.split(' - ')[0] : 'Untitled'),
        image_url: r.image_url,
        vendor: r.vendor,
        category: r.category,
        is_active: r.is_active,
        variants: [],
      });
    }
    groups.get(key).variants.push(r);
  }

  for (const g of groups.values()) {
    g.variant_count = g.variants.length;
    g.total_stock = g.variants.reduce((s, v) => s + (v.stock_quantity || 0), 0);
    g.stock_quantity = g.total_stock; // compatibility for sort/display
    g.total_sold = g.variants.reduce((s, v) => s + (v.total_sold || 0), 0);
    g.has_out_of_stock = g.variants.some(v => (v.stock_quantity || 0) === 0);
    g.has_low_stock = g.variants.some(v => {
      const q = v.stock_quantity || 0;
      return q > 0 && q <= 5;
    });
    // Lowest non-zero selling price across variants (or 0 if none priced)
    const prices = g.variants.map(v => v.selling_price || 0).filter(p => p > 0);
    g.selling_price = prices.length ? Math.min(...prices) : 0;
    // Group is active if ANY variant is active
    g.is_active = g.variants.some(v => v.is_active);
  }

  return Array.from(groups.values());
}

export async function GET(request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const view = searchParams.get('view') || 'grouped'; // grouped | flat
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '40');
    const search = searchParams.get('search');
    const category = searchParams.get('category');
    const stockFilter = searchParams.get('stock'); // low, out, all
    const sort = searchParams.get('sort') || 'title';
    const order = searchParams.get('order') || 'asc';

    // ── Build filtered query ──
    let query = supabase.from('products').select('*');

    if (search) {
      // Include parent_title so searching parent name finds all its variants
      query = query.or(
        `title.ilike.%${search}%,parent_title.ilike.%${search}%,sku.ilike.%${search}%,category.ilike.%${search}%,vendor.ilike.%${search}%`
      );
    }
    if (category && category !== 'all') query = query.eq('category', category);
    if (stockFilter === 'out') query = query.eq('stock_quantity', 0);
    if (stockFilter === 'low') query = query.lte('stock_quantity', 5).gt('stock_quantity', 0);

    query = query.order(sort, { ascending: order === 'asc' });

    // Paginate through all matching rows (Supabase caps single response ~1000)
    const allRows = [];
    {
      const PAGE = 1000;
      let off = 0;
      while (off < MAX_FETCH) {
        const { data: chunk, error } = await query.range(off, off + PAGE - 1);
        if (error) throw error;
        if (!chunk || chunk.length === 0) break;
        allRows.push(...chunk);
        if (chunk.length < PAGE) break;
        off += PAGE;
      }
    }

    // ── Stats (over full products table, unfiltered) ──
    // COUNT queries (head:true) are always accurate — no row limit.
    const [totalRowsRes, outRes, lowRes, activeRes] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('stock_quantity', 0),
      supabase.from('products').select('*', { count: 'exact', head: true }).lte('stock_quantity', 5).gt('stock_quantity', 0),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true),
    ]);

    // For aggregates (sum, distinct) we must paginate — Supabase caps
    // a single .select() response at ~1000 rows by default.
    const valueRows = [];
    const PAGE = 1000;
    let offset = 0;
    while (offset < MAX_FETCH) {
      const { data: chunk, error: chunkErr } = await supabase
        .from('products')
        .select('stock_quantity, selling_price, shopify_product_id')
        .range(offset, offset + PAGE - 1);
      if (chunkErr) throw chunkErr;
      if (!chunk || chunk.length === 0) break;
      valueRows.push(...chunk);
      if (chunk.length < PAGE) break;
      offset += PAGE;
    }

    const total_stock_value = valueRows.reduce(
      (s, p) => s + (p.stock_quantity || 0) * (p.selling_price || 0),
      0
    );
    const total_units = valueRows.reduce((s, p) => s + (p.stock_quantity || 0), 0);
    const distinctProducts = new Set(
      valueRows.map(p => p.shopify_product_id).filter(Boolean)
    ).size;

    const productStats = {
      total: totalRowsRes.count || 0,
      total_variants: totalRowsRes.count || 0,
      total_products: distinctProducts,
      out_of_stock: outRes.count || 0,
      low_stock: lowRes.count || 0,
      active: activeRes.count || 0,
      total_stock_value,
      total_units,
    };

    // ── Categories dropdown ──
    const { data: cats } = await supabase
      .from('products')
      .select('category')
      .not('category', 'is', null);
    const categories = [
      ...new Set((cats || []).map(c => c.category).filter(Boolean)),
    ].sort();

    // ── Paginate + shape output ──
    let products, total;
    if (view === 'grouped') {
      const groups = groupByProduct(allRows || []);
      total = groups.length;
      const from = (page - 1) * limit;
      products = groups.slice(from, from + limit);
    } else {
      total = (allRows || []).length;
      const from = (page - 1) * limit;
      products = (allRows || []).slice(from, from + limit);
    }

    return NextResponse.json({
      success: true,
      view,
      products,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
      stats: productStats,
      categories,
    });
  } catch (error) {
    console.error('Products fetch error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
