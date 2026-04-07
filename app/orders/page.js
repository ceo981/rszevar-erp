'use client';
import { useState, useEffect, useCallback } from 'react';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';

const fmt = n => `Rs ${Number(n || 0).toLocaleString()}`;
const timeAgo = iso => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const STATUS_CONFIG = {
  pending:    { label: 'Pending',    color: '#888',    bg: '#88888822' },
  confirmed:  { label: 'Confirmed',  color: '#3b82f6', bg: '#3b82f622' },
  processing: { label: 'Processing', color: gold,      bg: gold + '22' },
  packed:     { label: 'Packed',     color: '#06b6d4', bg: '#06b6d422' },
  dispatched: { label: 'Dispatched', color: '#a855f7', bg: '#a855f722' },
  in_transit: { label: 'In Transit', color: '#8b5cf6', bg: '#8b5cf622' },
  delivered:  { label: 'Delivered',  color: '#22c55e', bg: '#22c55e22' },
  returned:   { label: 'Returned',   color: '#f59e0b', bg: '#f59e0b22' },
  rto:        { label: 'RTO',        color: '#ef4444', bg: '#ef444422' },
  cancelled:  { label: 'Cancelled',  color: '#ef4444', bg: '#ef444422' },
};

const PAYMENT_CONFIG = {
  unpaid:   { label: 'Unpaid',   color: '#f87171', bg: '#f8717122' },
  paid:     { label: 'Paid',     color: '#22c55e', bg: '#22c55e22' },
  refunded: { label: 'Refunded', color: '#fbbf24', bg: '#fbbf2422' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span style={{ color: cfg.color, background: cfg.bg, padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>
      {cfg.label}
    </span>
  );
}

function PaymentBadge({ payment_status }) {
  const cfg = PAYMENT_CONFIG[payment_status] || PAYMENT_CONFIG.unpaid;
  return (
    <span style={{ color: cfg.color, background: cfg.bg, padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>
      {cfg.label}
    </span>
  );
}

// ─── Order Action Drawer ───────────────────────────────────────
function OrderDrawer({ order, onClose, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('actions');
  const [log, setLog] = useState([]);
  const [dispatchForm, setDispatchForm] = useState({ courier: 'PostEx', notes: '' });
  const [cancelReason, setCancelReason] = useState('');
  const [confirmNotes, setConfirmNotes] = useState('');
  const [showDispatch, setShowDispatch] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  useEffect(() => {
    if (tab === 'log') {
      fetch(`/api/orders/status?order_id=${order.id}`)
        .then(r => r.json())
        .then(d => setLog(d.log || []));
    }
  }, [tab, order.id]);

  const doAction = async (url, body, successMsg) => {
    setLoading(true); setMsg('');
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.success) {
        setMsg(successMsg + (d.warning ? ` ⚠ ${d.warning}` : '') + (d.tracking ? ` | Tracking: ${d.tracking}` : ''));
        onRefresh();
      } else {
        setMsg('❌ ' + d.error);
      }
    } catch (e) { setMsg('❌ ' + e.message); }
    setLoading(false);
  };

  const confirm = () => doAction('/api/orders/confirm', { order_id: order.id, notes: confirmNotes }, '✅ Order confirmed!');
  const dispatch = () => doAction('/api/orders/dispatch', { order_id: order.id, ...dispatchForm }, '✅ Dispatched!');
  const cancel = () => doAction('/api/orders/cancel', { order_id: order.id, reason: cancelReason }, '✅ Order cancelled');
  const setStatus = (status) => doAction('/api/orders/status', { order_id: order.id, status }, `✅ Status → ${status}`);

  const s = order.status;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex' }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.7)' }} />
      {/* Drawer */}
      <div style={{ width: 480, background: '#0f0f0f', borderLeft: `1px solid ${border}`, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: gold }}>{order.order_number || '#' + order.id}</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>{order.customer_name} · {order.city}</div>
            <div style={{ marginTop: 8 }}><StatusBadge status={order.status} /></div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Order Info */}
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${border}`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['COD Amount', fmt(order.total_amount)],
            ['Phone', order.customer_phone || '—'],
            ['Address', order.shipping_address || '—'],
            ['Placed', timeAgo(order.created_at)],
            ['Courier', order.dispatched_courier || '—'],
            ['Tracking', order.tracking_number || '—'],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>{k}</div>
              <div style={{ fontSize: 12, color: '#ccc', marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${border}` }}>
          {['actions', 'log'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '12px', background: 'none', border: 'none',
              color: tab === t ? gold : '#555', fontWeight: tab === t ? 600 : 400,
              fontSize: 13, cursor: 'pointer', borderBottom: tab === t ? `2px solid ${gold}` : '2px solid transparent',
              fontFamily: 'inherit', textTransform: 'capitalize',
            }}>{t === 'actions' ? '⚡ Actions' : '📋 Activity Log'}</button>
          ))}
        </div>

        <div style={{ padding: '20px 24px', flex: 1 }}>
          {tab === 'actions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Confirm */}
              {(s === 'pending' || s === 'processing') && (
                <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#3b82f6', marginBottom: 10 }}>✅ Confirm Order</div>
                  <input value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)}
                    placeholder="Notes (optional)" style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box', marginBottom: 10 }} />
                  <button onClick={confirm} disabled={loading} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                    Confirm Order
                  </button>
                </div>
              )}

              {/* Dispatch */}
              {(s === 'confirmed' || s === 'processing' || s === 'pending') && (
                <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#a855f7', marginBottom: 10 }}>📦 Dispatch Order</div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Select Courier</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['PostEx', 'Leopards', 'Kangaroo'].map(c => (
                        <button key={c} onClick={() => setDispatchForm(f => ({...f, courier: c}))}
                          style={{ flex: 1, padding: '8px', background: dispatchForm.courier === c ? '#a855f722' : '#1a1a1a', border: `1px solid ${dispatchForm.courier === c ? '#a855f7' : border}`, color: dispatchForm.courier === c ? '#a855f7' : '#888', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input value={dispatchForm.notes} onChange={e => setDispatchForm(f => ({...f, notes: e.target.value}))}
                    placeholder="Item description (e.g. Mala Set)" style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box', marginBottom: 10 }} />
                  <button onClick={dispatch} disabled={loading} style={{ background: '#a855f7', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                    Book & Dispatch via {dispatchForm.courier}
                  </button>
                </div>
              )}

              {/* Mark Delivered */}
              {s === 'dispatched' && (
                <button onClick={() => setStatus('delivered')} disabled={loading}
                  style={{ background: '#22c55e22', border: '1px solid #22c55e44', color: '#22c55e', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✅ Mark as Delivered
                </button>
              )}

              {/* Mark RTO */}
              {(s === 'dispatched' || s === 'delivered') && (
                <button onClick={() => setStatus('rto')} disabled={loading}
                  style={{ background: '#ef444422', border: '1px solid #ef444444', color: '#ef4444', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ↩️ Mark as RTO (Returned)
                </button>
              )}

              {/* Cancel */}
              {s !== 'cancelled' && s !== 'delivered' && (
                <div style={{ background: card, border: '1px solid #330000', borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#ef4444', marginBottom: 10 }}>❌ Cancel Order</div>
                  <input value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                    placeholder="Reason for cancellation" style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box', marginBottom: 10 }} />
                  <button onClick={cancel} disabled={loading} style={{ background: '#ef444422', border: '1px solid #ef444444', color: '#ef4444', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: 'inherit' }}>
                    Cancel Order
                  </button>
                </div>
              )}

              {msg && (
                <div style={{ padding: '10px 14px', background: msg.startsWith('✅') ? '#001a0a' : '#1a0000', borderRadius: 8, border: `1px solid ${msg.startsWith('✅') ? '#003300' : '#330000'}`, fontSize: 12, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>
                  {msg}
                </div>
              )}
            </div>
          )}

          {tab === 'log' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {log.length === 0 && <div style={{ color: '#444', fontSize: 13, textAlign: 'center', padding: 30 }}>No activity yet</div>}
              {log.map((l, i) => (
                <div key={i} style={{ background: card, border: `1px solid ${border}`, borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: gold, fontWeight: 600, textTransform: 'capitalize' }}>{l.action?.replace(/_/g, ' ')}</span>
                    <span style={{ fontSize: 11, color: '#444' }}>{timeAgo(l.performed_at)}</span>
                  </div>
                  {l.notes && <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{l.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Orders Page ─────────────────────────────────────────
export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const PER_PAGE = 30;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
      if (search) params.append('search', search);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      const r = await fetch(`/api/orders?${params}`);
      const d = await r.json();
      setOrders(d.orders || []);
      if (d.stats) setStats(d.stats);
    } catch {}
    setLoading(false);
  }, [page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  // Load last sync time on mount
  useEffect(() => {
    fetch('/api/shopify/sync')
      .then(r => r.json())
      .then(d => { if (d.last_synced) setLastSync(d.last_synced); })
      .catch(() => {});
  }, []);

  // Sync from Shopify
  const syncFromShopify = async () => {
    setSyncing(true);
    setSyncMsg({ type: 'info', text: '⟳ Fetching orders from Shopify (can take 30-60 seconds)...' });

    // Safety timeout: if 3 minutes pass, force unlock
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 3 * 60 * 1000);

    try {
      const r = await fetch('/api/shopify/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!r.ok) {
        throw new Error(`Server error ${r.status}`);
      }

      const d = await r.json();

      if (d.success) {
        setSyncMsg({
          type: 'success',
          text: d.synced > 0
            ? `✓ ${d.synced} orders synced from Shopify`
            : '✓ Already up to date — no new orders',
        });
        setLastSync(new Date().toISOString());
        await load(); // Reload orders from DB
      } else {
        setSyncMsg({ type: 'error', text: `✗ ${d.error || 'Sync failed'}` });
      }
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        setSyncMsg({ type: 'error', text: '✗ Sync timed out after 3 minutes. Try again or check Shopify API.' });
      } else {
        setSyncMsg({ type: 'error', text: `✗ ${e.message}` });
      }
    } finally {
      setSyncing(false);
      // Auto-hide after 6 seconds
      setTimeout(() => setSyncMsg(null), 6000);
    }
  };

  // Status counts (from API, global — not just current page)
  const c = stats || {};

  const filtered = orders.filter(o => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (o.shopify_order_name || '').toLowerCase().includes(q) ||
             (o.customer_name || '').toLowerCase().includes(q) ||
             (o.customer_phone || '').includes(q) ||
             (o.city || '').toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff' }}>
      {selected && <OrderDrawer order={selected} onClose={() => setSelected(null)} onRefresh={() => { load(); setSelected(prev => orders.find(o => o.id === prev?.id) || prev); }} />}

      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Orders</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>
            Confirm, dispatch, and manage all orders
            {lastSync && (
              <span style={{ marginLeft: 10, color: '#666' }}>
                · Last sync: {new Date(lastSync).toLocaleString('en-PK', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
              </span>
            )}
          </p>
        </div>
        {syncMsg && (
          <div style={{
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: 12,
            background:
              syncMsg.type === 'success' ? 'rgba(74,222,128,0.12)' :
              syncMsg.type === 'error' ? 'rgba(248,113,113,0.12)' :
              'rgba(96,165,250,0.12)',
            border: `1px solid ${
              syncMsg.type === 'success' ? '#4ade80' :
              syncMsg.type === 'error' ? '#f87171' :
              '#60a5fa'
            }`,
            color:
              syncMsg.type === 'success' ? '#4ade80' :
              syncMsg.type === 'error' ? '#f87171' :
              '#60a5fa',
          }}>
            {syncMsg.text}
          </div>
        )}
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Total', value: c.total || 0, color: '#fff' },
          { label: 'Pending', value: c.pending || 0, color: '#888' },
          { label: 'Confirmed', value: c.confirmed || 0, color: '#3b82f6' },
          { label: 'Dispatched', value: c.dispatched || 0, color: '#a855f7' },
          { label: 'Delivered', value: c.delivered || 0, color: '#22c55e' },
          { label: 'RTO', value: c.rto || 0, color: '#ef4444' },
          { label: 'Paid', value: c.paid || 0, color: '#22c55e' },
          { label: 'Unpaid', value: c.unpaid || 0, color: '#f87171' },
          { label: 'Pending COD', value: fmt(c.total_cod || 0), color: gold },
        ].map(s => (
          <div key={s.label} style={{ background: card, border: `1px solid ${border}`, borderRadius: 9, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search order, customer, phone..." style={{ flex: 1, minWidth: 200, background: card, border: `1px solid ${border}`, color: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13 }} />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          style={{ background: card, border: `1px solid ${border}`, color: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13 }}>
          <option value="all">All Status</option>
          {Object.keys(STATUS_CONFIG).map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
        </select>
        <button onClick={load} style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>⟳ Refresh</button>
        <button
          onClick={syncFromShopify}
          disabled={syncing}
          style={{
            background: syncing ? '#1a1a1a' : 'linear-gradient(135deg, #c9a96e 0%, #b8975d 100%)',
            border: `1px solid ${syncing ? border : '#c9a96e'}`,
            color: syncing ? '#888' : '#000',
            borderRadius: 8,
            padding: '9px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: syncing ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.15s',
          }}
          title="Pull latest orders from Shopify"
        >
          {syncing ? (
            <>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
              Syncing…
            </>
          ) : (
            <>⟱ Sync from Shopify</>
          )}
        </button>
        <style jsx>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>

      {/* Table */}
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${border}` }}>
                {['Order', 'Customer', 'City', 'COD', 'Status', 'Payment', 'Courier', 'Date', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#555', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#444' }}>Loading...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#444' }}>No orders found</td></tr>
              )}
              {filtered.map((order, i) => (
                <tr key={order.id} style={{ borderBottom: `1px solid #1a1a1a`, background: i % 2 === 0 ? 'transparent' : '#0a0a0a' }}
                  onClick={() => setSelected(order)} className="order-row">
                  <td style={{ padding: '12px 16px', color: gold, fontWeight: 600, cursor: 'pointer' }}>
                    {order.order_number || '#' + order.id}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#ccc' }}>{order.customer_name}</td>
                  <td style={{ padding: '12px 16px', color: '#888' }}>{order.city}</td>
                  <td style={{ padding: '12px 16px', color: '#fff', fontWeight: 600 }}>{fmt(order.total_amount)}</td>
                  <td style={{ padding: '12px 16px' }}><StatusBadge status={order.status} /></td>
                  <td style={{ padding: '12px 16px' }}><PaymentBadge payment_status={order.payment_status} /></td>
                  <td style={{ padding: '12px 16px', color: '#666', fontSize: 12 }}>{order.dispatched_courier || '—'}</td>
                  <td style={{ padding: '12px 16px', color: '#555', fontSize: 12 }}>{timeAgo(order.created_at)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <button onClick={e => { e.stopPropagation(); setSelected(order); }}
                      style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: gold, borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Actions →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#555' }}>Showing {filtered.length} orders</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: page === 1 ? '#333' : '#888', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: page === 1 ? 'not-allowed' : 'pointer' }}>← Prev</button>
            <span style={{ fontSize: 12, color: '#555', padding: '5px 10px' }}>Page {page}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={orders.length < PER_PAGE}
              style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: orders.length < PER_PAGE ? '#333' : '#888', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: orders.length < PER_PAGE ? 'not-allowed' : 'pointer' }}>Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
