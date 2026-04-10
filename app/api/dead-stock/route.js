import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const collection = searchParams.get('collection');
    const minValue = parseFloat(searchParams.get('min_value') || '0');
    const sortBy = searchParams.get('sort') || 'stock_value';

    // ─── 1. Get D-class products (no sales in 90d) with stock > 0 ───
    let query = supabase
      .from('products')
      .select('id, title, handle, sku, inventory_quantity, price, collections, abc_class, abc_window, updated_at')
      .eq('abc_class', 'D')
      .gt('inventory_quantity', 0);

    const { data: products, error } = await query;
    if (error) throw error;

    // ─── 2. Also get unclassified products with inventory > 0 ───
    const { data: unclassified } = await supabase
      .from('products')
      .select('id, title, handle, sku, inventory_quantity, price, collections, abc_class, abc_window, updated_at')
      .is('abc_class', null)
      .gt('inventory_quantity', 0);

    const allProducts = [...(products || []), ...(unclassified || [])];

    // ─── 3. Get last sale date for each product from orders ───
    const productIds = allProducts.map(p => p.id);

    // Query orders line_items JSONB for product_id matches
    const { data: orderData } = await supabase
      .from('orders')
      .select('id, created_at, line_items')
      .not('line_items', 'is', null)
      .gte('created_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()); // last 1 year

    // Build a map: product_id → last_sale_date
    const lastSaleMap = {};
    if (orderData) {
      for (const order of orderData) {
        const items = Array.isArray(order.line_items) ? order.line_items : [];
        for (const item of items) {
          const pid = item.product_id || item.productId;
          if (!pid) continue;
          const pidStr = String(pid);
          const orderDate = new Date(order.created_at);
          if (!lastSaleMap[pidStr] || orderDate > lastSaleMap[pidStr]) {
            lastSaleMap[pidStr] = orderDate;
          }
        }
      }
    }

    const now = new Date();
    const DEAD_THRESHOLD_DAYS = 90;

    // ─── 4. Enrich products ───
    let enriched = allProducts.map(p => {
      const lastSale = lastSaleMap[String(p.id)] || null;
      const daysDead = lastSale
        ? Math.floor((now - lastSale) / (1000 * 60 * 60 * 24))
        : 999; // never sold
      const stockValue = (p.inventory_quantity || 0) * (parseFloat(p.price) || 0);

      // Extract first collection name
      let collectionName = '—';
      if (p.collections && Array.isArray(p.collections) && p.collections.length > 0) {
        collectionName = p.collections[0].title || p.collections[0];
      }

      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        sku: p.sku || '—',
        inventory_quantity: p.inventory_quantity || 0,
        price: parseFloat(p.price) || 0,
        stock_value: stockValue,
        collections: p.collections || [],
        collection_name: collectionName,
        abc_class: p.abc_class || 'Unclassified',
        last_sale_date: lastSale ? lastSale.toISOString() : null,
        days_dead: daysDead,
        never_sold: !lastSale,
      };
    });

    // ─── 5. Filter by collection ───
    if (collection && collection !== 'all') {
      enriched = enriched.filter(p =>
        p.collections.some(c =>
          (c.title || c) === collection || (c.handle || '') === collection
        )
      );
    }

    // ─── 6. Filter by min stock value ───
    if (minValue > 0) {
      enriched = enriched.filter(p => p.stock_value >= minValue);
    }

    // ─── 7. Sort ───
    enriched.sort((a, b) => {
      if (sortBy === 'days_dead') return b.days_dead - a.days_dead;
      if (sortBy === 'inventory') return b.inventory_quantity - a.inventory_quantity;
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return b.stock_value - a.stock_value; // default: stock_value desc
    });

    // ─── 8. Summary stats ───
    const totalProducts = enriched.length;
    const totalStockValue = enriched.reduce((s, p) => s + p.stock_value, 0);
    const totalUnits = enriched.reduce((s, p) => s + p.inventory_quantity, 0);
    const neverSoldCount = enriched.filter(p => p.never_sold).length;
    const avgDaysDead = enriched.length
      ? Math.round(enriched.filter(p => !p.never_sold).reduce((s, p) => s + p.days_dead, 0) / Math.max(enriched.filter(p => !p.never_sold).length, 1))
      : 0;

    // ─── 9. Get unique collections for filter dropdown ───
    const collectionsSet = new Set();
    allProducts.forEach(p => {
      if (p.collections && Array.isArray(p.collections)) {
        p.collections.forEach(c => {
          const name = c.title || c;
          if (name) collectionsSet.add(name);
        });
      }
    });

    return Response.json({
      products: enriched,
      summary: {
        total_products: totalProducts,
        total_stock_value: totalStockValue,
        total_units: totalUnits,
        never_sold_count: neverSoldCount,
        avg_days_dead: avgDaysDead,
      },
      collections: Array.from(collectionsSet).sort(),
    });

  } catch (err) {
    console.error('[dead-stock] Error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
