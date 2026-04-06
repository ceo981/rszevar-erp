'use client';
import { useState, useEffect, useCallback } from 'react';

const COURIERS = ['PostEx', 'Kangaroo', 'Leopards'];
const STATUSES = ['booked', 'in_transit', 'delivered', 'rto', 'manual'];

const STATUS_CONFIG = {
  booked:     { label: 'Booked',     color: '#c9a96e', bg: '#2a2010' },
  in_transit: { label: 'In Transit', color: '#4a9eff', bg: '#101e3a' },
  delivered:  { label: 'Delivered',  color: '#4caf79', bg: '#0d2a1e' },
  rto:        { label: 'RTO',        color: '#e84444', bg: '#3a1010' },
  manual:     { label: 'Manual',     color: '#888',    bg: '#1e1e1e' },
};

const COURIER_COLOR = {
  PostEx:   { color: '#4caf79', bg: '#0d2a1e' },
  Kangaroo: { color: '#9b7fe8', bg: '#1e0d3a' },
  Leopards: { color: '#e87d44', bg: '#3a1e0d' },
};

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
const btnStyle = {
  background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8,
  padding: '8px 16px', color: '#c9a96e', fontSize: 13, cursor: 'pointer',
  fontFamily: 'inherit', fontWeight: 600,
};
const labelStyle = {
  display: 'block', fontSize: 11, color: '#555', marginBottom: 5,
  fontFamily: 'monospace', letterSpacing: 0.5,
};
const tdStyle = { padding: '11px 14px', fontSize: 13, color: '#888', verticalAlign: 'middle' };

// ── OVERVIEW TAB ──────────────────────────────────────────────
function OverviewTab({ summary, byCourier, loading }) {
  if (loading) return <div style={{ color: '#555', textAlign: 'center', padding: 60 }}>Loading...</div>;
  const s = summary || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 14 }}>
        {[
          { label: 'Total Bookings', value: s.total_bookings || 0, icon: '📦', color: '#ddd' },
          { label: 'Booked Today', value: s.booked_today || 0, icon: '🆕', color: '#c9a96e' },
          { label: 'In Transit', value: s.in_transit || 0, icon: '🚚', color: '#4a9eff' },
          { label: 'Delivered', value: s.delivered || 0, icon: '✅', color: '#4caf79' },
          { label: 'RTO', value: s.rto || 0, icon: '↩️', color: '#e84444' },
          { label: 'RTO Rate', value: (s.rto_rate || 0) + '%', icon: '📊', color: s.rto_rate > 15 ? '#e84444' : '#4caf79' },
        ].map(c => (
          <div key={c.label} style={{ background: '#111', border: '1px solid #222', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>{c.label}</span>
              <span style={{ fontSize: 18 }}>{c.icon}</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Per courier breakdown */}
      <div>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 14, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>Courier Breakdown</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {COURIERS.map(c => {
            const d = byCourier?.[c] || {};
            const deliveryRate = d.total ? Math.round((d.delivered / d.total) * 100) : 0;
            const rtoRate = d.total ? Math.round((d.rto / d.total) * 100) : 0;
            const cc = COURIER_COLOR[c];
            return (
              <div key={c} style={{ background: '#111', border: `1px solid ${cc.color}22`, borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <span style={{ background: cc.bg, color: cc.color, padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>{c}</span>
                  <span style={{ fontSize: 12, color: '#555' }}>{d.total || 0} total</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                  {[
                    { l: 'Booked', v: d.booked || 0, c: '#c9a96e' },
                    { l: 'Transit', v: d.in_transit || 0, c: '#4a9eff' },
                    { l: 'Delivered', v: d.delivered || 0, c: '#4caf79' },
                    { l: 'RTO', v: d.rto || 0, c: '#e84444' },
                  ].map(s => (
                    <div key={s.l}>
                      <div style={{ fontSize: 10, color: '#444', marginBottom: 3 }}>{s.l}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: s.c }}>{s.v}</div>
                    </div>
                  ))}
                </div>
                {/* Progress */}
                <div style={{ background: '#1e1e1e', borderRadius: 4, height: 6, overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: `${deliveryRate}%`, background: '#4caf79', height: '100%' }} />
                  <div style={{ width: `${rtoRate}%`, background: '#e84444', height: '100%' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#444' }}>
                  <span style={{ color: '#4caf79' }}>{deliveryRate}% delivered</span>
                  <span style={{ color: '#e84444' }}>{rtoRate}% RTO</span>
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: '#555' }}>
                  COD: <span style={{ color: '#c9a96e' }}>{d.cod_total ? 'Rs. ' + Math.round(d.cod_total / 1000) + 'K' : '—'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── BOOK NEW SHIPMENT TAB ─────────────────────────────────────
function BookTab({ onBooked }) {
  const [form, setForm] = useState({
    courier_name: 'PostEx',
    order_name: '',
    customer_name: '',
    customer_phone: '',
    city: '',
    address: '',
    cod_amount: '',
    weight: '0.5',
    pieces: '1',
    note: '',
  });
  const [pendingOrders, setPendingOrders] = useState([]);
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // Load pending/confirmed orders to quick-fill
    fetch('/api/orders?status=confirmed&limit=50')
      .then(r => r.json())
      .then(d => setPendingOrders(d.orders || []))
      .catch(() => {});
  }, []);

  const fillFromOrder = (order) => {
    setForm(f => ({
      ...f,
      order_name: order.name || '',
      order_id: order.id || '',
      customer_name: order.customer_name || '',
      customer_phone: order.customer_phone || '',
      city: order.shipping_city || '',
      address: order.shipping_address || '',
      cod_amount: order.total_price || '',
    }));
  };

  const book = async () => {
    if (!form.customer_name || !form.city || !form.cod_amount) {
      setError('Customer name, city aur COD amount required hai');
      return;
    }
    setBooking(true);
    setError('');
    setResult(null);

    const res = await fetch('/api/courier/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setBooking(false);

    if (data.success) {
      setResult(data);
      setForm(f => ({ ...f, order_name: '', customer_name: '', customer_phone: '', city: '', address: '', cod_amount: '', note: '' }));
      onBooked?.();
    } else {
      setError(data.error || 'Booking failed');
    }
  };

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      {/* Form */}
      <div style={{ flex: 1, minWidth: 320 }}>
        <div style={{ background: '#111', border: '1px solid #c9a96e33', borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 14, color: '#c9a96e', fontWeight: 700, marginBottom: 20 }}>📦 New Shipment</div>

          {/* Courier selector */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {COURIERS.map(c => (
              <button key={c} onClick={() => setForm(f => ({ ...f, courier_name: c }))}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                  background: form.courier_name === c ? COURIER_COLOR[c].bg : '#1a1a1a',
                  border: `1px solid ${form.courier_name === c ? COURIER_COLOR[c].color : '#2a2a2a'}`,
                  color: form.courier_name === c ? COURIER_COLOR[c].color : '#555',
                }}>
                {c}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={labelStyle}>Order # (optional)</label>
              <input placeholder="ZEVAR-116925" value={form.order_name} onChange={e => setForm(f => ({ ...f, order_name: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Customer Name *</label>
              <input placeholder="Ahmed Khan" value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Phone *</label>
              <input placeholder="03001234567" value={form.customer_phone} onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>City *</label>
              <input placeholder="Lahore" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>COD Amount *</label>
              <input type="number" placeholder="0" value={form.cod_amount} onChange={e => setForm(f => ({ ...f, cod_amount: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={labelStyle}>Address</label>
              <input placeholder="House #, Street, Area" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Weight (kg)</label>
              <input type="number" step="0.1" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Pieces</label>
              <input type="number" value={form.pieces} onChange={e => setForm(f => ({ ...f, pieces: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={labelStyle}>Note</label>
              <input placeholder="Special instructions..." value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inputStyle} />
            </div>
          </div>

          {error && <div style={{ marginTop: 14, background: '#3a1010', border: '1px solid #e8444433', borderRadius: 8, padding: '10px 14px', color: '#e84444', fontSize: 13 }}>❌ {error}</div>}

          <button onClick={book} disabled={booking}
            style={{ ...btnStyle, marginTop: 16, width: '100%', background: booking ? '#1a1a1a' : '#c9a96e', color: booking ? '#555' : '#000', padding: '11px', fontSize: 14 }}>
            {booking ? '⏳ Booking...' : `🚀 Book with ${form.courier_name}`}
          </button>

          {result && (
            <div style={{ marginTop: 14, background: '#0d2a1e', border: '1px solid #4caf7944', borderRadius: 10, padding: 16 }}>
              <div style={{ color: '#4caf79', fontWeight: 700, marginBottom: 8 }}>✅ Booking Successful!</div>
              {result.tracking_number && <div style={{ fontSize: 13, color: '#aaa' }}>Tracking #: <span style={{ color: '#c9a96e', fontFamily: 'monospace' }}>{result.tracking_number}</span></div>}
              {result.api_error && <div style={{ fontSize: 12, color: '#e87d44', marginTop: 6 }}>⚠️ API note: {result.api_error} — saved as manual booking</div>}
            </div>
          )}
        </div>
      </div>

      {/* Confirmed orders quick fill */}
      {pendingOrders.length > 0 && (
        <div style={{ width: 300, flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>
            Quick Fill — Confirmed Orders
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 500, overflowY: 'auto' }}>
            {pendingOrders.map(o => (
              <div key={o.id} onClick={() => fillFromOrder(o)}
                style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#c9a96e', fontSize: 13, fontWeight: 600 }}>{o.name}</span>
                  <span style={{ color: '#4caf79', fontSize: 12 }}>Rs. {o.total_price}</span>
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>{o.customer_name}</div>
                <div style={{ fontSize: 11, color: '#444' }}>{o.shipping_city}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── BOOKINGS LIST TAB ─────────────────────────────────────────
function BookingsTab({ refreshKey }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [courier, setCourier] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [tracking, setTracking] = useState({ id: null, loading: false, result: null });

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (courier) p.set('courier', courier);
    if (status) p.set('status', status);
    if (search) p.set('search', search);
    p.set('limit', '50');
    const res = await fetch(`/api/courier/bookings?${p}`);
    const d = await res.json();
    setBookings(d.bookings || []);
    setLoading(false);
  }, [courier, status, search]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const trackShipment = async (booking) => {
    if (!booking.tracking_number) return;
    setTracking({ id: booking.id, loading: true, result: null });
    const res = await fetch(`/api/courier/track?tracking=${booking.tracking_number}&courier=${booking.courier_name}&id=${booking.id}`);
    const d = await res.json();
    setTracking({ id: booking.id, loading: false, result: d });
    if (d.success) load();
  };

  const updateStatus = async (id, newStatus) => {
    await fetch('/api/courier/bookings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: newStatus }),
    });
    load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          placeholder="Search order, tracking, customer..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, width: 280 }}
        />
        <select value={courier} onChange={e => setCourier(e.target.value)}
          style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '8px 12px', color: '#888', fontSize: 13, fontFamily: 'inherit' }}>
          <option value="">All Couriers</option>
          {COURIERS.map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}
          style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '8px 12px', color: '#888', fontSize: 13, fontFamily: 'inherit' }}>
          <option value="">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s]?.label}</option>)}
        </select>
        <span style={{ fontSize: 13, color: '#555', alignSelf: 'center', marginLeft: 'auto' }}>{bookings.length} bookings</span>
      </div>

      {/* Table */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
              {['Date', 'Order', 'Courier', 'Tracking', 'Customer', 'City', 'COD', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: '#444' }}>Loading...</td></tr>
            ) : bookings.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: '#444' }}>No bookings found</td></tr>
            ) : bookings.map(b => {
              const sc = STATUS_CONFIG[b.status] || STATUS_CONFIG.manual;
              const cc = COURIER_COLOR[b.courier_name] || {};
              return (
                <tr key={b.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={tdStyle}>{fmtDate(b.created_at)}</td>
                  <td style={{ ...tdStyle, color: '#c9a96e', fontWeight: 600 }}>{b.order_name || '—'}</td>
                  <td style={tdStyle}>
                    <span style={{ background: cc.bg, color: cc.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{b.courier_name}</span>
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: '#666' }}>{b.tracking_number || '—'}</td>
                  <td style={tdStyle}>
                    <div style={{ color: '#ccc', fontSize: 13 }}>{b.customer_name}</div>
                    <div style={{ color: '#555', fontSize: 11 }}>{b.customer_phone}</div>
                  </td>
                  <td style={tdStyle}>{b.city}</td>
                  <td style={{ ...tdStyle, color: '#4caf79', fontWeight: 600 }}>{fmt(b.cod_amount)}</td>
                  <td style={tdStyle}>
                    <span style={{ background: sc.bg, color: sc.color, padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>{sc.label}</span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {b.tracking_number && (
                        <button onClick={() => trackShipment(b)}
                          disabled={tracking.id === b.id && tracking.loading}
                          style={{ background: '#101e3a', border: '1px solid #4a9eff33', borderRadius: 6, padding: '4px 8px', color: '#4a9eff', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {tracking.id === b.id && tracking.loading ? '...' : '📍 Track'}
                        </button>
                      )}
                      <select onChange={e => { if (e.target.value) updateStatus(b.id, e.target.value); }}
                        defaultValue=""
                        style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, padding: '4px 6px', color: '#666', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                        <option value="">Update</option>
                        {STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s]?.label}</option>)}
                      </select>
                    </div>
                    {tracking.id === b.id && tracking.result && (
                      <div style={{ marginTop: 6, fontSize: 11, color: tracking.result.success ? '#4caf79' : '#e84444' }}>
                        {tracking.result.success ? `✅ ${tracking.result.normalized_status}` : `❌ ${tracking.result.error}`}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── RTO TAB ───────────────────────────────────────────────────
function RTOTab() {
  const [rtos, setRtos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/courier/bookings?status=rto&limit=100')
      .then(r => r.json())
      .then(d => { setRtos(d.bookings || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const totalRTOValue = rtos.reduce((s, r) => s + parseFloat(r.cod_amount || 0), 0);

  const byCourier = COURIERS.reduce((acc, c) => {
    acc[c] = rtos.filter(r => r.courier_name === c);
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* RTO Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        <div style={{ background: '#111', border: '1px solid #e8444422', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Total RTOs</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#e84444' }}>{rtos.length}</div>
        </div>
        <div style={{ background: '#111', border: '1px solid #e8444422', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>RTO Value</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#e84444' }}>{fmt(totalRTOValue)}</div>
        </div>
        {COURIERS.map(c => (
          <div key={c} style={{ background: '#111', border: '1px solid #222', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{c} RTOs</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: COURIER_COLOR[c]?.color }}>{byCourier[c]?.length || 0}</div>
          </div>
        ))}
      </div>

      {/* RTO List */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
              {['Date', 'Order', 'Courier', 'Tracking', 'Customer', 'City', 'COD Lost'].map(h => (
                <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#444' }}>Loading...</td></tr>
            ) : rtos.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#444' }}>No RTOs — great job! 🎉</td></tr>
            ) : rtos.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                <td style={tdStyle}>{fmtDate(r.created_at)}</td>
                <td style={{ ...tdStyle, color: '#c9a96e', fontWeight: 600 }}>{r.order_name || '—'}</td>
                <td style={tdStyle}>
                  <span style={{ background: COURIER_COLOR[r.courier_name]?.bg, color: COURIER_COLOR[r.courier_name]?.color, padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>{r.courier_name}</span>
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: '#666' }}>{r.tracking_number || '—'}</td>
                <td style={tdStyle}>{r.customer_name}</td>
                <td style={tdStyle}>{r.city}</td>
                <td style={{ ...tdStyle, color: '#e84444', fontWeight: 600 }}>{fmt(r.cod_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────
export default function CourierPage() {
  const [tab, setTab] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [byCourier, setByCourier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadSummary = useCallback(() => {
    fetch('/api/courier')
      .then(r => r.json())
      .then(d => { setSummary(d.summary); setByCourier(d.by_courier); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary, refreshKey]);

  const TABS = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'book', label: '📦 Book Shipment' },
    { id: 'bookings', label: '📋 All Bookings' },
    { id: 'rto', label: '↩️ RTO' },
  ];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1300, fontFamily: "'Söhne', 'Helvetica Neue', sans-serif" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#eee', letterSpacing: -0.5, marginBottom: 4 }}>Courier Management</div>
        <div style={{ fontSize: 13, color: '#555' }}>PostEx · Kangaroo · Leopards — booking, tracking & RTO</div>
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

      {tab === 'overview'  && <OverviewTab summary={summary} byCourier={byCourier} loading={loading} />}
      {tab === 'book'      && <BookTab onBooked={() => setRefreshKey(k => k + 1)} />}
      {tab === 'bookings'  && <BookingsTab refreshKey={refreshKey} />}
      {tab === 'rto'       && <RTOTab />}
    </div>
  );
}
