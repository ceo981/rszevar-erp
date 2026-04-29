// ============================================================================
// RS ZEVAR ERP — OrderDrawer (shared component)
// Used by:
//   - app/orders/page.js           → variant="drawer" (fixed slide-in)
//   - app/orders/[id]/page.js      → variant="page"   (full-page view)
// ============================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@/context/UserContext';
import { openCourierBooking } from '@/lib/courier-booking-urls';

// ─── Shared style constants (mirrored from orders/page.js) ───────────────
export const gold   = '#c9a96e';
export const card   = '#141414';
export const border = '#222';

// Statuses jahan normal cancel block hota hai (post-dispatch zone).
// Frontend uses this to show "Force cancel (admin)" checkbox for super_admin
// only when the order is in one of these states. Backend has same set —
// duplicated here taa ke frontend bhi correct UI dikha sake bina extra
// API call ke.
export const NO_CANCEL_FROM_UI = new Set(['dispatched', 'delivered', 'rto', 'returned', 'refunded']);

// ─── Shared helpers ──────────────────────────────────────────────────────
export const fmt = n => `Rs ${Number(n || 0).toLocaleString()}`;
export const timeAgo = iso => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

// ─── Status/Payment config + badges ──────────────────────────────────────
export const STATUS_CONFIG = {
  pending:    { label: 'Pending',    color: '#888',    bg: '#88888822' },
  confirmed:  { label: 'Confirmed',  color: '#3b82f6', bg: '#3b82f622' },
  on_packing: { label: 'On Packing', color: '#f59e0b', bg: '#f59e0b22' },
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

export const PAYMENT_CONFIG = {
  unpaid:   { label: 'Unpaid',   color: '#f87171', bg: '#f8717122' },
  paid:     { label: 'Paid',     color: '#22c55e', bg: '#22c55e22' },
  refunded: { label: 'Refunded', color: '#fbbf24', bg: '#fbbf2422' },
};

export function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span style={{ color: cfg.color, background: cfg.bg, padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>
      {cfg.label}
    </span>
  );
}

export function PaymentBadge({ payment_status }) {
  const cfg = PAYMENT_CONFIG[payment_status] || PAYMENT_CONFIG.unpaid;
  return (
    <span style={{ color: cfg.color, background: cfg.bg, padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>
      {cfg.label}
    </span>
  );
}

// ─── OrderDrawer (the main export) ───────────────────────────────────────
export default function OrderDrawer({ order, onClose, onRefresh, performer, variant = 'drawer', defaultTab = 'actions' }) {
  const isPage = variant === 'page';
  const { profile } = useUser();
  const userRole    = profile?.role || '';
  const { userEmail } = useUser();
  const isCEO       = userRole === 'super_admin' || userRole === 'admin';
  const isOpsManager = userRole === 'manager';
  const isDispatcher = userRole === 'dispatcher';
  const canConfirm  = isCEO || isOpsManager;
  const canPack     = isCEO || isDispatcher;

  // ─── Mobile detection — drawer ko full-screen bana do mobile pe ───────
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState(defaultTab);
  const [log, setLog] = useState([]);
  const [localStatus, setLocalStatus] = useState(order.status);

  // FIX: keep localStatus in sync with order prop after parent refresh.
  // Previously useState(order.status) only ran on mount — status shown in drawer
  // could go stale if parent re-fetched and passed new order prop.
  useEffect(() => { setLocalStatus(order.status); }, [order.status]);
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
  // Apr 2026 — Super-admin force cancel flag for post-dispatch overrides
  // (RTO/dispatched/delivered cleanup scenarios)
  const [forceCancel, setForceCancel] = useState(false);
  // Apr 27 2026 — Removed `editMode` state. Customer info edit form ab
  // hamesha Customer tab pe inline visible hai (toggle ki zaroorat nahi).
  // editForm + saveEdit baqi hain — woh Customer tab ke inline form se use hote hain.
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
  // Items: DB order_items agar hain, warna shopify_raw se seedha.
  // FIX Apr 2026 — Line-level discount display: har item enrich hota hai
  // shopify_raw.line_items se match karke (SKU/title/id se). Ye has_line_discount,
  // original_unit_price, effective_unit_price, line_discount deta hai jisse
  // frontend strikethrough original price + highlighted discounted price dikha sake.
  //
  // FIX Apr 2026 (additional) — Filter out items removed via Shopify Order Edit.
  // Removed items have `current_quantity: 0` lekin abhi bhi line_items array
  // mein hote hain. Inko show karne se ERP mein removed earrings/items dikhte
  // thay (jaise ZEVAR-118275). Filter dono jagah lagana zaroori hai:
  //   - Fallback path mein (jab order_items empty ho) — direct rendering
  //   - Discount enrichment lookup mein — taa ke active item ka raw match
  //     hamesha milay (filter na karein toh active + removed dono entries
  //     same SKU rakh sakti hain)
  const isActiveRawLineItem = (it) => {
    if (it?.current_quantity !== undefined && it?.current_quantity !== null) {
      return it.current_quantity > 0;
    }
    return (it?.quantity || 0) > 0;
  };
  const buildItems = (ord) => {
    const rawLineItems = (ord.shopify_raw?.line_items || []).filter(isActiveRawLineItem);
    const enrichWithDiscount = (item) => {
      const raw = rawLineItems.find(r =>
        (item.shopify_line_item_id && String(r.id) === String(item.shopify_line_item_id)) ||
        (item.sku && r.sku === item.sku && r.quantity === item.quantity) ||
        (r.title && item.title && item.title.startsWith(r.title))
      );
      const rawDiscount = raw ? (parseFloat(raw.total_discount) || 0) : 0;
      const rawPrice = raw ? (parseFloat(raw.price) || 0) : parseFloat(item.unit_price || 0);
      const qty = item.quantity || 1;
      return {
        ...item,
        original_unit_price: rawPrice,
        effective_unit_price: qty > 0 ? rawPrice - (rawDiscount / qty) : rawPrice,
        line_discount: rawDiscount,
        has_line_discount: rawDiscount > 0.01,
      };
    };

    if (ord.order_items?.length > 0) {
      return ord.order_items
        .slice()
        .sort((a, b) => (a.id || 0) - (b.id || 0))
        .map(enrichWithDiscount);
    }
    // Fallback: shopify_raw.line_items (purane orders ke liye) — already filtered above
    return rawLineItems.map(item => {
      const effectiveQty = (item.current_quantity !== undefined && item.current_quantity !== null)
        ? item.current_quantity
        : (item.quantity || 1);
      return {
        title: item.title + (item.variant_title ? ` - ${item.variant_title}` : ''),
        sku: item.sku || null,
        quantity: effectiveQty,
        unit_price: parseFloat(item.price) || 0,
        total_price: (parseFloat(item.price) || 0) * effectiveQty,
        image_url: item.image?.src || null,
        shopify_line_item_id: String(item.id),
      };
    }).map(enrichWithDiscount);
  };

  // FIX Apr 2026 — Removed items history (Shopify-style):
  // Shopify Order Edit ke baad jo items hata diye gaye, woh `line_items`
  // array mein rehte hain `current_quantity: 0` ke saath. Yahan unko separate
  // dim/strikethrough section mein dikhate hain — bilkul Shopify admin ki tarah.
  const buildRemovedItems = (ord) => {
    return (ord.shopify_raw?.line_items || [])
      .filter(it => {
        if ((it.quantity || 0) === 0) return false;
        return it.current_quantity === 0;
      })
      .map(it => ({
        title: (it.title || '') + (it.variant_title ? ` - ${it.variant_title}` : ''),
        sku: it.sku || null,
        original_quantity: it.quantity,
        unit_price: parseFloat(it.price) || 0,
        total_price: (parseFloat(it.price) || 0) * (it.quantity || 0),
        image_url: it.image?.src || null,
        shopify_line_item_id: String(it.id),
      }));
  };

  const [orderItems, setOrderItems] = useState(() => buildItems(order));
  const [removedItems] = useState(() => buildRemovedItems(order));
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
        body: JSON.stringify({ order_id: order.id, comment: commentText, staff_name: performer, staff_email: userEmail }),
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
        body: JSON.stringify({ ...body, performed_by: performer, performed_by_email: userEmail }),
      });
      const d = await r.json();
      if (d.success) {
        setMsg(successMsg + (d.warning ? ` ⚠ ${d.warning}` : '') + (d.tracking ? ` | Tracking: ${d.tracking}` : ''));
        // Agar body mein status hai to instantly update karo
        if (body.status) setLocalStatus(body.status);
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
      const r = await fetch('/api/orders/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          notes: confirmNotes,
          performed_by: performer,
          performed_by_email: userEmail,
        }),
      });
      const d = await r.json();
      if (d.success) {
        setLocalStatus('confirmed');
        setMsg('✅ Order confirmed!');
        onRefresh();
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
  const cancel = () => doAction('/api/orders/cancel', { order_id: order.id, reason: cancelReason, force: forceCancel }, '✅ Order cancelled');

  // Apr 2026 — Cancel Shopify fulfillment from ERP. Reverses dispatch:
  // tracking removed, courier cleared, status reverted (dispatched → confirmed).
  // Confirms with native dialog before calling — destructive action.
  const cancelFulfillment = async () => {
    const reason = window.prompt('Fulfillment cancel karne ki wajah likho:\n(Tracking + courier hat jayegi, status confirmed pe wapas chala jayega)');
    if (reason === null) return; // user cancelled
    doAction('/api/orders/cancel-fulfillment', { order_id: order.id, reason: reason || 'No reason' }, '✅ Fulfillment cancelled — tracking removed');
  };
  
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
        setMsg('✅ Customer info updated!' + (d.warning ? ` ⚠️ ${d.warning}` : '') + (d.shopify_synced ? ' Shopify sync ✓' : ''));
        // Reset notes field after successful save
        setEditForm(f => ({ ...f, notes: '' }));
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
      // FIX: explicit action field (was silently failing with "Unknown action")
      // + performer attribution for audit log
      const r = await fetch('/api/orders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          action: 'set_packer',
          assigned_to: parseInt(assignedTo),
          performed_by: performer,
          performed_by_email: userEmail,
        }),
      });
      const d = await r.json();
      if (d.success) {
        const emp = packingStaff.find(e => String(e.id) === String(assignedTo));
        setCurrentAssignment({ assigned_to: parseInt(assignedTo), employee: emp });
        // Only claim on_packing if backend actually promoted the status
        if (d.status_promoted) setLocalStatus('on_packing');
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
        body: JSON.stringify({ order_id: order.id, action: 'packed', performed_by: performer, performed_by_email: userEmail }),
      });
      const d = await r.json();
      if (d.success) {
        setLocalStatus('packed');
        setMsg(`✅ Marked as packed! ${d.items_packed} item(s) logged.`);
        onRefresh();
      } else if (d.packed_by_missing) {
        setMsg('⚠️ Packed By set nahi — pehle mobile packing screen se packer add karo');
      } else {
        setMsg('❌ ' + d.error);
      }
    } catch (e) { setMsg('❌ ' + e.message); }
    setLoading(false);
  };

  const s = localStatus;

  // Order type badges
  const typeBadges = [];
  if (order.is_wholesale) typeBadges.push({ label: '🏢 Wholesale', color: '#8b5cf6' });
  if (order.is_international) typeBadges.push({ label: '🌍 International', color: '#06b6d4' });
  if (order.is_walkin) typeBadges.push({ label: '🚶 Walk-in', color: '#f59e0b' });

  // Outer wrapper: `drawer` = fixed-position slide-in with backdrop (list page usage)
  //                 `page`   = normal block-flow full-page (new-tab usage)
  // Mobile pe drawer full-screen bana do — side panel mobile pe kaam nahi karti
  const outerStyle = isPage
    ? { minHeight: '100vh', background: '#0a0a0a', padding: isMobile ? '12px 8px' : '20px 16px' }
    : { position: 'fixed', inset: 0, zIndex: 1000, display: 'flex' };
  const panelStyle = isPage
    ? { maxWidth: 900, margin: '0 auto', background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 12, display: 'flex', flexDirection: 'column' }
    : isMobile
      ? { width: '100%', background: '#0f0f0f', display: 'flex', flexDirection: 'column', overflowY: 'auto' }
      : { width: 580, background: '#0f0f0f', borderLeft: `1px solid ${border}`, display: 'flex', flexDirection: 'column', overflowY: 'auto' };

  return (
    <div style={outerStyle}>
      {!isPage && !isMobile && <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.7)' }} />}
      <div style={panelStyle}>
        <div style={{
          padding: isMobile ? '14px 14px' : '20px 24px',
          borderBottom: `1px solid ${border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          position: isMobile && !isPage ? 'sticky' : 'static',
          top: 0,
          background: '#0f0f0f',
          zIndex: 10,
        }}>
          {/* Mobile: back arrow instead of close */}
          {isMobile && !isPage && (
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: gold, fontSize: 22, cursor: 'pointer', padding: '0 4px', lineHeight: 1, flexShrink: 0 }}
              title="Wapas"
            >←</button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: isMobile ? 15 : 16, color: gold }}>{order.order_number || '#' + order.id}</div>
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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {order.shopify_order_id && !isMobile && (
              <a href={`https://rszevar.myshopify.com/admin/orders/${order.shopify_order_id}`} target="_blank" rel="noopener noreferrer"
                style={{ background: 'none', border: `1px solid #333`, color: '#555', fontSize: 12, padding: '4px 8px', borderRadius: 5, textDecoration: 'none' }}>
                🔗 Shopify
              </a>
            )}
            {!isPage && !isMobile && (
              <a href={`/orders/${order.id}`} target="_blank" rel="noopener noreferrer"
                title="Naye tab mein kholo"
                style={{ background: 'none', border: `1px solid #333`, color: '#888', fontSize: 13, padding: '4px 8px', borderRadius: 5, textDecoration: 'none', lineHeight: 1 }}>
                ↗
              </a>
            )}
            {!isPage && !isMobile && (
              <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
            )}
            {isPage && (
              <a href="/orders"
                style={{ background: '#1a1a1a', border: `1px solid #333`, color: '#888', fontSize: 12, padding: '6px 12px', borderRadius: 6, textDecoration: 'none' }}>
                ← Back to Orders
              </a>
            )}
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
                    {/* Line-level discount strikethrough — jab manual per-line
                        discount hai (e.g., Rs 1,450 → Rs 1,380), dono prices
                        dikhte hain Shopify admin ki tarah. */}
                    {item.has_line_discount ? (
                      <>
                        <div style={{ fontSize: 11, color: '#666', marginTop: 2, textDecoration: 'line-through' }}>
                          Rs {Number(item.original_unit_price).toLocaleString()}
                        </div>
                        <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
                          Rs {Number(item.effective_unit_price).toLocaleString()}
                        </div>
                      </>
                    ) : (
                      item.unit_price && <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>Rs {Number(item.unit_price).toLocaleString()}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* FIX Apr 2026 — Removed items section (Shopify-style edit history).
                Order Edit ke baad jo items hata diye gaye, woh yahan dim/strikethrough
                style mein dikhte hain. Operationally important: packers ko clear
                visible ho ke kya original mein tha aur kya ab nahi hai. */}
            {removedItems.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>
                  ⊗ Removed from order ({removedItems.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {removedItems.map((item, i) => (
                    <div key={`removed-${i}`} style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      background: 'rgba(239,68,68,0.04)',
                      border: '1px dashed rgba(239,68,68,0.25)',
                      borderRadius: 9,
                      padding: '10px 12px',
                      opacity: 0.75,
                    }}>
                      {item.image_url ? (
                        <img src={item.image_url} alt="" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 7, flexShrink: 0, filter: 'grayscale(0.7)' }} />
                      ) : (
                        <div style={{ width: 50, height: 50, borderRadius: 7, background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0, opacity: 0.5 }}>📦</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#aaa', fontWeight: 600, textDecoration: 'line-through', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.title}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <span style={{
                            fontSize: 8.5,
                            color: '#ef4444',
                            background: 'rgba(239,68,68,0.15)',
                            padding: '2px 6px',
                            borderRadius: 3,
                            fontWeight: 700,
                            letterSpacing: 0.5,
                          }}>
                            REMOVED
                          </span>
                          {item.sku && (
                            <span style={{ fontSize: 10, color: '#666' }}>
                              SKU: {item.sku}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, color: '#777' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, textDecoration: 'line-through' }}>
                          x{item.original_quantity}
                        </div>
                        <div style={{ fontSize: 11, marginTop: 2, textDecoration: 'line-through' }}>
                          Rs {Number(item.unit_price).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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

              {/* Apr 27 2026 — "✏️ Edit Order (Address / Details)" button hata diya.
                  Customer/address editing ab Customer tab pe inline form se hoti hai.
                  Line items / products editing /orders/[id]/edit page se hoti hai. */}

              {/* ══════════════════════════════════════════════ */}
              {/* SHARJEEL (manager) + CEO — Confirm, Assign, Hold, Attempted */}
              {/* ══════════════════════════════════════════════ */}

              {/* Confirm Order — pending/processing orders */}
              {canConfirm && (s === 'pending' || s === 'processing') && (
                <div style={{ background: card, border: `1px solid #3b82f644`, borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#3b82f6', marginBottom: 10 }}>✅ Confirm Order</div>
                  <input value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)}
                    placeholder="Notes (optional)" style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box', marginBottom: 10 }} />
                  <button onClick={confirm} disabled={loading}
                    style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 7, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                    {loading ? '...' : '✅ Confirm Order'}
                  </button>
                </div>
              )}

              {/* Reassign Packer — confirmed/on_packing orders */}
              {canConfirm && (s === 'confirmed' || s === 'on_packing') && (
                <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#f59e0b', marginBottom: 10 }}>
                    👤 Packer Assignment
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
                    {currentAssignment ? '🔄 Re-Assign Packer' : '✅ Assign Packer'}
                  </button>
                </div>
              )}

              {/* Unconfirm + Unassign — confirmed/on_packing pe CEO/Manager ke liye */}
              {canConfirm && (s === 'confirmed' || s === 'on_packing') && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={async () => {
                      // Paid order unconfirm nahi ho sakta
                      if (order.payment_status === 'paid' || order.payment_status === 'refunded') {
                        setMsg(`❌ Ye order "${order.payment_status}" hai — unconfirm nahi ho sakta`);
                        return;
                      }
                      setLoading(true); setMsg('');
                      try {
                        // Unassign packer
                        await fetch('/api/orders/assign', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ order_id: order.id, action: 'unassign', performed_by: performer, performed_by_email: userEmail }),
                        });
                        // Wapas pending
                        const r = await fetch('/api/orders/status', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ order_id: order.id, status: 'pending', notes: 'Unconfirmed — wapas pending', performed_by: performer, performed_by_email: userEmail }),
                        });
                        const d = await r.json();
                        if (d.success) { setLocalStatus('pending'); setCurrentAssignment(null); setMsg('✅ Order unconfirmed — wapas pending'); onRefresh(); }
                        else setMsg('❌ ' + d.error);
                      } catch(e) { setMsg('❌ ' + e.message); }
                      setLoading(false);
                    }}
                    disabled={loading}
                    style={{ flex: 1, background: '#1a1a1a', border: '1px solid #3b82f644', color: '#3b82f6', borderRadius: 8, padding: '10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ↩️ Unconfirm
                  </button>
                  {s === 'on_packing' && (
                    <button
                      onClick={async () => {
                        setLoading(true); setMsg('');
                        try {
                          const r = await fetch('/api/orders/assign', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ order_id: order.id, action: 'unassign', performed_by: performer, performed_by_email: userEmail }),
                          });
                          const d = await r.json();
                          if (d.success) { setLocalStatus('confirmed'); setCurrentAssignment(null); setMsg('✅ Packer hata diya — status confirmed'); onRefresh(); }
                          else setMsg('❌ ' + d.error);
                        } catch(e) { setMsg('❌ ' + e.message); }
                        setLoading(false);
                      }}
                      disabled={loading}
                      style={{ flex: 1, background: '#1a1a1a', border: '1px solid #f59e0b44', color: '#f59e0b', borderRadius: 8, padding: '10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      👤 Unassign
                    </button>
                  )}
                </div>
              )}

              {/* Attempted — Sharjeel/CEO only */}
              {canConfirm && (s === 'pending' || s === 'confirmed' || s === 'on_packing' || s === 'hold') && (
                <button onClick={() => setStatus('attempted')} disabled={loading}
                  style={{ background: '#f9731622', border: '1px solid #f9731644', color: '#f97316', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                  📞 Attempted (Call Nahi Utha)
                </button>
              )}

              {/* Hold — Sharjeel/CEO only */}
              {canConfirm && (s === 'pending' || s === 'confirmed' || s === 'on_packing' || s === 'attempted') && (
                <button onClick={() => setStatus('hold')} disabled={loading}
                  style={{ background: '#64748b22', border: '1px solid #64748b44', color: '#64748b', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                  ⏸ Put on Hold
                </button>
              )}

              {/* Resume — Sharjeel/CEO only */}
              {canConfirm && (s === 'hold' || s === 'attempted') && (
                <button onClick={() => setStatus('confirmed')} disabled={loading}
                  style={{ background: '#3b82f622', border: '1px solid #3b82f644', color: '#3b82f6', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                  ▶️ Resume Order (Wapas Confirmed)
                </button>
              )}

              {/* ══════════════════════════════════════════════ */}
              {/* ADIL (dispatcher) + CEO — Packed + Dispatched */}
              {/* ══════════════════════════════════════════════ */}

              {/* Mark as Packed — Adil/CEO, on_packing status pe */}
              {/* FIX: Pehle 'confirmed' pe bhi show hota tha, par backend mein  */}
              {/* canTransition guard confirmed → packed block karta hai.        */}
              {/* Confirmed pe pehle packer assign karo → status on_packing     */}
              {/* → phir Mark as Packed.                                         */}
              {canPack && s === 'on_packing' && (
                <div style={{ background: card, border: `1px solid #06b6d433`, borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#06b6d4', marginBottom: 10 }}>📦 Mark as Packed</div>

                  {/* Show current packed_by if set */}
                  {currentAssignment?.employee ? (
                    <div style={{ background: '#0a1a0a', border: '1px solid #22c55e33', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12 }}>
                      <span style={{ color: '#555' }}>Packed by: </span>
                      <span style={{ color: '#22c55e', fontWeight: 700 }}>{currentAssignment.employee.name}</span>
                    </div>
                  ) : currentAssignment?.notes === 'packing_team' ? (
                    <div style={{ background: '#0a0a1a', border: '1px solid #3b82f633', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12 }}>
                      <span style={{ color: '#555' }}>Packed by: </span>
                      <span style={{ color: '#3b82f6', fontWeight: 700 }}>👥 Packing Team</span>
                    </div>
                  ) : (
                    <div style={{ background: '#1a0a0a', border: '1px solid #ef444433', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#ef4444' }}>
                      ⚠️ Packed By abhi set nahi — packing screen se add karo pehle
                    </div>
                  )}

                  <button onClick={markPacked} disabled={loading}
                    style={{ background: '#06b6d422', border: '1px solid #06b6d444', color: '#06b6d4', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                    📦 Mark as Packed
                  </button>
                </div>
              )}

              {/* Dispatch section — Adil/CEO, packed status pe */}
              {/* FIX: Primary button = Mark as Dispatched (Shopify pe book ho chuka, */}
              {/* tracking aa chuki orders/fulfilled webhook se). Kangaroo/Leopards    */}
              {/* secondary — sirf jab Shopify pe book NAHI hua (rare case).           */}
              {/* Pehle wala issue: secondary modals direct hi dispatch flow the —     */}
              {/* Shopify-booked orders pe click karne se DOUBLE BOOKING ho jaati.     */}
              {canPack && s === 'packed' && (
                <div style={{ background: card, border: '1px solid #a855f744', borderRadius: 10, padding: '14px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#a855f7', marginBottom: 10 }}>🚚 Dispatch Order</div>

                  {/* Primary: Shopify pe already book ho chuka, sirf status flip */}
                  <button onClick={() => setStatus('dispatched')} disabled={loading}
                    style={{ background: '#a855f722', border: '1px solid #a855f744', color: '#a855f7', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', width: '100%', marginBottom: 10 }}>
                    ✅ Mark as Dispatched
                  </button>
                  <div style={{ fontSize: 10, color: '#666', marginBottom: 10, textAlign: 'center', lineHeight: 1.4 }}>
                    Shopify pe already book ho chuka? Ye click karo.
                  </div>

                  {/* Apr 2026 — Book at courier via Shopify (temporary bridge).
                      Staff ko Shopify Orders page access band karne ke baad,
                      yahan se directly Shopify courier app khol sakte hain
                      (naya tab) jisme order data prefilled aata hai. Booking
                      complete karne ke baad wapas ERP me "Mark as Dispatched"
                      click karna hai. */}
                  <div style={{ borderTop: `1px solid ${border}`, paddingTop: 10, marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 6, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      — Book on Shopify (new tab) —
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => openCourierBooking('postex', order.shopify_order_id)} disabled={loading}
                        style={{ flex: 1, background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 8, padding: '9px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        🚚 PostEx
                      </button>
                      <button onClick={() => openCourierBooking('leopards', order.shopify_order_id)} disabled={loading}
                        style={{ flex: 1, background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 8, padding: '9px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        🚚 Leopards
                      </button>
                    </div>
                    <div style={{ fontSize: 10, color: '#666', marginTop: 6, textAlign: 'center', lineHeight: 1.4 }}>
                      Shopify courier app khulega → book karke wapas aao → Mark as Dispatched
                    </div>
                  </div>

                  {/* Secondary: ERP direct booking (Shopify pe book nahi hua) */}
                  <div style={{ borderTop: `1px solid ${border}`, paddingTop: 10 }}>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 6, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      — OR ERP se directly book —
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setShowKangarooModal(true)} disabled={loading}
                        style={{ flex: 1, background: '#f59e0b22', border: '1px solid #f59e0b44', color: '#f59e0b', borderRadius: 8, padding: '9px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        🦘 Kangaroo
                      </button>
                      <button onClick={() => setShowLeopardsModal(true)} disabled={loading}
                        style={{ flex: 1, background: '#e87d4422', border: '1px solid #e87d4444', color: '#e87d44', borderRadius: 8, padding: '9px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        🐆 Leopards
                      </button>
                    </div>
                    <div style={{ fontSize: 10, color: '#666', marginTop: 6, textAlign: 'center', lineHeight: 1.4 }}>
                      ⚠️ Sirf tab jab Shopify pe book NAHI hua — warna double booking ho jayegi
                    </div>
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════════ */}
              {/* CEO ONLY — Delivered / RTO manual override */}
              {/* ══════════════════════════════════════════════ */}

              {isCEO && (s === 'dispatched' || s === 'packed' || s === 'attempted') && (
                <button onClick={() => setStatus('delivered')} disabled={loading}
                  style={{ background: '#22c55e22', border: '1px solid #22c55e44', color: '#22c55e', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                  ✅ Mark as Delivered (manual)
                </button>
              )}

              {isCEO && (s === 'dispatched' || s === 'packed' || s === 'delivered' || s === 'attempted') && (
                <button onClick={() => setStatus('rto')} disabled={loading}
                  style={{ background: '#ef444422', border: '1px solid #ef444444', color: '#ef4444', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                  ↩️ Mark as RTO (manual)
                </button>
              )}

              {/* Apr 2026 — Cancel Fulfillment (Shopify-style).
                  Visible jab order pe tracking/fulfillment hai — useful jab
                  staff ne accidentally galat courier book kar diya, ya order
                  edit hua aur dobara book karna hai. Tracking + courier clear
                  ho jate, status dispatched → confirmed wapas, Shopify side
                  bhi cancel hoti hai (ya already cancelled hai toh skip). */}
              {canPack && (order.shopify_fulfillment_id || order.tracking_number || order.dispatched_courier) && s !== 'cancelled' && (
                <button onClick={cancelFulfillment} disabled={loading}
                  style={{ background: '#1a1a1a', border: '1px solid #f59e0b66', color: '#f59e0b', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                  🔄 Cancel Fulfillment (remove tracking)
                </button>
              )}

              {s !== 'cancelled' && s !== 'delivered' && (
                <div style={{ background: card, border: '1px solid #330000', borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#ef4444', marginBottom: 10 }}>❌ Cancel Order</div>
                  <input value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                    placeholder="Reason for cancellation" style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box', marginBottom: 10 }} />

                  {/* Apr 2026 — Force cancel option for super_admin only.
                      Allows cancelling RTO/dispatched/delivered orders for
                      cleanup scenarios (e.g., orphan orders out-of-sync with
                      Shopify, or admin discretion calls). Activity log captures
                      this clearly so audit trail mein force override visible hai. */}
                  {isCEO && (NO_CANCEL_FROM_UI.has(s)) && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '8px 10px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={forceCancel} onChange={e => setForceCancel(e.target.checked)} style={{ cursor: 'pointer' }} />
                      <span style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.4 }}>
                        <strong>Force cancel (admin override)</strong><br/>
                        <span style={{ color: '#999', fontSize: 10 }}>
                          Status '{s}' se cancel hoga. RTO/dispatch ke liye normal flow allowed nahi — yeh sirf cleanup ke liye hai.
                        </span>
                      </span>
                    </label>
                  )}

                  <button onClick={cancel} disabled={loading} style={{ background: '#ef444422', border: '1px solid #ef444444', color: '#ef4444', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: 'inherit' }}>
                    {forceCancel ? '⚡ Force Cancel Order' : 'Cancel Order'}
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

              {/* Timeline Entries — super_admin sees all, staff hides webhook/system noise */}
              {(() => {
                const visibleLog = isCEO ? log : log.filter(l => {
                  const a = String(l.action || '');
                  if (a.startsWith('webhook:')) return false;
                  if (a.startsWith('protocol_violation:')) return false;
                  if (a === 'shopify_order_edited_webhook') return false;
                  if (a === 'courier_reclassified') return false;
                  return true;
                });
                return (<>
              {visibleLog.length === 0 && (
                <div style={{ color: '#333', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
                  Koi activity nahi abhi tak
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {visibleLog.map((l, i) => {
                  const isComment = l.action === 'staff_comment';
                  const dateStr = l.performed_at
                    ? new Date(l.performed_at).toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
                    : '';
                  const by = l.performed_by && l.performed_by !== 'Staff' ? l.performed_by : null;
                  const byEmail = l.performed_by_email || null;

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
                            {byEmail && <span style={{ color: '#555', fontSize: 10 }}> ({byEmail})</span>}
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
                        {i < visibleLog.length - 1 && <div style={{ width: 1, height: 18, background: '#1f1f1f', marginTop: 3 }} />}
                      </div>
                      <div style={{ flex: 1, paddingBottom: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontSize: 12, color: actionColor, fontWeight: 600, textTransform: 'capitalize' }}>{actionLabel}</div>
                          <div style={{ fontSize: 10, color: '#333', flexShrink: 0, marginLeft: 8 }}>{dateStr}</div>
                        </div>
                        {l.notes && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{l.notes}</div>}
                        {(by || byEmail) && <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>by <span style={{ color: gold }}>{by || byEmail}</span>{by && byEmail && <span style={{ color: '#444' }}> · {byEmail}</span>}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
                </>);
              })()}
            </div>
          )}

          {tab === 'customer' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Apr 27 2026 — Customer Info Edit (always-editable inline form).
                  Pehle yahan read-only card tha aur edit ke liye Actions tab pe
                  alag toggle button tha. Ab Shopify-style: form direct yahan
                  hai, kebab menu se aate hi user can edit. */}
              <div style={{ background: '#111', border: `1px solid ${border}`, borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>👤 Edit Customer Info</span>
                  <span style={{ fontSize: 9, color: '#444', textTransform: 'none', letterSpacing: 0 }}>Save Shopify pe bhi sync hota hai</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  {[
                    ['Customer Name', 'customer_name'],
                    ['Phone', 'customer_phone'],
                    ['City', 'customer_city'],
                  ].map(([lbl, key]) => (
                    <div key={key} style={{ gridColumn: key === 'customer_name' ? 'span 2' : 'auto' }}>
                      <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>{lbl}</div>
                      <input value={editForm[key]} onChange={e => setEditForm(f => ({...f, [key]: e.target.value}))}
                        style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }} />
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Shipping Address</div>
                  <textarea value={editForm.customer_address} onChange={e => setEditForm(f => ({...f, customer_address: e.target.value}))}
                    rows={2}
                    style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Edit Reason (audit log mein save hoga)</div>
                  <input value={editForm.notes} onChange={e => setEditForm(f => ({...f, notes: e.target.value}))}
                    placeholder="e.g. Customer ne address change kaha"
                    style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }} />
                </div>
                <button onClick={saveEdit} disabled={loading}
                  style={{ width: '100%', background: '#f59e0b', color: '#000', border: 'none', borderRadius: 7, padding: '10px', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: loading ? 0.5 : 1 }}>
                  {loading ? '⟳ Saving...' : '💾 Save + Sync to Shopify'}
                </button>
                {/* Tags display below the form */}
                {order.tags && Array.isArray(order.tags) && order.tags.length > 0 && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${border}` }}>
                    <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>Tags</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {order.tags.map((tag, ti) => (
                        <span key={ti} style={{ background: '#1f1f1f', border: '1px solid #333', color: '#888', padding: '2px 9px', borderRadius: 5, fontSize: 11 }}>{tag}</span>
                      ))}
                    </div>
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
