'use client';

import { useState, useEffect, useCallback } from 'react';

const formatCurrency = (val) =>
  'Rs. ' + Number(val || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 });

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
};

const daysBadge = (days, neverSold) => {
  if (neverSold) return <span style={{ background: '#4B1C1C', color: '#F87171', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>Never Sold</span>;
  if (days >= 180) return <span style={{ background: '#4B1C1C', color: '#F87171', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>{days}d</span>;
  if (days >= 90) return <span style={{ background: '#3B2A00', color: '#FBBF24', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>{days}d</span>;
  return <span style={{ background: '#1a2a1a', color: '#4ADE80', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>{days}d</span>;
};

const abcBadge = (cls) => {
  const colors = { A: ['#1a3a1a','#4ADE80'], B: ['#1a2a3a','#60A5FA'], C: ['#2a1a3a','#A78BFA'], D: ['#3a1a1a','#F87171'], Unclassified: ['#2a2a2a','#9CA3AF'] };
  const [bg, fg] = colors[cls] || colors['Unclassified'];
  return <span style={{ background: bg, color: fg, padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>{cls}</span>;
};

export default function DeadStockPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [collection, setCollection] = useState('all');
  const [minValue, setMinValue] = useState('');
  const [sortBy, setSortBy] = useState('stock_value');
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ collection, sort: sortBy });
      if (minValue) params.set('min_value', minValue);
      const res = await fetch(`/api/dead-stock?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [collection, minValue, sortBy]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const exportCSV = () => {
    if (!data?.products) return;
    const headers = ['Title', 'SKU', 'Collection', 'ABC Class', 'Stock Qty', 'Price', 'Stock Value', 'Last Sale Date', 'Days Dead'];
    const rows = filtered.map(p => [
      `"${p.title}"`, p.sku, `"${p.collection_name}"`, p.abc_class,
      p.inventory_quantity, p.price, p.stock_value,
      p.last_sale_date ? formatDate(p.last_sale_date) : 'Never Sold',
      p.never_sold ? 'Never Sold' : p.days_dead,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `dead-stock-report-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const filtered = (data?.products || []).filter(p =>
    !search || p.title.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
  );

  const s = data?.summary || {};

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e5e5e5', padding: '24px', fontFamily: 'Inter, sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff' }}>🪦 Dead Stock Report</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            Products with no sales in 90+ days — capital tied up
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={fetchData} disabled={loading} style={{ padding: '8px 16px', background: '#1f2937', color: '#e5e5e5', border: '1px solid #374151', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {loading ? '⏳ Loading...' : '🔄 Refresh'}
          </button>
          <button onClick={exportCSV} style={{ padding: '8px 16px', background: '#c9a96e', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      {!loading && data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'Dead Products', value: s.total_products, icon: '📦', color: '#F87171' },
            { label: 'Capital Tied Up', value: formatCurrency(s.total_stock_value), icon: '💸', color: '#FBBF24' },
            { label: 'Total Units', value: s.total_units?.toLocaleString(), icon: '🔢', color: '#60A5FA' },
            { label: 'Never Sold', value: s.never_sold_count, icon: '🚫', color: '#F87171' },
            { label: 'Avg Days Dead', value: s.avg_days_dead ? `${s.avg_days_dead}d` : '—', icon: '📅', color: '#A78BFA' },
          ].map(card => (
            <div key={card.label} style={{ background: '#111827', borderRadius: 10, padding: '16px 18px', border: '1px solid #1f2937' }}>
              <div style={{ fontSize: 22 }}>{card.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: card.color, margin: '4px 0 2px' }}>{card.value ?? '—'}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="🔍 Search product / SKU..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', background: '#111827', border: '1px solid #374151', borderRadius: 8, color: '#e5e5e5', fontSize: 13, width: 220 }}
        />
        <select value={collection} onChange={e => setCollection(e.target.value)}
          style={{ padding: '8px 12px', background: '#111827', border: '1px solid #374151', borderRadius: 8, color: '#e5e5e5', fontSize: 13 }}>
          <option value="all">All Collections</option>
          {(data?.collections || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="number" placeholder="Min Stock Value (Rs)"
          value={minValue}
          onChange={e => setMinValue(e.target.value)}
          style={{ padding: '8px 12px', background: '#111827', border: '1px solid #374151', borderRadius: 8, color: '#e5e5e5', fontSize: 13, width: 180 }}
        />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ padding: '8px 12px', background: '#111827', border: '1px solid #374151', borderRadius: 8, color: '#e5e5e5', fontSize: 13 }}>
          <option value="stock_value">Sort: Stock Value ↓</option>
          <option value="days_dead">Sort: Days Dead ↓</option>
          <option value="inventory">Sort: Qty ↓</option>
          <option value="title">Sort: Name A-Z</option>
        </select>
        <span style={{ color: '#6b7280', fontSize: 13 }}>{filtered.length} products</span>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#4B1C1C', border: '1px solid #F87171', borderRadius: 8, padding: 16, marginBottom: 20, color: '#F87171' }}>
          ⚠️ Error: {error}
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div>Loading dead stock data...</div>
        </div>
      ) : (
        <div style={{ background: '#111827', borderRadius: 12, border: '1px solid #1f2937', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#1f2937', borderBottom: '1px solid #374151' }}>
                {['#', 'Product', 'Collection', 'ABC', 'Qty', 'Price', 'Stock Value', 'Last Sale', 'Days Dead'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: h === 'Qty' || h === 'Price' || h === 'Stock Value' || h === '#' ? 'center' : 'left', color: '#9ca3af', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 48, color: '#6b7280' }}>
                    🎉 No dead stock found!
                  </td>
                </tr>
              ) : filtered.map((p, i) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #1f2937', background: i % 2 === 0 ? 'transparent' : '#0d1117' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#1a2332'}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : '#0d1117'}>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: '#6b7280' }}>{i + 1}</td>
                  <td style={{ padding: '10px 14px', maxWidth: 220 }}>
                    <div style={{ fontWeight: 500, color: '#e5e5e5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.title}>{p.title}</div>
                    {p.sku !== '—' && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>SKU: {p.sku}</div>}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#9ca3af', fontSize: 12 }}>{p.collection_name}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>{abcBadge(p.abc_class)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: '#e5e5e5', fontWeight: 600 }}>{p.inventory_quantity}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: '#9ca3af' }}>{formatCurrency(p.price)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: '#FBBF24', fontWeight: 700 }}>{formatCurrency(p.stock_value)}</td>
                  <td style={{ padding: '10px 14px', color: '#9ca3af', fontSize: 12, whiteSpace: 'nowrap' }}>{formatDate(p.last_sale_date)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>{daysBadge(p.days_dead, p.never_sold)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Footer note ── */}
      {!loading && filtered.length > 0 && (
        <div style={{ marginTop: 16, color: '#4b5563', fontSize: 12, textAlign: 'center' }}>
          📊 Based on 90-day ABC classification window · D-class = no sales in last 90 days
        </div>
      )}
    </div>
  );
}
