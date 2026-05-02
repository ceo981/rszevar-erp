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
  StatusBadge, PaymentBadge, fmt, timeAgo, ordinal,
  gold, card, border, STATUS_CONFIG, NO_CANCEL_FROM_UI,
} from '../_components/OrderDrawer';
import EditCustomerModal from '../_components/EditCustomerModal';
import EditShippingModal from '../_components/EditShippingModal';
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
function Card({ title, children, pad = '18px 20px', noPadBody = false, overflowVisible = false, right = null, id = null }) {
  return (
    <div id={id || undefined} style={{
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
  // May 2 2026 — Assign permission: CEO/manager can assign packer regardless of fulfill status
  const canAssign  = isCEO || isOpsManager;

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
  // Apr 30 2026 — Review tab actions (WhatsApp-cancelled orders).
  // 'confirm_cancel' => push cancellation to Shopify + clear review tags
  // 'restore'        => bring back to confirmed + WA notify customer
  const [reviewMode, setReviewMode] = useState(null);   // null | 'confirm_cancel' | 'restore'
  const [reviewNote, setReviewNote] = useState('');
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  // Apr 27 2026 — Track which tab to open drawer on. 'customer' jab kebab
  // menu se khule, 'actions' jab dispatch button etc. se khule.
  const [drawerInitialTab, setDrawerInitialTab] = useState('actions');

  // May 2026 — Shopify-style modal popups for customer/shipping edit (replaces
  // the older flow that opened the drawer's Customer tab). The drawer was the
  // only edit path when /api/orders/edit was broken — now restored, both flows
  // (modal AND drawer-tab) save through the same endpoint.
  const [showEditCustomer, setShowEditCustomer] = useState(false);
  const [showEditShipping, setShowEditShipping] = useState(false);

  // Phase 1 NEW: dropdown state for header/card menus (Print / More / Fulfill / Payment)
  const [openMenu, setOpenMenu] = useState(null);

  // Phase 2 NEW: confirmation box state for Mark as Paid (irreversible-ish, needs confirmation)
  const [showPaidConfirm, setShowPaidConfirm] = useState(false);
  // Apr 30 2026 — Payment method picker. When user clicks a specific method
  // (Cash / Bank Alfalah / Meezan / Easypaisa / JazzCash) we open this with
  // the method preset. For digital methods, screenshot upload is enabled.
  // null = no modal open. Object = { method: 'Cash'|..., requireProof: bool }.
  const [paymentMethodModal, setPaymentMethodModal] = useState(null);
  const [paymentProofFile, setPaymentProofFile] = useState(null);
  const [paymentProofUrl, setPaymentProofUrl] = useState('');
  const [paymentProofUploading, setPaymentProofUploading] = useState(false);
  const [paymentMethodNote, setPaymentMethodNote] = useState('');

  // Apr 2026 — Customer mini-history (last 3 orders by phone) for sidebar inline preview
  const [customerHistory, setCustomerHistory] = useState([]);

  // Apr 2026 — Manual Fulfill modal state.
  // For orders where team books courier outside ERP (e.g. Kangaroo via Shopify
  // app, Leopards via their own portal) OR walk-in/wholesale/pickup with no
  // tracking. Adds tracking + courier + creates Shopify fulfillment.
  const [showFulfillModal, setShowFulfillModal]   = useState(false);
  const [fulfillTracking, setFulfillTracking]     = useState('');
  const [fulfillCourier, setFulfillCourier]       = useState('');           // '' = auto-detect
  const [fulfillNotify, setFulfillNotify]         = useState(true);
  const [fulfillReason, setFulfillReason]         = useState('');
  const [fulfillCourierManuallyEdited, setFulfillCourierManuallyEdited] = useState(false);

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

  // Apr 2026 — Listen for "openFulfillModal" custom event from drawer.
  // Drawer dispatches this when user clicks "📋 Open fulfill modal" on the
  // confirmed-status fulfill section. We open our existing modal here.
  useEffect(() => {
    const handler = (e) => {
      // Only respond if the event matches THIS order id (drawer may live
      // in a different page context with multiple orders).
      if (!e?.detail || String(e.detail) === String(id)) {
        setShowFulfillModal(true);
      }
    };
    window.addEventListener('openFulfillModal', handler);
    return () => window.removeEventListener('openFulfillModal', handler);
  }, [id]);
  useEffect(() => { loadPackingStaff(); }, [loadPackingStaff]);

  // Apr 2026 — Fetch customer's last 4 orders by phone (for sidebar mini-history)
  // Excludes current order. Only runs if customer_phone exists and customer_order_count > 1.
  useEffect(() => {
    if (!order?.customer_phone || (order.customer_order_count || 0) < 2) {
      setCustomerHistory([]);
      return;
    }
    fetch(`/api/orders?search=${encodeURIComponent(order.customer_phone)}&limit=4`)
      .then(r => r.json())
      .then(d => {
        const others = (d.orders || []).filter(o => o.id !== order.id).slice(0, 3);
        setCustomerHistory(others);
      })
      .catch(() => setCustomerHistory([]));
  }, [order?.customer_phone, order?.customer_order_count, order?.id]);

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

  // Apr 30 2026 — Resolve a Review-tab order (WA-cancelled).
  // action: 'confirm_cancel' | 'restore'. Closes the inline strip on success
  // and refreshes — order will leave the Review tab.
  const resolveReview = async (action) => {
    const successMsg = action === 'confirm_cancel'
      ? '✓ Cancellation confirmed — pushed to Shopify'
      : '✓ Order restored — customer notified';
    await doAction('/api/orders/review/resolve', {
      order_id: id,
      action,
      notes: reviewNote.trim() || undefined,
    }, successMsg);
    setReviewMode(null);
    setReviewNote('');
  };

  // Apr 2026 — Mark as Packed
  // 1. Uses /api/orders/assign with action:'packed' (writes packing_log for HR Leaderboard credit).
  //    Direct /api/orders/status call would skip packing_log. See app/api/orders/assign/route.js.
  // 2. Frontend guard: order MUST have an assigned packer first. Without
  //    assignment, packing_log can't attribute the credit. Backend route
  //    also enforces this, but frontend gives a clearer error.
  const markPacked = () => {
    if (!order.assigned_to_name) {
      flash('error', '⚠️ Pehle packer assign karo — right sidebar ke "Assigned to" card se select karo', 6000);
      // UX boost — scroll the Assigned to card into view + brief gold pulse
      // so user knows EXACTLY where to look (especially on small screens
      // where the right sidebar is below the main content).
      if (typeof document !== 'undefined') {
        const el = document.getElementById('assigned-to-card');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const orig = el.style.boxShadow;
          el.style.transition = 'box-shadow 0.4s';
          el.style.boxShadow = '0 0 0 3px rgba(201,169,110,0.6), 0 0 24px rgba(201,169,110,0.4)';
          setTimeout(() => { el.style.boxShadow = orig; }, 2500);
        }
      }
      return;
    }
    doAction(
      '/api/orders/assign',
      { order_id: id, action: 'packed', performed_by: performer, performed_by_email: userEmail },
      '✓ Marked as Packed',
    );
  };

  const setStatus    = (s) => { setShowStatusMenu(false); doAction('/api/orders/status', { order_id: id, status: s }, `✓ Status → ${s}`); };

  // Phase 2: Mark as Paid — ERP + Shopify sync (shows richer success/warning)
  // Apr 30 2026 — Method-aware. Optional payment_method ('Cash' | 'Bank Alfalah' |
  // 'Meezan Bank' | 'Easypaisa' | 'JazzCash' | 'Manual'), optional proof URL
  // (Supabase storage public link), and optional staff note. Backwards-
  // compatible — if no args passed, behaves like the old generic mark-paid.
  const markAsPaid = async (opts = {}) => {
    const { payment_method, payment_proof_url, note } = opts;
    setShowPaidConfirm(false);
    setOpenMenu(null);
    setActionBusy(true);
    try {
      const r = await fetch('/api/orders/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: id,
          payment_method,
          payment_proof_url,
          note,
          performed_by: performer,
          performed_by_email: userEmail,
        }),
      });
      const d = await r.json();
      if (d.success) {
        const methodTag = payment_method ? ` (${payment_method})` : '';
        const msgText = d.shopify_synced
          ? (d.shopify_already_paid
            ? `✓ Paid${methodTag} (Shopify already paid)`
            : `✓ Paid${methodTag} — Shopify synced`)
          : (d.warning
            ? `⚠ Paid in ERP${methodTag} — Shopify sync failed: ${d.warning}`
            : `✓ Paid${methodTag}`);
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

  // Apr 2026 — Toggle order type tag (walkin / international / wholesale).
  // Manual ERP-side toggling — pehle yeh tags rszevar.com platform se aate the,
  // ab team yahin se manage karegi. Tag sirf informational hai — koi
  // auto-action trigger nahi karta. Best-effort sync to rszevar.com platform.
  const toggleOrderTypeTag = async (tag, newValue) => {
    setActionBusy(true);
    try {
      const r = await fetch('/api/orders/update-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: id,
          tag,
          value: newValue,
          performed_by: performer,
          performed_by_email: userEmail,
        }),
      });
      const d = await r.json();
      if (d.success) {
        const action = newValue ? 'added' : 'removed';
        const platformNote = d.platform_synced === false ? ' (platform sync pending)' : '';
        flash('success', `✓ ${d.label} ${action}${platformNote}`, 4000);
        await refreshAll();
      } else {
        flash('error', d.error || 'Tag update failed', 5000);
      }
    } catch (e) {
      flash('error', e.message, 5000);
    }
    setActionBusy(false);
  };

  // May 2 2026 — Convert order to credit (udhaar) — Step 6 of customer credits feature.
  // Uses dedicated /convert-to-credit endpoint instead of toggleOrderTypeTag because:
  //   1. This change ALSO affects status (auto-deliver if not terminal)
  //   2. Has revert path that needs warnings if payments already allocated
  //   3. Different audit trail entry (credit_converted vs tag change)
  const toggleCreditOrder = async (newValue) => {
    const isCurrentlyCredit = !!order.is_credit_order;
    if (isCurrentlyCredit === newValue) return;  // no-op

    let confirmMsg;
    let url = `/api/orders/${id}/convert-to-credit`;
    let reasonPrompt;

    if (newValue) {
      // Converting TO credit
      const TERMINAL = ['delivered', 'cancelled', 'returned'];
      const willAutoDeliver = !TERMINAL.includes(order.status);
      confirmMsg = willAutoDeliver
        ? `Order ko credit (udhaar) mark karna hai?\n\n` +
          `Yeh hoga:\n` +
          `• is_credit_order = true\n` +
          `• Status auto: ${order.status} → delivered\n` +
          `• Payment status unpaid rahega\n` +
          `• Customer Credits dashboard mein dikhe ga\n\n` +
          `Continue?`
        : `Order ko credit (udhaar) mark karna hai?\n\nCustomer Credits dashboard mein dikhe ga.\nContinue?`;
      reasonPrompt = 'Reason / note (optional):';
    } else {
      // Reverting from credit
      url += '?revert=true';
      confirmMsg =
        `Credit mark hata dein?\n\n` +
        `WARNING: Agar is order pe payments allocate hain, woh customer ke khaata mein rahengi.\n` +
        `Pehle payments void karna behtar hai agar zaroori ho.\n\n` +
        `Continue?`;
      reasonPrompt = 'Revert reason:';
    }

    if (!window.confirm(confirmMsg)) return;
    const reason = window.prompt(reasonPrompt, '');
    if (reason === null) return;  // user cancelled

    setActionBusy(true);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          performed_by: performer,
          performed_by_email: userEmail,
          reason: reason || undefined,
        }),
      });
      const text = await r.text();
      let d;
      try { d = JSON.parse(text); }
      catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 100)}`); }

      if (d.success) {
        flash('success', d.message || (newValue ? '✓ Converted to credit order' : '✓ Reverted from credit'), 4000);
        if (Array.isArray(d.warnings) && d.warnings.length > 0) {
          // Show warnings as separate alerts after a slight delay (so flash is visible first)
          setTimeout(() => alert('Warnings:\n\n' + d.warnings.join('\n\n')), 800);
        }
        await refreshAll();
      } else {
        flash('error', d.error || 'Credit toggle failed', 5000);
      }
    } catch (e) {
      flash('error', e.message, 5000);
    }
    setActionBusy(false);
  };

  // Apr 2026 — Cancel Shopify fulfillment from ERP. Reverses dispatch:
  // tracking removed, courier cleared, status reverted (dispatched → confirmed).
  const cancelFulfillment = async () => {
    const reason = window.prompt('Fulfillment cancel karne ki wajah likho:\n(Tracking + courier hat jayegi, status confirmed pe wapas chala jayega)');
    if (reason === null) return; // user cancelled
    await doAction('/api/orders/cancel-fulfillment', { order_id: id, reason: reason || 'No reason' }, '✓ Fulfillment cancelled — tracking removed');
  };

  // Apr 2026 — Auto-detect courier from tracking number prefix.
  // Mirrors lib/shopify.js#detectCourierFromTracking. Used in fulfill modal
  // for live preview as user types.
  //   "KI..." → Leopards
  //   "KL..." → Kangaroo
  //   else    → "" (user picks manually or leaves as Other)
  const detectCourierFromTrackingClient = (tracking) => {
    if (!tracking) return '';
    const t = String(tracking).trim().toUpperCase();
    if (t.startsWith('KI')) return 'Leopards';
    if (t.startsWith('KL')) return 'Kangaroo';
    return '';
  };

  // Effective courier: explicit edit > auto-detect from tracking > empty (=> "Other"/Pickup on backend)
  const effectiveFulfillCourier = (() => {
    if (fulfillCourierManuallyEdited && fulfillCourier) return fulfillCourier;
    const auto = detectCourierFromTrackingClient(fulfillTracking);
    if (auto) return auto;
    return fulfillCourier; // user-picked or empty
  })();

  // Apr 2026 — Manual Fulfill submit handler. Calls /api/orders/manual-fulfill.
  // Closes modal + refreshes data on success.
  const submitManualFulfill = async () => {
    setActionBusy(true);
    try {
      const r = await fetch('/api/orders/manual-fulfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: id,
          tracking_number: fulfillTracking.trim() || null,
          courier: effectiveFulfillCourier || null,
          notify_customer: fulfillNotify,
          reason: fulfillReason.trim() || null,
          performed_by: performer,
          performed_by_email: userEmail,
        }),
      });
      const d = await r.json();
      if (d.success) {
        const trackInfo = d.tracking_number
          ? `Tracking: ${d.tracking_number} (${d.courier})`
          : `Marked fulfilled (${d.courier} — no tracking)`;
        const shopifyInfo = d.shopify_synced
          ? ' — Shopify synced'
          : (d.warning ? ` — Shopify warning: ${d.warning}` : '');
        flash('success', `✓ ${trackInfo}${shopifyInfo}`, 6000);
        // Reset modal state
        setShowFulfillModal(false);
        setFulfillTracking('');
        setFulfillCourier('');
        setFulfillCourierManuallyEdited(false);
        setFulfillReason('');
        setFulfillNotify(true);
        await refreshAll();
      } else {
        flash('error', d.error || 'Manual fulfill failed', 6000);
      }
    } catch (e) {
      flash('error', e.message, 6000);
    }
    setActionBusy(false);
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

  // ─── Primary action based on status (Apr 2026 flow refactor) ─────────────
  // Office workflow: pending → confirmed → on_packing (after fulfill) → packed → dispatched
  //   pending      : Confirm Order (manager/CSR call answered)
  //   confirmed    : Add Tracking / Fulfill (slip nikalo, courier book — primary)
  //   on_packing   : Mark as Packed (dispatcher confirms physical packing — packer must be assigned first)
  //   packed       : Dispatch Order (parcel office se nikla)
  //   attempted/hold: Confirm (back to confirmed — try again)
  //
  // Note: courier_status_raw chalti rahegi independently — yeh sab sirf
  // OFFICE status hai. Booking/tracking metadata fulfill step pe save hoti hai.
  let primaryAction = null;
  if (order.status === 'pending' && canConfirm) {
    primaryAction = { label: '✓ Confirm Order', onClick: confirmOrder };
  } else if (order.status === 'confirmed' && !order.shopify_fulfillment_id) {
    primaryAction = { label: '📋 Add Tracking / Fulfill', onClick: () => setShowFulfillModal(true) };
  } else if (order.status === 'on_packing') {
    primaryAction = { label: '📦 Mark as Packed', onClick: markPacked };
  } else if (order.status === 'packed') {
    primaryAction = { label: '🚚 Dispatch Order', onClick: () => doAction('/api/orders/status', { order_id: id, status: 'dispatched' }, '✓ Dispatched') };
  } else if (order.status === 'attempted' || order.status === 'hold') {
    primaryAction = { label: '✓ Confirm Order', onClick: confirmOrder };
  } else if (order.status === 'confirmed' && order.shopify_fulfillment_id) {
    // Edge case: confirmed + already-fulfilled (e.g. Shopify webhook delayed advance)
    // Skip the fulfill step, jump straight to packing prompt.
    primaryAction = { label: '📦 Mark as Packed', onClick: markPacked };
  }

  const statusOptions = Object.keys(STATUS_CONFIG).filter(s => s !== order.status && s !== 'cancelled');

  // Fulfill dropdown items — secondary actions next to primary button
  const fulfillSecondary = [
    { status: 'on_packing', label: 'Mark as in progress', icon: '🟡', show: order.status !== 'on_packing' && !isCancelled && !isDelivered && order.status !== 'dispatched' },
    { status: 'hold',       label: 'Mark as on hold',     icon: '⏸', show: order.status !== 'hold' && !isCancelled && !isDelivered && order.status !== 'dispatched' },
    // Manual fulfill secondary entry — only shown when fulfill is NOT already
    // the primary action. Useful for emergency fulfill from on_packing/packed
    // (e.g. user reverted, needs to re-add tracking after cancel-fulfillment).
    {
      status: '__manual_fulfill__',
      label: order.shopify_fulfillment_id ? 'Already fulfilled' : '📋 Add tracking / Fulfill',
      icon:  '📋',
      show: ['on_packing', 'packed'].includes(order.status) && !order.shopify_fulfillment_id && !isCancelled,
      customAction: () => setShowFulfillModal(true),
    },
  ].filter(x => x.show);

  // ─── Assignment availability ───────────────────────────────────────────
  // Apr 2026 — Assignment is only valid AFTER fulfillment. Before that
  // (pending/confirmed), the order is still in CSR/manager territory; the
  // packer hasn't received it yet. Once fulfilled (status >= on_packing OR
  // shopify_fulfillment_id present), assignment dropdown unlocks.
  const assignmentUnlocked = (
    ['on_packing', 'packed', 'dispatched', 'delivered'].includes(order.status) ||
    !!order.shopify_fulfillment_id
  );
  const assignmentVisible = !isCancelled && order.status !== 'delivered' && order.status !== 'rto';

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
                {(order.customer_order_count || 0) > 1 && (
                  <span title={`Total ${order.customer_order_count} orders from this customer`}
                    style={{ color: '#fbbf24', background: '#fbbf2422', border: '1px solid #fbbf2444', padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>
                    ⭐ {ordinal(order.customer_order_count)} order
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
                    <MenuItem icon="🦘" label="Book at Kangaroo" onClick={() => { window.open(`/orders/${id}/book-kangaroo`, '_blank'); setOpenMenu(null); }} />
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

        {/* May 2 2026 — Partial payment banner. Sirf credit orders pe dikhe ga
            jo partial pay ho chuke hain. Customer khaata page ka link bhi deta hai. */}
        {order.is_credit_order && order.payment_status === 'partial' && order.customer_phone && (
          <div style={{
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 10, padding: '12px 16px', marginBottom: 16,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 12, flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b' }}>
                ⚠ Partially paid · Rs {(order.paid_amount || 0).toLocaleString('en-PK')} of Rs {(order.total_amount || 0).toLocaleString('en-PK')}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(245,158,11,0.85)', marginTop: 3 }}>
                Balance: Rs {Math.max(0, (order.total_amount || 0) - (order.paid_amount || 0)).toLocaleString('en-PK')} · Customer Credits mein track ho raha hai
              </div>
            </div>
            <a href={`/credits/${encodeURIComponent(order.customer_phone)}`}
              style={{
                background: '#f59e0b', color: '#000',
                border: 'none', borderRadius: 7,
                padding: '7px 14px', fontSize: 12, fontWeight: 600,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}>View khaata →</a>
          </div>
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
                        href={item.product_id ? `/inventory/${item.product_id}` : (item.sku ? `/inventory?search=${encodeURIComponent(item.sku)}` : '#')}
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
                                  onClick={() => {
                                    setOpenMenu(null);
                                    if (opt.customAction) {
                                      opt.customAction();
                                    } else {
                                      setStatus(opt.status);
                                    }
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Apr 30 2026 — Review action strip.
                    WhatsApp-cancelled orders sit in 'cancelled' status with the
                    'whatsapp_cancelled' tag, but Shopify side is still ACTIVE
                    (intentional — manual review before destruction). Staff has
                    two paths: confirm the cancellation (push to Shopify) or
                    restore (back to confirmed + WA notify customer). */}
                {isWaCancelledReview && (
                  <div style={{ borderTop: `1px solid ${border}`, background: 'rgba(251,191,36,0.05)' }}>
                    <div style={{ padding: '14px 20px' }}>
                      <div style={{ fontSize: 13, color: '#fbbf24', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                        ⚠️ Customer ne WhatsApp se cancel kiya — review zaroori
                      </div>
                      <div style={{ fontSize: 11, color: '#999', marginBottom: 12, lineHeight: 1.5 }}>
                        ERP mein cancel ho chuka hai but Shopify pe abhi active hai. Dono mein se ek decide karo:
                      </div>

                      {/* Action buttons row — only when no expand is open */}
                      {reviewMode === null && (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => { setReviewMode('restore'); setReviewNote(''); }}
                            disabled={actionBusy}
                            style={{ background: '#1a1a1a', border: '1px solid #22c55e', color: '#22c55e', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: actionBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: actionBusy ? 0.5 : 1 }}>
                            ↩️ Restore order
                          </button>
                          <button
                            onClick={() => { setReviewMode('confirm_cancel'); setReviewNote(''); }}
                            disabled={actionBusy}
                            style={{ background: '#1a1a1a', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: actionBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: actionBusy ? 0.5 : 1 }}>
                            ✓ Confirm cancellation
                          </button>
                        </div>
                      )}

                      {/* Restore expand */}
                      {reviewMode === 'restore' && (
                        <div style={{ padding: 12, background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8 }}>
                          <div style={{ fontSize: 12, color: '#22c55e', marginBottom: 6, fontWeight: 600 }}>↩️ Restore order to confirmed?</div>
                          <div style={{ fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.5 }}>
                            Status confirmed pe wapas, Shopify tag swap (whatsapp_cancelled hatega, whatsapp_confirmed lagega), aur customer ko WhatsApp pe automatic message jayega: "Aapka order reactivate ho gaya hai".
                          </div>
                          <textarea
                            value={reviewNote}
                            onChange={e => setReviewNote(e.target.value)}
                            rows={2}
                            placeholder="Reason / note (optional) — e.g. customer ne phone pe wapas confirm kiya"
                            style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }}
                          />
                          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                            <button onClick={() => { setReviewMode(null); setReviewNote(''); }}
                              style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                              Back
                            </button>
                            <button onClick={() => resolveReview('restore')} disabled={actionBusy}
                              style={{ background: '#22c55e', border: '1px solid #22c55e', color: '#000', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: actionBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: actionBusy ? 0.5 : 1 }}>
                              {actionBusy ? 'Restoring…' : '↩️ Restore + notify customer'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Confirm-cancel expand */}
                      {reviewMode === 'confirm_cancel' && (
                        <div style={{ padding: 12, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8 }}>
                          <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 6, fontWeight: 600 }}>✕ Confirm WhatsApp cancellation?</div>
                          <div style={{ fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.5 }}>
                            Shopify pe order cancel push hoga (refund + restock auto). Review tags hat jayenge. Yeh order Cancelled tab mein chala jayega — irreversible step normally.
                          </div>
                          <textarea
                            value={reviewNote}
                            onChange={e => setReviewNote(e.target.value)}
                            rows={2}
                            placeholder="Reason / note (optional)"
                            style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }}
                          />
                          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                            <button onClick={() => { setReviewMode(null); setReviewNote(''); }}
                              style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                              Back
                            </button>
                            <button onClick={() => resolveReview('confirm_cancel')} disabled={actionBusy}
                              style={{ background: '#ef4444', border: '1px solid #ef4444', color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: actionBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: actionBusy ? 0.5 : 1 }}>
                              {actionBusy ? 'Cancelling…' : '✓ Confirm cancel + push to Shopify'}
                            </button>
                          </div>
                        </div>
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
                {(() => {
                  const raw = order.courier_status_raw || '';
                  const rawLower = String(raw).toLowerCase();
                  // Detect exception/attention-needed states
                  const isException = !!raw && (
                    rawLower.includes('not available') ||
                    rawLower.includes('refus') ||
                    rawLower.includes('not delivered') ||
                    rawLower.includes('undelivered') ||
                    rawLower.includes('attempt') ||
                    rawLower.includes('exception') ||
                    rawLower.includes('hold') ||
                    rawLower.includes('return') ||
                    rawLower.includes('rto') ||
                    rawLower.includes('cancel')
                  );
                  const cardBorder = isException ? '#ef444466' : '#2a1a4a';
                  const tagColor   = isException ? '#ef4444'   : '#8b5cf6';
                  const tagBg      = isException ? '#ef444411' : '#8b5cf611';
                  const tagBorder  = isException ? '#ef444444' : '#8b5cf633';
                  return (
                    <div style={{ background: '#0f0f0f', border: `1px solid ${cardBorder}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>🚚 Courier Status</span>
                        {isException && <span style={{ color: '#ef4444', fontSize: 10 }}>⚠️ Attention</span>}
                      </div>
                      {raw
                        ? <span style={{ color: tagColor, background: tagBg, border: `1px solid ${tagBorder}`, padding: '3px 10px', borderRadius: 5, fontSize: 12, fontWeight: 600 }}>{raw}</span>
                        : <span style={{ color: '#444', fontSize: 12 }}>Not dispatched yet</span>}
                      {order.courier_last_synced_at && (
                        <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                          Last sync {timeAgo(order.courier_last_synced_at)}
                        </div>
                      )}
                    </div>
                  );
                })()}
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
              {/* FIX Apr 30 2026 — Subtotal items count Shopify se match kare.
                  Pehle items.length use hota tha (distinct line items count) —
                  Shopify total QUANTITY dikhata hai (sum of qty across lines).
                  Multi-quantity items ki wajah se 61 vs 63 ka mismatch ho raha
                  tha. Ab dono aligned hain. */}
              {(() => {
                const totalQty = items.reduce((s, it) => s + (parseInt(it.quantity) || 0), 0);
                return (
                  <Row label={`Subtotal (${totalQty} item${totalQty !== 1 ? 's' : ''})`} value={fmt(subtotal)} />
                );
              })()}
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
                          borderRadius: 8, padding: 5, minWidth: 240, zIndex: 50,
                          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                        }}
                      >
                        {/* Apr 30 2026 — Multi-method payment picker.
                            Bank/wallet options request screenshot proof.
                            "Cash" + "Manual" go straight to confirmation.
                            All flow through same /api/orders/mark-paid endpoint
                            with an optional payment_method tag for reporting.
                            Courier auto-paid (Leopards/auto-settle) does NOT
                            pass payment_method, so it stays as 'COD' — these
                            two paths don't conflict. */}
                        <MenuItem icon="🏦" label="Bank Alfalah" sub="Screenshot upload"
                          onClick={() => { setOpenMenu(null); setPaymentMethodModal({ method: 'Bank Alfalah', requireProof: true }); setPaymentProofFile(null); setPaymentProofUrl(''); setPaymentMethodNote(''); }} />
                        <MenuItem icon="🏦" label="Meezan Bank" sub="Screenshot upload"
                          onClick={() => { setOpenMenu(null); setPaymentMethodModal({ method: 'Meezan Bank', requireProof: true }); setPaymentProofFile(null); setPaymentProofUrl(''); setPaymentMethodNote(''); }} />
                        <MenuItem icon="💳" label="Easypaisa" sub="Screenshot upload"
                          onClick={() => { setOpenMenu(null); setPaymentMethodModal({ method: 'Easypaisa', requireProof: true }); setPaymentProofFile(null); setPaymentProofUrl(''); setPaymentMethodNote(''); }} />
                        <MenuItem icon="💳" label="JazzCash" sub="Screenshot upload"
                          onClick={() => { setOpenMenu(null); setPaymentMethodModal({ method: 'JazzCash', requireProof: true }); setPaymentProofFile(null); setPaymentProofUrl(''); setPaymentMethodNote(''); }} />
                        <MenuItem icon="💵" label="Cash" sub="In-hand collection"
                          onClick={() => { setOpenMenu(null); setPaymentMethodModal({ method: 'Cash', requireProof: false }); setPaymentProofFile(null); setPaymentProofUrl(''); setPaymentMethodNote(''); }} />
                        <div style={{ height: 1, background: border, margin: '4px 0' }} />
                        <MenuItem icon="✓" label="Manual paid" sub="Generic — no method tag"
                          onClick={() => { setOpenMenu(null); setShowPaidConfirm(true); }} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Apr 30 2026 — Payment method modal (per-method confirm).
                  Opens when user picks Cash / Bank Alfalah / Meezan / Easypaisa /
                  JazzCash from the Collect payment dropdown. Bank + wallet
                  methods require a screenshot upload (auto-uploads on file
                  select). Cash skips the upload step. Final confirm calls the
                  mark-paid endpoint with the payment_method tag and (if
                  uploaded) proof URL — both get embedded in the activity log
                  Timeline. */}
              {paymentMethodModal && !isPaid && !isCancelled && (
                <div style={{ marginTop: 14, padding: 14, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8 }}>
                  <div style={{ fontSize: 13, color: '#4ade80', marginBottom: 6, fontWeight: 600 }}>
                    💰 {paymentMethodModal.method} — confirm payment
                  </div>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10, lineHeight: 1.5 }}>
                    Order amount <strong style={{ color: '#fff' }}>{fmt(total)}</strong> {paymentMethodModal.method} ke through paid mark hoga.
                    {order.shopify_order_id ? ' Shopify pe bhi "Paid" sync hogi.' : ' (Manual order — sirf ERP).'}
                  </div>

                  {paymentMethodModal.requireProof && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Screenshot proof (JPG/PNG/PDF, max 10MB)</div>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setPaymentProofFile(f);
                          setPaymentProofUploading(true);
                          try {
                            const fd = new FormData();
                            fd.append('file', f);
                            fd.append('order_number', order.order_number || '');
                            const r = await fetch('/api/orders/payment-proof', { method: 'POST', body: fd });
                            const d = await r.json();
                            if (d.success) {
                              setPaymentProofUrl(d.url);
                              flash('success', '✓ Proof uploaded');
                            } else {
                              flash('error', d.error || 'Upload failed');
                              setPaymentProofFile(null);
                            }
                          } catch (err) {
                            flash('error', err.message);
                            setPaymentProofFile(null);
                          }
                          setPaymentProofUploading(false);
                        }}
                        style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit' }}
                      />
                      {paymentProofUploading && (
                        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>⟳ Uploading…</div>
                      )}
                      {paymentProofUrl && !paymentProofUploading && (
                        <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                          ✓ Uploaded —
                          <a href={paymentProofUrl} target="_blank" rel="noopener noreferrer" style={{ color: gold, textDecoration: 'underline' }}>
                            view
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Note (optional) — e.g. transaction id</div>
                    <input
                      type="text"
                      value={paymentMethodNote}
                      onChange={e => setPaymentMethodNote(e.target.value)}
                      placeholder="TXN-1234567 / Reference"
                      style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 12, boxSizing: 'border-box', fontFamily: 'inherit' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => { setPaymentMethodModal(null); setPaymentProofFile(null); setPaymentProofUrl(''); setPaymentMethodNote(''); }}
                      style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        // Defence: digital methods need proof. Cash doesn't.
                        if (paymentMethodModal.requireProof && !paymentProofUrl) {
                          flash('error', 'Pehle screenshot upload karo'); return;
                        }
                        await markAsPaid({
                          payment_method: paymentMethodModal.method,
                          payment_proof_url: paymentProofUrl || undefined,
                          note: paymentMethodNote.trim() || undefined,
                        });
                        setPaymentMethodModal(null);
                        setPaymentProofFile(null);
                        setPaymentProofUrl('');
                        setPaymentMethodNote('');
                      }}
                      disabled={actionBusy || paymentProofUploading || (paymentMethodModal.requireProof && !paymentProofUrl)}
                      style={{ background: '#22c55e', border: '1px solid #22c55e', color: '#000', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: (actionBusy || paymentProofUploading || (paymentMethodModal.requireProof && !paymentProofUrl)) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (actionBusy || paymentProofUploading || (paymentMethodModal.requireProof && !paymentProofUrl)) ? 0.5 : 1 }}>
                      {actionBusy ? 'Marking…' : `✓ Confirm ${paymentMethodModal.method} paid`}
                    </button>
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
            <Card title={`Timeline (${(isCEO ? timeline : timeline.filter(l => { const a = String(l.action || ''); return !a.startsWith('webhook:') && !a.startsWith('protocol_violation:') && a !== 'shopify_order_edited_webhook' && a !== 'courier_reclassified'; })).length})`}>
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
                  // Apr 2026 — Hide webhook + system noise for staff.
                  // Super_admin (CEO/admin) sees everything for audit purposes.
                  const visibleTimeline = isCEO ? timeline : timeline.filter(l => {
                    const a = String(l.action || '');
                    if (a.startsWith('webhook:')) return false;
                    if (a.startsWith('protocol_violation:')) return false;
                    if (a === 'shopify_order_edited_webhook') return false;
                    if (a === 'courier_reclassified') return false;
                    return true;
                  });

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

          {/* ═══ RIGHT SIDEBAR ═══ (sticky on desktop) */}
          <div style={{ position: 'sticky', top: 16, alignSelf: 'start', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>

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
                          onClick={() => { setOpenMenu(null); setShowEditCustomer(true); }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: '#ccc', fontSize: 13, padding: '8px 12px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          ✏️ Edit contact information
                        </button>
                        <button
                          onClick={() => { setOpenMenu(null); setShowEditShipping(true); }}
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
                <Link href={`/orders?search=${encodeURIComponent(order.customer_phone || '')}`}
                  style={{ fontSize: 12, color: gold, textDecoration: 'none', display: 'inline-block', marginTop: 6 }}>
                  {order.customer_order_count === 1 ? '1st order' : `${order.customer_order_count} orders total`} →
                </Link>
              )}
              {customerHistory.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${border}` }}>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Recent orders</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {customerHistory.map(co => {
                      const cfg = STATUS_CONFIG[co.status] || STATUS_CONFIG.pending;
                      return (
                        <Link key={co.id} href={`/orders/${co.id}`}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 8px', background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 6, textDecoration: 'none', fontSize: 11 }}>
                          <span style={{ color: gold, fontFamily: 'monospace', fontWeight: 600 }}>{co.order_number}</span>
                          <span style={{ color: cfg.color, fontSize: 10 }}>{cfg.label}</span>
                          <span style={{ color: '#666', fontSize: 10, flexShrink: 0 }}>{timeAgo(co.created_at)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>

            {/* Contact */}
            <Card title="Contact information">
              {order.customer_phone ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <a href={`tel:${order.customer_phone}`} style={{ fontSize: 13, color: gold, textDecoration: 'none' }}>
                    {order.customer_phone}
                  </a>
                  <button type="button" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(order.customer_phone); }} title="Copy number" style={{ background: 'transparent', border: '1px solid #333', color: '#888', fontSize: 10, cursor: 'pointer', padding: '2px 7px', borderRadius: 4, lineHeight: 1.4, fontFamily: 'inherit' }}>📋</button>
                  <a href={`https://wa.me/${String(order.customer_phone).replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" title="WhatsApp customer" style={{ background: 'transparent', border: '1px solid #14532d', color: '#22c55e', fontSize: 10, textDecoration: 'none', padding: '2px 7px', borderRadius: 4, lineHeight: 1.4 }}>💬 WhatsApp</a>
                </div>
              ) : <div style={{ fontSize: 12, color: '#555' }}>No phone</div>}
              <div style={{ fontSize: 12, color: '#555', marginTop: 8 }}>No email provided</div>
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
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(`${order.customer_address}, ${order.customer_city || ''}`)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color: gold, textDecoration: 'none' }}
                  >
                    🗺️ View on map ↗
                  </a>
                  <button type="button" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText([order.customer_address, order.customer_city].filter(Boolean).join(', ')); }} title="Copy full address"
                    style={{ background: 'transparent', border: '1px solid #333', color: '#888', fontSize: 11, cursor: 'pointer', padding: '3px 8px', borderRadius: 4, fontFamily: 'inherit' }}>
                    📋 Copy
                  </button>
                </div>
              )}
            </Card>

            {/* Billing address (Shopify-style — same as shipping for COD) */}
            <Card title="Billing address">
              <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>Same as shipping address</div>
            </Card>

            {/* Assignment — Apr 2026: only available after fulfillment.
                Pre-fulfill (pending/confirmed): show hint, hide dropdown.
                Post-fulfill (on_packing/packed): show dropdown.
                Dispatched onwards: just show name, no change. */}
            {assignmentVisible && (
              <Card title="Assigned to" id="assigned-to-card">
                {/* May 2 2026 — Show "Packing Team" badge when assigned via team mode */}
                {order.assigned_via_team ? (
                  <div style={{ fontSize: 13, color: '#3b82f6', fontWeight: 700, marginBottom: 10 }}>
                    👥 Packing Team
                    <span style={{ fontSize: 10, color: '#666', fontWeight: 400, display: 'block', marginTop: 2 }}>(shared credit — sab packing staff)</span>
                  </div>
                ) : order.assigned_to_name ? (
                  <div style={{ fontSize: 13, color: '#f59e0b', fontWeight: 600, marginBottom: 10 }}>
                    👤 {order.assigned_to_name}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#555', marginBottom: 10, fontStyle: 'italic' }}>Not assigned yet</div>
                )}
                {/* Permission-gated unlock (May 2 2026) — CEO/manager with orders.assign perm
                    can override status check and assign anytime (matches drawer behavior). */}
                {!assignmentUnlocked && !canAssign ? (
                  // Pre-fulfill non-privileged: explain why dropdown is hidden
                  <div style={{
                    fontSize: 11, color: '#888', background: '#0f0f0f',
                    border: `1px dashed ${border}`, borderRadius: 6,
                    padding: '8px 10px', lineHeight: 1.5,
                  }}>
                    🔒 Assignment {order.status === 'pending' ? 'Confirm' : 'Fulfill'} ke baad available hogi.
                    {order.status === 'confirmed' && (
                      <div style={{ marginTop: 4, color: '#666' }}>
                        Pehle &quot;📋 Add Tracking / Fulfill&quot; click karo (top mein), phir packer assign hoga.
                      </div>
                    )}
                  </div>
                ) : packingStaff.length > 0 && !['dispatched', 'delivered', 'rto'].includes(order.status) && (
                  // Post-fulfill (or perm-overridden): show dropdown
                  <select
                    value=""
                    onChange={e => { if (e.target.value) assignTo(e.target.value); }}
                    disabled={actionBusy}
                    style={{ width: '100%', background: '#0f0f0f', border: `1px solid ${border}`, color: '#ccc', borderRadius: 6, padding: '7px 10px', fontSize: 12, fontFamily: 'inherit' }}
                  >
                    <option value="">Change / assign…</option>
                    <option value="packing_team">👥 Whole Packing Team (shared credit)</option>
                    {packingStaff.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
              </Card>
            )}

            {/* Apr 2026 — Order Type tags (walk-in / international / wholesale).
                Yeh tags sirf INFORMATIONAL hain — kisi auto-action ko trigger
                nahi karte. Manual toggle. Mirror to rszevar.com platform side
                bhi automatically hota hai (best-effort). */}
            {!isCancelled && (
              <Card title="Order Type">
                <div style={{ fontSize: 11, color: '#666', marginBottom: 10, lineHeight: 1.4 }}>
                  Customer ya order ke type ka label. Sirf informational — koi auto-action nahi.
                </div>

                {/* Walk-in toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${border}` }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#e5e5e5', fontWeight: 500 }}>🚶 Walk-in</div>
                    <div style={{ fontSize: 10, color: '#666' }}>Customer shop pe aaya / pickup</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!order.is_walkin}
                    onChange={e => toggleOrderTypeTag('walkin', e.target.checked)}
                    disabled={actionBusy}
                    style={{ accentColor: '#f59e0b', width: 16, height: 16, cursor: actionBusy ? 'wait' : 'pointer' }}
                  />
                </div>

                {/* International toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${border}` }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#e5e5e5', fontWeight: 500 }}>🌍 International</div>
                    <div style={{ fontSize: 10, color: '#666' }}>Pakistan ke bahar ka order</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!order.is_international}
                    onChange={e => toggleOrderTypeTag('international', e.target.checked)}
                    disabled={actionBusy}
                    style={{ accentColor: '#22d3ee', width: 16, height: 16, cursor: actionBusy ? 'wait' : 'pointer' }}
                  />
                </div>

                {/* Wholesale toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#e5e5e5', fontWeight: 500 }}>🏢 Wholesale</div>
                    <div style={{ fontSize: 10, color: '#666' }}>Bulk / re-sale buyer</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!order.is_wholesale}
                    onChange={e => toggleOrderTypeTag('wholesale', e.target.checked)}
                    disabled={actionBusy}
                    style={{ accentColor: '#8b5cf6', width: 16, height: 16, cursor: actionBusy ? 'wait' : 'pointer' }}
                  />
                </div>
              </Card>
            )}

            {/* May 2 2026 — Credit / Udhaar toggle (Step 6 of customer credits).
                Yeh DEDICATED card hai (Order Type card se alag) kyunki yeh
                informational nahi hai — actually status change karta hai
                (auto-deliver) aur Customer Credits dashboard mein dikhata hai.
                Visual treatment gold accent ke saath taake clearly different lage. */}
            {!isCancelled && (
              <Card title="📒 Credit / Udhaar">
                <div style={{
                  fontSize: 11, color: '#666', marginBottom: 10, lineHeight: 1.5,
                }}>
                  Trusted customer jo udhaar pe maal le raha hai. Order delivered mark hoga real-time, payment Customer Credits mein track hogi.
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px',
                  background: order.is_credit_order ? 'rgba(201,169,110,0.08)' : 'transparent',
                  border: `1px solid ${order.is_credit_order ? 'rgba(201,169,110,0.3)' : border}`,
                  borderRadius: 6,
                }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#e5e5e5', fontWeight: 500 }}>
                      {order.is_credit_order ? '✓ Credit order' : 'Mark as credit order'}
                    </div>
                    <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                      {order.is_credit_order
                        ? 'Customer Credits dashboard mein active hai'
                        : 'On click: status auto-delivered, payment unpaid rahega'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!order.is_credit_order}
                    onChange={e => toggleCreditOrder(e.target.checked)}
                    disabled={actionBusy}
                    style={{
                      accentColor: '#c9a96e',
                      width: 16, height: 16,
                      cursor: actionBusy ? 'wait' : 'pointer',
                    }}
                  />
                </div>

                {order.is_credit_order && order.customer_phone && (
                  <a href={`/credits/${encodeURIComponent(order.customer_phone)}`}
                    style={{
                      display: 'block', marginTop: 10,
                      padding: '6px 10px', textAlign: 'center',
                      background: 'transparent', border: '1px solid rgba(201,169,110,0.3)',
                      borderRadius: 6, color: '#c9a96e',
                      fontSize: 11, fontWeight: 500, textDecoration: 'none',
                    }}>
                    View khaata →
                  </a>
                )}
              </Card>
            )}

            {/* Tags */}
            <Card title="Tags">
              {(() => {
                const visibleTags = Array.isArray(order.tags) ? order.tags.filter(t => {
                  const tag = String(t || '').toLowerCase();
                  // Hide: type tags (already shown as typeBadges in header) + redundant confirm/cancel state tags + system tags
                  if (['wholesale','international','walkin','kangaroo'].includes(tag)) return false;
                  if (['whatsapp_confirmed', 'whatsapp confirmed', 'order_confirmed', 'order confirmed', 'confirmation pending', 'whatsapp_cancelled', 'whatsapp cancelled', 'no whatsapp'].includes(tag)) return false;
                  if (tag.startsWith('packing:')) return false; // already shown via assigned_to_name
                  return true;
                }) : [];
                return visibleTags.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {visibleTags.map((tag, i) => (
                      <span key={i} style={{ color: '#9ca3af', background: '#1f1f2e', border: '1px solid #2a2a44', padding: '3px 8px', borderRadius: 4, fontSize: 11 }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#555', fontStyle: 'italic' }}>No tags</div>
                );
              })()}
            </Card>

            {/* Metadata */}
            <Card title="Order info">
              <Row label="Created" value={formatShortDate(order.created_at)} />
              {order.confirmed_at && <Row label="Confirmed" value={formatShortDate(order.confirmed_at)} color="#3b82f6" />}
              {order.dispatched_at && <Row label="Dispatched" value={formatShortDate(order.dispatched_at)} color="#a855f7" />}
              {order.delivered_at && <Row label="Delivered" value={formatShortDate(order.delivered_at)} color="#22c55e" />}
              {order.paid_at && <Row label="Paid" value={formatShortDate(order.paid_at)} color="#22c55e" />}
              {order.rto_at && <Row label="RTO" value={formatShortDate(order.rto_at)} color="#ef4444" />}
              {order.cancelled_at && <Row label="Cancelled" value={formatShortDate(order.cancelled_at)} color="#ef4444" />}
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

      {/* May 2026 — Shopify-style modal popups. Replace the older flow that
          opened OrderDrawer's Customer tab. Both contact + shipping use the
          same /api/orders/edit endpoint (restored from broken state). */}
      {showEditCustomer && order && (
        <EditCustomerModal
          order={order}
          performer={performer}
          userEmail={userEmail}
          onClose={() => setShowEditCustomer(false)}
          onSaved={() => { setShowEditCustomer(false); refreshAll(); }}
        />
      )}
      {showEditShipping && order && (
        <EditShippingModal
          order={order}
          performer={performer}
          userEmail={userEmail}
          onClose={() => setShowEditShipping(false)}
          onSaved={() => { setShowEditShipping(false); refreshAll(); }}
        />
      )}

      {/* Apr 2026 — Manual Fulfill modal: opened from Fulfill dropdown when status='packed'.
          Used when courier was booked OUTSIDE ERP (Kangaroo via Shopify app, Leopards via portal)
          OR when there's no tracking (walk-in / wholesale / pickup). */}
      {showFulfillModal && (
        <div
          onClick={() => !actionBusy && setShowFulfillModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12,
              padding: 24, width: '100%', maxWidth: 520,
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: 20, color: '#c9a96e', margin: 0, fontWeight: 600,
              }}>
                📋 Add Tracking / Mark Fulfilled
              </h3>
              <button
                onClick={() => setShowFulfillModal(false)}
                disabled={actionBusy}
                style={{
                  background: 'transparent', border: 'none', color: '#666',
                  cursor: 'pointer', fontSize: 18, padding: 4,
                }}
              >×</button>
            </div>

            <div style={{ fontSize: 12, color: '#888', marginBottom: 16, lineHeight: 1.5 }}>
              Order: <strong style={{ color: '#e5e5e5' }}>{order.order_number}</strong> · Total: <strong style={{ color: '#e5e5e5' }}>Rs {Number(total).toLocaleString('en-PK')}</strong>
              <div style={{ marginTop: 6, fontSize: 11, color: '#666' }}>
                Yeh option courier outside ERP book hua ho (Kangaroo Shopify app / Leopards portal),
                ya walk-in / wholesale / pickup bina tracking ke fulfill karna ho — uske liye hai.
              </div>
            </div>

            {/* Tracking input */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 6, fontWeight: 500 }}>
                Tracking Number <span style={{ color: '#666', fontWeight: 400 }}>(optional — leave empty for no-tracking fulfill)</span>
              </label>
              <input
                type="text"
                value={fulfillTracking}
                onChange={e => setFulfillTracking(e.target.value)}
                placeholder="e.g. KI3601012345 or KL27001234567"
                disabled={actionBusy}
                style={{
                  width: '100%', padding: '9px 12px',
                  background: '#0a0a0a', border: '1px solid #2a2a2a',
                  borderRadius: 6, color: '#e5e5e5', fontSize: 13,
                  fontFamily: 'monospace', outline: 'none',
                }}
                autoFocus
              />
              {fulfillTracking && detectCourierFromTrackingClient(fulfillTracking) && !fulfillCourierManuallyEdited && (
                <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4 }}>
                  ✓ Detected: <strong>{detectCourierFromTrackingClient(fulfillTracking)}</strong>
                </div>
              )}
            </div>

            {/* Courier dropdown */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 6, fontWeight: 500 }}>
                Courier
                {!fulfillCourierManuallyEdited && detectCourierFromTrackingClient(fulfillTracking) && (
                  <span style={{ color: '#666', fontWeight: 400 }}> (auto-detected — change if wrong)</span>
                )}
              </label>
              <select
                value={effectiveFulfillCourier || ''}
                onChange={e => {
                  setFulfillCourier(e.target.value);
                  setFulfillCourierManuallyEdited(true);
                }}
                disabled={actionBusy}
                style={{
                  width: '100%', padding: '9px 12px',
                  background: '#0a0a0a', border: '1px solid #2a2a2a',
                  borderRadius: 6, color: '#e5e5e5', fontSize: 13,
                  fontFamily: 'inherit', outline: 'none',
                }}
              >
                <option value="">— Auto / Not set —</option>
                <option value="Leopards">Leopards (KI...)</option>
                <option value="Kangaroo">Kangaroo (KL...)</option>
                <option value="PostEx">PostEx</option>
                <option value="TCS">TCS</option>
                <option value="M&P">M&amp;P</option>
                <option value="Other">Other</option>
                <option value="Pickup">Pickup / Walk-in (no courier)</option>
              </select>
            </div>

            {/* Notify customer checkbox — only meaningful with tracking */}
            <div style={{ marginBottom: 14, opacity: fulfillTracking.trim() ? 1 : 0.5 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#ccc', cursor: fulfillTracking.trim() ? 'pointer' : 'not-allowed' }}>
                <input
                  type="checkbox"
                  checked={fulfillNotify}
                  onChange={e => setFulfillNotify(e.target.checked)}
                  disabled={actionBusy || !fulfillTracking.trim()}
                  style={{ accentColor: '#c9a96e' }}
                />
                Customer ko shipping email bhejo
                {!fulfillTracking.trim() && <span style={{ color: '#666', fontSize: 11 }}>(needs tracking)</span>}
              </label>
            </div>

            {/* Apr 2026 — Order type quick-toggle inside fulfill modal.
                Convenience: agar fulfill karte waqt yaad aaye ke yeh walk-in /
                wholesale / international hai, yahin se mark kar sakte ho —
                sidebar par jana zaroori nahi. Backend update-tags endpoint
                par jata hai. */}
            <div style={{ marginBottom: 14, padding: '10px 12px', background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Order Type (optional)
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#ccc', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!order.is_walkin}
                    onChange={e => toggleOrderTypeTag('walkin', e.target.checked)}
                    disabled={actionBusy}
                    style={{ accentColor: '#f59e0b' }}
                  />
                  🚶 Walk-in
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#ccc', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!order.is_international}
                    onChange={e => toggleOrderTypeTag('international', e.target.checked)}
                    disabled={actionBusy}
                    style={{ accentColor: '#22d3ee' }}
                  />
                  🌍 International
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#ccc', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!order.is_wholesale}
                    onChange={e => toggleOrderTypeTag('wholesale', e.target.checked)}
                    disabled={actionBusy}
                    style={{ accentColor: '#8b5cf6' }}
                  />
                  🏢 Wholesale
                </label>
              </div>
            </div>

            {/* Reason (optional, audit log) */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 6, fontWeight: 500 }}>
                Note <span style={{ color: '#666', fontWeight: 400 }}>(optional — for audit log)</span>
              </label>
              <input
                type="text"
                value={fulfillReason}
                onChange={e => setFulfillReason(e.target.value)}
                placeholder="e.g. Booked Kangaroo manually, Wholesale pickup, Walk-in handover..."
                disabled={actionBusy}
                style={{
                  width: '100%', padding: '8px 12px',
                  background: '#0a0a0a', border: '1px solid #2a2a2a',
                  borderRadius: 6, color: '#e5e5e5', fontSize: 12,
                  fontFamily: 'inherit', outline: 'none',
                }}
              />
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowFulfillModal(false)}
                disabled={actionBusy}
                style={{
                  padding: '9px 16px', background: 'transparent',
                  border: '1px solid #333', borderRadius: 6,
                  color: '#aaa', fontSize: 12, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >Cancel</button>
              <button
                onClick={submitManualFulfill}
                disabled={actionBusy}
                style={{
                  padding: '9px 18px', background: '#c9a96e',
                  border: '1px solid #c9a96e', borderRadius: 6,
                  color: '#080808', fontSize: 12, cursor: 'pointer',
                  fontWeight: 600, fontFamily: 'inherit',
                  opacity: actionBusy ? 0.6 : 1,
                }}
              >
                {actionBusy ? 'Submitting…' : (fulfillTracking.trim() ? '✓ Add Tracking & Fulfill' : '✓ Mark as Fulfilled')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
