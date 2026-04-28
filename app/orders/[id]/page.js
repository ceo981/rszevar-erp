'use client';

// ============================================================================
// RS ZEVAR ERP — Single Order Page (Shopify-inspired full view)
// Route: /orders/[id]
// ----------------------------------------------------------------------------
// Phase 1 (Apr 20 2026): Shopify-style UI enhancement
//   - Header: [🔗 Shopify] [✏️ Edit] [🖨 Print ▾] [⋯ More ▾]
//   - Items card: Shopify-style "compound" action button with status dropdown
//   - Payment card: "Collect payment ▾" button with Mark-as-paid dropdown
//   - All existing state, handlers, API calls preserved unchanged
//   - Placeholders for: Mark as paid, Print PDFs, Duplicate, Archive (future phases)
//
// Design (unchanged):
//   - Dark theme (ERP aesthetic) + Shopify-style 2-col card layout
//   - Left:  Items | Status/Dispatch | Payment Summary | Timeline
//   - Right: Notes | Customer | Shipping | Assignment | Tags | Metadata
//   - Simple actions (confirm/cancel/status/comment/assign) inline
//   - Complex actions (dispatch/edit) open OrderDrawer as overlay
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';
import OrderDrawer, {
  StatusBadge, PaymentBadge, fmt, timeAgo,
  gold, card, border, STATUS_CONFIG, NO_CANCEL_FROM_UI,
} from '../_components/OrderDrawer';
import { openCourierBooking } from '@/lib/courier-booking-urls';

// ─── Format helpers ───────────────────────────────────────────────────────
function formatFullDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).replace(',', ' at');
}

function formatShortDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// ─── Small UI atoms ───────────────────────────────────────────────────────
function Card({ title, children, pad = '18px 20px', noPadBody = false, overflowVisible = false, right = null }) {
  return (
    <div style={{
      background: card,
      border: `1px solid ${border}`,
      borderRadius: 10,
      marginBottom: 16,
      overflow: overflowVisible ? 'visible' : 'hidden',
      position: 'relative',
    }}>
      {title && (
        <div style={{
          padding: '14px 20px',
          borderBottom: `1px solid ${border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(201,169,110,0.03)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e5e5' }}>{title}</div>
          {right}
        </div>
      )}
      <div style={{ padding: noPadBody ? 0 : pad }}>{children}</div>
    </div>
  );
}

function Row({ label, value, mono, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{
        color: color || '#e5e5e5',
        fontFamily: mono ? 'monospace' : 'inherit',
        textAlign: 'right',
        maxWidth: '60%',
        wordBreak: 'break-word',
      }}>{value ?? <span style={{ color: '#444' }}>—</span>}</span>
    </div>
  );
}

function HeaderBtn({ onClick, href, target, children, primary, title }) {
  const style = {
    background: primary ? gold : '#1a1a1a',
    border: `1px solid ${primary ? gold : border}`,
    color: primary ? '#000' : '#ccc',
    borderRadius: 7,
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: primary ? 600 : 500,
    cursor: 'pointer',
    textDecoration: 'none',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
  };
  if (href) return <a href={href} target={target} rel="noopener noreferrer" style={style} title={title}>{children}</a>;
  return <button onClick={onClick} style={style} title={title}>{children}</button>;
}

// ─── Dropdown menu item (shared styling for Print/More/Collect/Fulfill) ───
function MenuItem({ onClick, icon, label, sub, danger, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        width: '100%',
        textAlign: 'left',
        gap: 10,
        alignItems: 'flex-start',
        background: 'transparent',
        border: 'none',
        color: disabled ? '#555' : danger ? '#ef4444' : '#ddd',
        fontSize: 12,
        padding: '8px 12px',
        borderRadius: 5,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#1a1a1a'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {icon && <span style={{ fontSize: 14, flexShrink: 0, width: 16, textAlign: 'center' }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{sub}</div>}
      </span>
    </button>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function SingleOrderPage() {
  const params = useParams();
  const router = useRouter();
  const { profile, userEmail, activeUser } = useUser();
  const performer = activeUser?.name || profile?.full_name || profile?.email || 'Staff';
  const userRole = profile?.role || '';
  const isCEO = userRole === 'super_admin' || userRole === 'admin';
  const isOpsManager = userRole === 'manager';
  const isDispatcher = userRole === 'dispatcher';
  const canConfirm = isCEO || isOpsManager;
  const canPack    = isCEO || isDispatcher;

  const id = params?.id;
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [packingStaff, setPackingStaff] = useState([]);
  const [showDrawer, setShowDrawer] = useState(false);
  const [msg, setMsg] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [commentText, setCommentText] = useState('');
  // Apr 2026 — In-place edit state for staff comments
  const [editingId, setEditingId] = useState(null);     // id of comment being edited
  const [editingText, setEditingText] = useState('');   // current edit textarea value
  const [showCancelBox, setShowCancelBox] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  // Apr 2026 — Super-admin force cancel for post-dispatch overrides (RTO/dispatched/delivered cleanup)
  const [forceCancel, setForceCancel] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  // Apr 27 2026 — Track which tab to open drawer on. 'customer' jab kebab
  // menu se khule, 'actions' jab dispatch button etc. se khule.
  const [drawerInitialTab, setDrawerInitialTab] = useState('actions');

  // Phase 1 NEW: dropdown state for header/card menus (Print / More / Fulfill / Payment)
  const [openMenu, setOpenMenu] = useState(null);

  // Phase 2 NEW: confirmation box state for Mark as Paid (irreversible-ish, needs confirmation)
  const [showPaidConfirm, setShowPaidConfirm] = useState(false);

  // ─── Data fetchers ──────────────────────────────────────────────────────
  const loadOrder = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/orders/${id}`);
      const d = await r.json();
      if (d.success) setOrder(d.order);
      else setError(d.error || 'Order load failed');
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [id]);

  const loadTimeline = useCallback(async () => {
    if (!id) return;
    try {
      const r = await fetch(`/api/orders/comment?order_id=${id}`);
      const d = await r.json();
      setTimeline(d.log || []);
    } catch {}
  }, [id]);

  const loadPackingStaff = useCallback(async () => {
    try {
      const r = await fetch('/api/orders/assign');
      const d = await r.json();
      setPackingStaff(d.staff || []);
    } catch {}
  }, []);

  useEffect(() => { loadOrder(); }, [loadOrder]);
  useEffect(() => { loadTimeline(); }, [loadTimeline]);
  useEffect(() => { loadPackingStaff(); }, [loadPackingStaff]);

  // Close any open dropdown on outside click
  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenu]);

  // ─── Tab title ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (order?.order_number) document.title = `${order.order_number} — RS ZEVAR ERP`;
    else if (loading) document.title = 'Loading… — RS ZEVAR ERP';
  }, [order, loading]);

  // ─── Helpers ────────────────────────────────────────────────────────────
  const flash = (type, text, ms = 4000) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), ms);
  };

  const refreshAll = async () => {
    await Promise.all([loadOrder(), loadTimeline()]);
  };

  // Toggle a menu (stopPropagation in click handler so doc-click doesn't close it immediately)
  const toggleMenu = (name) => (e) => {
    e.stopPropagation();
    setOpenMenu(openMenu === name ? null : name);
  };

  // Phase 1 placeholder — features coming in later phases
  const comingSoon = (featureName, phase = 2) => {
    setOpenMenu(null);
    flash('info', `${featureName} — Phase ${phase} mein add hoga`);
  };

  // ─── Inline actions ─────────────────────────────────────────────────────
  const doAction = async (url, payload, successMsg) => {
    setActionBusy(true);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, performed_by: performer, performed_by_email: userEmail }),
      });
      const d = await r.json();
      if (d.success) {
        flash('success', successMsg);
        await refreshAll();
      } else {
        flash('error', d.error || 'Action failed');
      }
    } catch (e) {
      flash('error', e.message);
    }
    setActionBusy(false);
  };

  const confirmOrder = () => doAction('/api/orders/confirm', { order_id: id }, '✓ Order confirmed');
  const markPacked   = () => doAction('/api/orders/status', { order_id: id, status: 'packed' }, '✓ Marked as Packed');
  const setStatus    = (s) => { setShowStatusMenu(false); doAction('/api/orders/status', { order_id: id, status: s }, `✓ Status → ${s}`); };

  // Phase 2: Mark as Paid — ERP + Shopify sync (shows richer success/warning)
  const markAsPaid = async () => {
    setShowPaidConfirm(false);
    setOpenMenu(null);
    setActionBusy(true);
    try {
      const r = await fetch('/api/orders/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: id, performed_by: performer, performed_by_email: userEmail }),
      });
      const d = await r.json();
      if (d.success) {
        const msgText = d.shopify_synced
          ? (d.shopify_already_paid
            ? '✓ Paid (Shopify already paid)'
            : '✓ Paid — Shopify synced')
          : (d.warning
            ? `⚠ Paid in ERP — Shopify sync failed: ${d.warning}`
            : '✓ Paid');
        flash(d.shopify_synced || !d.warning ? 'success' : 'info', msgText, 6000);
        await refreshAll();
      } else {
        flash('error', d.error || 'Mark as paid failed');
      }
    } catch (e) {
      flash('error', e.message);
    }
    setActionBusy(false);
  };

  const cancelOrder = async () => {
    if (!cancelReason.trim()) { flash('error', 'Reason zaroori hai'); return; }
    await doAction('/api/orders/cancel', { order_id: id, reason: cancelReason, force: forceCancel }, '✓ Order cancelled');
    setShowCancelBox(false);
    setCancelReason('');
    setForceCancel(false);
  };

  // Apr 2026 — Cancel Shopify fulfillment from ERP. Reverses dispatch:
  // tracking removed, courier cleared, status reverted (dispatched → confirmed).
  const cancelFulfillment = async () => {
    const reason = window.prompt('Fulfillment cancel karne ki wajah likho:\n(Tracking + courier hat jayegi, status confirmed pe wapas chala jayega)');
    if (reason === null) return; // user cancelled
    await doAction('/api/orders/cancel-fulfillment', { order_id: id, reason: reason || 'No reason' }, '✓ Fulfillment cancelled — tracking removed');
  };

  const addComment = async () => {
    const txt = commentText.trim();
    if (!txt) return;
    setActionBusy(true);
    try {
      const r = await fetch('/api/orders/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: id, comment: txt, staff_name: performer, staff_email: userEmail }),
      });
      const d = await r.json();
      if (d.success) {
        setCommentText('');
        await loadTimeline();
        flash('success', '✓ Comment added');
      } else {
        flash('error', d.error || 'Comment failed');
      }
    } catch (e) {
      flash('error', e.message);
    }
    setActionBusy(false);
  };

  // Apr 2026 — Edit own comment (in-place)
  const startEditComment = (comment) => {
    setEditingId(comment.id);
    setEditingText(comment.notes || '');
  };
  const cancelEditComment = () => {
    setEditingId(null);
    setEditingText('');
  };
  const saveEditComment = async () => {
    const txt = editingText.trim();
    if (!txt || !editingId) return;
    setActionBusy(true);
    try {
      const r = await fetch('/api/orders/comment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, comment: txt, staff_email: userEmail }),
      });
      const d = await r.json();
      if (d.success) {
        cancelEditComment();
        await loadTimeline();
        flash('success', '✓ Comment updated');
      } else {
        flash('error', d.error || 'Edit failed');
      }
    } catch (e) {
      flash('error', e.message);
    }
    setActionBusy(false);
  };

  // Apr 2026 — Delete own comment (with confirmation)
  const deleteComment = async (commentId) => {
    if (!commentId) return;
    if (!window.confirm('Yeh comment delete kardenge?')) return;
    setActionBusy(true);
    try {
      const r = await fetch('/api/orders/comment', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: commentId, staff_email: userEmail }),
      });
      const d = await r.json();
      if (d.success) {
        await loadTimeline();
        flash('success', '✓ Comment deleted');
      } else {
        flash('error', d.error || 'Delete failed');
      }
    } catch (e) {
      flash('error', e.message);
    }
    setActionBusy(false);
  };

  const assignTo = async (staffId) => {
    setActionBusy(true);
    try {
      const r = await fetch('/api/orders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: id, assigned_to: staffId, performed_by: performer, performed_by_email: userEmail }),
      });
      const d = await r.json();
      if (d.success) { flash('success', '✓ Assigned'); await refreshAll(); }
      else flash('error', d.error || 'Assign failed');
    } catch (e) { flash('error', e.message); }
    setActionBusy(false);
  };

  // ─── Loading / error / not-found ────────────────────────────────────────
  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 14 }}>⟳ Loading order…</div>;
  }
  if (error || !order) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
        <div style={{ color: '#ef4444', fontSize: 14 }}>{error || 'Order not found'}</div>
        <Link href="/orders" style={{ background: gold, color: '#000', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          ← Back to Orders
        </Link>
      </div>
    );
  }

  // ─── Derived data ───────────────────────────────────────────────────────
  // Items: prefer DB order_items; fallback to shopify_raw.line_items for older
  // orders where order_items rows weren't backfilled. Same pattern as the
  // original OrderDrawer's buildItems helper.
  //
  // FIX Apr 2026 — Line-level discount display:
  // Shopify line_items have `total_discount` (manual per-line discount).
  // We enrich each item with `effective_unit_price` + `line_discount` by
  // matching SKU/title from shopify_raw.line_items. Display shows strikethrough
  // original price when there's a per-line discount (like Rs 1,450 → Rs 1,380).
  //
  // FIX Apr 2026 (additional) — Filter out items removed via Shopify Order Edit
  // (current_quantity === 0). Removed items remain in line_items array for
  // history but should not appear in ERP display.
  const isActiveRawLineItem = (it) => {
    if (it?.current_quantity !== undefined && it?.current_quantity !== null) {
      return it.current_quantity > 0;
    }
    return (it?.quantity || 0) > 0;
  };
  const rawLineItems = (order.shopify_raw?.line_items || []).filter(isActiveRawLineItem);
  const enrichItemWithDiscount = (item) => {
    // Try to match with raw Shopify line item by shopify_line_item_id, SKU, or title
    const raw = rawLineItems.find(r =>
      (item.shopify_line_item_id && String(r.id) === String(item.shopify_line_item_id)) ||
      (item.sku && r.sku === item.sku && r.quantity === item.quantity) ||
      (r.title && item.title && item.title.startsWith(r.title))
    );
    const rawDiscount = raw ? (parseFloat(raw.total_discount) || 0) : 0;
    const rawPrice = raw ? (parseFloat(raw.price) || 0) : parseFloat(item.unit_price || 0);
    const qty = item.quantity || 1;
    const effectiveUnitPrice = qty > 0 ? rawPrice - (rawDiscount / qty) : rawPrice;
    return {
      ...item,
      original_unit_price: rawPrice,
      effective_unit_price: effectiveUnitPrice,
      line_discount: rawDiscount,
      has_line_discount: rawDiscount > 0.01,
    };
  };

  const items = ((order.order_items?.length > 0)
    ? order.order_items.slice().sort((a, b) => (a.id || 0) - (b.id || 0))
    : rawLineItems.map(it => {
        const effectiveQty = (it.current_quantity !== undefined && it.current_quantity !== null)
          ? it.current_quantity
          : (it.quantity || 0);
        return {
          title: (it.title || '') + (it.variant_title ? ` - ${it.variant_title}` : ''),
          sku: it.sku || null,
          quantity: effectiveQty,
          unit_price: parseFloat(it.price) || 0,
          total_price: (parseFloat(it.price) || 0) * effectiveQty,
          image_url: null,
          shopify_line_item_id: String(it.id),
        };
      })
  ).map(enrichItemWithDiscount);

  // FIX Apr 2026 — Removed items history (Shopify-style):
  // Shopify Order Edit ke baad jo items remove hue, woh `line_items` array mein
  // rehte hain `current_quantity: 0` ke saath. Yahan unko alag se dikha rahe hain
  // taa ke packers/CS ko visible ho ke kya hata diya gaya tha aur kab.
  const removedItems = (order.shopify_raw?.line_items || [])
    .filter(it => {
      // Original mein order tha (qty > 0), ab nahi hai (current_quantity 0)
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

  const subtotal = parseFloat(order.subtotal || 0);
  const discount = parseFloat(order.discount || 0);
  const shipping = parseFloat(order.shipping_fee || 0);
  const total = parseFloat(order.total_amount || 0);

  // FIX Apr 2026 — Discount code name extraction from shopify_raw.
  // Shopify exposes discount codes via `discount_codes` (array) and
  // `discount_applications` (array with title, type, value_type).
  // We show the code name next to the discount line for context.
  // Example: "Discount (RS5)" instead of just "Discount".
  const discountCodes = order.shopify_raw?.discount_codes || [];
  const discountApplications = order.shopify_raw?.discount_applications || [];
  // Prefer discount_applications title (more descriptive), fall back to discount_codes code.
  const discountLabel = (() => {
    if (discountApplications.length > 0) {
      const app = discountApplications[0];
      if (app.code) return app.code;
      if (app.title) return app.title;
      if (app.type === 'manual') return 'Manual';
      if (app.type === 'automatic') return 'Auto';
    }
    if (discountCodes.length > 0 && discountCodes[0].code) return discountCodes[0].code;
    return null;
  })();
  const isPaid = order.payment_status === 'paid';
  const isRefunded = order.payment_status === 'refunded';
  const paidAmt = isPaid ? total : 0;
  const balance = total - paidAmt;
  const isCancelled = order.status === 'cancelled';
  const isDelivered = order.status === 'delivered';
  const isDispatched = !!order.tracking_number || ['dispatched', 'delivered'].includes(order.status);

  const typeBadges = [];
  if (order.is_wholesale)     typeBadges.push({ label: '🏢 Wholesale',     color: '#8b5cf6' });
  if (order.is_international) typeBadges.push({ label: '🌍 International', color: '#22d3ee' });
  if (order.is_walkin)        typeBadges.push({ label: '🚶 Walk-in',        color: '#f59e0b' });
  const isWaCancelledReview = order.status === 'cancelled'
    && Array.isArray(order.tags)
    && order.tags.some(t => String(t).toLowerCase() === 'whatsapp_cancelled');

  // Primary action based on status (Shopify-style big button)
  let primaryAction = null;
  if (order.status === 'pending' && canConfirm) {
    primaryAction = { label: '✓ Confirm Order', onClick: confirmOrder };
  } else if (order.status === 'confirmed' || order.status === 'on_packing') {
    primaryAction = { label: '📦 Mark as Packed', onClick: markPacked };
  } else if (order.status === 'packed') {
    primaryAction = { label: '🚚 Dispatch Order', onClick: () => { setDrawerInitialTab('actions'); setShowDrawer(true); } };
  }

  const statusOptions = Object.keys(STATUS_CONFIG).filter(s => s !== order.status && s !== 'cancelled');

  // Fulfill dropdown items — only shown if we have a primary action
  const fulfillSecondary = [
    { status: 'on_packing', label: 'Mark as in progress', icon: '🟡', show: order.status !== 'on_packing' && !isCancelled && !isDelivered },
    { status: 'hold',       label: 'Mark as on hold',     icon: '⏸', show: order.status !== 'hold' && !isCancelled && !isDelivered },
  ].filter(x => x.show);

  // Fulfilled/Unfulfilled header badge
  const itemsHeaderLabel =
      isDelivered  ? `Delivered (${items.length})`
    : isDispatched ? `Fulfilled (${items.length})`
    :                `Unfulfilled (${items.length})`;
  const itemsHeaderColor =
      isDelivered  ? { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', br: '#22c55e44' }
    : isDispatched ? { bg: 'rgba(168,85,247,0.15)', fg: '#a855f7', br: '#a855f744' }
    :                { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b', br: '#f59e0b44' };

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#e5e5e5' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 24px 40px' }}>

        {/* ─── Header ─── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Link href="/orders" style={{ color: '#888', textDecoration: 'none', fontSize: 13 }}>
                  ← Orders
                </Link>
                <span style={{ color: '#333' }}>/</span>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff' }}>
                  {order.order_number || `#${String(order.id).slice(0, 8)}`}
                </h1>
                <StatusBadge status={order.status} />
                <PaymentBadge payment_status={order.payment_status} />
                {typeBadges.map(b => (
                  <span key={b.label} style={{ color: b.color, background: b.color + '22', padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>{b.label}</span>
                ))}
                {isWaCancelledReview && (
                  <span title="Customer ne WhatsApp se cancel kiya — review zaroori"
                    style={{ color: '#fbbf24', background: '#fbbf2422', border: '1px solid #fbbf2455', padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>
                    ⚠️ Review needed
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                {formatFullDate(order.created_at)}
                {order.shopify_order_id && <span> · from Shopify</span>}
              </div>
            </div>

            {/* Phase 1: Shopify-style action button row */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {order.shopify_order_id && (
                <HeaderBtn href={`https://rszevar.myshopify.com/admin/orders/${order.shopify_order_id}`} target="_blank">
                  🔗 Shopify
                </HeaderBtn>
              )}

              {/* Edit — goes to Shopify-style line items edit page */}
              <HeaderBtn onClick={() => router.push(`/orders/${id}/edit`)} title="Edit order line items (add/remove/qty/discount/shipping)">
                ✏️ Edit
              </HeaderBtn>

              {/* Print dropdown */}
              <div style={{ position: 'relative' }}>
                <HeaderBtn onClick={toggleMenu('print')}>🖨 Print ▾</HeaderBtn>
                {openMenu === 'print' && (
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                      background: '#0f0f0f', border: `1px solid ${border}`,
                      borderRadius: 8, padding: 5, minWidth: 200, zIndex: 50,
                      boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                    }}
                  >
                    <MenuItem icon="📋" label="Print packing slip" sub="For packing staff"
                      onClick={() => { setOpenMenu(null); window.open(`/orders/${id}/print/packing-slip`, '_blank'); }} />
                    <MenuItem icon="🧾" label="Print invoice" sub="For customer"
                      onClick={() => { setOpenMenu(null); window.open(`/orders/${id}/print/invoice`, '_blank'); }} />
                  </div>
                )}
              </div>

              {/* More actions dropdown (placeholders — future phases) */}
              <div style={{ position: 'relative' }}>
                <HeaderBtn onClick={toggleMenu('more')}>⋯ More ▾</HeaderBtn>
                {openMenu === 'more' && (
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                      background: '#0f0f0f', border: `1px solid ${border}`,
                      borderRadius: 8, padding: 5, minWidth: 220, zIndex: 50,
                      boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                    }}
                  >
                    <MenuItem icon="📋" label="Duplicate order" onClick={() => comingSoon('Duplicate order', 5)} />
                    <MenuItem icon="📂" label="Archive order" onClick={() => comingSoon('Archive order', 5)} />
                    <MenuItem icon="💬" label="Send order WhatsApp" onClick={() => comingSoon('Manual WhatsApp send', 5)} />
                    <div style={{ height: 1, background: border, margin: '4px 0' }} />
                    <MenuItem icon="🚚" label="Book at PostEx" onClick={() => { openCourierBooking('postex', order.shopify_order_id); setOpenMenu(null); }} />
                    <MenuItem icon="🚚" label="Book at Leopards" onClick={() => { openCourierBooking('leopards', order.shopify_order_id); setOpenMenu(null); }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Status message */}
        {msg && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16,
            background: msg.type === 'success' ? 'rgba(74,222,128,0.12)'
                      : msg.type === 'info'    ? 'rgba(201,169,110,0.12)'
                      : 'rgba(248,113,113,0.12)',
            border: `1px solid ${msg.type === 'success' ? '#4ade80' : msg.type === 'info' ? gold : '#f87171'}`,
            color:  msg.type === 'success' ? '#4ade80' : msg.type === 'info' ? gold : '#f87171',
          }}>{msg.text}</div>
        )}

        {/* ─── 2-Column Grid ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 20 }}>

          {/* ═══ LEFT COLUMN ═══ */}
          <div>

            {/* Items card — Shopify-style fulfilled/unfulfilled badge */}
            <Card
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    background: itemsHeaderColor.bg,
                    color:      itemsHeaderColor.fg,
                    border: `1px solid ${itemsHeaderColor.br}`,
                    padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                  }}>
                    {itemsHeaderLabel}
                  </span>
                  <span style={{ background: '#1a1a1a', border: `1px solid ${border}`, padding: '3px 10px', borderRadius: 12, fontSize: 11, color: '#888' }}>
                    📍 OFFICE
                  </span>
                </div>
              }
              noPadBody
              overflowVisible
            >
              <div>
                {items.length === 0 && (
                  <div style={{ padding: 30, textAlign: 'center', color: '#555', fontSize: 13 }}>
                    No items in this order
                  </div>
                )}
                {items.map((item, idx) => (
                  <div key={item.id || idx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 20px',
                    borderBottom: idx < items.length - 1 ? `1px solid ${border}` : 'none',
                  }}>
                    <div style={{
                      width: 52, height: 52, borderRadius: 8,
                      background: '#1a1a1a', border: `1px solid ${border}`,
                      overflow: 'hidden', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {item.image_url
                        ? <img src={item.image_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ color: '#444', fontSize: 22 }}>📦</span>
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link
                        href={item.sku ? `/inventory?search=${encodeURIComponent(item.sku)}` : '#'}
                        style={{ color: '#fff', fontSize: 13, fontWeight: 500, textDecoration: 'none', display: 'block', wordBreak: 'break-word' }}
                      >
                        {item.title || 'Untitled'}
                      </Link>
                      {item.sku && (
                        <div style={{ fontSize: 11, color: '#666', marginTop: 3, fontFamily: 'monospace' }}>
                          SKU: {item.sku}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {/* Line-level discount strikethrough — shows original price
                          struck through + effective price, matching Shopify admin UI.
                          Example: Rs 1,450 (strikethrough) Rs 1,380 × 1 */}
                      {item.has_line_discount ? (
                        <>
                          <div style={{ fontSize: 13, color: '#ccc' }}>
                            <span style={{ textDecoration: 'line-through', color: '#666', marginRight: 6 }}>
                              {fmt(item.original_unit_price)}
                            </span>
                            <span style={{ color: '#22c55e', fontWeight: 600 }}>
                              {fmt(item.effective_unit_price)}
                            </span>
                            {' '}× {item.quantity}
                          </div>
                          <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, marginTop: 2 }}>
                            {fmt(item.effective_unit_price * item.quantity)}
                          </div>
                          <div style={{ fontSize: 10, color: '#22c55e', marginTop: 2 }}>
                            Saved {fmt(item.line_discount)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 13, color: '#ccc' }}>
                            {fmt(item.unit_price)} × {item.quantity}
                          </div>
                          <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, marginTop: 2 }}>
                            {fmt(item.total_price || (item.unit_price * item.quantity))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {/* FIX Apr 2026 — Removed items history (Shopify-style).
                    Shopify Order Edit ke baad jo items hata diye gaye, woh
                    yahan dim/strikethrough style mein dikhte hain — bilkul
                    Shopify admin ki tarah. Operationally important: packers
                    ko clear visible ho ke kya hata hai. */}
                {removedItems.length > 0 && (
                  <>
                    <div style={{
                      padding: '10px 20px 6px 20px',
                      borderTop: `1px solid ${border}`,
                      fontSize: 11,
                      color: '#888',
                      textTransform: 'uppercase',
                      letterSpacing: 1,
                      background: 'rgba(239,68,68,0.04)',
                    }}>
                      Removed from order ({removedItems.length})
                    </div>
                    {removedItems.map((item, idx) => (
                      <div key={`removed-${idx}`} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '14px 20px',
                        borderTop: idx === 0 ? 'none' : `1px solid ${border}`,
                        background: 'rgba(239,68,68,0.02)',
                        opacity: 0.7,
                      }}>
                        <div style={{
                          width: 52, height: 52, borderRadius: 8,
                          background: '#1a1a1a', border: `1px solid ${border}`,
                          overflow: 'hidden', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {item.image_url
                            ? <img src={item.image_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(0.7)' }} />
                            : <span style={{ color: '#444', fontSize: 22 }}>📦</span>
                          }
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#bbb', textDecoration: 'line-through', wordBreak: 'break-word' }}>
                            {item.title || 'Untitled'}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                            <span style={{
                              fontSize: 9,
                              color: '#ef4444',
                              background: 'rgba(239,68,68,0.12)',
                              padding: '2px 7px',
                              borderRadius: 3,
                              fontWeight: 700,
                              letterSpacing: 0.5,
                            }}>
                              REMOVED
                            </span>
                            {item.sku && (
                              <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
                                SKU: {item.sku}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', whiteSpace: 'nowrap', color: '#777' }}>
                          <div style={{ fontSize: 13, textDecoration: 'line-through' }}>
                            {fmt(item.unit_price)} × {item.original_quantity}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, textDecoration: 'line-through' }}>
                            {fmt(item.total_price)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {/* Primary action strip — Shopify-style compound button */}
                {primaryAction && !isCancelled && (
                  <div style={{ padding: '14px 20px', borderTop: `1px solid ${border}`, background: 'rgba(201,169,110,0.03)', display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
                    <div style={{ display: 'inline-flex', position: 'relative' }}>
                      <button
                        onClick={primaryAction.onClick}
                        disabled={actionBusy}
                        style={{
                          background: '#1a1a1a',
                          border: `1px solid ${gold}`,
                          borderRight: fulfillSecondary.length > 0 ? 'none' : `1px solid ${gold}`,
                          color: gold,
                          borderRadius: fulfillSecondary.length > 0 ? '7px 0 0 7px' : 7,
                          padding: '9px 20px',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: actionBusy ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit',
                          opacity: actionBusy ? 0.5 : 1,
                        }}>
                        {actionBusy ? '⟳ Working…' : primaryAction.label}
                      </button>
                      {fulfillSecondary.length > 0 && (
                        <>
                          <button
                            onClick={toggleMenu('fulfill')}
                            disabled={actionBusy}
                            style={{
                              background: '#1a1a1a',
                              border: `1px solid ${gold}`,
                              color: gold,
                              borderRadius: '0 7px 7px 0',
                              padding: '9px 10px',
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: actionBusy ? 'not-allowed' : 'pointer',
                              fontFamily: 'inherit',
                              opacity: actionBusy ? 0.5 : 1,
                              borderLeft: '1px solid rgba(0,0,0,0.3)',
                            }}>
                            ▾
                          </button>
                          {openMenu === 'fulfill' && (
                            <div
                              onClick={e => e.stopPropagation()}
                              style={{
                                position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                                background: '#0f0f0f', border: `1px solid ${border}`,
                                borderRadius: 8, padding: 5, minWidth: 200, zIndex: 50,
                                boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                              }}
                            >
                              {fulfillSecondary.map(opt => (
                                <MenuItem
                                  key={opt.status}
                                  icon={opt.icon}
                                  label={opt.label}
                                  onClick={() => { setOpenMenu(null); setStatus(opt.status); }}
                                />
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Status & Dispatch info — unchanged */}
            <Card title="Status & Dispatch" overflowVisible>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>🏢 Office Status</div>
                  <StatusBadge status={order.status} />
                  {order.confirmed_at && (
                    <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                      Confirmed {timeAgo(order.confirmed_at)}
                    </div>
                  )}
                </div>
                <div style={{ background: '#0f0f0f', border: `1px solid #2a1a4a`, borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>🚚 Courier Status</div>
                  {order.courier_status_raw
                    ? <span style={{ color: '#8b5cf6', background: '#8b5cf611', border: '1px solid #8b5cf633', padding: '3px 10px', borderRadius: 5, fontSize: 12, fontWeight: 600 }}>{order.courier_status_raw}</span>
                    : <span style={{ color: '#444', fontSize: 12 }}>Not dispatched yet</span>}
                  {order.courier_last_synced_at && (
                    <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                      Last sync {timeAgo(order.courier_last_synced_at)}
                    </div>
                  )}
                </div>
              </div>

              {order.dispatched_courier && (
                <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 8, padding: '12px 14px' }}>
                  <Row label="Courier" value={order.dispatched_courier} />
                  <Row
                    label="Tracking #"
                    value={order.tracking_number
                      ? (order.courier_tracking_url
                        ? <a href={order.courier_tracking_url} target="_blank" rel="noopener noreferrer" style={{ color: gold, textDecoration: 'none', fontFamily: 'monospace' }}>{order.tracking_number} ↗</a>
                        : <span style={{ fontFamily: 'monospace' }}>{order.tracking_number}</span>)
                      : null}
                  />
                  <Row label="Dispatched at" value={formatShortDate(order.dispatched_at)} />
                  {order.courier_slip_url && (
                    <Row label="Slip" value={<a href={order.courier_slip_url} target="_blank" rel="noopener noreferrer" style={{ color: gold, textDecoration: 'none' }}>📄 Print slip ↗</a>} />
                  )}
                  {order.delivered_at && <Row label="Delivered at" value={formatShortDate(order.delivered_at)} color="#22c55e" />}
                </div>
              )}

              {/* Inline secondary actions — preserved exactly */}
              {!isCancelled && (
                <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {/* Apr 27 2026 — "✏️ Edit customer info" button moved to
                      Customer card sidebar (Shopify-style "..." menu).
                      See Customer card below. */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setShowStatusMenu(v => !v)}
                      style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#ccc', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                      🔄 Change status ▾
                    </button>
                    {showStatusMenu && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 8, padding: 6, minWidth: 180, zIndex: 50, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                        {statusOptions.map(s => (
                          <button
                            key={s}
                            onClick={() => setStatus(s)}
                            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: '#ccc', fontSize: 12, padding: '7px 10px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <StatusBadge status={s} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {!isDelivered && (
                    <button
                      onClick={() => setShowCancelBox(v => !v)}
                      style={{ background: '#1a0000', border: '1px solid #660000', color: '#ef4444', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                      ✕ Cancel order
                    </button>
                  )}

                  {/* Apr 2026 — Cancel Fulfillment button.
                      Visible jab order pe tracking/fulfillment hai aur user
                      CEO/Dispatcher hai. Tracking + courier clear ho jate,
                      dispatched → confirmed wapas. Shopify pe bhi cancel hoti
                      (ya already cancelled toh skip). Re-book ke liye safe. */}
                  {canPack && (order.shopify_fulfillment_id || order.tracking_number || order.dispatched_courier) && order.status !== 'cancelled' && (
                    <button
                      onClick={cancelFulfillment}
                      disabled={actionBusy}
                      style={{ background: '#1a1a1a', border: '1px solid #f59e0b66', color: '#f59e0b', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: actionBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: actionBusy ? 0.5 : 1 }}>
                      🔄 Cancel fulfillment
                    </button>
                  )}
                </div>
              )}

              {showCancelBox && (
                <div style={{ marginTop: 12, padding: 14, background: '#1a0000', border: '1px solid #660000', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>Cancel reason (required)</div>
                  <textarea
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                    rows={2}
                    placeholder="Kyun cancel kar rahe ho..."
                    style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }}
                  />

                  {/* Apr 2026 — Force cancel checkbox for super_admin only,
                      visible only when order is in post-dispatch state */}
                  {isCEO && NO_CANCEL_FROM_UI.has(order.status) && (
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, padding: '8px 10px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={forceCancel} onChange={e => setForceCancel(e.target.checked)} style={{ cursor: 'pointer', marginTop: 3 }} />
                      <span style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.4 }}>
                        <strong>Force cancel (admin override)</strong><br/>
                        <span style={{ color: '#999', fontSize: 10 }}>
                          Status '{order.status}' se cancel hoga. Yeh cleanup scenarios ke liye hai (out-of-sync orders, etc.)
                        </span>
                      </span>
                    </label>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setShowCancelBox(false); setCancelReason(''); setForceCancel(false); }}
                      style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Back
                    </button>
                    <button onClick={cancelOrder} disabled={actionBusy || !cancelReason.trim()}
                      style={{ background: '#ef4444', border: '1px solid #ef4444', color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: (actionBusy || !cancelReason.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (actionBusy || !cancelReason.trim()) ? 0.5 : 1 }}>
                      {actionBusy ? 'Cancelling…' : (forceCancel ? '⚡ Force cancel' : 'Confirm cancel')}
                    </button>
                  </div>
                </div>
              )}
            </Card>

            {/* Payment Summary — Shopify-style with Collect payment button */}
            <Card
              title={
                <span style={{
                  background: isPaid ? 'rgba(34,197,94,0.15)' : isRefunded ? 'rgba(156,163,175,0.15)' : 'rgba(245,158,11,0.15)',
                  color: isPaid ? '#22c55e' : isRefunded ? '#9ca3af' : '#f59e0b',
                  border: `1px solid ${isPaid ? '#22c55e44' : isRefunded ? '#9ca3af44' : '#f59e0b44'}`,
                  padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                }}>
                  {isPaid ? '✓ Paid' : isRefunded ? 'Refunded' : 'Payment pending'}
                </span>
              }
              overflowVisible
            >
              <Row label={`Subtotal (${items.length} item${items.length !== 1 ? 's' : ''})`} value={fmt(subtotal)} />
              {discount > 0 && (
                <Row
                  label={
                    <span>
                      Discount
                      {discountLabel && (
                        <span style={{
                          marginLeft: 8,
                          fontSize: 10,
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: 'rgba(34,197,94,0.12)',
                          color: '#22c55e',
                          fontFamily: 'monospace',
                          fontWeight: 600,
                          letterSpacing: 0.5,
                        }}>
                          {discountLabel}
                        </span>
                      )}
                    </span>
                  }
                  value={<span style={{ color: '#f87171' }}>-{fmt(discount)}</span>}
                />
              )}
              <Row label="Shipping" value={fmt(shipping)} />
              <div style={{ borderTop: `1px solid ${border}`, margin: '8px 0', paddingTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700 }}>
                  <span style={{ color: '#fff' }}>Total</span>
                  <span style={{ color: '#fff' }}>{fmt(total)}</span>
                </div>
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${border}` }}>
                <Row label="Paid" value={<span style={{ color: paidAmt > 0 ? '#22c55e' : '#e5e5e5' }}>{fmt(paidAmt)}</span>} />
                <Row label="Balance" value={<span style={{ color: balance > 0 ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>{fmt(balance)}</span>} />
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${border}`, fontSize: 11, color: '#666' }}>
                Payment method: <span style={{ color: '#888' }}>{order.payment_method || 'COD'}</span>
              </div>

              {/* Collect payment button — only when unpaid and not cancelled */}
              {!isPaid && !isRefunded && !isCancelled && balance > 0 && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={toggleMenu('payment')}
                      style={{
                        background: '#1a1a1a',
                        border: `1px solid ${gold}`,
                        color: gold,
                        borderRadius: 7,
                        padding: '8px 18px',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}>
                      💰 Collect payment ▾
                    </button>
                    {openMenu === 'payment' && (
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{
                          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                          background: '#0f0f0f', border: `1px solid ${border}`,
                          borderRadius: 8, padding: 5, minWidth: 200, zIndex: 50,
                          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                        }}
                      >
                        <MenuItem icon="✓" label="Mark as paid" sub="ERP + Shopify dono sync honge"
                          onClick={() => { setOpenMenu(null); setShowPaidConfirm(true); }} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Phase 2: Mark as Paid confirmation box */}
              {showPaidConfirm && !isPaid && !isCancelled && (
                <div style={{ marginTop: 14, padding: 14, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8 }}>
                  <div style={{ fontSize: 13, color: '#4ade80', marginBottom: 6, fontWeight: 600 }}>
                    ✓ Confirm: Mark as Paid
                  </div>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10, lineHeight: 1.5 }}>
                    Order amount <strong style={{ color: '#fff' }}>{fmt(total)}</strong> paid mark ho jaayega.
                    {order.shopify_order_id
                      ? ' Shopify pe bhi "Paid" dikhane lagega.'
                      : ' (Manual order — sirf ERP mein mark hoga)'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowPaidConfirm(false)}
                      style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Cancel
                    </button>
                    <button onClick={markAsPaid} disabled={actionBusy}
                      style={{ background: '#22c55e', border: '1px solid #22c55e', color: '#000', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: actionBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: actionBusy ? 0.5 : 1 }}>
                      {actionBusy ? 'Marking…' : '✓ Yes, mark as paid'}
                    </button>
                  </div>
                </div>
              )}
            </Card>

            {/* Timeline — unchanged */}
            <Card title={`Timeline (${timeline.filter(l => !(l.action || '').startsWith('webhook:')).length})`}>
              {/* Comment input */}
              <div style={{ marginBottom: 14, padding: '12px', background: '#0f0f0f', borderRadius: 8, border: `1px solid ${border}` }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: gold + '22', color: gold, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                    {(performer[0] || '?').toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <textarea
                      value={commentText}
                      onChange={e => setCommentText(e.target.value)}
                      placeholder="Leave a comment… (internal note)"
                      rows={2}
                      style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }}
                    />
                    {commentText.trim() && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                        <button onClick={addComment} disabled={actionBusy}
                          style={{ background: gold, border: 'none', color: '#000', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: actionBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: actionBusy ? 0.5 : 1 }}>
                          {actionBusy ? '...' : 'Post'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Log */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(() => {
                  // Apr 2026 — Hide webhook entries (Shopify sync noise).
                  // Action prefix `webhook:` waale entries staff ke liye useless
                  // hain. Sirf meaningful events dikhayenge: confirmations,
                  // status changes, comments, dispatches, etc.
                  const visibleTimeline = timeline.filter(l => !(l.action || '').startsWith('webhook:'));

                  if (visibleTimeline.length === 0) {
                    return <div style={{ textAlign: 'center', color: '#555', fontSize: 12, padding: 20 }}>No activity yet</div>;
                  }

                  return visibleTimeline.map(l => {
                    const isComment = l.action === 'staff_comment';
                    // Owner = jis user ne yeh comment likhi (apne email se match)
                    const isOwnComment = isComment && l.performed_by_email && l.performed_by_email === userEmail;
                    const isEditing = editingId === l.id;
                    const wasEdited = !!l.edited_at;

                    const actionColor = l.action?.startsWith('protocol_violation') ? '#f87171'
                      : l.action === 'confirmed' ? '#3b82f6'
                      : l.action === 'dispatched' ? '#a855f7'
                      : l.action === 'delivered' ? '#22c55e'
                      : l.action === 'cancelled' ? '#ef4444'
                      : gold;

                    return (
                      <div key={l.id} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: isComment ? 'rgba(201,169,110,0.05)' : '#0f0f0f', border: `1px solid ${border}`, borderRadius: 7 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: actionColor + '22', color: actionColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>
                          {isComment ? '💬' : '•'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* Header row: action label + edit/delete (own comments only) */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontSize: 12, color: actionColor, fontWeight: 600 }}>
                              {(l.action || '').replace(/_/g, ' ')}
                              {wasEdited && (
                                <span style={{ marginLeft: 6, fontSize: 10, color: '#888', fontWeight: 400, fontStyle: 'italic' }}>
                                  (edited)
                                </span>
                              )}
                            </div>
                            {isOwnComment && !isEditing && (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  onClick={() => startEditComment(l)}
                                  disabled={actionBusy}
                                  title="Edit"
                                  style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12, padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit' }}
                                  onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.color = gold; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888'; }}>
                                  ✏️
                                </button>
                                <button
                                  onClick={() => deleteComment(l.id)}
                                  disabled={actionBusy}
                                  title="Delete"
                                  style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12, padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit' }}
                                  onMouseEnter={e => { e.currentTarget.style.background = '#1a0000'; e.currentTarget.style.color = '#ef4444'; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888'; }}>
                                  🗑
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Body: textarea (edit mode) ya plain text */}
                          {isEditing ? (
                            <div style={{ marginTop: 6 }}>
                              <textarea
                                value={editingText}
                                onChange={e => setEditingText(e.target.value)}
                                rows={2}
                                style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '6px 8px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }}
                              />
                              <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                                <button onClick={cancelEditComment} disabled={actionBusy}
                                  style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                                  Cancel
                                </button>
                                <button onClick={saveEditComment} disabled={actionBusy || !editingText.trim()}
                                  style={{ background: gold, border: 'none', color: '#000', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: (actionBusy || !editingText.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (actionBusy || !editingText.trim()) ? 0.5 : 1 }}>
                                  {actionBusy ? '...' : 'Save'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            l.notes && <div style={{ fontSize: 13, color: '#ccc', marginTop: 3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{l.notes}</div>
                          )}

                          <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                            {l.performed_by || 'System'} · {formatShortDate(l.performed_at)}
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </Card>
          </div>

          {/* ═══ RIGHT SIDEBAR ═══ (unchanged) */}
          <div>

            {/* Notes (confirmation_notes) */}
            <Card title="Notes">
              {order.confirmation_notes
                ? <div style={{ fontSize: 13, color: '#ccc', whiteSpace: 'pre-wrap' }}>{order.confirmation_notes}</div>
                : <div style={{ fontSize: 12, color: '#555', fontStyle: 'italic' }}>No notes from customer</div>}
            </Card>

            {/* Customer */}
            {/* Apr 27 2026 — Shopify-style "..." kebab menu in Customer Card.
                Replaces the inline "Edit customer info" button that used to
                sit in the secondary actions row. Click "..." to get options
                that all open the existing edit drawer. */}
            <Card title="Customer" overflowVisible right={
              !isCancelled && (
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === 'customer-edit' ? null : 'customer-edit'); }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#888',
                      fontSize: 18,
                      cursor: 'pointer',
                      padding: '2px 8px',
                      borderRadius: 5,
                      lineHeight: 1,
                      fontFamily: 'inherit',
                    }}
                    title="Customer actions"
                    onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >⋯</button>
                  {openMenu === 'customer-edit' && (
                    <>
                      {/* Backdrop to close on outside click */}
                      <div
                        onClick={() => setOpenMenu(null)}
                        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                      />
                      <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        right: 0,
                        background: '#0f0f0f',
                        border: `1px solid ${border}`,
                        borderRadius: 8,
                        padding: 4,
                        minWidth: 220,
                        zIndex: 50,
                        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                      }}>
                        <button
                          onClick={() => { setOpenMenu(null); setDrawerInitialTab('customer'); setShowDrawer(true); }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: '#ccc', fontSize: 13, padding: '8px 12px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          ✏️ Edit contact information
                        </button>
                        <button
                          onClick={() => { setOpenMenu(null); setDrawerInitialTab('customer'); setShowDrawer(true); }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: '#ccc', fontSize: 13, padding: '8px 12px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          📍 Edit shipping address
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            }>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{order.customer_name || 'Unknown'}</div>
              {order.customer_order_count > 0 && (
                <Link href={`/customers?phone=${encodeURIComponent(order.customer_phone || '')}`}
                  style={{ fontSize: 12, color: gold, textDecoration: 'none', display: 'inline-block', marginTop: 6 }}>
                  {order.customer_order_count === 1 ? '1st order' : `${order.customer_order_count} orders total`} →
                </Link>
              )}
            </Card>

            {/* Contact */}
            <Card title="Contact information">
              {order.customer_phone ? (
                <a href={`tel:${order.customer_phone}`} style={{ fontSize: 13, color: gold, textDecoration: 'none' }}>
                  {order.customer_phone}
                </a>
              ) : <div style={{ fontSize: 12, color: '#555' }}>No phone</div>}
              <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>No email provided</div>
            </Card>

            {/* Shipping address */}
            <Card title="Shipping address">
              <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.55 }}>
                <div style={{ color: '#fff', fontWeight: 500 }}>{order.customer_name || '—'}</div>
                {order.customer_address && <div>{order.customer_address}</div>}
                {order.customer_city && <div>{order.customer_city}</div>}
                <div>Pakistan</div>
                {order.customer_phone && <div style={{ marginTop: 4 }}>{order.customer_phone}</div>}
              </div>
              {order.customer_address && (
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(`${order.customer_address}, ${order.customer_city || ''}`)}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: gold, textDecoration: 'none', display: 'inline-block', marginTop: 10 }}
                >
                  View on map ↗
                </a>
              )}
            </Card>

            {/* Billing address (Shopify-style — same as shipping for COD) */}
            <Card title="Billing address">
              <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>Same as shipping address</div>
            </Card>

            {/* Assignment */}
            <Card title="Assigned to">
              {order.assigned_to_name ? (
                <div style={{ fontSize: 13, color: '#f59e0b', fontWeight: 600, marginBottom: 10 }}>
                  👤 {order.assigned_to_name}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#555', marginBottom: 10, fontStyle: 'italic' }}>Not assigned yet</div>
              )}
              {packingStaff.length > 0 && !isCancelled && (
                <select
                  value=""
                  onChange={e => { if (e.target.value) assignTo(e.target.value); }}
                  disabled={actionBusy}
                  style={{ width: '100%', background: '#0f0f0f', border: `1px solid ${border}`, color: '#ccc', borderRadius: 6, padding: '7px 10px', fontSize: 12, fontFamily: 'inherit' }}
                >
                  <option value="">Change / assign…</option>
                  {packingStaff.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
            </Card>

            {/* Tags */}
            <Card title="Tags">
              {Array.isArray(order.tags) && order.tags.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {order.tags.map((tag, i) => (
                    <span key={i} style={{ color: '#9ca3af', background: '#1f1f2e', border: '1px solid #2a2a44', padding: '3px 8px', borderRadius: 4, fontSize: 11 }}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#555', fontStyle: 'italic' }}>No tags</div>
              )}
            </Card>

            {/* Metadata */}
            <Card title="Order info">
              <Row label="Created" value={formatShortDate(order.created_at)} />
              <Row label="Updated" value={formatShortDate(order.updated_at)} />
              {order.shopify_order_id && <Row label="Shopify ID" value={order.shopify_order_id} mono />}
              {order.shopify_synced_at && <Row label="Last synced" value={timeAgo(order.shopify_synced_at)} />}
              <Row label="Order type" value={order.is_wholesale ? 'Wholesale' : order.is_international ? 'International' : order.is_walkin ? 'Walk-in' : 'Retail'} />
            </Card>
          </div>
        </div>
      </div>

      {/* Drawer overlay — opens on Edit/Dispatch button click */}
      {showDrawer && (
        <OrderDrawer
          order={order}
          onClose={() => setShowDrawer(false)}
          onRefresh={refreshAll}
          performer={performer}
          variant="drawer"
          defaultTab={drawerInitialTab}
        />
      )}
    </div>
  );
}
