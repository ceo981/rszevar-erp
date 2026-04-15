'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@/context/UserContext';

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
  attempted:  { label: 'Attempted',  color: '#f97316', bg: '#f9731622' },
  hold:       { label: 'Hold',       color: '#64748b', bg: '#64748b22' },
};

const PAYMENT_CONFIG = {
  unpaid:   { label: 'Unpaid',   color: '#f87171', bg: '#f8717122' },
  paid:     { label: 'Paid',     color: '#22c55e', bg: '#22c55e22' },
  refunded: { label: 'Refunded', color: '#fbbf24', bg: '#fbbf2422' },
};

function DraftOrderModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', customer_address: '', customer_city: '', note: '', source: 'WhatsApp',
  });
  const [items, setItems] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');

  const searchProducts = async (q) => {
    if (!q || q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const r = await fetch(`/api/products?search=${encodeURIComponent(q)}&view=flat&limit=10`);
    const d = await r.json();
    setSearchResults(d.products || []);
    setSearching(false);
  };

  const addItem = (product) => {
    const existing = items.find(i => i.shopify_variant_id === product.shopify_variant_id);
    if (existing) {
      setItems(items.map(i => i.shopify_variant_id === product.shopify_variant_id ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setItems([...items, { ...product, quantity: 1, price: product.selling_price }]);
    }
    setProductSearch('');
    setSearchResults([]);
  };

  const create = async () => {
    if (!form.customer_name || !form.customer_phone) { setMsg('❌ Name aur phone zaroori hai'); return; }
    if (items.length === 0) { setMsg('❌ Kam az kam 1 product add karo'); return; }
    setCreating(true);
    try {
      const r = await fetch('/api/orders/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, line_items: items }),
      });
      const d = await r.json();
      if (d.success) {
        // Shopify draft order directly open karo — wahan se shipping, discount, create order
        const shopifyDraftUrl = `https://rszevar.myshopify.com/admin/draft_orders/${d.draft_order_id}`;
        window.open(shopifyDraftUrl, '_blank');
        onCreated?.();
        onClose();
      } else setMsg('❌ ' + d.error);
    } catch(e) { setMsg('❌ ' + e.message); }
    setCreating(false);
  };

  const inpStyle = { width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 12, padding: 24, width: 540, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#a855f7' }}>+ Draft Order (WhatsApp)</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          {[['Customer Name *', 'customer_name'], ['Phone *', 'customer_phone'], ['City', 'customer_city']].map(([lbl, key]) => (
            <div key={key}>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>{lbl}</div>
              <input value={form[key]} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} style={inpStyle} />
            </div>
          ))}
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Source</div>
            <select value={form.source} onChange={e => setForm(f => ({...f, source: e.target.value}))} style={inpStyle}>
              {['WhatsApp', 'Facebook', 'Instagram', 'Walk-in', 'Phone Call'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Address</div>
          <input value={form.customer_address} onChange={e => setForm(f => ({...f, customer_address: e.target.value}))} style={inpStyle} />
        </div>

        {/* Product Search */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Products Add Karo</div>
          <div style={{ position: 'relative' }}>
            <input value={productSearch}
              onChange={e => { setProductSearch(e.target.value); searchProducts(e.target.value); }}
              placeholder="SKU ya naam se search karo..."
              style={{ ...inpStyle, borderColor: '#a855f7' }} />
            {(searchResults.length > 0 || searching) && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: `1px solid ${border}`, borderRadius: 7, zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
                {searching ? <div style={{ padding: 10, color: '#555', fontSize: 12 }}>Searching...</div> :
                  searchResults.map(p => (
                    <div key={p.id} onClick={() => addItem(p)}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: `1px solid #222`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#252525'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div>
                        <div style={{ fontSize: 12, color: '#e2e8f0' }}>{p.title}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>{p.sku}</div>
                      </div>
                      <div style={{ color: gold, fontSize: 12, fontWeight: 600 }}>Rs {(p.selling_price || 0).toLocaleString()}</div>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        </div>

        {/* Items list */}
        {items.length > 0 && (
          <div style={{ marginBottom: 12, background: '#111', borderRadius: 8, padding: 10 }}>
            {items.map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < items.length - 1 ? `1px solid #222` : 'none' }}>
                <div style={{ flex: 1, fontSize: 12, color: '#e2e8f0' }}>{item.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="number" min="1" value={item.quantity}
                    onChange={e => setItems(items.map((it, j) => j === i ? {...it, quantity: parseInt(e.target.value) || 1} : it))}
                    style={{ width: 50, background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 5, padding: '4px 8px', fontSize: 12, textAlign: 'center' }} />
                  <div style={{ color: gold, fontSize: 12, width: 80, textAlign: 'right' }}>Rs {((item.price || 0) * item.quantity).toLocaleString()}</div>
                  <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
              </div>
            ))}
            <div style={{ textAlign: 'right', marginTop: 8, fontWeight: 700, color: gold }}>
              Total: Rs {items.reduce((s, i) => s + (i.price || 0) * i.quantity, 0).toLocaleString()}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Note (optional)</div>
          <input value={form.note} onChange={e => setForm(f => ({...f, note: e.target.value}))} placeholder="Customer ne kya kaha..." style={inpStyle} />
        </div>

        {msg && <div style={{ marginBottom: 10, fontSize: 13, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}
        <button onClick={create} disabled={creating}
          style={{ width: '100%', background: '#a855f7', color: '#fff', border: 'none', borderRadius: 8, padding: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          {creating ? 'Creating...' : '🚀 Shopify Draft Order Create Karo'}
        </button>
      </div>
    </div>
  );
}

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

// ─── Filter Dropdown ──────────────────────────────────────────
// Single dropdown with sections. Picks ONE filter at a time.
// Filter object: { type, value } e.g. { type: 'status', value: 'delivered' }
function FilterDropdown({ current, onChange, globalCounts }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const gc = globalCounts || {};

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const sections = [
    {
      label: 'Status',
      items: [
        { type: 'status', value: 'pending',   label: 'Pending',      color: '#888',    count: gc.pending },
        { type: 'status', value: 'confirmed',  label: 'Confirmed',    color: '#3b82f6', count: gc.confirmed },
        { type: 'status', value: 'packed',     label: 'Packed',       color: '#06b6d4', count: gc.packed },
        { type: 'status', value: 'dispatched', label: 'Dispatched',   color: '#a855f7', count: gc.dispatched },
        { type: 'status', value: 'delivered',  label: 'Delivered',    color: '#22c55e', count: gc.delivered },
        { type: 'status', value: 'attempted',  label: '📞 Attempted', color: '#f97316', count: gc.attempted },
        { type: 'status', value: 'hold',       label: '⏸ Hold',      color: '#64748b', count: gc.hold },
        { type: 'status', value: 'rto',        label: 'RTO',          color: '#ef4444', count: gc.rto },
        { type: 'status', value: 'cancelled',  label: 'Cancelled',    color: '#ef4444', count: gc.cancelled },
      ],
    },
    {
      label: 'Type',
      items: [
        { type: 'type', value: 'wholesale', label: '🏢 Wholesale', color: '#8b5cf6', count: gc.wholesale },
        { type: 'type', value: 'international', label: '🌍 International', color: '#06b6d4', count: gc.international },
        { type: 'type', value: 'walkin', label: '🚶 Walk-in', color: '#f59e0b', count: gc.walkin },
      ],
    },
    {
      label: 'Courier',
      items: [
        { type: 'courier', value: 'Leopards', label: '🐆 Leopards', color: '#a855f7', count: gc.leopards },
        { type: 'courier', value: 'PostEx', label: '📦 PostEx', color: '#22d3ee', count: gc.postex },
        { type: 'courier', value: 'Kangaroo', label: '🦘 Kangaroo', color: '#f59e0b', count: gc.kangaroo },
        { type: 'courier', value: 'Other', label: '❓ Other / Unknown', color: '#888' },
      ],
    },
    {
      label: 'Payment',
      items: [
        { type: 'payment', value: 'paid',     label: '💰 Paid',     color: '#22c55e', count: gc.paid },
        { type: 'payment', value: 'unpaid',   label: '⏳ Unpaid',   color: '#f87171', count: gc.unpaid },
        { type: 'payment', value: 'refunded', label: '↩️ Refunded', color: '#fbbf24' },
      ],
    },
  ];

  // Derive display label
  let displayLabel = 'All Orders';
  let displayColor = '#888';
  if (current.type) {
    for (const s of sections) {
      const found = s.items.find(i => i.type === current.type && i.value === current.value);
      if (found) {
        displayLabel = found.label;
        displayColor = found.color;
        break;
      }
    }
  }

  const pick = (item) => {
    onChange({ type: item.type, value: item.value });
    setOpen(false);
  };

  const clear = () => {
    onChange({ type: null, value: null });
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: card,
          border: `1px solid ${current.type ? displayColor : border}`,
          color: current.type ? displayColor : '#fff',
          borderRadius: 8,
          padding: '9px 16px',
          fontSize: 13,
          fontWeight: current.type ? 600 : 400,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 180,
          fontFamily: 'inherit',
        }}
      >
        <span style={{ flex: 1, textAlign: 'left' }}>{displayLabel}</span>
        <span style={{ fontSize: 10, color: '#555' }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          minWidth: 260,
          background: '#0a0a0a',
          border: `1px solid ${border}`,
          borderRadius: 10,
          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          zIndex: 100,
          maxHeight: 480,
          overflowY: 'auto',
        }}>
          {/* All / Clear */}
          <button
            onClick={clear}
            style={{
              width: '100%',
              background: !current.type ? '#1a1a1a' : 'transparent',
              border: 'none',
              color: !current.type ? gold : '#ccc',
              padding: '11px 16px',
              fontSize: 13,
              fontWeight: !current.type ? 600 : 400,
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
              borderBottom: `1px solid ${border}`,
            }}
          >
            {current.type ? '✕ Clear filter' : '✓ All Orders'}
          </button>

          {sections.map(section => (
            <div key={section.label}>
              <div style={{
                padding: '10px 16px 6px',
                fontSize: 10,
                color: '#555',
                textTransform: 'uppercase',
                letterSpacing: 1,
                fontWeight: 600,
                background: '#050505',
              }}>
                {section.label}
              </div>
              {section.items.map(item => {
                const active = current.type === item.type && current.value === item.value;
                return (
                  <button
                    key={`${item.type}-${item.value}`}
                    onClick={() => pick(item)}
                    style={{
                      width: '100%',
                      background: active ? '#1a1a1a' : 'transparent',
                      border: 'none',
                      borderLeft: active ? `3px solid ${item.color}` : '3px solid transparent',
                      color: active ? item.color : '#ccc',
                      padding: '10px 16px',
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#111'; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span>{item.label}</span>
                    {typeof item.count === 'number' && (
                      <span style={{
                        fontSize: 11,
                        color: active ? item.color : '#555',
                        background: active ? item.color + '22' : '#1a1a1a',
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontWeight: 600,
                        minWidth: 24,
                        textAlign: 'center',
                      }}>
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Order Action Drawer ───────────────────────────────────────
function OrderDrawer({ order, onClose, onRefresh, performer }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('actions');
  const [log, setLog] = useState([]);
  const [dispatchForm, setDispatchForm] = useState({ courier: 'PostEx', notes: '' });
  const [showKangarooModal, setShowKangarooModal] = useState(false);
  const [kangarooForm, setKangarooForm] = useState({
    name: order.customer_name || '',
    phone: order.customer_phone || '',
    address: order.customer_address || '',
    city: order.customer_city || 'Karachi',
    amount: order.total_price || order.total_amount || '',
    invoice: order.order_number || '',
    notes: '',
    ordertype: 'COD',
  });
  const [showLeopardsModal, setShowLeopardsModal] = useState(false);
  const [leopardsForm, setLeopardsForm] = useState({
    name: order.customer_name || '',
    phone: order.customer_phone || '',
    address: order.customer_address || '',
    city: order.customer_city || 'Karachi',
    amount: order.total_price || order.total_amount || '',
    notes: '',
    weight: 500,
    pieces: 1,
  });
  const [cancelReason, setCancelReason] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    customer_name: order.customer_name || '',
    customer_phone: order.customer_phone || '',
    customer_address: order.customer_address || '',
    customer_city: order.customer_city || '',
    notes: '',
  });
  const [confirmNotes, setConfirmNotes] = useState('');
  const [packingStaff, setPackingStaff] = useState([]);
  const [assignedTo, setAssignedTo] = useState('');
  const [currentAssignment, setCurrentAssignment] = useState(null);
  // Items: DB order_items agar hain, warna shopify_raw se seedha
  const buildItems = (ord) => {
    if (ord.order_items?.length > 0) {
      return ord.order_items.sort((a, b) => (a.id || 0) - (b.id || 0));
    }
    // Fallback: shopify_raw.line_items (purane orders ke liye)
    return (ord.shopify_raw?.line_items || []).map(item => ({
      title: item.title + (item.variant_title ? ` - ${item.variant_title}` : ''),
      sku: item.sku || null,
      quantity: item.quantity,
      unit_price: parseFloat(item.price) || 0,
      total_price: (parseFloat(item.price) || 0) * item.quantity,
      image_url: item.image?.src || null,
    }));
  };
  const [orderItems, setOrderItems] = useState(() => buildItems(order));
  const [customerOrders, setCustomerOrders] = useState([]);
  const [customerOrdersLoading, setCustomerOrdersLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const loadLog = useCallback(() => {
    fetch(`/api/orders/comment?order_id=${order.id}`)
      .then(r => r.json())
      .then(d => setLog(d.log || []));
  }, [order.id]);

  useEffect(() => {
    if (tab === 'timeline') loadLog();
  }, [tab, loadLog]);

  // Customer ki previous orders load karo (phone se)
  useEffect(() => {
    if (tab === 'customer' && order.customer_phone) {
      setCustomerOrdersLoading(true);
      fetch(`/api/orders?search=${encodeURIComponent(order.customer_phone)}&limit=20`)
        .then(r => r.json())
        .then(d => {
          setCustomerOrders((d.orders || []).filter(o => o.id !== order.id));
          setCustomerOrdersLoading(false);
        })
        .catch(() => setCustomerOrdersLoading(false));
    }
  }, [tab, order.customer_phone, order.id]);

  const submitComment = async () => {
    if (!commentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const r = await fetch('/api/orders/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, comment: commentText }),
      });
      const d = await r.json();
      if (d.success) {
        setCommentText('');
        loadLog();
      }
    } catch(e) { console.error(e); }
    setSubmittingComment(false);
  };

  useEffect(() => {
    // DB se fresh items fetch (images updated ho sakti hain)
    fetch(`/api/orders?action=items&order_id=${order.id}`)
      .then(r => r.json())
      .then(d => { if (d.items?.length > 0) setOrderItems(d.items); })
      .catch(() => {});
  }, [order.id]);

  useEffect(() => {
    // Load packing staff
    fetch('/api/orders/assign')
      .then(r => r.json())
      .then(d => setPackingStaff(d.employees || []));
    // Load current assignment
    fetch(`/api/orders/assign?order_id=${order.id}`)
      .then(r => r.json())
      .then(d => {
        if (d.assignment) {
          setCurrentAssignment(d.assignment);
          setAssignedTo(String(d.assignment.assigned_to));
        }
      });
  }, [order.id]);

  const doAction = async (url, body, successMsg) => {
    setLoading(true); setMsg('');
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, performed_by: performer }),
      });
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

  const confirm = async () => {
    setLoading(true); setMsg('');
    try {
      // Ek hi API call mein confirm + assign dono
      const r = await fetch('/api/orders/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          notes: confirmNotes,
          assigned_to: assignedTo ? parseInt(assignedTo) : null,
          performed_by: performer,
        }),
      });
      const d = await r.json();
      if (d.success) {
        const emp = packingStaff.find(e => String(e.id) === String(assignedTo));
        if (assignedTo && emp) setCurrentAssignment({ assigned_to: parseInt(assignedTo), employee: emp });
        setMsg(`✅ Order confirmed!${d.assigned_name ? ` Assigned to ${d.assigned_name}` : ''}`);
        onRefresh(); // Ek baar refresh, sab kuch update ho jaye ga
      } else {
        setMsg('❌ ' + d.error);
      }
    } catch (e) { setMsg('❌ ' + e.message); }
    setLoading(false);
  };
  const dispatch = () => doAction('/api/orders/dispatch', { order_id: order.id, ...dispatchForm }, '✅ Dispatched!');

  const bookLeopardsNow = async () => {
    setLoading(true);
    setMsg('');
    // Get order items for special instructions
    let itemsText = leopardsForm.notes || '';
    if (!itemsText) {
      try {
        const ir = await fetch(`/api/orders?id=${order.id}&include_items=true`);
        const id = await ir.json();
        if (id.items?.length) {
          itemsText = id.items.map(i => `${i.title}${i.variant_title ? ` (${i.variant_title})` : ''} SKU:${i.sku || ''} x${i.quantity}`).join(', ');
        }
      } catch(e) {}
    }
    try {
      const r = await fetch('/api/orders/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          courier: 'Leopards',
          courier_notes: itemsText || 'Jewelry',
          override_name: leopardsForm.name,
          override_phone: leopardsForm.phone,
          override_address: leopardsForm.address,
          override_city: leopardsForm.city,
          override_amount: leopardsForm.amount,
          override_weight: leopardsForm.weight,
          override_pieces: leopardsForm.pieces,
        }),
      });
      const d = await r.json();
      if (d.success) {
        setMsg(`✅ Leopards booked! Tracking: ${d.tracking || 'Pending'}`);
        setShowLeopardsModal(false);
        setTimeout(() => { onRefresh?.(); onClose(); }, 1500);
      } else {
        setMsg('❌ ' + (d.error || 'Booking failed'));
      }
    } catch (e) {
      setMsg('❌ ' + e.message);
    }
    setLoading(false);
  };

  const bookKangaroo = async () => {
    setLoading(true);
    setMsg('');
    try {
      const r = await fetch('/api/orders/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          courier: 'Kangaroo',
          kangaroo_ordertype: kangarooForm.ordertype || 'COD',
          kangaroo_comment: kangarooForm.notes || '',
          override_name: kangarooForm.name,
          override_phone: kangarooForm.phone,
          override_address: kangarooForm.address,
          override_city: kangarooForm.city,
          override_amount: kangarooForm.amount,
        }),
      });
      const d = await r.json();
      if (d.success) {
        setMsg(`✅ Kangaroo booked! Tracking: ${d.tracking || 'Pending'}`);
        setShowKangarooModal(false);
        setTimeout(() => { onRefresh?.(); onClose(); }, 1500);
      } else {
        setMsg('❌ ' + (d.error || 'Booking failed'));
      }
    } catch (e) {
      setMsg('❌ ' + e.message);
    }
    setLoading(false);
  };
  const cancel = () => doAction('/api/orders/cancel', { order_id: order.id, reason: cancelReason }, '✅ Order cancelled');
  
  const saveEdit = async () => {
    setLoading(true); setMsg('');
    try {
      const r = await fetch('/api/orders/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, ...editForm }),
      });
      const d = await r.json();
      if (d.success) {
        setMsg('✅ Order updated!' + (d.warning ? ` ⚠️ ${d.warning}` : '') + (d.shopify_synced ? ' Shopify sync ✓' : ''));
        setEditMode(false);
        onRefresh();
      } else setMsg('❌ ' + d.error);
    } catch(e) { setMsg('❌ ' + e.message); }
    setLoading(false);
  };
  const setStatus = (status) => doAction('/api/orders/status', { order_id: order.id, status }, `✅ Status → ${status}`);

  const assignOrder = async () => {
    if (!assignedTo) return;
    setLoading(true); setMsg('');
    try {
      const r = await fetch('/api/orders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, assigned_to: parseInt(assignedTo) }),
      });
      const d = await r.json();
      if (d.success) {
        const emp = packingStaff.find(e => String(e.id) === String(assignedTo));
        setCurrentAssignment({ assigned_to: parseInt(assignedTo), employee: emp });
        setMsg(`✅ Assigned to ${emp?.name || 'packer'}!`);
        onRefresh();
      } else { setMsg('❌ ' + d.error); }
    } catch (e) { setMsg('❌ ' + e.message); }
    setLoading(false);
  };

  const markPacked = async () => {
    setLoading(true); setMsg('');
    try {
      const r = await fetch('/api/orders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, action: 'packed' }),
      });
      const d = await r.json();
      if (d.success) {
        setMsg(`✅ Marked as packed! ${d.items_packed} item(s) logged.`);
        onRefresh();
      } else { setMsg('❌ ' + d.error); }
    } catch (e) { setMsg('❌ ' + e.message); }
    setLoading(false);
  };

  const s = order.status;

  // Order type badges
  const typeBadges = [];
  if (order.is_wholesale) typeBadges.push({ label: '🏢 Wholesale', color: '#8b5cf6' });
  if (order.is_international) typeBadges.push({ label: '🌍 International', color: '#06b6d4' });
  if (order.is_walkin) typeBadges.push({ label: '🚶 Walk-in', color: '#f59e0b' });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.7)' }} />
      <div style={{ width: 580, background: '#0f0f0f', borderLeft: `1px solid ${border}`, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: gold }}>{order.order_number || '#' + order.id}</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>{order.customer_name} · {order.customer_city}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <StatusBadge status={order.status} />
              {typeBadges.map(b => (
                <span key={b.label} style={{ color: b.color, background: b.color + '22', padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>
                  {b.label}
                </span>
              ))}
              {Array.isArray(order.tags) && order.tags.filter(t => !['wholesale','international','walkin','kangaroo'].includes(t?.toLowerCase())).map((tag, ti) => (
                <span key={ti} style={{ color: '#9ca3af', background: '#1f1f2e', border: '1px solid #2a2a44', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>{tag}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {order.shopify_order_id && (
              <a href={`https://rszevar.myshopify.com/admin/orders/${order.shopify_order_id}`} target="_blank" rel="noopener noreferrer"
                style={{ background: 'none', border: `1px solid #333`, color: '#555', fontSize: 12, padding: '4px 8px', borderRadius: 5, textDecoration: 'none' }}>
                🔗 Shopify
              </a>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${border}` }}>
          {/* Dual Status Row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, background: '#111', border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>🏢 Office Status</div>
              <StatusBadge status={order.status} />
            </div>
            <div style={{ flex: 1, background: '#111', border: `1px solid #2a1a4a`, borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>🚚 Courier Status</div>
              {order.courier_status_raw
                ? <span style={{ color: '#8b5cf6', background: '#8b5cf611', border: '1px solid #8b5cf633', padding: '3px 10px', borderRadius: 5, fontSize: 12, fontWeight: 600 }}>{order.courier_status_raw}</span>
                : <span style={{ color: '#333', fontSize: 12 }}>Not dispatched yet</span>}
            </div>
          </div>
          {/* Info Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['COD Amount', fmt(order.total_amount)],
              ['Phone', order.customer_phone || '—'],
              ['Placed', timeAgo(order.created_at)],
              ['Payment', order.payment_status || 'unpaid'],
              ['Courier', order.dispatched_courier || '—'],
              ['Tracking', order.tracking_number || '—'],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>{k}</div>
                <div style={{ fontSize: 12, color: '#ccc', marginTop: 2 }}>{v}</div>
              </div>
            ))}
            <div style={{ gridColumn: 'span 2' }}>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>Address</div>
              <div style={{ fontSize: 12, color: '#ccc', marginTop: 2 }}>{order.customer_address || '—'}</div>
            </div>
          </div>
        </div>

        {/* Order Items */}
        {orderItems.length > 0 && (
          <div style={{ padding: '14px 24px', borderBottom: `1px solid ${border}` }}>
            <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>📦 Order Items ({orderItems.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {orderItems.map((item, i) => (
                <div key={i}
                  onClick={() => { onClose(); setTimeout(() => { window.dispatchEvent(new CustomEvent('openInventorySku', { detail: item.sku })); }, 300); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#1a1a1a', borderRadius: 9, padding: '10px 12px', cursor: item.sku ? 'pointer' : 'default', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#252525'}
                  onMouseLeave={e => e.currentTarget.style.background = '#1a1a1a'}
                  title={item.sku ? 'Click to view in Inventory' : ''}
                >
                  {item.image_url ? (
                    <img src={item.image_url} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 7, flexShrink: 0, border: '1px solid #333' }} />
                  ) : (
                    <div style={{ width: 60, height: 60, borderRadius: 7, background: '#c9a96e22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0 }}>💍</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: '#fff', fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
                    {item.sku && <div style={{ fontSize: 11, color: '#c9a96e99', marginTop: 3 }}>SKU: {item.sku} {item.sku ? '↗' : ''}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 15, color: '#c9a96e', fontWeight: 700 }}>x{item.quantity}</div>
                    {item.unit_price && <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>Rs {Number(item.unit_price).toLocaleString()}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', borderBottom: `1px solid ${border}` }}>
          {['actions', 'timeline', 'customer'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '12px', background: 'none', border: 'none',
              color: tab === t ? gold : '#555', fontWeight: tab === t ? 600 : 400,
              fontSize: 12, cursor: 'pointer', borderBottom: tab === t ? `2px solid ${gold}` : '2px solid transparent',
              fontFamily: 'inherit',
            }}>{t === 'actions' ? '⚡ Actions' : t === 'timeline' ? '📋 Timeline' : '👤 Customer'}</button>
          ))}
        </div>

        <div style={{ padding: '20px 24px', flex: 1 }}>
          {tab === 'actions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* ── Edit Order ── */}
              {!editMode ? (
                <button onClick={() => setEditMode(true)}
                  style={{ background: 'transparent', border: `1px solid #f59e0b`, color: '#f59e0b', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  ✏️ Edit Order (Address / Details)
                </button>
              ) : (
                <div style={{ background: card, border: `1px solid #f59e0b`, borderRadius: 10, padding: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#f59e0b', marginBottom: 12 }}>✏️ Edit Order</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    {[
                      ['Customer Name', 'customer_name'],
                      ['Phone', 'customer_phone'],
                      ['City', 'customer_city'],
                    ].map(([lbl, key]) => (
                      <div key={key}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 3 }}>{lbl}</div>
                        <input value={editForm[key]} onChange={e => setEditForm(f => ({...f, [key]: e.target.value}))}
                          style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '7px 10px', fontSize: 12, boxSizing: 'border-box' }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 3 }}>Address</div>
                    <input value={editForm.customer_address} onChange={e => setEditForm(f => ({...f, customer_address: e.target.value}))}
                      style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '7px 10px', fontSize: 12, boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 3 }}>Note (Shopify pe bhi jayega)</div>
                    <input value={editForm.notes} onChange={e => setEditForm(f => ({...f, notes: e.target.value}))}
                      placeholder="Reason for edit..." style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '7px 10px', fontSize: 12, boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={saveEdit} disabled={loading}
                      style={{ flex: 1, background: '#f59e0b', color: '#000', border: 'none', borderRadius: 7, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      💾 Save + Sync Shopify
                    </button>
                    <button onClick={() => setEditMode(false)}
                      style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#555', borderRadius: 7, padding: '9px 14px', fontSize: 12, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {(s === 'pending' || s === 'processing') && (
                <div style={{ background: card, border: `1px solid ${assignedTo ? '#3b82f6' : border}`, borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#3b82f6', marginBottom: 10 }}>✅ Confirm Order</div>
                  <input value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)}
                    placeholder="Notes (optional)" style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box', marginBottom: 10 }} />
                  {/* Assign to packer — REQUIRED */}
                  <div style={{ fontSize: 11, color: assignedTo ? '#f59e0b' : '#ef4444', marginBottom: 5, fontWeight: 600 }}>
                    👤 Packer Assign Karo (required)
                  </div>
                  <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                    style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${assignedTo ? '#f59e0b' : '#ef4444'}`, color: assignedTo ? '#fff' : '#ef4444', borderRadius: 7, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box', marginBottom: 10, fontFamily: 'inherit' }}>
                    <option value="">— Packer select karo —</option>
                    {packingStaff.map(e => (
                      <option key={e.id} value={e.id}>{e.name} ({e.role})</option>
                    ))}
                  </select>
                  {!assignedTo && (
                    <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8 }}>⚠️ Packer assign kiye baghair confirm nahi hoga</div>
                  )}
                  <button onClick={confirm} disabled={loading || !assignedTo}
                    style={{ background: assignedTo ? '#3b82f6' : '#1a1a1a', color: assignedTo ? '#fff' : '#555', border: `1px solid ${assignedTo ? '#3b82f6' : border}`, borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: assignedTo ? 'pointer' : 'not-allowed', width: '100%' }}>
                    {assignedTo ? '✅ Confirm Order' : '🔒 Pehle Packer Select Karo'}
                  </button>
                </div>
              )}

              {/* Assignment section for confirmed orders */}
              {s === 'confirmed' && (
                  <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '16px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#f59e0b', marginBottom: 10 }}>
                      👤 Packing Assignment
                      {currentAssignment?.employee && (
                        <span style={{ fontSize: 11, color: '#22c55e', marginLeft: 8, fontWeight: 400 }}>
                          ✓ {currentAssignment.employee.name}
                        </span>
                      )}
                    </div>
                    <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                      style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: assignedTo ? '#fff' : '#555', borderRadius: 7, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box', marginBottom: 10, fontFamily: 'inherit' }}>
                      <option value="">— Select Packer —</option>
                      {packingStaff.map(e => (
                        <option key={e.id} value={e.id}>{e.name} ({e.role})</option>
                      ))}
                    </select>
                    <button onClick={assignOrder} disabled={loading || !assignedTo}
                      style={{ background: assignedTo ? '#f59e0b22' : '#1a1a1a', border: `1px solid ${assignedTo ? '#f59e0b' : border}`, color: assignedTo ? '#f59e0b' : '#555', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: assignedTo ? 'pointer' : 'default', width: '100%', fontFamily: 'inherit' }}>
                      {currentAssignment ? '🔄 Reassign Packer' : '✅ Assign Packer'}
                    </button>
                  </div>
                )}

                {/* Mark as Packed — confirmed ke baad + dispatched ke baad bhi */}
                {(s === 'confirmed' || s === 'dispatched' || s === 'attempted') && currentAssignment && (
                  <button onClick={markPacked} disabled={loading}
                    style={{ background: '#06b6d422', border: '1px solid #06b6d444', color: '#06b6d4', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                    📦 Mark as Packed (Slip Nikli, Pack Kiya)
                  </button>
                )}

                {/* Attempted — PENDING/CONFIRMED pe (call kiya, nahi utha) */}
                {(s === 'pending' || s === 'confirmed' || s === 'hold') && (
                  <button onClick={() => setStatus('attempted')} disabled={loading}
                    style={{ background: '#f9731622', border: '1px solid #f9731644', color: '#f97316', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                    📞 Attempted (Call Nahi Utha)
                  </button>
                )}

                {/* Hold — koi bhi active status pe */}
                {(s === 'pending' || s === 'confirmed' || s === 'attempted') && (
                  <button onClick={() => setStatus('hold')} disabled={loading}
                    style={{ background: '#64748b22', border: '1px solid #64748b44', color: '#64748b', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                    ⏸ Put on Hold
                  </button>
                )}

                {/* Resume from Hold or Attempted — wapas confirm pe */}
                {(s === 'hold' || s === 'attempted') && (
                  <button onClick={() => setStatus('confirmed')} disabled={loading}
                    style={{ background: '#3b82f622', border: '1px solid #3b82f644', color: '#3b82f6', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                    ▶️ Resume Order (Wapas Confirmed)
                  </button>
                )}

              {(s === 'confirmed' || s === 'processing' || s === 'pending' || s === 'hold') && (
                <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#a855f7', marginBottom: 10 }}>📦 Dispatch Order</div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Via PostEx (auto-book)</div>
                  </div>
                  <input value={dispatchForm.notes} onChange={e => setDispatchForm(f => ({...f, notes: e.target.value}))}
                    placeholder="Item description (e.g. Mala Set)" style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box', marginBottom: 10 }} />
                  <button onClick={() => { setDispatchForm(f => ({...f, courier: 'PostEx'})); dispatch(); }} disabled={loading}
                    style={{ background: '#4caf7922', border: '1px solid #4caf7944', color: '#4caf79', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', marginBottom: 8, fontFamily: 'inherit' }}>
                    🚚 Book via PostEx
                  </button>
                  <button onClick={() => { setLeopardsForm({ name: order.customer_name||'', phone: order.customer_phone||'', address: order.customer_address||'', city: order.customer_city||'Karachi', amount: order.total_price||order.total_amount||'', notes: '', weight: 500, pieces: 1 }); setShowLeopardsModal(true); }} disabled={loading}
                    style={{ background: '#e87d4422', border: '1px solid #e87d4444', color: '#e87d44', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', marginBottom: 8, fontFamily: 'inherit' }}>
                    🐆 Book via Leopards
                  </button>
                  <button onClick={() => { setKangarooForm({ name: order.customer_name||'', phone: order.customer_phone||'', address: order.customer_address||'', city: order.customer_city||'Karachi', amount: order.total_price||order.total_amount||'', invoice: order.order_number||'', notes: '' }); setShowKangarooModal(true); }} disabled={loading}
                    style={{ background: '#f59e0b22', border: '1px solid #f59e0b55', color: '#f59e0b', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: 'inherit' }}>
                    🦘 Book via Kangaroo
                  </button>
                </div>
              )}

              {(s === 'dispatched' || s === 'packed' || s === 'attempted') && (
                <button onClick={() => setStatus('delivered')} disabled={loading}
                  style={{ background: '#22c55e22', border: '1px solid #22c55e44', color: '#22c55e', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                  ✅ Mark as Delivered
                </button>
              )}

              {(s === 'dispatched' || s === 'packed' || s === 'delivered' || s === 'attempted') && (
                <button onClick={() => setStatus('rto')} disabled={loading}
                  style={{ background: '#ef444422', border: '1px solid #ef444444', color: '#ef4444', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                  ↩️ Mark as RTO (Returned)
                </button>
              )}

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

          {tab === 'timeline' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* Comment Input */}
              <div style={{ background: '#111', border: `1px solid ${border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 8, fontWeight: 600 }}>💬 Staff Note / Comment</div>
                <textarea
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitComment(); }}
                  placeholder="Koi note likhein... (Ctrl+Enter to post)"
                  rows={3}
                  style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', outline: 'none' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: '#444' }}>Post karne wale: <span style={{ color: gold }}>{performer || 'Staff'}</span></span>
                  <button
                    onClick={submitComment}
                    disabled={!commentText.trim() || submittingComment}
                    style={{ background: commentText.trim() ? gold : '#1a1a1a', color: commentText.trim() ? '#000' : '#444', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 12, fontWeight: 700, cursor: commentText.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}
                  >
                    {submittingComment ? 'Posting...' : '📨 Post'}
                  </button>
                </div>
              </div>

              {/* Timeline Entries */}
              {log.length === 0 && (
                <div style={{ color: '#333', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
                  Koi activity nahi abhi tak
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {log.map((l, i) => {
                  const isComment = l.action === 'staff_comment';
                  const dateStr = l.performed_at
                    ? new Date(l.performed_at).toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
                    : '';
                  const by = l.performed_by && l.performed_by !== 'Staff' ? l.performed_by : null;

                  if (isComment) {
                    return (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1e293b', border: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, marginTop: 2 }}>💬</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ background: '#0f1f35', border: '1px solid #1e3a5f', borderRadius: '0 10px 10px 10px', padding: '10px 14px' }}>
                            <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{l.notes}</div>
                          </div>
                          <div style={{ fontSize: 10, color: '#3a4a5a', marginTop: 4, paddingLeft: 2 }}>
                            {by && <span style={{ color: gold, fontWeight: 600 }}>{by}</span>}
                            {by && ' · '}{dateStr}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Activity entry styling
                  const actionLabel = (l.action || '').replace(/_/g, ' ');
                  const actionColors = {
                    'confirmed': '#3b82f6',
                    'assigned': '#f59e0b',
                    'packed': '#06b6d4',
                    'status changed to delivered': '#22c55e',
                    'status changed to cancelled': '#ef4444',
                    'status changed to dispatched': '#a855f7',
                    'status changed to confirmed': '#3b82f6',
                    'status changed to returned': '#f59e0b',
                    'status changed to rto': '#ef4444',
                    'status changed to attempted': '#f97316',
                    'status changed to hold': '#64748b',
                    'status changed to packed': '#06b6d4',
                  };
                  const actionColor = actionColors[actionLabel] || gold;
                  const actionEmojis = {
                    'confirmed': '✅',
                    'assigned': '👤',
                    'packed': '📦',
                    'status changed to delivered': '🎉',
                    'status changed to cancelled': '❌',
                    'status changed to dispatched': '🚚',
                    'status changed to attempted': '📞',
                    'status changed to hold': '⏸',
                    'status changed to rto': '↩️',
                    'status changed to packed': '📦',
                  };
                  const emoji = actionEmojis[actionLabel] || '🔹';

                  return (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0' }}>
                      <div style={{ width: 32, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: actionColor + '22', border: `1px solid ${actionColor}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{emoji}</div>
                        {i < log.length - 1 && <div style={{ width: 1, height: 18, background: '#1f1f1f', marginTop: 3 }} />}
                      </div>
                      <div style={{ flex: 1, paddingBottom: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontSize: 12, color: actionColor, fontWeight: 600, textTransform: 'capitalize' }}>{actionLabel}</div>
                          <div style={{ fontSize: 10, color: '#333', flexShrink: 0, marginLeft: 8 }}>{dateStr}</div>
                        </div>
                        {l.notes && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{l.notes}</div>}
                        {by && <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>by <span style={{ color: gold }}>{by}</span></div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'customer' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Customer Info Card */}
              <div style={{ background: '#111', border: `1px solid ${border}`, borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>👤 Customer Info</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    ['Name', order.customer_name || '—'],
                    ['Phone', order.customer_phone || '—'],
                    ['City', order.customer_city || '—'],
                    ['Address', order.customer_address || '—'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ gridColumn: k === 'Address' ? 'span 2' : 'auto' }}>
                      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8 }}>{k}</div>
                      <div style={{ fontSize: 13, color: '#ccc', marginTop: 3 }}>{v}</div>
                    </div>
                  ))}
                </div>
                {/* Tags */}
                {order.tags && Array.isArray(order.tags) && order.tags.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {order.tags.map((tag, ti) => (
                      <span key={ti} style={{ background: '#1f1f1f', border: '1px solid #333', color: '#888', padding: '2px 9px', borderRadius: 5, fontSize: 11 }}>{tag}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Previous Orders */}
              <div>
                <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                  🛒 Purane Orders {!customerOrdersLoading && customerOrders.length > 0 && `(${customerOrders.length})`}
                </div>
                {customerOrdersLoading && <div style={{ color: '#444', fontSize: 13, textAlign: 'center', padding: 20 }}>Loading...</div>}
                {!customerOrdersLoading && customerOrders.length === 0 && (
                  <div style={{ color: '#333', fontSize: 12, textAlign: 'center', padding: 20 }}>Koi purana order nahi mila</div>
                )}
                {!customerOrdersLoading && customerOrders.map(co => {
                  const coStatus = STATUS_CONFIG[co.status] || STATUS_CONFIG.pending;
                  const coDate = co.created_at ? new Date(co.created_at).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
                  return (
                    <div
                      key={co.id}
                      onClick={() => { onClose(); setTimeout(() => window.dispatchEvent(new CustomEvent('openOrder', { detail: co })), 200); }}
                      style={{ background: '#111', border: `1px solid ${border}`, borderRadius: 9, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', transition: 'border-color 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = gold + '66'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = border}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: gold }}>{co.order_number || '#' + co.id}</div>
                        <span style={{ color: coStatus.color, background: coStatus.bg, padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>{coStatus.label}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                        <div style={{ fontSize: 12, color: '#666' }}>{coDate}</div>
                        <div style={{ fontSize: 12, color: '#c9a96e99', fontWeight: 600 }}>Rs {Number(co.total_amount || 0).toLocaleString()}</div>
                      </div>
                      {co.tracking_number && <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>🚚 {co.dispatched_courier || ''} · {co.tracking_number}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Kangaroo Booking Modal ── */}
      {showKangarooModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#111', border: '1px solid #f59e0b44', borderRadius: 14, padding: 28, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b' }}>🦘 Book via Kangaroo</div>
              <button onClick={() => setShowKangarooModal(false)} style={{ background: 'none', border: 'none', color: '#555', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 5, fontFamily: 'monospace', letterSpacing: 0.5 }}>Order Type</div>
                <select value={kangarooForm.ordertype} onChange={e => setKangarooForm(f => ({...f, ordertype: e.target.value}))}
                  style={{ width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}>
                  <option value="COD">COD</option>
                  <option value="Replacement">Replacement</option>
                  <option value="Voucher">Voucher</option>
                  <option value="Cash Refund">Cash Refund</option>
                </select>
              </div>
              {[
                ['Customer Name', 'name', 'text', 'Customer ka naam'],
                ['Phone', 'phone', 'text', '03xx-xxxxxxx'],
                ['City', 'city', 'text', 'Karachi'],
                ['COD Amount (Rs.)', 'amount', 'number', '0'],
                ['Invoice / Order #', 'invoice', 'text', order.order_number || ''],
              ].map(([label, key, type, placeholder]) => (
                <div key={key}>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 5, fontFamily: 'monospace', letterSpacing: 0.5 }}>{label}</div>
                  <input type={type} value={kangarooForm[key]} onChange={e => setKangarooForm(f => ({...f, [key]: e.target.value}))}
                    placeholder={placeholder}
                    style={{ width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 5, fontFamily: 'monospace', letterSpacing: 0.5 }}>Address</div>
                <textarea value={kangarooForm.address} onChange={e => setKangarooForm(f => ({...f, address: e.target.value}))}
                  rows={2} placeholder="Customer ka address"
                  style={{ width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 5, fontFamily: 'monospace', letterSpacing: 0.5 }}>Special Instructions (optional)</div>
                <input value={kangarooForm.notes} onChange={e => setKangarooForm(f => ({...f, notes: e.target.value}))}
                  placeholder="e.g. Earrings Set, handle with care..."
                  style={{ width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              </div>

              {msg && <div style={{ padding: '10px 14px', borderRadius: 8, background: msg.startsWith('✅') ? '#1a2a1a' : '#2a1a1a', color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: 13 }}>{msg}</div>}

              <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 12, fontSize: 12, color: '#666' }}>
                ⚠️ Submit karne se: Kangaroo pe booking hogi → ERP mein dispatched mark hoga → Shopify fulfill hoga tracking ke saath
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={bookKangaroo} disabled={loading}
                  style={{ flex: 1, background: '#f59e0b', color: '#000', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                  {loading ? '⏳ Booking...' : '🦘 Confirm & Book'}
                </button>
                <button onClick={() => setShowKangarooModal(false)}
                  style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8, padding: '10px 16px', color: '#666', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Leopards Booking Modal ── */}
      {showLeopardsModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#111', border: '1px solid #e87d4444', borderRadius: 14, padding: 28, width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#e87d44' }}>🐆 Book via Leopards</div>
              <button onClick={() => setShowLeopardsModal(false)} style={{ background: 'none', border: 'none', color: '#555', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                ['Customer Name', 'name', 'text'],
                ['Phone', 'phone', 'text'],
                ['City', 'city', 'text'],
                ['COD Amount (Rs.)', 'amount', 'number'],
              ].map(([label, key, type]) => (
                <div key={key}>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 5, fontFamily: 'monospace', letterSpacing: 0.5 }}>{label}</div>
                  <input type={type} value={leopardsForm[key]} onChange={e => setLeopardsForm(f => ({...f, [key]: e.target.value}))}
                    style={{ width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 5, fontFamily: 'monospace', letterSpacing: 0.5 }}>Address</div>
                <textarea value={leopardsForm.address} onChange={e => setLeopardsForm(f => ({...f, address: e.target.value}))}
                  rows={2} style={{ width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 5, fontFamily: 'monospace', letterSpacing: 0.5 }}>Weight (grams)</div>
                  <input type="number" value={leopardsForm.weight} onChange={e => setLeopardsForm(f => ({...f, weight: e.target.value}))}
                    style={{ width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 5, fontFamily: 'monospace', letterSpacing: 0.5 }}>Pieces</div>
                  <input type="number" value={leopardsForm.pieces} onChange={e => setLeopardsForm(f => ({...f, pieces: e.target.value}))}
                    style={{ width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 5, fontFamily: 'monospace', letterSpacing: 0.5 }}>Special Instructions (auto order items se bharega)</div>
                <input value={leopardsForm.notes} onChange={e => setLeopardsForm(f => ({...f, notes: e.target.value}))}
                  placeholder="Leave empty for auto order items..."
                  style={{ width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              </div>
              {msg && <div style={{ padding: '10px 14px', borderRadius: 8, background: msg.startsWith('✅') ? '#1a2a1a' : '#2a1a1a', color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: 13 }}>{msg}</div>}
              <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 12, fontSize: 12, color: '#666' }}>
                ⚠️ Submit karne se: Leopards pe booking hogi → ERP dispatched → Shopify fulfilled
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={bookLeopardsNow} disabled={loading}
                  style={{ flex: 1, background: '#e87d44', color: '#000', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                  {loading ? '⏳ Booking...' : '🐆 Confirm & Book'}
                </button>
                <button onClick={() => setShowLeopardsModal(false)}
                  style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8, padding: '10px 16px', color: '#666', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Orders Page ─────────────────────────────────────────
export default function OrdersPage() {
  const { profile } = useUser();
  const performer = profile?.full_name || profile?.email || 'Staff';
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [globalCounts, setGlobalCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState({ type: null, value: null }); // unified filter
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const PER_PAGE = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
      if (search) params.append('search', search);
      if (filter.type && filter.value) params.append(filter.type, filter.value);
      const r = await fetch(`/api/orders?${params}`);
      const d = await r.json();
      const newOrders = d.orders || [];
      if (page === 1) {
        setOrders(newOrders);
      } else {
        setOrders(prev => [...prev, ...newOrders]);
      }
      setHasMore(newOrders.length === PER_PAGE);
      if (d.stats) setStats(d.stats);
      if (d.global_counts) setGlobalCounts(d.global_counts);
    } catch {}
    setLoading(false);
  }, [page, search, filter]);

  useEffect(() => { load(); }, [load]);

  // Background auto-sync — page load pe silently Leopards + Kangaroo dono sync
  useEffect(() => {
    const backgroundSync = async () => {
      try {
        await Promise.allSettled([
          fetch('/api/courier/leopards/sync-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ triggered_by: 'auto_page_load' }),
          }),
          fetch('/api/courier/leopards/sync-payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ triggered_by: 'auto_page_load' }),
          }),
          fetch('/api/courier/kangaroo/sync-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ triggered_by: 'auto_page_load' }),
          }),
        ]);
        load();
      } catch (e) {
        console.log('[auto-sync] background sync error:', e.message);
      }
    };
    backgroundSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Sirf page load pe ek baar
  useEffect(() => {
    const handler = (e) => {
      const orderData = e.detail;
      if (orderData) setSelected(orderData);
    };
    window.addEventListener('openOrder', handler);
    return () => window.removeEventListener('openOrder', handler);
  }, []);

  // Settlement upload hone ke baad foran orders refresh ho
  useEffect(() => {
    const handler = () => { load(); };
    window.addEventListener('settlementApplied', handler);
    return () => window.removeEventListener('settlementApplied', handler);
  }, [load]);

  useEffect(() => {
    fetch('/api/shopify/sync')
      .then(r => r.json())
      .then(d => { if (d.last_synced) setLastSync(d.last_synced); })
      .catch(() => {});
  }, []);

  const showMsg = (type, text, ms = 8000) => {
    setSyncMsg({ type, text });
    setTimeout(() => setSyncMsg(null), ms);
  };

  const syncFromShopify = async () => {
    setSyncing(true);
    setSyncMsg({ type: 'info', text: '⟳ Fetching orders from Shopify (can take 30-60 seconds)...' });
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
      if (!r.ok) throw new Error(`Server error ${r.status}`);
      const d = await r.json();

      if (d.success) {
        setSyncMsg({
          type: 'success',
          text: d.synced > 0
            ? `✓ ${d.synced} orders synced from Shopify`
            : '✓ Already up to date — no new orders',
        });
        setLastSync(new Date().toISOString());
        await load();
      } else {
        setSyncMsg({ type: 'error', text: `✗ ${d.error || 'Sync failed'}` });
      }
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        setSyncMsg({ type: 'error', text: '✗ Sync timed out after 3 minutes.' });
      } else {
        setSyncMsg({ type: 'error', text: `✗ ${e.message}` });
      }
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 6000);
    }
  };

  const cleanUndefinedOrders = async () => {
    if (!window.confirm('Sab #undefined orders delete ho jayein gi. Confirm?')) return;
    setCleaning(true);
    try {
      const r = await fetch('/api/orders/cleanup', { method: 'POST' });
      const d = await r.json();
      if (d.success) {
        showMsg('success', d.message);
        await load();
      } else {
        showMsg('error', `✗ ${d.error}`);
      }
    } catch (e) { showMsg('error', `✗ ${e.message}`); }
    setCleaning(false);
  };

  const c = stats || {};
  const anySyncing = syncing || cleaning;

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff' }}>
      {showDraft && <DraftOrderModal onClose={() => setShowDraft(false)} onCreated={() => { load(); setShowDraft(false); }} />}
      {selected && <OrderDrawer order={selected} onClose={() => setSelected(null)} onRefresh={() => { load(); setSelected(prev => orders.find(o => o.id === prev?.id) || prev); }} performer={performer} />}

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
            maxWidth: 600,
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

      {/* Summary cards (filter-aware — show counts within current filter) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Total', value: c.total || 0, color: '#fff' },
          { label: 'Pending', value: c.pending || 0, color: '#888' },
          { label: 'Confirmed', value: c.confirmed || 0, color: '#3b82f6' },
          { label: 'Dispatched', value: c.dispatched || 0, color: '#a855f7' },
          { label: 'Delivered', value: c.delivered || 0, color: '#22c55e' },
          { label: 'Attempted', value: c.attempted || 0, color: '#f97316' },
          { label: 'Hold', value: c.hold || 0, color: '#64748b' },
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

      {/* Filters + Sync buttons */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search order, customer, phone, tracking..." style={{ flex: 1, minWidth: 200, background: card, border: `1px solid ${border}`, color: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13 }} />

        <FilterDropdown
          current={filter}
          onChange={(f) => { setFilter(f); setPage(1); }}
          globalCounts={globalCounts}
        />

        <button onClick={load} style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>⟳ Refresh</button>

        <button onClick={() => setShowDraft(true)}
          style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid #a855f7', color: '#a855f7', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          + Draft Order
        </button>

        <button
          onClick={syncFromShopify}
          disabled={anySyncing}
          style={{
            background: syncing ? '#1a1a1a' : 'linear-gradient(135deg, #c9a96e 0%, #b8975d 100%)',
            border: `1px solid ${syncing ? border : '#c9a96e'}`,
            color: syncing ? '#888' : '#000',
            borderRadius: 8,
            padding: '9px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: anySyncing ? 'not-allowed' : 'pointer',
            opacity: (anySyncing && !syncing) ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
          title="Pull latest orders from Shopify"
        >
          {syncing ? (<><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>Syncing…</>) : (<>⟱ Sync from Shopify</>)}
        </button>

        <button
          onClick={cleanUndefinedOrders}
          disabled={anySyncing}
          style={{
            background: cleaning ? '#1a1a1a' : 'transparent',
            border: `1px solid ${cleaning ? border : '#ef4444'}`,
            color: cleaning ? '#888' : '#ef4444',
            borderRadius: 8,
            padding: '9px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: anySyncing ? 'not-allowed' : 'pointer',
            opacity: (anySyncing && !cleaning) ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'inherit',
          }}
          title="Delete karo sab #undefined / ghost orders"
        >
          {cleaning ? (<><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>Cleaning…</>) : (<>🗑️ Clean</>)}
        </button>


        <style jsx>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>

      {/* Table */}
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${border}` }}>
                {['Order', 'Customer', 'City', 'COD', 'Office Status', 'Payment', 'Courier', 'Courier Status', 'Assigned', 'Date', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#555', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={11} style={{ padding: 40, textAlign: 'center', color: '#444' }}>Loading...</td></tr>
              )}
              {!loading && orders.length === 0 && (
                <tr><td colSpan={11} style={{ padding: 40, textAlign: 'center', color: '#444' }}>No orders found</td></tr>
              )}
              {orders.map((order, i) => {
                let typeIcon = '';
                if (order.is_wholesale) typeIcon = '🏢';
                else if (order.is_international) typeIcon = '🌍';
                else if (order.is_walkin) typeIcon = '🚶';
                const courierStatusRaw = order.courier_status_raw;
                return (
                  <tr key={order.id} style={{ borderBottom: `1px solid #1a1a1a`, background: i % 2 === 0 ? 'transparent' : '#0a0a0a' }}
                    onClick={() => setSelected(order)} className="order-row">
                    <td style={{ padding: '12px 16px', color: gold, fontWeight: 600, cursor: 'pointer' }}>
                      {order.order_number || '#' + order.id}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#ccc' }}>{order.customer_name}</td>
                    <td style={{ padding: '12px 16px', color: '#888' }}>{order.customer_city}</td>
                    <td style={{ padding: '12px 16px', color: '#fff', fontWeight: 600 }}>{fmt(order.total_amount)}</td>
                    <td style={{ padding: '12px 16px' }}><StatusBadge status={order.status} /></td>
                    <td style={{ padding: '12px 16px' }}><PaymentBadge payment_status={order.payment_status} /></td>
                    <td style={{ padding: '12px 16px', color: '#666', fontSize: 12 }}>{order.dispatched_courier || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {courierStatusRaw
                        ? <span style={{ color: '#8b5cf6', background: '#8b5cf611', border: '1px solid #8b5cf633', padding: '2px 8px', borderRadius: 5, fontSize: 11, whiteSpace: 'nowrap' }}>{courierStatusRaw}</span>
                        : <span style={{ color: '#333' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12 }}>
                      {order.assigned_to_name
                        ? <span style={{ color: '#f59e0b', fontWeight: 600 }}>{order.assigned_to_name}</span>
                        : <span style={{ color: '#333' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '12px 16px', color: '#555', fontSize: 12 }}>{timeAgo(order.created_at)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <button onClick={e => { e.stopPropagation(); setSelected(order); }}
                        style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: gold, borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                        Actions →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '12px 16px', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#555' }}>Showing {orders.length} orders</span>
          {hasMore && (
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={loading}
              style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: loading ? '#444' : gold, borderRadius: 6, padding: '6px 18px', fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
            >
              {loading ? '⟳ Loading...' : 'Show More ↓'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
