'use client';
// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR ERP — Accounts Page
// ----------------------------------------------------------------------------
// Tabs: Dashboard · Settlements · Vendors · Personal · Zakat
//
// May 5 2026 — Mobile-first overhaul
//   • Vendors tab redesigned: master-detail flow on mobile (list ↔ detail),
//     card-based transaction view on mobile, polished list with avatars,
//     search filter, and prominent outstanding badges.
//   • Transactions now sort DESC (newest first) — print statement reverses
//     the array internally so running balance stays chronological.
//   • All copy converted to professional English. Roman Urdu strings removed.
//   • Tab bar scrolls horizontally on narrow screens (no awkward wrap).
//   • Inputs use 16px on mobile to prevent iOS auto-zoom.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from 'react';
import SettlementsTab from './SettlementsTab';
import { useUser } from '@/context/UserContext';

// ── Shared style atoms ──────────────────────────────────────────────────────
const S = {
  input:   { width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '10px 12px', color: '#ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  btn:     { background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 16px', color: '#c9a96e', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 },
  label:   { display: 'block', fontSize: 11, color: '#666', marginBottom: 6, fontFamily: 'monospace', letterSpacing: 0.5, textTransform: 'uppercase' },
  td:      { padding: '12px 16px', fontSize: 13, color: '#888', verticalAlign: 'middle' },
  th:      { padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#444', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 400, borderBottom: '1px solid #1e1e1e' },
  card:    { background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, padding: '20px 24px' },
  section: { background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, overflow: 'hidden', marginBottom: 20 },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmt(n) { if (!n && n !== 0) return '—'; return 'Rs. ' + parseFloat(n).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }); }
function fmtDateShort(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }); }
function today()      { return new Date().toISOString().split('T')[0]; }
function thisMonth()  { return new Date().toISOString().slice(0, 7); }

// Deterministic color per vendor name — used for avatar circles.
function vendorColor(name) {
  const palette = ['#c9a96e', '#60a5fa', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  return palette[Math.abs(hash) % palette.length];
}

function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

// Mobile detection hook (<= 768px viewport).
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

// ── Modal — full-screen friendly on mobile (global CSS caps width to 100%) ──
function Modal({ title, onClose, children, width = 500 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 14, padding: 24, width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#c9a96e' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: 22, cursor: 'pointer', padding: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color = '#c9a96e', icon, border }) {
  return (
    <div style={{ ...S.card, borderColor: border || '#1e1e1e' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</span>
        {icon && <span style={{ fontSize: 18 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#444', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD TAB
// ════════════════════════════════════════════════════════════════════════════
function DashboardTab() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/accounts/dashboard?month=' + month);
      const d = await r.json();
      if (d.success) setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#444' }}>Loading financial data...</div>;
  if (!data)   return <div style={{ padding: 40, color: '#ef4444' }}>Failed to load data. Please refresh.</div>;

  const { orders, settlements, expenses, vendors, pl, inventory } = data;
  const plColor = pl.net >= 0 ? '#22c55e' : '#ef4444';
  const couriers = ['PostEx', 'Leopards', 'Kangaroo'];
  const cColors  = { PostEx: '#4caf79', Leopards: '#e87d44', Kangaroo: '#9b7fe8' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...S.input, width: 'auto', fontSize: 14, padding: '8px 14px', fontWeight: 600 }} />
        <button onClick={load} style={{ ...S.btn, padding: '8px 14px' }}>🔄 Refresh</button>
      </div>

      {/* P&L summary */}
      <div style={{ background: pl.net >= 0 ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.05)', border: `1px solid ${pl.net >= 0 ? '#22c55e33' : '#ef444433'}`, borderRadius: 14, padding: 24 }}>
        <div style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>📊 Profit & Loss — {month}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 20 }}>
          <div><div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Revenue (Delivered)</div><div style={{ fontSize: 28, fontWeight: 700, color: '#22c55e' }}>{fmt(pl.revenue)}</div></div>
          <div><div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Total Expenses</div><div style={{ fontSize: 28, fontWeight: 700, color: '#ef4444' }}>{fmt(pl.total_expenses)}</div></div>
          <div><div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Net {pl.net >= 0 ? 'Profit' : 'Loss'}</div><div style={{ fontSize: 32, fontWeight: 800, color: plColor, letterSpacing: -1 }}>{fmt(Math.abs(pl.net))}</div><div style={{ fontSize: 12, color: plColor, marginTop: 2 }}>{pl.margin}% margin</div></div>
        </div>
      </div>

      {/* Orders */}
      <div>
        <div style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>📋 Orders (All Time)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <StatCard label="This Month" value={orders.total_this_month} icon="📋" />
          <StatCard label="Delivered" value={orders.delivered} color="#22c55e" icon="✅" border="#22c55e22" />
          <StatCard label="In Transit" value={orders.dispatched} color="#60a5fa" icon="🚚" />
          <StatCard label="Pending Revenue" value={fmt(orders.pending_revenue)} color="#f59e0b" icon="⏳" />
          <StatCard label="Cash Collected" value={fmt(orders.cash_collected)} color="#22c55e" icon="💵" border="#22c55e22" />
          <StatCard label="Awaiting Settlement" value={fmt(orders.awaiting_settlement)} color="#a855f7" icon="⏳" />
        </div>
      </div>

      {/* Courier breakdown */}
      <div>
        <div style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>🚚 Courier Breakdown</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {couriers.map(c => {
            const co = orders.by_courier?.[c] || {};
            const settled = settlements.by_courier?.[c] || 0;
            return (
              <div key={c} style={{ ...S.card, borderColor: cColors[c] + '33' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: cColors[c], marginBottom: 12 }}>{c}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[['Orders', co.orders || 0, '#ccc'], ['Delivered', co.delivered || 0, '#22c55e'], ['Revenue', fmt(co.revenue || 0), '#ccc'], ['Settled', fmt(settled), '#22c55e']].map(([l, v, col]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: '#555' }}>{l}</span><span style={{ color: col, fontWeight: l === 'Settled' ? 700 : 400 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expenses */}
      <div>
        <div style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>💸 Expenses Breakdown</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <StatCard label="Operations" value={fmt(expenses.operations)} color="#ef4444" icon="🏭" border="#ef444422" />
          <StatCard label="Salaries" value={fmt(expenses.salaries)} color="#ef4444" icon="👥" border="#ef444422" />
          <StatCard label="Personal" value={fmt(expenses.personal)} color="#ef4444" icon="💳" border="#ef444422" />
          <StatCard label="Advances Given" value={fmt(expenses.advances)} color="#f59e0b" icon="💸" />
        </div>
        {Object.keys(expenses.by_category || {}).length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(expenses.by_category).map(([cat, amt]) => (
              <span key={cat} style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 20, padding: '4px 12px', fontSize: 12, color: '#666' }}>{cat}: <span style={{ color: '#ef4444' }}>{fmt(amt)}</span></span>
            ))}
          </div>
        )}
      </div>

      {/* Settlements */}
      <div>
        <div style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>✅ Settlements Received</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <StatCard label="This Month" value={fmt(settlements.received_this_month)} color="#22c55e" icon="💰" border="#22c55e22" />
          <StatCard label="All Time Total" value={fmt(settlements.total_all_time)} color="#22c55e" icon="💰" border="#22c55e22" />
          {couriers.map(c => <StatCard key={c} label={c} value={fmt(settlements.by_courier?.[c] || 0)} color={cColors[c]} />)}
        </div>
      </div>

      {/* Capital */}
      <div>
        <div style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>🏦 Capital & Liabilities</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <StatCard label="Inventory Value" value={fmt(inventory.value)} color="#c9a96e" icon="📦" />
          <StatCard label="Vendor Outstanding" value={fmt(vendors.outstanding)} color="#ef4444" icon="🏭" border="#ef444422" sub={'Total purchased: ' + fmt(vendors.total_purchased)} />
          <StatCard label="Total Vendor Paid" value={fmt(vendors.total_paid)} color="#22c55e" icon="✅" />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// VENDORS TAB — redesigned
// ────────────────────────────────────────────────────────────────────────────
// Layout:
//   • Desktop  → side-by-side (list 320px | detail flex 1)
//   • Mobile   → master-detail flow: list OR detail (driven by `selected`)
// Visual: avatars, search filter, professional copy, transaction cards.
// Order:  transactions sorted DESC (newest first) from API.
// ════════════════════════════════════════════════════════════════════════════
function VendorsTab() {
  const { can } = useUser();
  const canVendorEdit    = can('accounts.vendors_edit');
  const canVendorPayment = can('accounts.vendors_payment');
  const isMobile = useIsMobile();

  const [ledger, setLedger]       = useState([]);
  const [totalOut, setTotalOut]   = useState(0);
  const [selected, setSelected]   = useState(null);
  const [selData, setSelData]     = useState(null);
  const [showAdd, setShowAdd]     = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [showTxn, setShowTxn]     = useState(null);
  const [editingTxn, setEditingTxn] = useState(null);
  const [vForm, setVForm]         = useState({ name: '', phone: '', category: 'General', payment_terms: '', contact_person: '' });
  const [tForm, setTForm]         = useState({ amount: '', payment_date: today(), due_date: '', item_description: '', note: '' });
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState('');
  const [modalMsg, setModalMsg]   = useState('');
  const [search, setSearch]       = useState('');
  const [sortBy, setSortBy]       = useState('outstanding'); // 'outstanding' | 'name' | 'recent'

  const load = useCallback(async () => {
    const r = await fetch('/api/accounts/vendors');
    const d = await r.json();
    if (d.success) { setLedger(d.ledger || []); setTotalOut(d.total_outstanding || 0); }
  }, []);

  const loadV = useCallback(async (id) => {
    const r = await fetch('/api/accounts/vendors?vendor_id=' + id + '&action=transactions');
    const d = await r.json();
    if (d.success) setSelData(d);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selected) loadV(selected); else setSelData(null); }, [selected, loadV]);

  function sm(m) { setMsg(m); setTimeout(() => setMsg(''), 4000); }
  function mm(m) { setModalMsg(m); setTimeout(() => setModalMsg(''), 4000); }

  // Filtered & sorted vendor list (memo'd to avoid re-sort on every keystroke).
  const visibleLedger = useMemo(() => {
    let list = ledger;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(v =>
        (v.name || '').toLowerCase().includes(q) ||
        (v.phone || '').toLowerCase().includes(q) ||
        (v.category || '').toLowerCase().includes(q) ||
        (v.contact_person || '').toLowerCase().includes(q)
      );
    }
    const sorted = [...list];
    if (sortBy === 'outstanding') {
      sorted.sort((a, b) => (b.outstanding || 0) - (a.outstanding || 0));
    } else if (sortBy === 'recent') {
      sorted.sort((a, b) => new Date(b.last_transaction || 0) - new Date(a.last_transaction || 0));
    } else {
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    return sorted;
  }, [ledger, search, sortBy]);

  async function addVendor() {
    if (!vForm.name) { mm('❌ Vendor name is required'); return; }
    setSaving(true); setModalMsg('');
    try {
      const isEdit = !!editingVendor;
      const payload = isEdit
        ? { action: 'update_vendor', vendor_id: editingVendor.id, ...vForm }
        : { action: 'add_vendor', ...vForm };
      const r = await fetch('/api/accounts/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.success) {
        closeAdd();
        sm(isEdit ? '✅ Vendor updated successfully' : '✅ Vendor added successfully');
        load();
      } else {
        mm('❌ ' + (d.error || 'Something went wrong'));
      }
    } catch (e) {
      mm('❌ Network error: ' + e.message);
    }
    setSaving(false);
  }

  function openEditVendor(v) {
    setEditingVendor(v);
    setVForm({
      name: v.name || '',
      phone: v.phone || '',
      category: v.category || 'General',
      payment_terms: v.payment_terms || '',
      contact_person: v.contact_person || '',
      email: v.email || '',
    });
    setShowAdd(true);
  }

  function closeAdd() {
    setShowAdd(false);
    setEditingVendor(null);
    setVForm({ name: '', phone: '', category: 'General', payment_terms: '', contact_person: '' });
  }

  async function addTxn(type) {
    if (!tForm.amount) { mm('❌ Amount is required'); return; }
    setSaving(true); setModalMsg('');
    try {
      const isEdit = !!editingTxn;
      const payload = isEdit
        ? { action: 'update_transaction', id: editingTxn.id, ...tForm }
        : { action: 'add_transaction', vendor_id: selected, payment_type: type, ...tForm };
      const r = await fetch('/api/accounts/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.success) {
        closeTxn();
        sm(isEdit ? '✅ Entry updated' : '✅ Entry saved');
        load(); loadV(selected);
      } else {
        mm('❌ ' + (d.error || 'Something went wrong'));
      }
    } catch (e) {
      mm('❌ Network error: ' + e.message);
    }
    setSaving(false);
  }

  function openEdit(t) {
    setEditingTxn(t);
    setShowTxn(t.payment_type);
    setTForm({
      amount: t.amount ?? '',
      payment_date: (t.payment_date || '').slice(0, 10) || today(),
      due_date: (t.due_date || '').slice(0, 10) || '',
      item_description: t.item_description || '',
      note: t.note || '',
    });
  }

  function closeTxn() {
    setShowTxn(null);
    setEditingTxn(null);
    setTForm({ amount: '', payment_date: today(), due_date: '', item_description: '', note: '' });
  }

  async function delTxn(id) {
    if (!confirm('Delete this entry?')) return;
    await fetch('/api/accounts/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_transaction', id }) });
    load(); loadV(selected);
  }

  // Print statement: API returns DESC, but running balance must be chronological,
  // so reverse a copy before walking through.
  function printStatement() {
    if (!selData) return;
    const v = selData.vendor;
    const chronological = [...(selData.transactions || [])].reverse();
    let running = 0;
    const rows = chronological.map(t => {
      const isP = t.payment_type === 'purchase';
      running += isP ? parseFloat(t.amount) : -parseFloat(t.amount);
      return '<tr><td>' + fmtDate(t.payment_date) + '</td><td>' + (t.item_description || t.note || '—') + '</td><td style="color:' + (isP ? '#c00' : '#888') + '">' + (isP ? fmt(t.amount) : '—') + '</td><td style="color:#090">' + (!isP ? fmt(t.amount) : '—') + '</td><td style="font-weight:700;color:' + (running > 0 ? '#c00' : '#090') + '">' + fmt(Math.abs(running)) + ' ' + (running > 0 ? 'DR' : 'CR') + '</td></tr>';
    }).join('');
    const html = '<html><head><title>' + v.name + ' Statement</title><style>body{font-family:Arial;padding:30px;color:#222}table{width:100%;border-collapse:collapse}th,td{padding:8px 12px;border:1px solid #ddd;font-size:13px}th{background:#f5f5f5}</style></head><body><h2>RS ZEVAR — ' + v.name + '</h2><p>Phone: ' + (v.phone || '—') + ' | Terms: ' + (v.payment_terms || '—') + ' | Date: ' + new Date().toLocaleDateString() + '</p><table><thead><tr><th>Date</th><th>Description</th><th>Purchase (Dr)</th><th>Payment (Cr)</th><th>Balance</th></tr></thead><tbody>' + rows + '</tbody></table><p style="text-align:right;font-weight:700;margin-top:20px">Outstanding: ' + fmt(selData.outstanding) + '</p></body></html>';
    const w = window.open('', '_blank'); w.document.write(html); w.document.close(); w.print();
  }

  const selV = ledger.find(v => v.id === selected);

  // Mobile master-detail: render one panel at a time.
  const showList   = !isMobile || !selected;
  const showDetail = !isMobile || !!selected;

  // ─── List Panel ──────────────────────────────────────────────────────────
  const ListPanel = (
    <div style={{ width: isMobile ? '100%' : 320, flexShrink: 0 }}>
      {/* Outstanding summary banner */}
      {totalOut > 0 && (
        <div style={{ background: 'linear-gradient(135deg, #2a1a1a 0%, #1f1414 100%)', border: '1px solid #ef444433', borderRadius: 12, padding: '14px 18px', marginBottom: 12, boxShadow: '0 2px 12px rgba(239,68,68,0.08)' }}>
          <div style={{ fontSize: 10, color: '#ef4444aa', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Total Outstanding</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#ef4444', letterSpacing: -0.5 }}>{fmt(totalOut)}</div>
          <div style={{ fontSize: 11, color: '#ef444477', marginTop: 2 }}>across {ledger.filter(v => v.outstanding > 0).length} vendor{ledger.filter(v => v.outstanding > 0).length !== 1 ? 's' : ''}</div>
        </div>
      )}

      {/* Action button + search */}
      {canVendorEdit && (
        <button onClick={() => setShowAdd(true)} style={{ ...S.btn, width: '100%', marginBottom: 10, padding: '10px 16px', background: '#c9a96e', color: '#000', borderColor: '#c9a96e' }}>
          + Add New Vendor
        </button>
      )}
      <input
        placeholder="🔍 Search by name, phone, category..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ ...S.input, marginBottom: 8, fontSize: 13 }}
      />

      {/* Sort chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { id: 'outstanding', label: 'Outstanding' },
          { id: 'recent',      label: 'Recent' },
          { id: 'name',        label: 'Name' },
        ].map(s => (
          <button
            key={s.id}
            onClick={() => setSortBy(s.id)}
            style={{
              background: sortBy === s.id ? '#c9a96e22' : 'transparent',
              border: '1px solid ' + (sortBy === s.id ? '#c9a96e66' : '#2a2a2a'),
              color: sortBy === s.id ? '#c9a96e' : '#666',
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 16,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 500,
            }}
          >{s.label}</button>
        ))}
      </div>

      {/* Vendor cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visibleLedger.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#444', fontSize: 13, background: '#0d0d0d', border: '1px dashed #222', borderRadius: 10 }}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.6 }}>🏭</div>
            <div style={{ color: '#888', marginBottom: 4 }}>{search ? 'No vendors match your search' : 'No vendors yet'}</div>
            <div style={{ fontSize: 11, color: '#444' }}>{search ? 'Try a different keyword' : 'Add your first vendor to get started'}</div>
          </div>
        )}
        {visibleLedger.map(v => {
          const isActive = selected === v.id;
          const accent = vendorColor(v.name);
          return (
            <button
              key={v.id}
              onClick={() => setSelected(v.id)}
              style={{
                background: isActive ? '#1a1a1a' : '#0d0d0d',
                border: '1px solid ' + (isActive ? '#c9a96e66' : '#1a1a1a'),
                borderRadius: 10,
                padding: '12px 14px',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontFamily: 'inherit',
                transition: 'border-color 0.15s ease, background 0.15s ease',
              }}
            >
              {/* Avatar circle */}
              <div style={{
                width: 38, height: 38, flexShrink: 0,
                borderRadius: '50%',
                background: accent + '22',
                color: accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, letterSpacing: 0.5,
                border: '1px solid ' + accent + '44',
              }}>{initials(v.name)}</div>

              {/* Name + category + outstanding */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13.5,
                  color: isActive ? '#c9a96e' : '#ddd',
                  fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  marginBottom: 3,
                }}>{v.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: '#666', background: '#1a1a1a', padding: '1px 7px', borderRadius: 10, border: '1px solid #2a2a2a' }}>{v.category || 'General'}</span>
                  {v.outstanding > 0 ? (
                    <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>{fmt(v.outstanding)} due</span>
                  ) : v.transactions > 0 ? (
                    <span style={{ fontSize: 10, color: '#22c55e' }}>✓ Cleared</span>
                  ) : null}
                </div>
              </div>

              {isMobile && <span style={{ color: '#444', fontSize: 16 }}>›</span>}
            </button>
          );
        })}
      </div>
    </div>
  );

  // ─── Detail Panel ────────────────────────────────────────────────────────
  const DetailPanel = (
    <div style={{ flex: 1, minWidth: 0 }}>
      {!selected ? (
        <div style={{ padding: '60px 24px', textAlign: 'center', color: '#444', background: '#0d0d0d', border: '1px dashed #1e1e1e', borderRadius: 12 }}>
          <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.4 }}>👈</div>
          <div style={{ fontSize: 14, color: '#666' }}>Select a vendor to view their ledger</div>
        </div>
      ) : (
        <>
          {/* Header card */}
          <div style={{ ...S.card, marginBottom: 14, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              {/* Mobile back button */}
              {isMobile && (
                <button
                  onClick={() => setSelected(null)}
                  style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#888', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                >← Back</button>
              )}

              {/* Avatar */}
              <div style={{
                width: 48, height: 48, flexShrink: 0,
                borderRadius: '50%',
                background: vendorColor(selV?.name) + '22',
                color: vendorColor(selV?.name),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700,
                border: '1px solid ' + vendorColor(selV?.name) + '44',
              }}>{initials(selV?.name)}</div>

              {/* Name + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#eee', letterSpacing: -0.3 }}>{selV?.name}</div>
                  {selV && canVendorEdit && (
                    <button
                      onClick={() => openEditVendor(selV)}
                      title="Edit vendor details"
                      style={{ background: 'transparent', border: '1px solid #2a2a2a', color: '#c9a96e', cursor: 'pointer', fontSize: 11, padding: '3px 9px', borderRadius: 6, fontFamily: 'inherit', fontWeight: 500 }}
                    >✏️ Edit</button>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {selV?.phone           && <span>📞 {selV.phone}</span>}
                  {selV?.contact_person  && <span>👤 {selV.contact_person}</span>}
                  {selV?.payment_terms   && <span>⏱ {selV.payment_terms}</span>}
                  {selV?.category        && <span style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '1px 7px', fontSize: 10 }}>{selV.category}</span>}
                </div>
              </div>
            </div>

            {/* Stats row */}
            {selData && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
                marginTop: 14,
                paddingTop: 14,
                borderTop: '1px solid #1e1e1e',
              }}>
                {[
                  { l: 'Purchased', v: selData.total_purchase, c: '#ccc' },
                  { l: 'Paid',      v: selData.total_paid,     c: '#22c55e' },
                  { l: 'Outstanding', v: selData.outstanding,  c: selData.outstanding > 0 ? '#ef4444' : '#22c55e' },
                ].map(s => (
                  <div key={s.l}>
                    <div style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', letterSpacing: 0.5, textTransform: 'uppercase' }}>{s.l}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: s.c, marginTop: 2 }}>{fmt(s.v)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {canVendorEdit && (
              <button
                onClick={() => setShowTxn('purchase')}
                style={{ ...S.btn, background: '#1a2a1a', borderColor: '#22c55e44', color: '#22c55e', flex: isMobile ? '1 1 calc(50% - 4px)' : '0 0 auto', minWidth: 0 }}
              >+ Purchase</button>
            )}
            {canVendorPayment && (
              <button
                onClick={() => setShowTxn('payment')}
                style={{ ...S.btn, background: '#2a1a1a', borderColor: '#ef444444', color: '#ef4444', flex: isMobile ? '1 1 calc(50% - 4px)' : '0 0 auto', minWidth: 0 }}
              >+ Payment</button>
            )}
            <button
              onClick={printStatement}
              style={{ ...S.btn, flex: isMobile ? '1 1 100%' : '0 0 auto' }}
            >🖨️ Print Statement</button>
          </div>

          {msg && <div style={{ padding: '10px 16px', borderRadius: 8, background: msg.startsWith('✅') ? '#1a2a1a' : '#2a1a1a', color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: 13, marginBottom: 12 }}>{msg}</div>}

          {/* Transaction list — table on desktop, cards on mobile */}
          {isMobile ? (
            <TxnCardList
              transactions={selData?.transactions || []}
              canEdit={canVendorEdit}
              onEdit={openEdit}
              onDelete={delTxn}
            />
          ) : (
            <TxnTable
              transactions={selData?.transactions || []}
              canEdit={canVendorEdit}
              onEdit={openEdit}
              onDelete={delTxn}
            />
          )}
        </>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 20 }}>
      {showList && ListPanel}
      {showDetail && DetailPanel}

      {/* ── Add / Edit Vendor Modal ── */}
      {showAdd && (
        <Modal title={editingVendor ? '✏️ Edit Vendor' : '🏭 New Vendor'} onClose={closeAdd}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              ['name',           'Vendor Name *',   'e.g. Ali Brothers'],
              ['phone',          'Phone',           '03xx-xxxxxxx'],
              ['contact_person', 'Contact Person',  'Full name'],
              ['payment_terms',  'Payment Terms',   'e.g. Net 30 days, COD, Advance'],
            ].map(([k, l, p]) => (
              <div key={k}>
                <label style={S.label}>{l}</label>
                <input placeholder={p} value={vForm[k] || ''} onChange={e => setVForm(f => ({ ...f, [k]: e.target.value }))} style={S.input} />
              </div>
            ))}
            <div>
              <label style={S.label}>Category</label>
              <select value={vForm.category} onChange={e => setVForm(f => ({ ...f, category: e.target.value }))} style={S.input}>
                {['General', 'Jewelry', 'Packaging', 'Accessories', 'Raw Material', 'Other'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            {modalMsg && <div style={{ padding: '10px 14px', borderRadius: 8, background: modalMsg.startsWith('✅') ? '#1a2a1a' : '#2a1a1a', color: modalMsg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: 13 }}>{modalMsg}</div>}
            <button onClick={addVendor} disabled={saving} style={{ ...S.btn, background: '#c9a96e', color: '#000', fontWeight: 700, padding: '11px' }}>
              {saving ? 'Saving...' : editingVendor ? 'Update Vendor' : 'Add Vendor'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Add / Edit Transaction Modal ── */}
      {showTxn && (
        <Modal
          title={(editingTxn ? '✏️ Edit ' : '') + (showTxn === 'purchase' ? '📦 Purchase Entry' : '💸 Payment Entry')}
          onClose={closeTxn}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={S.label}>Amount (Rs.) *</label>
                <input type="number" placeholder="0" value={tForm.amount} onChange={e => setTForm(f => ({ ...f, amount: e.target.value }))} style={S.input} />
              </div>
              <div>
                <label style={S.label}>Date</label>
                <input type="date" value={tForm.payment_date} onChange={e => setTForm(f => ({ ...f, payment_date: e.target.value }))} style={S.input} />
              </div>
            </div>
            {showTxn === 'purchase' && (
              <>
                <div>
                  <label style={S.label}>Item Description</label>
                  <input placeholder="e.g. Gold chains, packaging boxes" value={tForm.item_description} onChange={e => setTForm(f => ({ ...f, item_description: e.target.value }))} style={S.input} />
                </div>
                <div>
                  <label style={S.label}>Payment Due Date</label>
                  <input type="date" value={tForm.due_date} onChange={e => setTForm(f => ({ ...f, due_date: e.target.value }))} style={S.input} />
                </div>
              </>
            )}
            <div>
              <label style={S.label}>Reference / Note</label>
              <input placeholder="Invoice number or reference" value={tForm.note} onChange={e => setTForm(f => ({ ...f, note: e.target.value }))} style={S.input} />
            </div>
            {modalMsg && <div style={{ padding: '10px 14px', borderRadius: 8, background: modalMsg.startsWith('✅') ? '#1a2a1a' : '#2a1a1a', color: modalMsg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: 13 }}>{modalMsg}</div>}
            <button
              onClick={() => addTxn(showTxn)}
              disabled={saving}
              style={{ ...S.btn, background: showTxn === 'purchase' ? '#1a2a1a' : '#2a1a1a', borderColor: showTxn === 'purchase' ? '#22c55e44' : '#ef444444', color: showTxn === 'purchase' ? '#22c55e' : '#ef4444', padding: '11px', fontWeight: 700 }}
            >
              {saving ? 'Saving...' : editingTxn ? 'Update Entry' : (showTxn === 'purchase' ? 'Save Purchase' : 'Save Payment')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Transaction table (desktop) ─────────────────────────────────────────────
function TxnTable({ transactions, canEdit, onEdit, onDelete }) {
  return (
    <div style={S.section}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Date', 'Type', 'Description', 'Amount', 'Due Date', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {!transactions.length && (
            <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#333' }}>No transactions yet</td></tr>
          )}
          {transactions.map(t => {
            const isP = t.payment_type === 'purchase';
            const overdue = t.due_date && new Date(t.due_date) < new Date();
            return (
              <tr key={t.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                <td style={S.td}>{fmtDate(t.payment_date)}</td>
                <td style={S.td}>
                  <span style={{ background: isP ? '#22c55e22' : '#ef444422', color: isP ? '#22c55e' : '#ef4444', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                    {isP ? '📦 Purchase' : '💸 Payment'}
                  </span>
                </td>
                <td style={{ ...S.td, color: '#ccc' }}>{t.item_description || t.note || '—'}</td>
                <td style={{ ...S.td, color: isP ? '#ef4444' : '#22c55e', fontWeight: 700 }}>{fmt(t.amount)}</td>
                <td style={S.td}>
                  {t.due_date
                    ? <span style={{ color: overdue ? '#ef4444' : '#f59e0b' }}>📅 {fmtDate(t.due_date)}</span>
                    : '—'}
                </td>
                <td style={S.td}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {canEdit && <button onClick={() => onEdit(t)} title="Edit entry" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', color: '#c9a96e', cursor: 'pointer', fontSize: 12, padding: '5px 10px', borderRadius: 6, fontFamily: 'inherit' }}>✏️ Edit</button>}
                    {canEdit && <button onClick={() => onDelete(t.id)} title="Delete entry" style={{ background: '#2a1a1a', border: '1px solid #ef444455', color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '5px 10px', borderRadius: 6, fontFamily: 'inherit' }}>🗑 Delete</button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Transaction cards (mobile) ──────────────────────────────────────────────
// Designed for thumb-comfortable interaction at narrow widths.
function TxnCardList({ transactions, canEdit, onEdit, onDelete }) {
  if (!transactions.length) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#444', background: '#0d0d0d', border: '1px dashed #1e1e1e', borderRadius: 10 }}>
        <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>📒</div>
        <div style={{ fontSize: 13, color: '#888' }}>No transactions yet</div>
        <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>Add a purchase or payment to start the ledger</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {transactions.map(t => {
        const isP = t.payment_type === 'purchase';
        const overdue = t.due_date && new Date(t.due_date) < new Date();
        return (
          <div
            key={t.id}
            style={{
              background: '#0f0f0f',
              border: '1px solid ' + (isP ? '#22c55e22' : '#ef444422'),
              borderLeftWidth: 3,
              borderLeftColor: isP ? '#22c55e' : '#ef4444',
              borderRadius: 10,
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ background: isP ? '#22c55e22' : '#ef444422', color: isP ? '#22c55e' : '#ef4444', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {isP ? '📦 Purchase' : '💸 Payment'}
                </span>
                <span style={{ fontSize: 11, color: '#666' }}>{fmtDate(t.payment_date)}</span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: isP ? '#ef4444' : '#22c55e', whiteSpace: 'nowrap', letterSpacing: -0.3 }}>{fmt(t.amount)}</div>
            </div>

            {(t.item_description || t.note) && (
              <div style={{ fontSize: 13, color: '#ccc', marginBottom: 8, lineHeight: 1.4, wordBreak: 'break-word' }}>
                {t.item_description || t.note}
              </div>
            )}

            {t.due_date && (
              <div style={{ fontSize: 11, color: overdue ? '#ef4444' : '#f59e0b', marginBottom: 8 }}>
                📅 Due: {fmtDate(t.due_date)} {overdue && <span style={{ background: '#ef444422', padding: '1px 6px', borderRadius: 4, marginLeft: 4, fontSize: 10, fontWeight: 700 }}>OVERDUE</span>}
              </div>
            )}

            {canEdit && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid #1a1a1a' }}>
                <button onClick={() => onEdit(t)} style={{ flex: 1, background: '#1e1e1e', border: '1px solid #2a2a2a', color: '#c9a96e', cursor: 'pointer', fontSize: 12, padding: '7px', borderRadius: 6, fontFamily: 'inherit', fontWeight: 600 }}>✏️ Edit</button>
                <button onClick={() => onDelete(t.id)} style={{ flex: 1, background: '#2a1a1a', border: '1px solid #ef444455', color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '7px', borderRadius: 6, fontFamily: 'inherit', fontWeight: 600 }}>🗑 Delete</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PERSONAL EXPENSES TAB
// ════════════════════════════════════════════════════════════════════════════
function PersonalTab() {
  const { can } = useUser();
  const canPersonalEdit = can('accounts.personal_edit');
  const isMobile = useIsMobile();

  const [expenses, setExpenses]     = useState([]);
  const [total, setTotal]           = useState(0);
  const [byCategory, setByCategory] = useState({});
  const [month, setMonth]           = useState(thisMonth());
  const [showModal, setShowModal]   = useState(false);
  const [form, setForm]             = useState({ title: '', amount: '', category: 'Office Rent', expense_date: today(), note: '' });
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState('');
  const CATS = ['Office Rent', 'Electricity', 'Internet', 'Personal Purchase', 'Food', 'Travel', 'Other'];

  const load = useCallback(async () => {
    const r = await fetch('/api/accounts/personal?month=' + month);
    const d = await r.json();
    if (d.success) {
      setExpenses(d.expenses || []);
      setTotal(d.total || 0);
      setByCategory(d.by_category || {});
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);
  function sm(m) { setMsg(m); setTimeout(() => setMsg(''), 3000); }

  async function add() {
    if (!form.title || !form.amount) { sm('❌ Title and amount are required'); return; }
    setSaving(true);
    const r = await fetch('/api/accounts/personal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', ...form }) });
    const d = await r.json();
    setSaving(false);
    if (d.success) {
      sm('✅ Expense added');
      setShowModal(false);
      setForm({ title: '', amount: '', category: 'Office Rent', expense_date: today(), note: '' });
      load();
    } else sm('❌ ' + d.error);
  }

  async function del(id) {
    if (!confirm('Delete this expense?')) return;
    await fetch('/api/accounts/personal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) });
    load();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...S.input, width: 'auto' }} />
        <div style={{ ...S.card, padding: '10px 20px', flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 12, color: '#555' }}>This Month: </span>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#ef4444', marginLeft: 8 }}>{fmt(total)}</span>
        </div>
        {canPersonalEdit && (
          <button onClick={() => setShowModal(true)} style={{ ...S.btn, background: '#2a1a1a', borderColor: '#ef444444', color: '#ef4444' }}>
            + Add Expense
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {Object.entries(byCategory).map(([cat, amt]) => (
          <span key={cat} style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 20, padding: '4px 12px', fontSize: 12, color: '#666' }}>
            {cat}: <span style={{ color: '#ef4444' }}>{fmt(amt)}</span>
          </span>
        ))}
      </div>

      {msg && <div style={{ padding: '10px 16px', borderRadius: 8, background: msg.startsWith('✅') ? '#1a2a1a' : '#2a1a1a', color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: 13 }}>{msg}</div>}

      {/* Mobile: cards · Desktop: table */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {expenses.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#444', background: '#0d0d0d', border: '1px dashed #1e1e1e', borderRadius: 10 }}>
              <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>💳</div>
              <div style={{ fontSize: 13, color: '#888' }}>No personal expenses recorded</div>
            </div>
          )}
          {expenses.map(e => (
            <div key={e.id} style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderLeft: '3px solid #ef4444', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#ddd', fontWeight: 600, marginBottom: 3, wordBreak: 'break-word' }}>{e.title}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '1px 8px', fontSize: 10, color: '#777' }}>{e.category}</span>
                    <span style={{ fontSize: 11, color: '#666' }}>{fmtDate(e.expense_date)}</span>
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#ef4444', letterSpacing: -0.3, whiteSpace: 'nowrap' }}>{fmt(e.amount)}</div>
              </div>
              {e.note && <div style={{ fontSize: 12, color: '#666', marginTop: 4, fontStyle: 'italic' }}>{e.note}</div>}
              {canPersonalEdit && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #1a1a1a', textAlign: 'right' }}>
                  <button onClick={() => del(e.id)} style={{ background: '#2a1a1a', border: '1px solid #ef444455', color: '#ef4444', cursor: 'pointer', fontSize: 11, padding: '5px 12px', borderRadius: 6, fontFamily: 'inherit', fontWeight: 600 }}>🗑 Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={S.section}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Date', 'Title', 'Category', 'Amount', 'Note', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {expenses.length === 0 && <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#333' }}>No personal expenses recorded</td></tr>}
              {expenses.map(e => (
                <tr key={e.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={S.td}>{fmtDate(e.expense_date)}</td>
                  <td style={{ ...S.td, color: '#ccc', fontWeight: 500 }}>{e.title}</td>
                  <td style={S.td}>
                    <span style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#666' }}>{e.category}</span>
                  </td>
                  <td style={{ ...S.td, color: '#ef4444', fontWeight: 700 }}>{fmt(e.amount)}</td>
                  <td style={{ ...S.td, color: '#555' }}>{e.note || '—'}</td>
                  <td style={S.td}>
                    {canPersonalEdit && <button onClick={() => del(e.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16 }}>🗑</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Modal title="💳 Personal Expense" onClose={() => setShowModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={S.label}>Title *</label>
              <input placeholder="e.g. Office rent, Electricity bill" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={S.input} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={S.label}>Amount (Rs.) *</label>
                <input type="number" placeholder="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={S.input} />
              </div>
              <div>
                <label style={S.label}>Date</label>
                <input type="date" value={form.expense_date} onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} style={S.input} />
              </div>
            </div>
            <div>
              <label style={S.label}>Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={S.input}>
                {CATS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Note</label>
              <input placeholder="Additional details..." value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={S.input} />
            </div>
            <button onClick={add} disabled={saving} style={{ ...S.btn, background: '#c9a96e', color: '#000', fontWeight: 700, padding: '11px' }}>
              {saving ? 'Saving...' : 'Save Expense'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ZAKAT TAB
// ════════════════════════════════════════════════════════════════════════════
function ZakatTab() {
  const { can } = useUser();
  const canZakatEdit = can('accounts.zakat_edit');

  const [year, setYear]       = useState('2027-2028');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCalc, setShowCalc] = useState(false);
  const [showDist, setShowDist] = useState(false);
  const [cForm, setCForm]     = useState({ inventory_value: '', cash_in_hand: '', receivables: '', liabilities: '', other_assets: '', other_assets_note: '', nisab_amount: '175000', shaban_date: '', notes: '' });
  const [dForm, setDForm]     = useState({ recipient: '', amount: '', distribution_date: today(), note: '' });
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState('');
  const YEARS = ['2026-2027', '2027-2028', '2028-2029', '2029-2030'];
  const SHABAN = { '2026-2027': '2027-03-03', '2027-2028': '2028-02-21', '2028-2029': '2029-02-10' };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch('/api/accounts/zakat?year=' + year);
    const d = await r.json();
    if (d.success) {
      setData(d);
      if (d.record) {
        setCForm(f => ({
          ...f,
          inventory_value:    d.record.inventory_value    || '',
          cash_in_hand:       d.record.cash_in_hand       || '',
          receivables:        d.record.receivables        || '',
          liabilities:        d.record.liabilities        || '',
          other_assets:       d.record.other_assets       || '',
          other_assets_note:  d.record.other_assets_note  || '',
          nisab_amount:       d.record.nisab_amount       || '175000',
          shaban_date:        d.record.shaban_date        || SHABAN[year] || '',
          notes:              d.record.notes              || '',
        }));
      } else {
        setCForm(f => ({ ...f, shaban_date: SHABAN[year] || '', inventory_value: Math.round(d.inventory_value || 0) }));
      }
    }
    setLoading(false);
  }, [year]);

  useEffect(() => { load(); }, [load]);
  function sm(m) { setMsg(m); setTimeout(() => setMsg(''), 4000); }

  const calcTotal = () => parseFloat(cForm.inventory_value || 0) + parseFloat(cForm.cash_in_hand || 0) + parseFloat(cForm.receivables || 0) + parseFloat(cForm.other_assets || 0) - parseFloat(cForm.liabilities || 0);
  const calcZakat = () => { const t = calcTotal(); return t >= parseFloat(cForm.nisab_amount || 0) ? t * 0.025 : 0; };

  async function saveCalc() {
    setSaving(true);
    const r = await fetch('/api/accounts/zakat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_calculation', year, ...cForm }) });
    const d = await r.json();
    setSaving(false);
    if (d.success) { sm('✅ Zakat saved: ' + fmt(d.zakat_due)); setShowCalc(false); load(); }
    else sm('❌ ' + d.error);
  }

  async function addDist() {
    if (!dForm.recipient || !dForm.amount) { sm('❌ Recipient and amount are required'); return; }
    setSaving(true);
    const r = await fetch('/api/accounts/zakat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_distribution', zakat_year: year, ...dForm }) });
    const d = await r.json();
    setSaving(false);
    if (d.success) { sm('✅ Distribution added'); setShowDist(false); setDForm({ recipient: '', amount: '', distribution_date: today(), note: '' }); load(); }
    else sm('❌ ' + d.error);
  }

  async function delDist(id) {
    if (!confirm('Delete this distribution?')) return;
    await fetch('/api/accounts/zakat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_distribution', id }) });
    load();
  }

  const record      = data?.record;
  const distributed = data?.total_distributed || 0;
  const remaining   = data?.remaining || 0;
  const percent     = record ? Math.min(100, (distributed / parseFloat(record.zakat_due || 1)) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={year} onChange={e => setYear(e.target.value)} style={{ ...S.input, width: 'auto', fontWeight: 600, fontSize: 14 }}>
          {YEARS.map(y => <option key={y}>{y}</option>)}
        </select>
        {canZakatEdit && <button onClick={() => setShowCalc(true)} style={S.btn}>🧮 Calculate Zakat</button>}
        {canZakatEdit && record && remaining > 0 && (
          <button onClick={() => setShowDist(true)} style={{ ...S.btn, background: '#1a2a1a', borderColor: '#22c55e44', color: '#22c55e' }}>+ Add Distribution</button>
        )}
      </div>

      {msg && <div style={{ padding: '10px 16px', borderRadius: 8, background: msg.startsWith('✅') ? '#1a2a1a' : '#2a1a1a', color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: 13 }}>{msg}</div>}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#444' }}>Loading...</div>
      ) : (
        <>
          {record ? (
            <div style={{ background: 'rgba(201,169,110,0.05)', border: '1px solid #c9a96e33', borderRadius: 14, padding: 24 }}>
              <div style={{ fontSize: 12, color: '#c9a96e', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
                🌙 Zakat {year} — 15 Sha&apos;ban {record.shaban_date ? fmtDate(record.shaban_date) : ''}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 20 }}>
                {[
                  ['Total Assets',     fmt(record.total_assets), '#c9a96e'],
                  ['Nisab',            fmt(record.nisab_amount), '#888'],
                  ['Zakat Due (2.5%)', fmt(record.zakat_due),    '#c9a96e'],
                  ['Distributed',      fmt(distributed),         '#22c55e'],
                  ['Remaining',        fmt(remaining),           remaining > 0 ? '#ef4444' : '#22c55e'],
                ].map(([l, v, c]) => (
                  <div key={l}>
                    <div style={{ fontSize: 11, color: '#555' }}>{l}</div>
                    <div style={{ fontSize: l === 'Zakat Due (2.5%)' ? 24 : 20, fontWeight: l === 'Zakat Due (2.5%)' ? 800 : 700, color: c }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ background: '#1a1a1a', borderRadius: 100, height: 10, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ height: '100%', width: percent + '%', background: percent >= 100 ? '#22c55e' : '#c9a96e', borderRadius: 100, transition: 'width 0.5s ease' }} />
              </div>
              <div style={{ fontSize: 11, color: '#555' }}>
                {percent.toFixed(1)}% distributed — {remaining > 0 ? fmt(remaining) + ' remaining' : '✅ Full zakat distributed!'}
              </div>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #1e1e1e', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {[
                  ['Inventory',     record.inventory_value],
                  ['Cash',          record.cash_in_hand],
                  ['Receivables',   record.receivables],
                  ['Other Assets',  record.other_assets],
                  ['Liabilities (-)', record.liabilities],
                ].map(([l, v]) => parseFloat(v) > 0 && (
                  <div key={l}>
                    <span style={{ fontSize: 11, color: '#555' }}>{l}: </span>
                    <span style={{ fontSize: 13, color: '#888' }}>{fmt(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ ...S.card, textAlign: 'center', padding: 40, color: '#555' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🌙</div>
              <div style={{ fontSize: 14, marginBottom: 8 }}>Zakat not calculated yet</div>
              <div style={{ fontSize: 12, color: '#444' }}>Click &ldquo;Calculate Zakat&rdquo; above to begin</div>
            </div>
          )}

          {record && (
            <div style={S.section}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#888' }}>🤲 Distribution History</span>
                <span style={{ fontSize: 12, color: '#444' }}>{data?.distributions?.length || 0} entries</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Date', 'Recipient', 'Amount', 'Note', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {!data?.distributions?.length && <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#333' }}>No distributions yet</td></tr>}
                  {data?.distributions?.map(d => (
                    <tr key={d.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={S.td}>{fmtDate(d.distribution_date)}</td>
                      <td style={{ ...S.td, color: '#ccc', fontWeight: 500 }}>{d.recipient}</td>
                      <td style={{ ...S.td, color: '#c9a96e', fontWeight: 700 }}>{fmt(d.amount)}</td>
                      <td style={{ ...S.td, color: '#555' }}>{d.note || '—'}</td>
                      <td style={S.td}>
                        {canZakatEdit && <button onClick={() => delDist(d.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16 }}>🗑</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showCalc && (
        <Modal title="🧮 Zakat Calculator" onClose={() => setShowCalc(false)} width={560}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#1a1a1a', border: '1px solid #c9a96e33', borderRadius: 8, padding: 14, fontSize: 12, color: '#888' }}>
              📌 Zakat = (Total Assets − Liabilities) × 2.5% &nbsp;|&nbsp; Nisab ≈ Rs. 175,000 (52.5 tola silver, 2026)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={S.label}>15 Sha&apos;ban Date</label>
                <input type="date" value={cForm.shaban_date} onChange={e => setCForm(f => ({ ...f, shaban_date: e.target.value }))} style={S.input} />
              </div>
              <div>
                <label style={S.label}>Nisab (Rs.)</label>
                <input type="number" value={cForm.nisab_amount} onChange={e => setCForm(f => ({ ...f, nisab_amount: e.target.value }))} style={S.input} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', borderTop: '1px solid #1e1e1e', paddingTop: 14 }}>Assets</div>
            <div>
              <label style={S.label}>📦 Inventory Value (Rs.)</label>
              <input type="number" value={cForm.inventory_value} onChange={e => setCForm(f => ({ ...f, inventory_value: e.target.value }))} style={S.input} placeholder="Auto-filled from inventory" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={S.label}>💵 Cash in Hand / Bank</label>
                <input type="number" value={cForm.cash_in_hand} onChange={e => setCForm(f => ({ ...f, cash_in_hand: e.target.value }))} style={S.input} placeholder="0" />
              </div>
              <div>
                <label style={S.label}>📋 Receivables (money owed to you)</label>
                <input type="number" value={cForm.receivables} onChange={e => setCForm(f => ({ ...f, receivables: e.target.value }))} style={S.input} placeholder="0" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={S.label}>➕ Other Assets (gold, etc.)</label>
                <input type="number" value={cForm.other_assets} onChange={e => setCForm(f => ({ ...f, other_assets: e.target.value }))} style={S.input} placeholder="0" />
              </div>
              <div>
                <label style={S.label}>Description</label>
                <input value={cForm.other_assets_note} onChange={e => setCForm(f => ({ ...f, other_assets_note: e.target.value }))} style={S.input} placeholder="What is it..." />
              </div>
            </div>
            <div>
              <label style={S.label}>➖ Liabilities (money you owe)</label>
              <input type="number" value={cForm.liabilities} onChange={e => setCForm(f => ({ ...f, liabilities: e.target.value }))} style={S.input} placeholder="0" />
            </div>
            <div style={{ background: '#1a2a1a', border: '1px solid #22c55e33', borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#555' }}>Total Zakatable Assets:</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#c9a96e' }}>{fmt(calcTotal())}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#555' }}>Zakat Due (2.5%):</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#22c55e' }}>{fmt(calcZakat())}</span>
              </div>
              {calcTotal() < parseFloat(cForm.nisab_amount || 0) && (
                <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>⚠️ Below nisab — zakat is not obligatory</div>
              )}
            </div>
            <div>
              <label style={S.label}>Notes</label>
              <input value={cForm.notes} onChange={e => setCForm(f => ({ ...f, notes: e.target.value }))} style={S.input} placeholder="Additional details..." />
            </div>
            <button onClick={saveCalc} disabled={saving} style={{ ...S.btn, background: '#c9a96e', color: '#000', fontWeight: 700, padding: '11px' }}>
              {saving ? 'Saving...' : '💾 Save Calculation'}
            </button>
          </div>
        </Modal>
      )}

      {showDist && (
        <Modal title="🤲 Zakat Distribution" onClose={() => setShowDist(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ ...S.card, background: '#1a2a1a', borderColor: '#22c55e33' }}>
              <span style={{ fontSize: 12, color: '#555' }}>Remaining: </span>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#22c55e', marginLeft: 8 }}>{fmt(remaining)}</span>
            </div>
            <div>
              <label style={S.label}>Recipient *</label>
              <input placeholder="e.g. Zaid Ahmed, Masjid Fund" value={dForm.recipient} onChange={e => setDForm(f => ({ ...f, recipient: e.target.value }))} style={S.input} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={S.label}>Amount (Rs.) *</label>
                <input type="number" placeholder="0" value={dForm.amount} onChange={e => setDForm(f => ({ ...f, amount: e.target.value }))} style={S.input} />
              </div>
              <div>
                <label style={S.label}>Date</label>
                <input type="date" value={dForm.distribution_date} onChange={e => setDForm(f => ({ ...f, distribution_date: e.target.value }))} style={S.input} />
              </div>
            </div>
            <div>
              <label style={S.label}>Note</label>
              <input placeholder="Additional details..." value={dForm.note} onChange={e => setDForm(f => ({ ...f, note: e.target.value }))} style={S.input} />
            </div>
            <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 12, fontSize: 12, color: '#666' }}>
              ⚠️ Distribution cannot exceed the remaining amount
            </div>
            <button onClick={addDist} disabled={saving} style={{ ...S.btn, background: '#c9a96e', color: '#000', fontWeight: 700, padding: '11px' }}>
              {saving ? 'Saving...' : '🤲 Save Distribution'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN — Tab navigation + permission gating
// ════════════════════════════════════════════════════════════════════════════
export default function AccountsPage() {
  const { can } = useUser();

  // Each tab has its own granular view permission. Tabs without perm hide.
  const ALL_TABS = [
    { id: 'dashboard',   label: '📊 Dashboard',   perm: 'accounts.view_revenue' },
    { id: 'settlements', label: '✅ Settlements', perm: 'accounts.settlements_view' },
    { id: 'vendors',     label: '🏭 Vendors',     perm: 'accounts.vendors_view' },
    { id: 'personal',    label: '💳 Personal',    perm: 'accounts.personal_view' },
    { id: 'zakat',       label: '🌙 Zakat',       perm: 'accounts.zakat_view' },
  ];
  const TABS = ALL_TABS.filter(t => can(t.perm));

  const defaultTab = TABS[0]?.id || 'dashboard';
  const [tab, setTab] = useState(defaultTab);

  // No permissions → soft empty state.
  if (TABS.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#888', fontFamily: "'Söhne', 'Helvetica Neue', sans-serif" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, color: '#fff', fontWeight: 600, marginBottom: 8 }}>Permission denied</div>
        <div style={{ fontSize: 13, color: '#666' }}>You don&apos;t have access to any Accounts tabs. Please contact the CEO to grant access.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1300, fontFamily: "'Söhne', 'Helvetica Neue', sans-serif" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#eee', letterSpacing: -0.5, marginBottom: 4 }}>Accounts</div>
        <div style={{ fontSize: 13, color: '#555' }}>Financial dashboard, settlements, vendors &amp; zakat</div>
      </div>

      {/* Scrollable tab bar — no awkward wrap on mobile, no overflow.
          The inner div uses min-content so the buttons sit on one row;
          the outer div hides scrollbar (mostly) while still scrolling. */}
      <div style={{
        marginBottom: 24,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}>
        <div style={{
          display: 'inline-flex',
          gap: 4,
          background: '#111',
          borderRadius: 10,
          padding: 4,
          border: '1px solid #1e1e1e',
          minWidth: 'min-content',
        }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: tab === t.id ? '#1e1e1e' : 'transparent',
                border: `1px solid ${tab === t.id ? '#2a2a2a' : 'transparent'}`,
                borderRadius: 8,
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: 13,
                color: tab === t.id ? '#c9a96e' : '#666',
                fontWeight: tab === t.id ? 600 : 400,
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {tab === 'dashboard'   && <DashboardTab />}
      {tab === 'settlements' && <SettlementsTab />}
      {tab === 'vendors'     && <VendorsTab />}
      {tab === 'personal'    && <PersonalTab />}
      {tab === 'zakat'       && <ZakatTab />}
    </div>
  );
}
