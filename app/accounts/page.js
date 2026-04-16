'use client';
import { useState, useEffect, useCallback } from 'react';
import SettlementsTab from './SettlementsTab';

const S = {
  input: { width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  btn: { background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 16px', color: '#c9a96e', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 },
  label: { display: 'block', fontSize: 11, color: '#555', marginBottom: 6, fontFamily: 'monospace', letterSpacing: 0.5 },
  td: { padding: '12px 16px', fontSize: 13, color: '#888', verticalAlign: 'middle' },
  th: { padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#444', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 400, borderBottom: '1px solid #1e1e1e' },
  card: { background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, padding: '20px 24px' },
  section: { background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, overflow: 'hidden', marginBottom: 20 },
};

function fmt(n) { if (!n && n !== 0) return '—'; return 'Rs. ' + parseFloat(n).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }); }
function today() { return new Date().toISOString().split('T')[0]; }
function thisMonth() { return new Date().toISOString().slice(0, 7); }

function Modal({ title, onClose, children, width = 500 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 14, padding: 28, width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#c9a96e' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 22, cursor: 'pointer' }}>✕</button>
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

// ══════════════════════════════════════════════════════
// DASHBOARD TAB
// ══════════════════════════════════════════════════════
function DashboardTab() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
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
  if (!data) return <div style={{ padding: 40, color: '#ef4444' }}>Data load nahi hua</div>;

  const { orders, settlements, expenses, vendors, pl, inventory } = data;
  const plColor = pl.net >= 0 ? '#22c55e' : '#ef4444';
  const couriers = ['PostEx', 'Leopards', 'Kangaroo'];
  const cColors = { PostEx: '#4caf79', Leopards: '#e87d44', Kangaroo: '#9b7fe8' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...S.input, width: 'auto', fontSize: 14, padding: '8px 14px', fontWeight: 600 }} />
        <button onClick={load} style={{ ...S.btn, padding: '8px 14px' }}>🔄 Refresh</button>
      </div>

      {/* P&L */}
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
                  {[['Orders', co.orders || 0, '#ccc'], ['Delivered', co.delivered || 0, '#22c55e'], ['Revenue', fmt(co.revenue || 0), '#ccc'], ['Settled ↑', fmt(settled), '#22c55e']].map(([l, v, col]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: '#555' }}>{l}</span><span style={{ color: col, fontWeight: l === 'Settled ↑' ? 700 : 400 }}>{v}</span>
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

// ══════════════════════════════════════════════════════
// VENDORS TAB
// ══════════════════════════════════════════════════════
function VendorsTab() {
  const [ledger, setLedger] = useState([]);
  const [totalOut, setTotalOut] = useState(0);
  const [selected, setSelected] = useState(null);
  const [selData, setSelData] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showTxn, setShowTxn] = useState(null);
  const [vForm, setVForm] = useState({ name: '', phone: '', category: 'General', payment_terms: '', contact_person: '' });
  const [tForm, setTForm] = useState({ amount: '', payment_date: today(), due_date: '', item_description: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [modalMsg, setModalMsg] = useState('');

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
  useEffect(() => { if (selected) loadV(selected); }, [selected, loadV]);

  function sm(m) { setMsg(m); setTimeout(() => setMsg(''), 4000); }
  function mm(m) { setModalMsg(m); setTimeout(() => setModalMsg(''), 4000); }

  async function addVendor() {
    if (!vForm.name) { mm('❌ Vendor name required hai'); return; }
    setSaving(true);
    setModalMsg('');
    try {
      const r = await fetch('/api/accounts/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_vendor', ...vForm }) });
      const d = await r.json();
      if (d.success) {
        setShowAdd(false);
        setVForm({ name: '', phone: '', category: 'General', payment_terms: '', contact_person: '' });
        sm('✅ Vendor add ho gaya!');
        load();
      } else {
        mm('❌ ' + (d.error || 'Error hua'));
      }
    } catch (e) {
      mm('❌ Network error: ' + e.message);
    }
    setSaving(false);
  }

  async function addTxn(type) {
    if (!tForm.amount) { mm('❌ Amount required hai'); return; }
    setSaving(true);
    setModalMsg('');
    try {
      const r = await fetch('/api/accounts/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_transaction', vendor_id: selected, payment_type: type, ...tForm }) });
      const d = await r.json();
      if (d.success) {
        setShowTxn(null);
        setTForm({ amount: '', payment_date: today(), due_date: '', item_description: '', note: '' });
        sm('✅ Entry add ho gayi!');
        load(); loadV(selected);
      } else {
        mm('❌ ' + (d.error || 'Error hua'));
      }
    } catch (e) {
      mm('❌ Network error: ' + e.message);
    }
    setSaving(false);
  }

  async function delTxn(id) {
    if (!confirm('Delete karo?')) return;
    await fetch('/api/accounts/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_transaction', id }) });
    load(); loadV(selected);
  }

  function printStatement() {
    if (!selData) return;
    const v = selData.vendor;
    let running = 0;
    const rows = (selData.transactions || []).map(t => {
      const isP = t.payment_type === 'purchase';
      running += isP ? parseFloat(t.amount) : -parseFloat(t.amount);
      return '<tr><td>' + fmtDate(t.payment_date) + '</td><td>' + (t.item_description || t.note || '—') + '</td><td style="color:' + (isP ? '#c00' : '#888') + '">' + (isP ? fmt(t.amount) : '—') + '</td><td style="color:#090">' + (!isP ? fmt(t.amount) : '—') + '</td><td style="font-weight:700;color:' + (running > 0 ? '#c00' : '#090') + '">' + fmt(Math.abs(running)) + ' ' + (running > 0 ? 'DR' : 'CR') + '</td></tr>';
    }).join('');
    const html = '<html><head><title>' + v.name + ' Statement</title><style>body{font-family:Arial;padding:30px;color:#222}table{width:100%;border-collapse:collapse}th,td{padding:8px 12px;border:1px solid #ddd;font-size:13px}th{background:#f5f5f5}</style></head><body><h2>RS ZEVAR — ' + v.name + '</h2><p>Phone: ' + (v.phone || '—') + ' | Terms: ' + (v.payment_terms || '—') + ' | Date: ' + new Date().toLocaleDateString() + '</p><table><thead><tr><th>Date</th><th>Description</th><th>Purchase (Dr)</th><th>Payment (Cr)</th><th>Balance</th></tr></thead><tbody>' + rows + '</tbody></table><p style="text-align:right;font-weight:700;margin-top:20px">Outstanding: ' + fmt(selData.outstanding) + '</p></body></html>';
    const w = window.open('', '_blank'); w.document.write(html); w.document.close(); w.print();
  }

  const selV = ledger.find(v => v.id === selected);

  return (
    <div style={{ display: 'flex', gap: 20 }}>
      <div style={{ width: 280, flexShrink: 0 }}>
        {totalOut > 0 && <div style={{ background: '#2a1a1a', border: '1px solid #ef444433', borderRadius: 10, padding: '12px 16px', marginBottom: 12 }}><div style={{ fontSize: 11, color: '#ef4444', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Total Outstanding</div><div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{fmt(totalOut)}</div></div>}
        <button onClick={() => setShowAdd(true)} style={{ ...S.btn, width: '100%', marginBottom: 10 }}>+ New Vendor</button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ledger.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#333', fontSize: 13 }}>Koi vendor nahi</div>}
          {ledger.map(v => (
            <button key={v.id} onClick={() => setSelected(v.id)} style={{ background: selected === v.id ? '#1e1e1e' : 'transparent', border: '1px solid ' + (selected === v.id ? '#c9a96e44' : '#1e1e1e'), borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ fontSize: 13, color: selected === v.id ? '#c9a96e' : '#ccc', fontWeight: 600 }}>{v.name}</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{v.category}</div>
              {v.outstanding > 0 && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 3, fontWeight: 600 }}>{fmt(v.outstanding)} due</div>}
              {v.outstanding <= 0 && v.transactions > 0 && <div style={{ fontSize: 11, color: '#22c55e', marginTop: 3 }}>✅ Clear</div>}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {!selected ? <div style={{ padding: 60, textAlign: 'center', color: '#333', fontSize: 14 }}>← Vendor select karo</div> : (
          <>
            <div style={{ ...S.card, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#eee' }}>{selV?.name}</div>
                  <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                    {selV?.phone && <span>📞 {selV.phone} &nbsp;</span>}
                    {selV?.payment_terms && <span>⏱ {selV.payment_terms} &nbsp;</span>}
                    {selV?.category && <span style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>{selV.category}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => setShowTxn('purchase')} style={{ ...S.btn, background: '#1a2a1a', borderColor: '#22c55e44', color: '#22c55e', fontSize: 12 }}>+ Maal Aya</button>
                  <button onClick={() => setShowTxn('payment')} style={{ ...S.btn, background: '#2a1a1a', borderColor: '#ef444444', color: '#ef4444', fontSize: 12 }}>+ Payment Di</button>
                  <button onClick={printStatement} style={{ ...S.btn, fontSize: 12 }}>🖨️ Statement</button>
                </div>
              </div>
              {selData && (
                <div style={{ display: 'flex', gap: 24, marginTop: 16, paddingTop: 16, borderTop: '1px solid #1e1e1e' }}>
                  {[['Total Purchased', selData.total_purchase, '#ccc'], ['Total Paid', selData.total_paid, '#22c55e'], ['Outstanding', selData.outstanding, selData.outstanding > 0 ? '#ef4444' : '#22c55e']].map(([l, v, c]) => (
                    <div key={l}><div style={{ fontSize: 11, color: '#555' }}>{l}</div><div style={{ fontSize: 16, fontWeight: 700, color: c }}>{fmt(v)}</div></div>
                  ))}
                </div>
              )}
            </div>
            {msg && <div style={{ padding: '10px 16px', borderRadius: 8, background: msg.startsWith('✅') ? '#1a2a1a' : '#2a1a1a', color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: 13, marginBottom: 12 }}>{msg}</div>}
            <div style={S.section}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Date', 'Type', 'Description', 'Amount', 'Due Date', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {!selData?.transactions?.length && <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#333' }}>Koi transaction nahi</td></tr>}
                  {selData?.transactions?.map(t => {
                    const isP = t.payment_type === 'purchase';
                    return (
                      <tr key={t.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <td style={S.td}>{fmtDate(t.payment_date)}</td>
                        <td style={S.td}><span style={{ background: isP ? '#22c55e22' : '#ef444422', color: isP ? '#22c55e' : '#ef4444', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{isP ? '📦 Maal Aya' : '💸 Payment'}</span></td>
                        <td style={{ ...S.td, color: '#ccc' }}>{t.item_description || t.note || '—'}</td>
                        <td style={{ ...S.td, color: isP ? '#ef4444' : '#22c55e', fontWeight: 700 }}>{fmt(t.amount)}</td>
                        <td style={S.td}>{t.due_date ? <span style={{ color: new Date(t.due_date) < new Date() ? '#ef4444' : '#f59e0b' }}>📅 {fmtDate(t.due_date)}</span> : '—'}</td>
                        <td style={S.td}><button onClick={() => delTxn(t.id)} style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 16 }}>🗑</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showAdd && (
        <Modal title="🏭 New Vendor" onClose={() => setShowAdd(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[['name','Vendor Name *','e.g. Ali Brothers'],['phone','Phone','03xx-xxxxxxx'],['contact_person','Contact Person','Name'],['payment_terms','Payment Terms','e.g. 30 din baad, advance']].map(([k,l,p]) => (
              <div key={k}><label style={S.label}>{l}</label><input placeholder={p} value={vForm[k]||''} onChange={e=>setVForm(f=>({...f,[k]:e.target.value}))} style={S.input}/></div>
            ))}
            <div><label style={S.label}>Category</label><select value={vForm.category} onChange={e=>setVForm(f=>({...f,category:e.target.value}))} style={S.input}>{['General','Jewelry','Packaging','Accessories','Raw Material','Other'].map(c=><option key={c}>{c}</option>)}</select></div>
            {modalMsg && <div style={{padding:'10px 14px',borderRadius:8,background:modalMsg.startsWith('✅')?'#1a2a1a':'#2a1a1a',color:modalMsg.startsWith('✅')?'#22c55e':'#ef4444',fontSize:13}}>{modalMsg}</div>}
            <button onClick={addVendor} disabled={saving} style={{...S.btn,background:'#c9a96e',color:'#000',fontWeight:700}}>{saving?'Saving...':'Add Vendor'}</button>
          </div>
        </Modal>
      )}

      {showTxn && (
        <Modal title={showTxn==='purchase'?'📦 Maal Aya':'💸 Payment Di'} onClose={()=>setShowTxn(null)}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={S.label}>Amount (Rs.) *</label><input type="number" placeholder="0" value={tForm.amount} onChange={e=>setTForm(f=>({...f,amount:e.target.value}))} style={S.input}/></div>
              <div><label style={S.label}>Date</label><input type="date" value={tForm.payment_date} onChange={e=>setTForm(f=>({...f,payment_date:e.target.value}))} style={S.input}/></div>
            </div>
            {showTxn==='purchase'&&<><div><label style={S.label}>Item Description</label><input placeholder="Kya maal aya..." value={tForm.item_description} onChange={e=>setTForm(f=>({...f,item_description:e.target.value}))} style={S.input}/></div><div><label style={S.label}>Payment Due Date</label><input type="date" value={tForm.due_date} onChange={e=>setTForm(f=>({...f,due_date:e.target.value}))} style={S.input}/></div></>}
            <div><label style={S.label}>Reference / Note</label><input placeholder="Invoice no..." value={tForm.note} onChange={e=>setTForm(f=>({...f,note:e.target.value}))} style={S.input}/></div>
            {modalMsg && <div style={{padding:'10px 14px',borderRadius:8,background:modalMsg.startsWith('✅')?'#1a2a1a':'#2a1a1a',color:modalMsg.startsWith('✅')?'#22c55e':'#ef4444',fontSize:13}}>{modalMsg}</div>}
            <button onClick={()=>addTxn(showTxn)} disabled={saving} style={{...S.btn,background:showTxn==='purchase'?'#1a2a1a':'#2a1a1a',borderColor:showTxn==='purchase'?'#22c55e44':'#ef444444',color:showTxn==='purchase'?'#22c55e':'#ef4444'}}>{saving?'Saving...':showTxn==='purchase'?'Save Maal Entry':'Save Payment'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// PERSONAL EXPENSES TAB
// ══════════════════════════════════════════════════════
function PersonalTab() {
  const [expenses,setExpenses]=useState([]);
  const [total,setTotal]=useState(0);
  const [byCategory,setByCategory]=useState({});
  const [month,setMonth]=useState(thisMonth());
  const [showModal,setShowModal]=useState(false);
  const [form,setForm]=useState({title:'',amount:'',category:'Office Rent',expense_date:today(),note:''});
  const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState('');
  const CATS=['Office Rent','Electricity','Internet','Personal Purchase','Food','Travel','Other'];

  const load=useCallback(async()=>{
    const r=await fetch('/api/accounts/personal?month='+month);
    const d=await r.json();
    if(d.success){setExpenses(d.expenses||[]);setTotal(d.total||0);setByCategory(d.by_category||{});}
  },[month]);

  useEffect(()=>{load();},[load]);
  function sm(m){setMsg(m);setTimeout(()=>setMsg(''),3000);}

  async function add(){
    if(!form.title||!form.amount){sm('❌ Title aur amount required');return;}
    setSaving(true);
    const r=await fetch('/api/accounts/personal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add',...form})});
    const d=await r.json();
    setSaving(false);
    if(d.success){sm('✅ Expense add!');setShowModal(false);setForm({title:'',amount:'',category:'Office Rent',expense_date:today(),note:''});load();}
    else sm('❌ '+d.error);
  }

  async function del(id){
    if(!confirm('Delete?'))return;
    await fetch('/api/accounts/personal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',id})});
    load();
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
        <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{...S.input,width:'auto'}}/>
        <div style={{...S.card,padding:'10px 20px',flex:1}}><span style={{fontSize:12,color:'#555'}}>This Month: </span><span style={{fontSize:18,fontWeight:700,color:'#ef4444',marginLeft:8}}>{fmt(total)}</span></div>
        <button onClick={()=>setShowModal(true)} style={{...S.btn,background:'#2a1a1a',borderColor:'#ef444444',color:'#ef4444'}}>+ Add Expense</button>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        {Object.entries(byCategory).map(([cat,amt])=>(
          <span key={cat} style={{background:'#1e1e1e',border:'1px solid #2a2a2a',borderRadius:20,padding:'4px 12px',fontSize:12,color:'#666'}}>{cat}: <span style={{color:'#ef4444'}}>{fmt(amt)}</span></span>
        ))}
      </div>
      {msg&&<div style={{padding:'10px 16px',borderRadius:8,background:msg.startsWith('✅')?'#1a2a1a':'#2a1a1a',color:msg.startsWith('✅')?'#22c55e':'#ef4444',fontSize:13}}>{msg}</div>}
      <div style={S.section}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr>{['Date','Title','Category','Amount','Note',''].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {expenses.length===0&&<tr><td colSpan={6} style={{padding:40,textAlign:'center',color:'#333'}}>Koi personal expense nahi</td></tr>}
            {expenses.map(e=>(
              <tr key={e.id} style={{borderBottom:'1px solid #1a1a1a'}}>
                <td style={S.td}>{fmtDate(e.expense_date)}</td>
                <td style={{...S.td,color:'#ccc',fontWeight:500}}>{e.title}</td>
                <td style={S.td}><span style={{background:'#1e1e1e',border:'1px solid #2a2a2a',borderRadius:4,padding:'2px 8px',fontSize:11,color:'#666'}}>{e.category}</span></td>
                <td style={{...S.td,color:'#ef4444',fontWeight:700}}>{fmt(e.amount)}</td>
                <td style={{...S.td,color:'#555'}}>{e.note||'—'}</td>
                <td style={S.td}><button onClick={()=>del(e.id)} style={{background:'none',border:'none',color:'#333',cursor:'pointer',fontSize:16}}>🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showModal&&(
        <Modal title="💳 Personal Expense" onClose={()=>setShowModal(false)}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div><label style={S.label}>Title *</label><input placeholder="e.g. Office rent, Bijli bill..." value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} style={S.input}/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={S.label}>Amount (Rs.) *</label><input type="number" placeholder="0" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} style={S.input}/></div>
              <div><label style={S.label}>Date</label><input type="date" value={form.expense_date} onChange={e=>setForm(f=>({...f,expense_date:e.target.value}))} style={S.input}/></div>
            </div>
            <div><label style={S.label}>Category</label><select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} style={S.input}>{CATS.map(c=><option key={c}>{c}</option>)}</select></div>
            <div><label style={S.label}>Note</label><input placeholder="Extra detail..." value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))} style={S.input}/></div>
            <button onClick={add} disabled={saving} style={{...S.btn,background:'#c9a96e',color:'#000',fontWeight:700}}>{saving?'Saving...':'Save Expense'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// ZAKAT TAB
// ══════════════════════════════════════════════════════
function ZakatTab() {
  const [year,setYear]=useState('2027-2028');
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [showCalc,setShowCalc]=useState(false);
  const [showDist,setShowDist]=useState(false);
  const [cForm,setCForm]=useState({inventory_value:'',cash_in_hand:'',receivables:'',liabilities:'',other_assets:'',other_assets_note:'',nisab_amount:'175000',shaban_date:'',notes:''});
  const [dForm,setDForm]=useState({recipient:'',amount:'',distribution_date:today(),note:''});
  const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState('');
  const YEARS=['2026-2027','2027-2028','2028-2029','2029-2030'];
  const SHABAN={'2026-2027':'2027-03-03','2027-2028':'2028-02-21','2028-2029':'2029-02-10'};

  const load=useCallback(async()=>{
    setLoading(true);
    const r=await fetch('/api/accounts/zakat?year='+year);
    const d=await r.json();
    if(d.success){
      setData(d);
      if(d.record){setCForm(f=>({...f,inventory_value:d.record.inventory_value||'',cash_in_hand:d.record.cash_in_hand||'',receivables:d.record.receivables||'',liabilities:d.record.liabilities||'',other_assets:d.record.other_assets||'',other_assets_note:d.record.other_assets_note||'',nisab_amount:d.record.nisab_amount||'175000',shaban_date:d.record.shaban_date||SHABAN[year]||'',notes:d.record.notes||''}));}
      else{setCForm(f=>({...f,shaban_date:SHABAN[year]||'',inventory_value:Math.round(d.inventory_value||0)}));}
    }
    setLoading(false);
  },[year]);

  useEffect(()=>{load();},[load]);
  function sm(m){setMsg(m);setTimeout(()=>setMsg(''),4000);}

  const calcTotal=()=>parseFloat(cForm.inventory_value||0)+parseFloat(cForm.cash_in_hand||0)+parseFloat(cForm.receivables||0)+parseFloat(cForm.other_assets||0)-parseFloat(cForm.liabilities||0);
  const calcZakat=()=>{const t=calcTotal();return t>=parseFloat(cForm.nisab_amount||0)?t*0.025:0;};

  async function saveCalc(){
    setSaving(true);
    const r=await fetch('/api/accounts/zakat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save_calculation',year,...cForm})});
    const d=await r.json();
    setSaving(false);
    if(d.success){sm('✅ Zakat: '+fmt(d.zakat_due));setShowCalc(false);load();}
    else sm('❌ '+d.error);
  }

  async function addDist(){
    if(!dForm.recipient||!dForm.amount){sm('❌ Recipient aur amount required');return;}
    setSaving(true);
    const r=await fetch('/api/accounts/zakat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add_distribution',zakat_year:year,...dForm})});
    const d=await r.json();
    setSaving(false);
    if(d.success){sm('✅ Distribution add!');setShowDist(false);setDForm({recipient:'',amount:'',distribution_date:today(),note:''});load();}
    else sm('❌ '+d.error);
  }

  async function delDist(id){
    if(!confirm('Delete?'))return;
    await fetch('/api/accounts/zakat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete_distribution',id})});
    load();
  }

  const record=data?.record;
  const distributed=data?.total_distributed||0;
  const remaining=data?.remaining||0;
  const percent=record?Math.min(100,(distributed/parseFloat(record.zakat_due||1))*100):0;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:20}}>
      <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
        <select value={year} onChange={e=>setYear(e.target.value)} style={{...S.input,width:'auto',fontWeight:600,fontSize:14}}>{YEARS.map(y=><option key={y}>{y}</option>)}</select>
        <button onClick={()=>setShowCalc(true)} style={S.btn}>🧮 Zakat Calculate karo</button>
        {record&&remaining>0&&<button onClick={()=>setShowDist(true)} style={{...S.btn,background:'#1a2a1a',borderColor:'#22c55e44',color:'#22c55e'}}>+ Distribution Add karo</button>}
      </div>

      {msg&&<div style={{padding:'10px 16px',borderRadius:8,background:msg.startsWith('✅')?'#1a2a1a':'#2a1a1a',color:msg.startsWith('✅')?'#22c55e':'#ef4444',fontSize:13}}>{msg}</div>}

      {loading?<div style={{padding:40,textAlign:'center',color:'#444'}}>Loading...</div>:(
        <>
          {record?(
            <div style={{background:'rgba(201,169,110,0.05)',border:'1px solid #c9a96e33',borderRadius:14,padding:24}}>
              <div style={{fontSize:12,color:'#c9a96e',fontFamily:'monospace',letterSpacing:1,textTransform:'uppercase',marginBottom:16}}>🌙 Zakat {year} — 15 Shaban {record.shaban_date?fmtDate(record.shaban_date):''}</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))',gap:16,marginBottom:20}}>
                {[['Total Assets',fmt(record.total_assets),'#c9a96e'],['Nisab',fmt(record.nisab_amount),'#888'],['Zakat Due (2.5%)',fmt(record.zakat_due),'#c9a96e'],['Distributed',fmt(distributed),'#22c55e'],['Remaining',fmt(remaining),remaining>0?'#ef4444':'#22c55e']].map(([l,v,c])=>(
                  <div key={l}><div style={{fontSize:11,color:'#555'}}>{l}</div><div style={{fontSize:l==='Zakat Due (2.5%)'?24:20,fontWeight:l==='Zakat Due (2.5%)'?800:700,color:c}}>{v}</div></div>
                ))}
              </div>
              <div style={{background:'#1a1a1a',borderRadius:100,height:10,overflow:'hidden',marginBottom:6}}>
                <div style={{height:'100%',width:percent+'%',background:percent>=100?'#22c55e':'#c9a96e',borderRadius:100,transition:'width 0.5s ease'}}/>
              </div>
              <div style={{fontSize:11,color:'#555'}}>{percent.toFixed(1)}% distribute — {remaining>0?fmt(remaining)+' baqi':'✅ Poori zakat nikal di!'}</div>
              <div style={{marginTop:16,paddingTop:16,borderTop:'1px solid #1e1e1e',display:'flex',gap:16,flexWrap:'wrap'}}>
                {[['Inventory',record.inventory_value],['Cash',record.cash_in_hand],['Receivables',record.receivables],['Other Assets',record.other_assets],['Liabilities (-)',record.liabilities]].map(([l,v])=>parseFloat(v)>0&&(
                  <div key={l}><span style={{fontSize:11,color:'#555'}}>{l}: </span><span style={{fontSize:13,color:'#888'}}>{fmt(v)}</span></div>
                ))}
              </div>
            </div>
          ):(
            <div style={{...S.card,textAlign:'center',padding:40,color:'#555'}}>
              <div style={{fontSize:32,marginBottom:12}}>🌙</div>
              <div style={{fontSize:14,marginBottom:8}}>Zakat calculate nahi ki abhi tak</div>
              <div style={{fontSize:12,color:'#444'}}>Upar "Zakat Calculate karo" click karo</div>
            </div>
          )}

          {record&&(
            <div style={S.section}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #1e1e1e',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:13,fontWeight:600,color:'#888'}}>🤲 Distribution History</span>
                <span style={{fontSize:12,color:'#444'}}>{data?.distributions?.length||0} entries</span>
              </div>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr>{['Date','Recipient','Amount','Note',''].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {!data?.distributions?.length&&<tr><td colSpan={5} style={{padding:40,textAlign:'center',color:'#333'}}>Koi distribution nahi</td></tr>}
                  {data?.distributions?.map(d=>(
                    <tr key={d.id} style={{borderBottom:'1px solid #1a1a1a'}}>
                      <td style={S.td}>{fmtDate(d.distribution_date)}</td>
                      <td style={{...S.td,color:'#ccc',fontWeight:500}}>{d.recipient}</td>
                      <td style={{...S.td,color:'#c9a96e',fontWeight:700}}>{fmt(d.amount)}</td>
                      <td style={{...S.td,color:'#555'}}>{d.note||'—'}</td>
                      <td style={S.td}><button onClick={()=>delDist(d.id)} style={{background:'none',border:'none',color:'#333',cursor:'pointer',fontSize:16}}>🗑</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showCalc&&(
        <Modal title="🧮 Zakat Calculator" onClose={()=>setShowCalc(false)} width={560}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{background:'#1a1a1a',border:'1px solid #c9a96e33',borderRadius:8,padding:14,fontSize:12,color:'#888'}}>📌 Zakat = (Total Assets - Liabilities) × 2.5% | Nisab ≈ Rs. 1,75,000 (52.5 tola silver 2026)</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={S.label}>15 Shaban Date</label><input type="date" value={cForm.shaban_date} onChange={e=>setCForm(f=>({...f,shaban_date:e.target.value}))} style={S.input}/></div>
              <div><label style={S.label}>Nisab (Rs.)</label><input type="number" value={cForm.nisab_amount} onChange={e=>setCForm(f=>({...f,nisab_amount:e.target.value}))} style={S.input}/></div>
            </div>
            <div style={{fontSize:12,color:'#555',fontFamily:'monospace',textTransform:'uppercase',borderTop:'1px solid #1e1e1e',paddingTop:14}}>Assets</div>
            <div><label style={S.label}>📦 Inventory Value (Rs.)</label><input type="number" value={cForm.inventory_value} onChange={e=>setCForm(f=>({...f,inventory_value:e.target.value}))} style={S.input} placeholder="Auto inventory se..." /></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={S.label}>💵 Cash in Hand / Bank</label><input type="number" value={cForm.cash_in_hand} onChange={e=>setCForm(f=>({...f,cash_in_hand:e.target.value}))} style={S.input} placeholder="0"/></div>
              <div><label style={S.label}>📋 Receivables (Udhari milni hai)</label><input type="number" value={cForm.receivables} onChange={e=>setCForm(f=>({...f,receivables:e.target.value}))} style={S.input} placeholder="0"/></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={S.label}>➕ Other Assets (Gold, etc.)</label><input type="number" value={cForm.other_assets} onChange={e=>setCForm(f=>({...f,other_assets:e.target.value}))} style={S.input} placeholder="0"/></div>
              <div><label style={S.label}>Details</label><input value={cForm.other_assets_note} onChange={e=>setCForm(f=>({...f,other_assets_note:e.target.value}))} style={S.input} placeholder="Kya hai..."/></div>
            </div>
            <div><label style={S.label}>➖ Liabilities (Udhari deni hai)</label><input type="number" value={cForm.liabilities} onChange={e=>setCForm(f=>({...f,liabilities:e.target.value}))} style={S.input} placeholder="0"/></div>
            <div style={{background:'#1a2a1a',border:'1px solid #22c55e33',borderRadius:10,padding:16}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><span style={{fontSize:13,color:'#555'}}>Total Zakatable Assets:</span><span style={{fontSize:14,fontWeight:700,color:'#c9a96e'}}>{fmt(calcTotal())}</span></div>
              <div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:13,color:'#555'}}>Zakat Due (2.5%):</span><span style={{fontSize:20,fontWeight:800,color:'#22c55e'}}>{fmt(calcZakat())}</span></div>
              {calcTotal()<parseFloat(cForm.nisab_amount||0)&&<div style={{fontSize:12,color:'#ef4444',marginTop:8}}>⚠️ Nisab se kam — zakat wajib nahi</div>}
            </div>
            <div><label style={S.label}>Notes</label><input value={cForm.notes} onChange={e=>setCForm(f=>({...f,notes:e.target.value}))} style={S.input} placeholder="Koi detail..."/></div>
            <button onClick={saveCalc} disabled={saving} style={{...S.btn,background:'#c9a96e',color:'#000',fontWeight:700}}>{saving?'Saving...':'💾 Save Calculation'}</button>
          </div>
        </Modal>
      )}

      {showDist&&(
        <Modal title="🤲 Zakat Distribution" onClose={()=>setShowDist(false)}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{...S.card,background:'#1a2a1a',borderColor:'#22c55e33'}}><span style={{fontSize:12,color:'#555'}}>Remaining: </span><span style={{fontSize:18,fontWeight:700,color:'#22c55e',marginLeft:8}}>{fmt(remaining)}</span></div>
            <div><label style={S.label}>Recipient (Jisko di) *</label><input placeholder="e.g. Zaid Ahmed, Masjid Fund..." value={dForm.recipient} onChange={e=>setDForm(f=>({...f,recipient:e.target.value}))} style={S.input}/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={S.label}>Amount (Rs.) *</label><input type="number" placeholder="0" value={dForm.amount} onChange={e=>setDForm(f=>({...f,amount:e.target.value}))} style={S.input}/></div>
              <div><label style={S.label}>Date</label><input type="date" value={dForm.distribution_date} onChange={e=>setDForm(f=>({...f,distribution_date:e.target.value}))} style={S.input}/></div>
            </div>
            <div><label style={S.label}>Note</label><input placeholder="Koi detail..." value={dForm.note} onChange={e=>setDForm(f=>({...f,note:e.target.value}))} style={S.input}/></div>
            <div style={{background:'#1a1a1a',borderRadius:8,padding:12,fontSize:12,color:'#666'}}>⚠️ Limit se zyada distribution nahi hogi</div>
            <button onClick={addDist} disabled={saving} style={{...S.btn,background:'#c9a96e',color:'#000',fontWeight:700}}>{saving?'Saving...':'🤲 Save Distribution'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════
export default function AccountsPage() {
  const [tab,setTab]=useState('dashboard');
  const TABS=[
    {id:'dashboard',label:'📊 Dashboard'},
    {id:'settlements',label:'✅ Settlements'},
    {id:'vendors',label:'🏭 Vendors'},
    {id:'personal',label:'💳 Personal'},
    {id:'zakat',label:'🌙 Zakat'},
  ];
  return (
    <div style={{padding:'24px 32px',maxWidth:1300,fontFamily:"'Söhne', 'Helvetica Neue', sans-serif"}}>
      <div style={{marginBottom:24}}>
        <div style={{fontSize:22,fontWeight:700,color:'#eee',letterSpacing:-0.5,marginBottom:4}}>Accounts</div>
        <div style={{fontSize:13,color:'#555'}}>Financial dashboard, settlements, vendors & zakat</div>
      </div>
      <div style={{display:'flex',gap:4,marginBottom:28,background:'#111',borderRadius:10,padding:4,width:'fit-content',border:'1px solid #1e1e1e',flexWrap:'wrap'}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{background:tab===t.id?'#1e1e1e':'transparent',border:`1px solid ${tab===t.id?'#2a2a2a':'transparent'}`,borderRadius:8,padding:'7px 16px',cursor:'pointer',fontSize:13,color:tab===t.id?'#c9a96e':'#555',fontWeight:tab===t.id?600:400,fontFamily:'inherit'}}>{t.label}</button>
        ))}
      </div>
      {tab==='dashboard'&&<DashboardTab/>}
      {tab==='settlements'&&<SettlementsTab/>}
      {tab==='vendors'&&<VendorsTab/>}
      {tab==='personal'&&<PersonalTab/>}
      {tab==='zakat'&&<ZakatTab/>}
    </div>
  );
}
