import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const collection = searchParams.get('collection');
    const minValue   = parseFloat(searchParams.get('min_value') || '0');
    const sortBy     = searchParams.get('sort') || 'stock_value';

    // ─── 1. Fetch D-class + unclassified products with stock > 0 ───
    // abc_90d = 'D' means no sales in last 90 days (computed by compute-abc cron)
    // Also include NULL abc_90d = never classified (possibly new/unsynced products)
    const { data: deadProducts, error } = await supabase
      .from('products')
      .select('id, title, handle, sku, stock_quantity, selling_price, collections, abc_90d, abc_180d, last_sold_at, updated_at')
      .or('abc_90d.eq.D,abc_90d.is.null')
      .gt('stock_quantity', 0);

    if (error) throw error;

    const now = new Date();

    // ─── 2. Enrich each product ───
    let enriched = (deadProducts || []).map(p => {
      const lastSale   = p.last_sold_at ? new Date(p.last_sold_at) : null;
      const daysDead   = lastSale
        ? Math.floor((now - lastSale) / (1000 * 60 * 60 * 24))
        : 999;
      const qty        = p.stock_quantity || 0;
      const price      = parseFloat(p.selling_price) || 0;
      const stockValue = qty * price;

      // Extract first collection name from JSONB array [{handle, title}]
      let collectionName = '—';
      if (Array.isArray(p.collections) && p.collections.length > 0) {
        collectionName = p.collections[0].title || p.collections[0].handle || '—';
      }

      return {
        id:                 p.id,
        title:              p.title,
        handle:             p.handle,
        sku:                p.sku || '—',
        stock_quantity:     qty,
        selling_price:      price,
        stock_value:        stockValue,
        collections:        p.collections || [],
        collection_name:    collectionName,
        abc_90d:            p.abc_90d || 'Unclassified',
        abc_180d:           p.abc_180d || '—',
        last_sale_date:     lastSale ? lastSale.toISOString() : null,
        days_dead:          daysDead,
        never_sold:         !lastSale,
      };
    });

    // ─── 3. Filter by collection ───
    if (collection && collection !== 'all') {
      enriched = enriched.filter(p =>
        p.collections.some(c => c.title === collection || c.handle === collection)
      );
    }

    // ─── 4. Filter by min stock value ───
    if (minValue > 0) {
      enriched = enriched.filter(p => p.stock_value >= minValue);
    }

    // ─── 5. Sort ───
    enriched.sort((a, b) => {
      if (sortBy === 'days_dead')  return b.days_dead - a.days_dead;
      if (sortBy === 'inventory')  return b.stock_quantity - a.stock_quantity;
      if (sortBy === 'title')      return a.title.localeCompare(b.title);
      return b.stock_value - a.stock_value; // default
    });

    // ─── 6. Summary stats ───
    const totalStockValue = enriched.reduce((s, p) => s + p.stock_value, 0);
    const totalUnits      = enriched.reduce((s, p) => s + p.stock_quantity, 0);
    const neverSoldCount  = enriched.filter(p => p.never_sold).length;
    const soldButDead     = enriched.filter(p => !p.never_sold);
    const avgDaysDead     = soldButDead.length
      ? Math.round(soldButDead.reduce((s, p) => s + p.days_dead, 0) / soldButDead.length)
      : 0;

    // ─── 7. Unique collections for filter dropdown ───
    const collectionsSet = new Set();
    (deadProducts || []).forEach(p => {
      (p.collections || []).forEach(c => {
        if (c.title) collectionsSet.add(c.title);
      });
    });

    return Response.json({
      products: enriched,
      summary: {
        total_products:   enriched.length,
        total_stock_value: totalStockValue,
        total_units:      totalUnits,
        never_sold_count: neverSoldCount,
        avg_days_dead:    avgDaysDead,
      },
      collections: Array.from(collectionsSet).sort(),
    });

  } catch (err) {
    console.error('[dead-stock] Error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
