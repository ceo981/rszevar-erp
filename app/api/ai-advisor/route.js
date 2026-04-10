import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Fetch full ERP snapshot for AI context ──────────────────────────────────
async function getERPContext() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    { data: recentOrders },
    { data: allOrderStats },
    { data: products },
    { data: deadStock },
    { data: codOrders },
    { data: settlements },
    { data: expenses },
    { data: vendors },
    { data: topItems },
  ] = await Promise.all([
    // Recent 30-day orders
    supabase.from('orders').select('id, status, total_amount, customer_city, dispatched_courier, created_at')
      .gte('created_at', thirtyDaysAgo),
    // All-time quick counts
    supabase.from('orders').select('status, total_amount', { count: 'exact' }),
    // Inventory health
    supabase.from('products').select('id, stock_quantity, selling_price, abc_90d'),
    // Dead stock
    supabase.from('products').select('id, title, stock_quantity, selling_price')
      .eq('abc_90d', 'D').gt('stock_quantity', 0),
    // COD orders
    supabase.from('orders').select('total_price, payment_status, courier_name').eq('payment_method', 'COD'),
    // Settlements
    supabase.from('settlements').select('amount, status, courier_name'),
    // Expenses this month
    supabase.from('expenses').select('amount, category, expense_date').gte('expense_date', monthStart),
    // Vendor outstanding
    supabase.from('vendor_payments').select('amount, payment_type'),
    // Top selling SKUs (30d)
    supabase.from('order_items').select('sku, quantity, total_price')
      .in('order_id',
        (await supabase.from('orders').select('id').gte('created_at', thirtyDaysAgo)).data?.map(o => o.id) || []
      ),
  ]);

  // ── Orders summary ──
  const recent = recentOrders || [];
  const orderSummary = {
    last30Days: {
      total:      recent.length,
      revenue:    recent.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0),
      pending:    recent.filter(o => o.status === 'pending').length,
      confirmed:  recent.filter(o => o.status === 'confirmed').length,
      dispatched: recent.filter(o => o.status === 'dispatched').length,
      delivered:  recent.filter(o => o.status === 'delivered').length,
      returned:   recent.filter(o => ['returned','rto'].includes(o.status)).length,
      cancelled:  recent.filter(o => o.status === 'cancelled').length,
    },
  };
  const deliveredRevenue = recent.filter(o => o.status === 'delivered').reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
  orderSummary.last30Days.deliveredRevenue = deliveredRevenue;
  orderSummary.last30Days.rtoRate = recent.length
    ? ((orderSummary.last30Days.returned / recent.length) * 100).toFixed(1) + '%'
    : '0%';
  orderSummary.last30Days.deliveryRate = recent.length
    ? ((orderSummary.last30Days.delivered / recent.length) * 100).toFixed(1) + '%'
    : '0%';

  // Top cities
  const cityMap = {};
  recent.forEach(o => {
    const c = o.customer_city || 'Unknown';
    cityMap[c] = (cityMap[c] || 0) + 1;
  });
  orderSummary.topCities = Object.entries(cityMap).sort((a,b) => b[1]-a[1]).slice(0,5).map(([city, count]) => ({ city, count }));

  // ── Inventory health ──
  const prods = products || [];
  const totalProducts   = prods.length;
  const outOfStock      = prods.filter(p => (p.stock_quantity || 0) === 0).length;
  const lowStock        = prods.filter(p => (p.stock_quantity || 0) > 0 && (p.stock_quantity || 0) <= 3).length;
  const totalInventoryValue = prods.reduce((s, p) => s + (p.stock_quantity || 0) * parseFloat(p.selling_price || 0), 0);
  const abcCounts = { A: 0, B: 0, C: 0, D: 0, null: 0 };
  prods.forEach(p => { const k = p.abc_90d || 'null'; abcCounts[k] = (abcCounts[k] || 0) + 1; });

  // Dead stock
  const deadValue = (deadStock || []).reduce((s, p) => s + (p.stock_quantity || 0) * parseFloat(p.selling_price || 0), 0);
  const deadUnits = (deadStock || []).reduce((s, p) => s + (p.stock_quantity || 0), 0);

  // Top selling products (30d)
  const skuMap = {};
  (topItems || []).forEach(item => {
    if (!item.sku) return;
    const k = item.sku;
    if (!skuMap[k]) skuMap[k] = { sku: k, units: 0, revenue: 0 };
    skuMap[k].units   += parseInt(item.quantity || 0);
    skuMap[k].revenue += parseFloat(item.total_price || 0);
  });
  const topProducts = Object.values(skuMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  // ── Accounts ──
  const totalCOD      = (codOrders || []).reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
  const totalSettled  = (settlements || []).filter(s => s.status === 'settled').reduce((s, x) => s + parseFloat(x.amount || 0), 0);
  const pendingCOD    = totalCOD - totalSettled;
  const monthExpenses = (expenses || []).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const vendorPurchases = (vendors || []).filter(v => v.payment_type === 'purchase').reduce((s, v) => s + parseFloat(v.amount || 0), 0);
  const vendorPaid      = (vendors || []).filter(v => v.payment_type === 'payment').reduce((s, v) => s + parseFloat(v.amount || 0), 0);

  return {
    orders: orderSummary,
    inventory: { totalProducts, outOfStock, lowStock, totalInventoryValue, abcCounts, topProducts },
    deadStock:  { count: (deadStock || []).length, totalValue: deadValue, totalUnits: deadUnits },
    accounts:   { pendingCOD, totalSettled, monthExpenses, vendorOutstanding: vendorPurchases - vendorPaid },
  };
}

function buildSystemPrompt(ctx) {
  const fmt = (n) => 'Rs. ' + Math.round(n).toLocaleString('en-PK');
  const o = ctx.orders.last30Days;
  const inv = ctx.inventory;
  const ds = ctx.deadStock;
  const acc = ctx.accounts;

  return `You are the AI Business Advisor for RS ZEVAR — a luxury jewelry e-commerce brand in Karachi, Pakistan. You help Abdul Rehman (CEO) make smart, data-driven decisions.

## Live ERP Snapshot (Last Updated: ${new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })})

### 📋 Orders (Last 30 Days)
- Total Orders: ${o.total} | Revenue: ${fmt(o.revenue)}
- Delivered: ${o.delivered} (${o.deliveryRate}) | Delivered Revenue: ${fmt(o.deliveredRevenue)}
- Pending: ${o.pending} | Confirmed: ${o.confirmed} | Dispatched: ${o.dispatched}
- Returned/RTO: ${o.returned} (${o.rtoRate}) | Cancelled: ${o.cancelled}
- Top Cities: ${ctx.orders.topCities.map(c => `${c.city}(${c.count})`).join(', ')}

### 📦 Inventory Health
- Total Products: ${inv.totalProducts} | Total Inventory Value: ${fmt(inv.totalInventoryValue)}
- Out of Stock: ${inv.outOfStock} | Low Stock (≤3): ${inv.lowStock}
- ABC Classification: A=${inv.abcCounts.A} | B=${inv.abcCounts.B} | C=${inv.abcCounts.C} | D=${inv.abcCounts.D} | Unclassified=${inv.abcCounts.null}
- Top Products (30d by revenue): ${inv.topProducts.map(p => `${p.sku}(${fmt(p.revenue)}, ${p.units} units)`).join(', ') || 'N/A'}

### 🪦 Dead Stock (No Sales 90d+)
- Dead Products: ${ds.count} | Dead Units: ${ds.totalUnits} | Capital Tied Up: ${fmt(ds.totalValue)}

### 💰 Accounts
- Pending COD Settlement: ${fmt(acc.pendingCOD)}
- Total Settled (All Time): ${fmt(acc.totalSettled)}
- This Month's Expenses: ${fmt(acc.monthExpenses)}
- Vendor Outstanding: ${fmt(acc.vendorOutstanding)}

## Your Role
- Answer in Hinglish (mix of English + Urdu) — same language Abdul uses
- Be direct, concise, and actionable
- Always reference actual numbers from the ERP data above
- Give specific recommendations, not generic advice
- If asked about something not in the data, say so clearly`;
}

// ── Main Route ──────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const { messages } = await request.json();
    if (!messages?.length) return Response.json({ error: 'No messages' }, { status: 400 });

    // Fetch fresh ERP context
    const ctx = await getERPContext();
    const systemPrompt = buildSystemPrompt(ctx);

    // Call Claude API with streaming
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            process.env.ANTHROPIC_API_KEY,
        'anthropic-version':    '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 1024,
        system:     systemPrompt,
        stream:     true,
        messages:   messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}));
      return Response.json({ error: err.error?.message || 'Claude API error' }, { status: 500 });
    }

    // Stream back to client
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = anthropicRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                controller.enqueue(encoder.encode(parsed.delta.text));
              }
            } catch {}
          }
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

  } catch (err) {
    console.error('[ai-advisor] Error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
