'use client';
import { useState, useEffect, useCallback } from 'react';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';
const fmt = n => `Rs ${Number(n || 0).toLocaleString()}`;
const timeAgo = iso => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d/30)}mo ago`;
  return `${Math.floor(d/365)}y ago`;
};

const STATUS_COLORS = {
  delivered: { color: '#22c55e', bg: '#22c55e22', label: 'Delivered' },
  pending:   { color: '#fb923c', bg: '#fb923c22', label: 'Pending' },
  rto:       { color: '#ef4444', bg: '#ef444422', label: 'RTO' },
  returned:  { color: '#ef4444', bg: '#ef444422', label: 'Returned' },
  dispatched:{ color: '#a855f7', bg: '#a855f722', label: 'Dispatched' },
  cancelled: { color: '#555',    bg: '#55555522', label: 'Cancelled' },
  confirmed: { color: '#3b82f6', bg: '#3b82f622', label: 'Confirmed' },
};

// ── Customer Detail Drawer ────────────────────────────────────
function CustomerDrawer({ customer, onClose, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [blacklistReason, setBlacklistReason] = useState('');
  const [showBlacklistForm, setShowBlacklistForm] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(`/api/customers?id=${customer.phone}`)
      .then(r => r.json())
      .then(d => { setDetail(d); setLoading(false); });
  }, [customer.phone]);

  const blacklist = async () => {
    const r = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'blacklist', phone: customer.phone, name: customer.name, reason: blacklistReason }),
    });
    const d = await r.json();
    if (d.success) { setMsg('⛔ Customer blacklisted'); onRefresh(); setShowBlacklistForm(false); }
  };

  const unblacklist = async () => {
    await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unblacklist', phone: customer.phone }),
    });
    setMsg('✅ Removed from blacklist');
    onRefresh();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.7)' }} />
      <div style={{ width: 460, background: '#0f0f0f', borderLeft: `1px solid ${border}`, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, color: customer.is_blacklisted ? '#ef4444' : '#fff' }}>
              {customer.is_blacklisted && '⛔ '}{customer.name}
            </div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>{customer.phone} · {customer.city}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {customer.is_vip && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: gold+'22', color: gold }}>⭐ VIP</span>}
              {customer.is_repeat && !customer.is_vip && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#3b82f622', color: '#3b82f6' }}>🔄 Repeat</span>}
              {customer.is_blacklisted && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#ef444422', color: '#ef4444' }}>⛔ Blacklisted</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, borderBottom: `1px solid ${border}` }}>
          {[
            { label: 'Total Orders', value: customer.orders, color: '#fff' },
            { label: 'Total Spend', value: fmt(customer.total_spend), color: gold },
            { label: 'Delivered', value: customer.delivered, color: '#22c55e' },
            { label: 'RTO', value: customer.rto, color: '#ef4444' },
            { label: 'Delivery Rate', value: customer.delivery_rate + '%', color: '#3b82f6' },
            { label: 'Last Order', value: timeAgo(customer.last_order), color: '#888' },
          ].map(s => (
            <div key={s.label} style={{ padding: '14px 16px', borderBottom: `1px solid ${border}` }}>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ padding: '20px 24px', flex: 1 }}>
          {/* Blacklist actions */}
          <div style={{ marginBottom: 20 }}>
            {customer.is_blacklisted ? (
              <button onClick={unblacklist} style={{ background: '#001a0a', border: '1px solid #003300', color: '#22c55e', borderRadius: 8, padding: '8px 16px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                ✅ Remove from Blacklist
              </button>
            ) : (
              <div>
                {!showBlacklistForm ? (
                  <button onClick={() => setShowBlacklistForm(true)} style={{ background: '#1a0000', border: '1px solid #330000', color: '#ef4444', borderRadius: 8, padding: '8px 16px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ⛔ Blacklist Customer
                  </button>
                ) : (
                  <div style={{ background: '#1a0000', border: '1px solid #330000', borderRadius: 8, padding: '14px' }}>
                    <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>Blacklist karne ki wajah:</div>
                    <input value={blacklistReason} onChange={e => setBlacklistReason(e.target.value)}
                      placeholder="e.g. COD refuse kiya, fake order..." style={{ width: '100%', background: '#0a0a0a', border: `1px solid #330000`, color: '#fff', borderRadius: 6, padding: '8px 10px', fontSize: 12, boxSizing: 'border-box', marginBottom: 8 }} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={blacklist} style={{ background: '#ef444422', border: '1px solid #ef444444', color: '#ef4444', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Confirm Blacklist</button>
                      <button onClick={() => setShowBlacklistForm(false)} style={{ background: 'none', border: `1px solid ${border}`, color: '#555', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {msg && <div style={{ marginTop: 8, fontSize: 12, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}
          </div>

          {/* Order history */}
          {loading ? (
            <div style={{ color: '#444', textAlign: 'center', padding: 30 }}>Loading...</div>
          ) : (
            <>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: '#888' }}>Order History ({detail?.orders?.length || 0})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(detail?.orders || []).map((o, i) => {
                  const sc = STATUS_COLORS[o.status] || STATUS_COLORS.pending;
                  return (
                    <div key={i} style={{ background: card, border: `1px solid ${border}`, borderRadius: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, color: gold, fontWeight: 600 }}>{o.order_number || o.shopify_order_name || '#'+o.id}</div>
                        <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{timeAgo(o.created_at)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{fmt(o.total_amount)}</div>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: sc.bg, color: sc.color }}>{sc.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Complaints */}
              {(detail?.complaints || []).length > 0 && (
                <>
                  <div style={{ fontWeight: 600, fontSize: 13, margin: '16px 0 10px', color: '#ef4444' }}>Complaints ({detail.complaints.length})</div>
                  {detail.complaints.map((c, i) => (
                    <div key={i} style={{ background: '#1a0000', border: '1px solid #330000', borderRadius: 8, padding: '10px 14px', marginBottom: 6, fontSize: 12 }}>
                      <div style={{ color: '#f87171', fontWeight: 600 }}>{c.category}</div>
                      <div style={{ color: '#888', marginTop: 2 }}>{c.description}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Customers Page ───────────────────────────────────────
export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page, filter });
    if (search) params.append('search', search);
    const r = await fetch(`/api/customers?${params}`);
    const d = await r.json();
    setCustomers(d.customers || []);
    setSummary(d.summary || {});
    setTotal(d.total || 0);
    setLoading(false);
  }, [page, filter, search]);

  useEffect(() => { load(); }, [load]);

  const filters = [
    { id: 'all', label: 'All', count: summary.total },
    { id: 'repeat', label: '🔄 Repeat', count: summary.repeat },
    { id: 'vip', label: '⭐ VIP (3+ orders)', count: summary.vip },
    { id: 'rto', label: '↩️ Had RTO', count: summary.rto_customers },
    { id: 'blacklist', label: '⛔ Blacklisted', count: summary.blacklisted },
  ];

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff', padding: 24 }}>
      {selected && <CustomerDrawer customer={selected} onClose={() => setSelected(null)} onRefresh={load} />}

      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Customers</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>{summary.total || 0} unique customers · from order history</p>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Customers', value: summary.total || 0, color: '#fff' },
          { label: 'Repeat Buyers', value: summary.repeat || 0, color: '#3b82f6' },
          { label: 'VIP (3+ orders)', value: summary.vip || 0, color: gold },
          { label: 'Had RTO', value: summary.rto_customers || 0, color: '#ef4444' },
          { label: 'Blacklisted', value: summary.blacklisted || 0, color: '#ef4444' },
        ].map(s => (
          <div key={s.label} style={{ background: card, border: `1px solid ${border}`, borderRadius: 9, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters + Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {filters.map(f => (
          <button key={f.id} onClick={() => { setFilter(f.id); setPage(1); }}
            style={{ padding: '7px 14px', background: filter === f.id ? '#1e1e1e' : 'transparent', border: `1px solid ${filter === f.id ? '#333' : border}`, borderRadius: 8, fontSize: 12, color: filter === f.id ? gold : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>
            {f.label} {f.count !== undefined && <span style={{ opacity: 0.6 }}>({f.count || 0})</span>}
          </button>
        ))}
      </div>
      <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, phone, city..."
        style={{ width: '100%', maxWidth: 380, background: card, border: `1px solid ${border}`, color: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13, marginBottom: 16, boxSizing: 'border-box' }} />

      {/* Table */}
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${border}` }}>
                {['Customer', 'Phone', 'City', 'Orders', 'Total Spend', 'Delivered', 'RTO', 'Last Order', 'Tag'].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', color: '#555', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, background: '#0a0a0a' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#444' }}>Loading...</td></tr>}
              {!loading && customers.length === 0 && <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#444' }}>No customers found</td></tr>}
              {customers.map((c, i) => (
                <tr key={i} onClick={() => setSelected(c)} style={{ borderBottom: '1px solid #1a1a1a', cursor: 'pointer', background: c.is_blacklisted ? '#1a000088' : 'transparent' }}>
                  <td style={{ padding: '11px 14px', color: c.is_blacklisted ? '#ef4444' : '#fff', fontWeight: 500 }}>
                    {c.is_blacklisted && '⛔ '}{c.name}
                  </td>
                  <td style={{ padding: '11px 14px', color: '#666', fontSize: 12 }}>{c.phone}</td>
                  <td style={{ padding: '11px 14px', color: '#888' }}>{c.city || '—'}</td>
                  <td style={{ padding: '11px 14px', color: '#fff', fontWeight: 600 }}>{c.orders}</td>
                  <td style={{ padding: '11px 14px', color: gold, fontWeight: 600 }}>{fmt(c.total_spend)}</td>
                  <td style={{ padding: '11px 14px', color: '#22c55e' }}>{c.delivered}</td>
                  <td style={{ padding: '11px 14px', color: c.rto > 0 ? '#ef4444' : '#555' }}>{c.rto}</td>
                  <td style={{ padding: '11px 14px', color: '#555', fontSize: 12 }}>{timeAgo(c.last_order)}</td>
                  <td style={{ padding: '11px 14px' }}>
                    {c.is_vip && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: gold+'22', color: gold }}>⭐ VIP</span>}
                    {c.is_repeat && !c.is_vip && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#3b82f622', color: '#3b82f6' }}>🔄 Repeat</span>}
                    {c.is_blacklisted && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#ef444422', color: '#ef4444' }}>⛔</span>}
                    {!c.is_vip && !c.is_repeat && !c.is_blacklisted && <span style={{ color: '#333', fontSize: 11 }}>New</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#555' }}>{total} customers</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: page===1?'#333':'#888', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: page===1?'not-allowed':'pointer' }}>← Prev</button>
            <span style={{ fontSize: 12, color: '#555', padding: '5px 10px' }}>Page {page}</span>
            <button onClick={() => setPage(p => p+1)} disabled={customers.length < 30} style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: customers.length<30?'#333':'#888', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: customers.length<30?'not-allowed':'pointer' }}>Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
