'use client';
import { useState, useEffect, useCallback } from 'react';
import SettlementsTab from './SettlementsTab';

const COURIERS = ['PostEx', 'Kangaroo', 'Leopards'];

const EXPENSE_CATEGORIES = [
  'Packaging', 'Operations', 'Salaries', 'Marketing',
  'Utilities', 'Transport', 'Office', 'Miscellaneous',
];

function fmt(n) {
  if (!n && n !== 0) return '—';
  return 'Rs. ' + parseFloat(n).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}

const inputStyle = {
  width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a',
  borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};
const selectStyle = {
  background: '#111', border: '1px solid #222', borderRadius: 8,
  padding: '8px 12px', color: '#888', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
const btnStyle = {
  background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8,
  padding: '8px 16px', color: '#c9a96e', fontSize: 13, cursor: 'pointer',
  fontFamily: 'inherit', fontWeight: 600, transition: 'all 0.15s',
};
const labelStyle = { display: 'block', fontSize: 11, color: '#555', marginBottom: 6, fontFamily: 'monospace', letterSpacing: 0.5 };
const tdStyle = { padding: '12px 16px', fontSize: 13, color: '#888', verticalAlign: 'middle' };

// ─── STAT CARD ────────────────────────────────────────────────
function StatCard({ label, value, sub, color = '#c9a96e', icon }) {
  return (
    <div style={{
      background: '#111', border: '1px solid #222', borderRadius: 12,
      padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: '#666', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</span>
        {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#555' }}>{sub}</div>}
    </div>
  );
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────
function OverviewTab({ summary, byCourier, loading }) {
  if (loading) return <div style={{ color: '#555', textAlign: 'center', padding: 60 }}>Loading...</div>;
  const s = summary || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        <StatCard label="Total COD" value={fmt(s.total_cod)} icon="💵" />
        <StatCard label="Total Settled" value={fmt(s.total_settled)} color="#4caf79" icon="✅" />
        <StatCard label="Pending Settlement" value={fmt(s.pending_settlement)} color="#e87d44" icon="⏳" />
        <StatCard label="Total Expenses" value={fmt(s.total_expenses)} color="#e84444" icon="💸" />
        <StatCard label="This Month Expenses" value={fmt(s.month_expenses)} color="#e84444" icon="📅" />
        <StatCard label="Net Received" value={fmt(s.net_received)} color="#c9a96e" icon="📈" />
        <StatCard label="Vendor Outstanding" value={fmt(s.vendor_outstanding)} color="#9b7fe8" icon="🏭" />
      </div>
      <div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 12, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>
          Courier Breakdown
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {COURIERS.map(c => {
            const d = byCourier?.[c] || {};
            const pct = d.total ? Math.round((d.settled / d.total) * 100) : 0;
            return (
              <div key={c} style={{ background: '#111', border: '1px solid #222', borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontWeight: 600, color: '#ddd' }}>{c}</span>
                  <span style={{ fontSize: 12, color: '#666' }}>{d.orders || 0} orders</span>
                </div>
                <div style={{ background: '#1e1e1e', borderRadius: 4, height: 6, marginBottom: 12, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, background: '#4caf79', height: '100%', borderRadius: 4, transition: 'width 0.4s ease' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 2 }}>Total</div>
                    <div style={{ fontSize: 13, color: '#aaa', fontWeight: 600 }}>{d.total ? 'Rs. ' + Math.round(d.total / 1000) + 'K' : '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 2 }}>Settled</div>
                    <div style={{ fontSize: 13, color: '#4caf79', fontWeight: 600 }}>{d.settled ? 'Rs. ' + Math.round(d.settled / 1000) + 'K' : '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 2 }}>Pending</div>
                    <div style={{ fontSize: 13, color: '#e87d44', fontWeight: 600 }}>{d.pending ? 'Rs. ' + Math.round(d.pending / 1000) + 'K' : '—'}</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 10 }}>{pct}% settled</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── EXPENSES TAB ─────────────────────────────────────────────
function ExpensesTab() {
  const [expenses, setExpenses] = useState([]);
  const [byCategory, setByCategory] = useState({});
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', amount: '', category: 'Packaging', expense_date: new Date().toISOString().split('T')[0], note: '', paid_by: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    params.set('limit', '50');
    const res = await fetch(`/api/accounts/expenses?${params}`);
    const d = await res.json();
    setExpenses(d.expenses || []);
    setByCategory(d.by_category || {});
    setLoading(false);
  }, [category]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.title || !form.amount) return;
    setSaving(true);
    await fetch('/api/accounts/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setShowForm(false);
    setForm({ title: '', amount: '', category: 'Packaging', expense_date: new Date().toISOString().split('T')[0], note: '', paid_by: '' });
    load();
  };

  const del = async (id) => {
    if (!confirm('Delete this expense?')) return;
    await fetch(`/api/accounts/expenses?id=${id}`, { method: 'DELETE' });
    load();
  };

  const totalFiltered = expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
          <button key={cat} onClick={() => setCategory(category === cat ? '' : cat)} style={{
            background: category === cat ? '#c9a96e22' : '#111',
            border: `1px solid ${category === cat ? '#c9a96e' : '#222'}`,
            borderRadius: 20, padding: '4px 12px', cursor: 'pointer',
            fontSize: 12, color: category === cat ? '#c9a96e' : '#666',
          }}>
            {cat} · {fmt(amt)}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#666' }}>
          {expenses.length} entries · <span style={{ color: '#e84444' }}>{fmt(totalFiltered)}</span>
        </span>
        <button onClick={() => setShowForm(!showForm)} style={{ ...btnStyle, marginLeft: 'auto' }}>+ Add Expense</button>
      </div>
      {showForm && (
        <div style={{ background: '#111', border: '1px solid #c9a96e33', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, color: '#c9a96e', marginBottom: 16, fontWeight: 600 }}>New Expense</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <div><label style={labelStyle}>Title</label><input placeholder="Packaging bags" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={inputStyle} /></div>
            <div><label style={labelStyle}>Amount (Rs.)</label><input type="number" placeholder="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} style={inputStyle} /></div>
            <div><label style={labelStyle}>Category</label><select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={inputStyle}>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
            <div><label style={labelStyle}>Date</label><input type="date" value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} style={inputStyle} /></div>
            <div><label style={labelStyle}>Paid By</label><input placeholder="Abdul / Sharjeel..." value={form.paid_by} onChange={e => setForm({ ...form, paid_by: e.target.value })} style={inputStyle} /></div>
            <div><label style={labelStyle}>Note</label><input placeholder="Optional" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} style={inputStyle} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={save} disabled={saving} style={{ ...btnStyle, background: '#c9a96e', color: '#000' }}>{saving ? 'Saving...' : 'Save Expense'}</button>
            <button onClick={() => setShowForm(false)} style={{ ...btnStyle, background: '#1e1e1e', color: '#888' }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
              {['Date', 'Title', 'Category', 'Amount', 'Paid By', 'Note', ''].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#444' }}>Loading...</td></tr>
            ) : expenses.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#444' }}>No expenses recorded yet</td></tr>
            ) : expenses.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                <td style={tdStyle}>{fmtDate(e.expense_date)}</td>
                <td style={{ ...tdStyle, color: '#ccc', fontWeight: 500 }}>{e.title}</td>
                <td style={tdStyle}><span style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#888' }}>{e.category}</span></td>
                <td style={{ ...tdStyle, color: '#e84444', fontWeight: 600 }}>{fmt(e.amount)}</td>
                <td style={{ ...tdStyle, fontSize: 12, color: '#666' }}>{e.paid_by || '—'}</td>
                <td style={{ ...tdStyle, fontSize: 12, color: '#555' }}>{e.note || '—'}</td>
                <td style={tdStyle}><button onClick={() => del(e.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16 }}>🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── VENDORS TAB ──────────────────────────────────────────────
function VendorsTab() {
  const [ledger, setLedger] = useState([]);
  const [selected, setSelected] = useState(null);
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ vendor_name: '', amount: '', payment_type: 'purchase', payment_date: new Date().toISOString().split('T')[0], note: '', reference: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/accounts/vendors');
    const d = await res.json();
    setLedger(d.ledger || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadTxns = async (vendor) => {
    setSelected(vendor);
    const res = await fetch(`/api/accounts/vendors?vendor_id=${vendor.id}`);
    const d = await res.json();
    setTxns(d.transactions || []);
  };

  const save = async () => {
    if (!form.amount) return;
    setSaving(true);
    await fetch('/api/accounts/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, vendor_id: selected?.id }),
    });
    setSaving(false);
    setShowForm(false);
    setForm({ vendor_name: '', amount: '', payment_type: 'purchase', payment_date: new Date().toISOString().split('T')[0], note: '', reference: '' });
    load();
    if (selected) loadTxns(selected);
  };

  const totalOutstanding = ledger.reduce((s, v) => s + (v.outstanding || 0), 0);

  return (
    <div style={{ display: 'flex', gap: 20 }}>
      <div style={{ width: 300, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: '#666' }}>Outstanding: <span style={{ color: '#9b7fe8', fontWeight: 700 }}>{fmt(totalOutstanding)}</span></span>
          <button onClick={() => { setSelected(null); setShowForm(true); }} style={{ ...btnStyle, marginLeft: 'auto', fontSize: 11, padding: '4px 10px' }}>+ New Vendor</button>
        </div>
        {loading ? <div style={{ color: '#444', textAlign: 'center', padding: 40 }}>Loading...</div>
          : ledger.length === 0 ? <div style={{ color: '#444', textAlign: 'center', padding: 40 }}>No vendors yet</div>
          : ledger.map(v => (
            <div key={v.id} onClick={() => loadTxns(v)} style={{
              background: selected?.id === v.id ? '#1a1a1a' : '#111',
              border: `1px solid ${selected?.id === v.id ? '#c9a96e44' : '#222'}`,
              borderRadius: 10, padding: '14px 16px', marginBottom: 8, cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontWeight: 600, color: '#ddd', fontSize: 14 }}>{v.name}</span>
                <span style={{ fontSize: 12, color: v.outstanding > 0 ? '#9b7fe8' : '#4caf79', fontWeight: 600 }}>{v.outstanding > 0 ? fmt(v.outstanding) : 'Clear'}</span>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#555' }}>
                <span>Purchases: {fmt(v.total_purchase)}</span>
                <span>Paid: {fmt(v.total_paid)}</span>
              </div>
            </div>
          ))}
      </div>
      <div style={{ flex: 1 }}>
        {!selected && !showForm ? (
          <div style={{ color: '#444', textAlign: 'center', padding: 80 }}>Select a vendor to view ledger</div>
        ) : showForm ? (
          <div style={{ background: '#111', border: '1px solid #c9a96e33', borderRadius: 12, padding: 24 }}>
            <div style={{ fontSize: 14, color: '#c9a96e', marginBottom: 20, fontWeight: 600 }}>{selected ? `Add Transaction — ${selected.name}` : 'New Vendor'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {!selected && <div style={{ gridColumn: '1/-1' }}><label style={labelStyle}>Vendor Name</label><input placeholder="e.g. Ali Zeenat Traders" value={form.vendor_name} onChange={e => setForm({ ...form, vendor_name: e.target.value })} style={inputStyle} /></div>}
              <div><label style={labelStyle}>Type</label><select value={form.payment_type} onChange={e => setForm({ ...form, payment_type: e.target.value })} style={inputStyle}><option value="purchase">Purchase (Debit)</option><option value="payment">Payment (Credit)</option></select></div>
              <div><label style={labelStyle}>Amount (Rs.)</label><input type="number" placeholder="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} style={inputStyle} /></div>
              <div><label style={labelStyle}>Date</label><input type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} style={inputStyle} /></div>
              <div><label style={labelStyle}>Reference</label><input placeholder="Invoice/Challan #" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} style={inputStyle} /></div>
              <div style={{ gridColumn: '1/-1' }}><label style={labelStyle}>Note</label><input placeholder="Optional" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} style={inputStyle} /></div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={save} disabled={saving} style={{ ...btnStyle, background: '#c9a96e', color: '#000' }}>{saving ? 'Saving...' : 'Save'}</button>
              <button onClick={() => setShowForm(false)} style={{ ...btnStyle, background: '#1e1e1e', color: '#888' }}>Cancel</button>
            </div>
          </div>
        ) : selected ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, color: '#ddd', fontSize: 16 }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>Outstanding: <span style={{ color: '#9b7fe8' }}>{fmt(selected.outstanding)}</span></div>
              </div>
              <button onClick={() => setShowForm(true)} style={{ ...btnStyle, marginLeft: 'auto' }}>+ Add Transaction</button>
            </div>
            <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                    {['Date', 'Type', 'Amount', 'Reference', 'Note'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 400 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {txns.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: '#444' }}>No transactions</td></tr>
                  ) : txns.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={tdStyle}>{fmtDate(t.payment_date)}</td>
                      <td style={tdStyle}><span style={{ background: t.payment_type === 'purchase' ? '#3a1e1e' : '#1e3a2e', color: t.payment_type === 'purchase' ? '#e84444' : '#4caf79', padding: '2px 8px', borderRadius: 4, fontSize: 11, textTransform: 'uppercase' }}>{t.payment_type === 'purchase' ? 'Debit' : 'Credit'}</span></td>
                      <td style={{ ...tdStyle, color: t.payment_type === 'purchase' ? '#e84444' : '#4caf79', fontWeight: 600 }}>{t.payment_type === 'purchase' ? '-' : '+'}{fmt(t.amount)}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: '#666' }}>{t.reference || '—'}</td>
                      <td style={{ ...tdStyle, fontSize: 12, color: '#555' }}>{t.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────
export default function AccountsPage() {
  const [tab, setTab] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [byCourier, setByCourier] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(d => { setSummary(d.summary); setByCourier(d.by_courier); setSummaryLoading(false); })
      .catch(() => setSummaryLoading(false));
  }, []);

  const TABS = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'settlements', label: '✅ Settlements' },
    { id: 'expenses', label: '💸 Expenses' },
    { id: 'vendors', label: '🏭 Vendors' },
  ];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, fontFamily: "'Söhne', 'Helvetica Neue', sans-serif" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#eee', letterSpacing: -0.5, marginBottom: 4 }}>Accounts</div>
        <div style={{ fontSize: 13, color: '#555' }}>COD settlements, expenses & vendor ledger</div>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#111', borderRadius: 10, padding: 4, width: 'fit-content', border: '1px solid #1e1e1e' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: tab === t.id ? '#1e1e1e' : 'transparent',
            border: `1px solid ${tab === t.id ? '#2a2a2a' : 'transparent'}`,
            borderRadius: 8, padding: '7px 16px', cursor: 'pointer',
            fontSize: 13, color: tab === t.id ? '#c9a96e' : '#555',
            fontWeight: tab === t.id ? 600 : 400, fontFamily: 'inherit',
          }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab summary={summary} byCourier={byCourier} loading={summaryLoading} />}
      {tab === 'settlements' && <SettlementsTab />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'vendors' && <VendorsTab />}
    </div>
  );
}
