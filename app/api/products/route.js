import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// ============================================================================
// Products / Inventory API
// Phase 1: Collection filter added (?collection=handle)
//          Collections list returned for dropdown
// ============================================================================

const MAX_FETCH = 10000;

function groupByProduct(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.shopify_product_id || `orphan-${r.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        group_key: key,
        id: key,
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
    g.stock_quantity = g.total_stock;
    g.total_sold = g.variants.reduce((s, v) => s + (v.total_sold || 0), 0);
    g.has_out_of_stock = g.variants.some(v => (v.stock_quantity || 0) === 0);
    g.has_low_stock = g.variants.some(v => {
      const q = v.stock_quantity || 0;
      return q > 0 && q <= 5;
    });
    const prices = g.variants.map(v => v.selling_price || 0).filter(p => p > 0);
    g.selling_price = prices.length ? Math.min(...prices) : 0;
    g.is_active = g.variants.some(v => v.is_active);
  }

  return Array.from(groups.values());
}

export async function GET(request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const view = searchParams.get('view') || 'grouped';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '40');
    const search = searchParams.get('search');
    const category = searchParams.get('category');
    const collection = searchParams.get('collection');      // NEW: collection handle
    const stockFilter = searchParams.get('stock');
    const activeFilter = searchParams.get('active');
    const sort = searchParams.get('sort') || 'title';
    const order = searchParams.get('order') || 'asc';
    // ABC filter params
    const abc = searchParams.get('abc') || 'all';
    const abcWindow = searchParams.get('abc_window') || '90d';
    const abcCol = abcWindow === '180d' ? 'abc_180d' : 'abc_90d';

    // ── Build filtered query ──
    let query = supabase.from('products').select('*');

    if (search) {
      // Sanitize: strip characters that break PostgREST .or() parser
      //   ,  → separates OR conditions
      //   () → groups conditions
      //   %  → ilike wildcard (user shouldn't inject these)
      const safeSearch = search.replace(/[,()%]/g, ' ').trim();
      if (safeSearch) {
        query = query.or(
          `title.ilike.%${safeSearch}%,parent_title.ilike.%${safeSearch}%,sku.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%,vendor.ilike.%${safeSearch}%`
        );
      }
    }
    if (category && category !== 'all') query = query.eq('category', category);
    if (stockFilter === 'out') query = query.eq('stock_quantity', 0);
    if (stockFilter === 'low') query = query.lte('stock_quantity', 3).gt('stock_quantity', 0);
    if (activeFilter === 'active') query = query.eq('is_active', true);
    if (activeFilter === 'draft') query = query.eq('is_active', false);
    if (abc !== 'all') query = query.eq(abcCol, abc);

    // SEO tier filter (Phase 1.2)
    const seoTier = searchParams.get('seo_tier');
    if (seoTier && seoTier !== 'all') query = query.eq('seo_tier', seoTier);

    // Collection filter: JSONB contains — checks if collections array has an
    // object with matching handle, e.g. [{"handle":"bangles"}]
    if (collection && collection !== 'all') {
      query = query.contains('collections', [{ handle: collection }]);
    }

    query = query.order(sort, { ascending: order === 'asc' });

    // Paginate through all matching rows
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

    // ── Stats (unfiltered) ──
    const [totalRowsRes, outRes, lowRes, activeRes] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('stock_quantity', 0),
      supabase.from('products').select('*', { count: 'exact', head: true }).lte('stock_quantity', 3).gt('stock_quantity', 0),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true),
    ]);

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

    const total_stock_value = valueRows.reduce((s, p) => s + (p.stock_quantity || 0) * (p.selling_price || 0), 0);
    const total_units = valueRows.reduce((s, p) => s + (p.stock_quantity || 0), 0);
    const distinctProducts = new Set(valueRows.map(p => p.shopify_product_id).filter(Boolean)).size;

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
    // Must bypass Supabase's default 1000-row cap — with 4,900+ variants
    // some categories would be missing if we didn't page through all rows.
    const { data: cats } = await supabase
      .from('products')
      .select('category')
      .not('category', 'is', null)
      .range(0, MAX_FETCH - 1);
    const categories = [...new Set((cats || []).map(c => c.category).filter(Boolean))].sort();

    // ── Collections dropdown (extract unique from JSONB) ──
    // Same reason as above — need full scan, not first 1000.
    const { data: collRows } = await supabase
      .from('products')
      .select('collections')
      .not('collections', 'eq', '[]')
      .range(0, MAX_FETCH - 1);
    const collMap = new Map();
    for (const row of collRows || []) {
      for (const c of row.collections || []) {
        if (c.handle && !collMap.has(c.handle)) {
          collMap.set(c.handle, c.title || c.handle);
        }
      }
    }
    const collections = Array.from(collMap.entries())
      .map(([handle, title]) => ({ handle, title }))
      .sort((a, b) => a.title.localeCompare(b.title));

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
      collections,  // NEW: [{handle, title}, ...]
    });
  } catch (error) {
    console.error('Products fetch error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
