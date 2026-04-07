'use client';
import { useState, useEffect, useCallback } from 'react';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';
const fmt = n => `Rs ${Number(n || 0).toLocaleString()}`;

const STATUS_CFG = {
  pending:    { label: 'Pending',    color: '#fb923c', bg: '#fb923c22' },
  processing: { label: 'Processing', color: gold,      bg: gold+'22' },
  delivered:  { label: 'Delivered',  color: '#22c55e', bg: '#22c55e22' },
  cancelled:  { label: 'Cancelled',  color: '#555',    bg: '#55555522' },
};

// ── Buyer Modal ───────────────────────────────────────────────
function BuyerModal({ buyer, onClose, onSave }) {
  const [form, setForm] = useState(buyer || { name: '', business_name: '', phone: '', city: '', discount_pct: '', credit_limit: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async () => {
    if (!form.name) { setMsg('Name zaroori hai'); return; }
    setSaving(true);
    const r = await fetch('/api/wholesale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: buyer?.id ? 'update_buyer' : 'add_buyer', ...form }) });
    const d = await r.json();
    if (d.success) { onSave(); onClose(); }
    else setMsg('Error: ' + d.error);
    setSaving(false);
  };

  const inp = (label, key, type = 'text', placeholder = '') => (
    <div>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>{label}</div>
      <input type={type} value={form[key] || ''} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} placeholder={placeholder}
        style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 12, padding: 28, width: 440, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: gold }}>{buyer?.id ? 'Edit Buyer' : 'Add Wholesale Buyer'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {inp('Contact Name', 'name', 'text', 'Farhan / Owner name')}
            {inp('Business Name', 'business_name', 'text', 'Shop / Company name')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {inp('Phone', 'phone', 'tel', '03XX-XXXXXXX')}
            {inp('City', 'city', 'text', 'Lahore, Karachi...')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {inp('Discount %', 'discount_pct', 'number', '10')}
            {inp('Credit Limit (Rs)', 'credit_limit', 'number', '50000')}
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Notes</div>
            <textarea value={form.notes || ''} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} placeholder="Optional..."
              style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
          </div>
          {msg && <div style={{ color: '#ef4444', fontSize: 12 }}>{msg}</div>}
          <button onClick={save} disabled={saving} style={{ background: gold, color: '#000', border: 'none', borderRadius: 8, padding: '11px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            {saving ? 'Saving...' : buyer?.id ? 'Save Changes' : 'Add Buyer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Order Modal ───────────────────────────────────────────────
function OrderModal({ buyers, onClose, onSave }) {
  const [form, setForm] = useState({ buyer_id: buyers[0]?.id || '', total_amount: '', paid_amount: '0', discount_pct: '', notes: '', order_date: new Date().toISOString().split('T')[0] });
  const [saving, setSaving] = useState(false);

  const selectedBuyer = buyers.find(b => String(b.id) === String(form.buyer_id));

  const save = async () => {
    if (!form.buyer_id || !form.total_amount) return;
    setSaving(true);
    const r = await fetch('/api/wholesale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_order', ...form }) });
    const d = await r.json();
    if (d.success) { onSave(); onClose(); }
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 12, padding: 28, width: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: gold }}>New Wholesale Order</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Buyer</div>
            <select value={form.buyer_id} onChange={e => { const b = buyers.find(b => String(b.id) === e.target.value); setForm(f => ({...f, buyer_id: e.target.value, discount_pct: b?.discount_pct || ''})); }}
              style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit' }}>
              {buyers.map(b => <option key={b.id} value={b.id}>{b.name} — {b.business_name || b.city}</option>)}
            </select>
          </div>
          {selectedBuyer && <div style={{ fontSize: 12, color: '#555', padding: '8px 12px', background: '#1a1a1a', borderRadius: 6 }}>
            Discount: {selectedBuyer.discount_pct}% · Credit Limit: {fmt(selectedBuyer.credit_limit)}
          </div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Total Amount (Rs)</div>
              <input type="number" value={form.total_amount} onChange={e => setForm(f => ({...f, total_amount: e.target.value}))} placeholder="0"
                style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Paid Amount (Rs)</div>
              <input type="number" value={form.paid_amount} onChange={e => setForm(f => ({...f, paid_amount: e.target.value}))} placeholder="0"
                style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Discount %</div>
              <input type="number" value={form.discount_pct} onChange={e => setForm(f => ({...f, discount_pct: e.target.value}))} placeholder="0"
                style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Order Date</div>
              <input type="date" value={form.order_date} onChange={e => setForm(f => ({...f, order_date: e.target.value}))}
                style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13 }} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Notes</div>
            <input type="text" value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Items, details..."
              style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <button onClick={save} disabled={saving} style={{ background: gold, color: '#000', border: 'none', borderRadius: 8, padding: '11px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            {saving ? 'Saving...' : '+ Add Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Wholesale Page ───────────────────────────────────────
export default function WholesalePage() {
  const [tab, setTab] = useState('buyers');
  const [buyers, setBuyers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [showBuyerModal, setShowBuyerModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [editBuyer, setEditBuyer] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [b, o, s] = await Promise.all([
      fetch('/api/wholesale?type=buyers').then(r => r.json()),
      fetch('/api/wholesale?type=orders').then(r => r.json()),
      fetch('/api/wholesale?type=stats').then(r => r.json()),
    ]);
    setBuyers(b.buyers || []);
    setOrders(o.orders || []);
    setStats(s.stats || {});
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteBuyer = async (id) => {
    if (!confirm('Delete this buyer?')) return;
    await fetch('/api/wholesale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_buyer', id }) });
    load();
  };

  const updateOrder = async (id, status, paid_amount) => {
    await fetch('/api/wholesale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_order', id, status, paid_amount }) });
    load();
  };

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff', padding: 24 }}>
      {showBuyerModal && <BuyerModal buyer={editBuyer} onClose={() => { setShowBuyerModal(false); setEditBuyer(null); }} onSave={load} />}
      {showOrderModal && <OrderModal buyers={buyers} onClose={() => setShowOrderModal(false)} onSave={load} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Wholesale</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>Wholesale buyers aur orders manage karo</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setEditBuyer(null); setShowBuyerModal(true); }}
            style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>
            + Add Buyer
          </button>
          <button onClick={() => setShowOrderModal(true)} disabled={buyers.length === 0}
            style={{ background: gold, color: '#000', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: buyers.length === 0 ? 'not-allowed' : 'pointer' }}>
            + New Order
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Buyers', value: buyers.length, color: '#fff' },
          { label: 'Total Orders', value: stats.total_orders || 0, color: '#3b82f6' },
          { label: 'Total Value', value: fmt(stats.total_value), color: gold },
          { label: 'Total Paid', value: fmt(stats.total_paid), color: '#22c55e' },
          { label: 'Pending Payment', value: fmt(stats.pending_payment), color: '#ef4444' },
        ].map(s => (
          <div key={s.label} style={{ background: card, border: `1px solid ${border}`, borderRadius: 9, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#0a0a0a', padding: 4, borderRadius: 9, width: 'fit-content' }}>
        {[['buyers', '👥 Buyers'], ['orders', '📋 Orders']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ background: tab === id ? '#1e1e1e' : 'transparent', border: `1px solid ${tab === id ? '#2a2a2a' : 'transparent'}`, borderRadius: 7, padding: '7px 18px', fontSize: 13, color: tab === id ? gold : '#555', fontWeight: tab === id ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>Loading...</div> : (
        <>
          {/* Buyers Tab */}
          {tab === 'buyers' && (
            buyers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🏪</div>
                <div>Koi wholesale buyer nahi — upar + Add Buyer click karo</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                {buyers.map(b => (
                  <div key={b.id} style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '16px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>{b.name}</div>
                        {b.business_name && <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{b.business_name}</div>}
                      </div>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: b.status === 'active' ? '#22c55e22' : '#55555522', color: b.status === 'active' ? '#22c55e' : '#555' }}>{b.status}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 12 }}>
                      <div><div style={{ color: '#555', marginBottom: 2 }}>Phone</div><div style={{ color: '#888' }}>{b.phone || '—'}</div></div>
                      <div><div style={{ color: '#555', marginBottom: 2 }}>City</div><div style={{ color: '#888' }}>{b.city || '—'}</div></div>
                      <div><div style={{ color: '#555', marginBottom: 2 }}>Discount</div><div style={{ color: gold, fontWeight: 600 }}>{b.discount_pct || 0}%</div></div>
                      <div><div style={{ color: '#555', marginBottom: 2 }}>Credit Limit</div><div style={{ color: '#fff' }}>{fmt(b.credit_limit)}</div></div>
                    </div>
                    {b.notes && <div style={{ fontSize: 11, color: '#555', marginBottom: 10, padding: '6px 10px', background: '#1a1a1a', borderRadius: 6 }}>{b.notes}</div>}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => { setEditBuyer(b); setShowBuyerModal(true); }}
                        style={{ flex: 1, background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✏️ Edit</button>
                      <button onClick={() => deleteBuyer(b.id)}
                        style={{ background: '#1a0000', border: '1px solid #330000', color: '#ef4444', borderRadius: 7, padding: '7px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Orders Tab */}
          {tab === 'orders' && (
            orders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <div>Koi wholesale order nahi — upar + New Order click karo</div>
              </div>
            ) : (
              <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${border}` }}>
                      {['Buyer', 'Date', 'Total', 'Paid', 'Pending', 'Discount', 'Status', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '11px 14px', textAlign: 'left', color: '#555', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', background: '#0a0a0a' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o, i) => {
                      const pending = parseFloat(o.total_amount || 0) - parseFloat(o.paid_amount || 0);
                      const sc = STATUS_CFG[o.status] || STATUS_CFG.pending;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                          <td style={{ padding: '11px 14px' }}>
                            <div style={{ color: '#fff', fontWeight: 500 }}>{o.wholesale_buyers?.name || '—'}</div>
                            <div style={{ fontSize: 11, color: '#555' }}>{o.wholesale_buyers?.city}</div>
                          </td>
                          <td style={{ padding: '11px 14px', color: '#888', fontSize: 12 }}>{o.order_date}</td>
                          <td style={{ padding: '11px 14px', color: gold, fontWeight: 600 }}>{fmt(o.total_amount)}</td>
                          <td style={{ padding: '11px 14px', color: '#22c55e' }}>{fmt(o.paid_amount)}</td>
                          <td style={{ padding: '11px 14px', color: pending > 0 ? '#ef4444' : '#22c55e' }}>{fmt(pending)}</td>
                          <td style={{ padding: '11px 14px', color: '#888' }}>{o.discount_pct || 0}%</td>
                          <td style={{ padding: '11px 14px' }}>
                            <select value={o.status} onChange={e => updateOrder(o.id, e.target.value, o.paid_amount)}
                              style={{ background: sc.bg, border: `1px solid ${sc.color}44`, color: sc.color, borderRadius: 6, padding: '4px 8px', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>
                              {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '11px 14px' }}>
                            <button onClick={() => { const p = prompt('Paid amount update karo:', o.paid_amount); if (p) updateOrder(o.id, o.status, p); }}
                              style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                              💰 Update
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
