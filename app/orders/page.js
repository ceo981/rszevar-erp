'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/context/UserContext';
import OrderDrawer from './_components/OrderDrawer';

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
        { type: 'status', value: 'pending',    label: 'Pending',      color: '#888',    count: gc.pending },
        { type: 'status', value: 'confirmed',  label: 'Confirmed',    color: '#3b82f6', count: gc.confirmed },
        { type: 'status', value: 'on_packing', label: 'On Packing',   color: '#f59e0b', count: gc.on_packing },
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

// OrderDrawer now lives in ./_components/OrderDrawer.js (shared with /orders/[id])

function BulkCancelModal({ count, onClose, onConfirm, running }) {
  const [reason, setReason] = useState('');
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 12, padding: 24, width: 460 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#ef4444' }}>
          ✕ Cancel {count} order{count > 1 ? 's' : ''}
        </h3>
        <p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
          Reason sab orders pe lagegi. Shopify pe bhi cancel hoga. Dispatched/Delivered orders skip honge.
        </p>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Cancel reason (required)..."
          rows={3}
          style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', marginTop: 12, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} disabled={running}
            style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: running ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            Back
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={running || !reason.trim()}
            style={{ background: '#ef4444', border: '1px solid #ef4444', color: '#fff', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: (running || !reason.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (running || !reason.trim()) ? 0.5 : 1 }}>
            {running ? 'Cancelling…' : `Cancel ${count} order${count > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkStatusModal({ count, onClose, onConfirm, running }) {
  const [newStatus, setNewStatus] = useState('');
  const [notes, setNotes] = useState('');
  // FIX: exclude cancelled (use action=cancel instead) and in_transit/processing
  // (in_transit not in DB enum; processing barely used). 'dispatched' allowed —
  // legitimate for Shopify-booked orders bulk status flip.
  const BULK_ALLOWED = ['pending', 'confirmed', 'on_packing', 'packed', 'dispatched', 'delivered', 'returned', 'rto', 'attempted', 'hold'];
  const options = BULK_ALLOWED
    .filter(val => STATUS_CONFIG[val])
    .map(val => ({ value: val, label: STATUS_CONFIG[val].label, color: STATUS_CONFIG[val].color }));
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 12, padding: 24, width: 480 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: gold }}>
          ⚙ Change status — {count} order{count > 1 ? 's' : ''}
        </h3>
        <p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
          Select new status. Jo order pehle se same status pe hai, skip hoga.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => setNewStatus(opt.value)}
              style={{
                background: newStatus === opt.value ? opt.color + '22' : '#1a1a1a',
                border: newStatus === opt.value ? `1px solid ${opt.color}` : `1px solid ${border}`,
                color: newStatus === opt.value ? opt.color : '#aaa',
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 12,
                fontWeight: newStatus === opt.value ? 600 : 400,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'center',
              }}>
              {opt.label}
            </button>
          ))}
        </div>

        <input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', marginTop: 12 }}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} disabled={running}
            style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: running ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            Back
          </button>
          <button
            onClick={() => onConfirm({ status: newStatus, notes })}
            disabled={running || !newStatus}
            style={{ background: gold, border: `1px solid ${gold}`, color: '#000', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: (running || !newStatus) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (running || !newStatus) ? 0.5 : 1 }}>
            {running ? 'Updating…' : 'Apply to all'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkAssignModal({ count, onClose, onConfirm, running }) {
  const [employees, setEmployees] = useState([]);
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/orders/assign')
      .then(r => r.json())
      .then(d => { setEmployees(d.employees || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 12, padding: 24, width: 440 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f59e0b' }}>
          👤 Assign packer — {count} order{count > 1 ? 's' : ''}
        </h3>
        <p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
          Sirf Confirmed / On Packing orders pe lagega. Baaki skip honge.
        </p>

        {loading ? (
          <p style={{ color: '#555', fontSize: 13, marginTop: 14 }}>Loading employees…</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14, maxHeight: 320, overflowY: 'auto' }}>
            <button
              onClick={() => setAssignedTo('packing_team')}
              style={{
                background: assignedTo === 'packing_team' ? '#f59e0b22' : '#1a1a1a',
                border: assignedTo === 'packing_team' ? `1px solid #f59e0b` : `1px solid ${border}`,
                color: assignedTo === 'packing_team' ? '#f59e0b' : '#ccc',
                borderRadius: 6, padding: '10px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}>
              🤝 Packing Team (shared credit)
            </button>
            {employees.map(emp => (
              <button
                key={emp.id}
                onClick={() => setAssignedTo(String(emp.id))}
                style={{
                  background: assignedTo === String(emp.id) ? '#f59e0b22' : '#1a1a1a',
                  border: assignedTo === String(emp.id) ? `1px solid #f59e0b` : `1px solid ${border}`,
                  color: assignedTo === String(emp.id) ? '#f59e0b' : '#ccc',
                  borderRadius: 6, padding: '10px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                }}>
                {emp.name} <span style={{ color: '#555', fontSize: 11 }}>· {emp.designation || emp.role}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} disabled={running}
            style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: running ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            Back
          </button>
          <button
            onClick={() => onConfirm({ assigned_to: assignedTo })}
            disabled={running || !assignedTo}
            style={{ background: '#f59e0b', border: `1px solid #f59e0b`, color: '#000', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: (running || !assignedTo) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (running || !assignedTo) ? 0.5 : 1 }}>
            {running ? 'Assigning…' : `Assign ${count} order${count > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkResultModal({ result, onClose }) {
  if (!result) return null;
  const { summary, results } = result;
  const failures = results.filter(r => !r.success);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 12, padding: 24, width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
          {summary.failed === 0 ? '✓ All done' : `⚠ Partial — ${summary.succeeded}/${summary.total} succeeded`}
        </h3>
        <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 13 }}>
          <span style={{ color: '#22c55e' }}>✓ {summary.succeeded} succeeded</span>
          {summary.failed > 0 && <span style={{ color: '#ef4444' }}>✕ {summary.failed} failed</span>}
        </div>
        {failures.length > 0 && (
          <div style={{ marginTop: 14, flex: 1, overflowY: 'auto', background: '#1a1a1a', border: `1px solid ${border}`, borderRadius: 6, padding: 10 }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Failed orders</div>
            {failures.map(f => (
              <div key={f.order_id} style={{ fontSize: 12, color: '#ccc', padding: '4px 0', borderBottom: '1px solid #222' }}>
                <span style={{ color: gold, fontWeight: 600 }}>Order #{f.order_id}</span>
                <span style={{ color: '#ef4444', marginLeft: 8 }}>— {f.error}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose}
            style={{ background: gold, border: `1px solid ${gold}`, color: '#000', borderRadius: 7, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Orders Page ─────────────────────────────────────────
export default function OrdersPage() {
  const { profile, userEmail, can } = useUser();
  const performer = profile?.full_name || profile?.email || 'Staff';

  // ── Granular permission gates (May 2 2026) ──────────────────────────────
  // Each top-bar action / bulk button checks its own permission. Hiding the
  // bulk system entirely for users without orders.bulk keeps UI clean.
  const canCreate       = can('orders.create');
  const canSync         = can('orders.shopify_sync');
  const canBulk         = can('orders.bulk');
  const canBulkConfirm  = canBulk && can('orders.confirm');
  const canBulkAssign   = canBulk && can('orders.assign');
  const canBulkStatus   = canBulk && can('orders.dispatch'); // status changes touch dispatch flow
  const canBulkCancel   = canBulk && can('orders.cancel');
  const canViewAmount   = can('orders.view_amount');
  // ── Protocol Audit perms (May 2 2026) — CEO-only by default ──
  const canAuditProtocol  = can('orders.protocol_audit');
  const canVerifyProtocol = can('orders.protocol_verify');
  // Apr 30 2026 — Read URL `?search=` so deep-links from order detail page
  // (Customer name → "X orders total" link) land here pre-filtered.
  const urlSearchParams = useSearchParams();
  const initialSearchFromUrl = urlSearchParams?.get('search') || '';
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [globalCounts, setGlobalCounts] = useState({});
  // May 2 2026 — Protocol audit reasons map { order_id: { skipped_assignment, ... } }
  // Only populated when audit filter is active.
  const [protocolReasons, setProtocolReasons] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearchFromUrl);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearchFromUrl); // debounced version used by API
  // Apr 2026 — Default tab: Unfulfilled (operational view "kya pack karna hai").
  // User can switch to "All Orders" anytime by clicking that tab.
  // FIX Apr 30 2026 — when arriving with a deep-link search (e.g. customer
  // phone), default to "All Orders" so wholesale/walk-in/delivered all show.
  const [filter, setFilter] = useState(
    initialSearchFromUrl
      ? { type: null, value: null }
      : { type: 'fulfillment', value: 'unfulfilled' }
  );
  // Apr 28 2026 — Date range filter. By default both empty = no date filter.
  // User select karega to backend ko `from` aur `to` params bhejtay hain
  // jo orders list AND tab counts dono ko narrow karte hain.
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // FIX: cleaning state + button removed — /api/orders/cleanup endpoint doesn't exist (404)
  const [syncMsg, setSyncMsg] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const PER_PAGE = 50;

  // ── Bulk selection state ──
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkModal, setBulkModal] = useState(null); // 'cancel' | 'status' | 'assign' | null
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  // ── Debounce search typing ──
  // User har keystroke pe API hit na ho. 350ms ruk ke fire hoti hai query.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // ── Request cancellation + sequence guard ──
  // Race condition fix: fast typing ke saath parallel API calls aate the, aur
  // late-arriving response UI ko overwrite kar deti thi. Ab pehle wali request
  // abort ho jaati hai, aur safety ke liye requestId se bhi guard hai.
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    // Cancel any in-flight request — late response ab UI overwrite nahi karegi
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;

    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
      if (debouncedSearch) params.append('search', debouncedSearch);
      if (filter.type && filter.value) params.append(filter.type, filter.value);
      if (dateRange.from) params.append('from', dateRange.from);
      if (dateRange.to) params.append('to', dateRange.to);
      const r = await fetch(`/api/orders?${params}`, { signal: controller.signal });
      const d = await r.json();

      // Guard: agar naya request fire ho chuka hai to is purani response ko ignore karo
      if (requestId !== requestIdRef.current) return;

      const newOrders = d.orders || [];
      if (page === 1) {
        setOrders(newOrders);
      } else {
        setOrders(prev => [...prev, ...newOrders]);
      }
      setHasMore(newOrders.length === PER_PAGE);
      if (d.stats) setStats(d.stats);
      if (d.global_counts) setGlobalCounts(d.global_counts);
      // May 2 2026 — Protocol audit: capture reasons map (or clear if not audit filter)
      setProtocolReasons(d.protocol_reasons || {});
    } catch (e) {
      if (e.name === 'AbortError') return; // expected — naya request le chuka
    }
    // Sirf latest request hi loading state ko off karegi
    if (requestId === requestIdRef.current) setLoading(false);
  }, [page, debouncedSearch, filter, dateRange]);

  useEffect(() => { load(); }, [load]);

  // FIX: keep the currently-open drawer order in sync with the latest `orders`
  // data after a refresh. Previously `onRefresh` was using closure-stale orders,
  // so the drawer showed pre-action data (old status, old items) after a refresh.
  useEffect(() => {
    if (!selected) return;
    const fresh = orders.find(o => o.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [orders, selected]);

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
        // load() removed — background sync ke baad list reload nahi karni
        // Warna search karte waqt scroll/results reset ho jate the
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

  // ── Bulk selection helpers ──
  const pageOrderIds = orders.map(o => o.id);
  const allSelectedOnPage = pageOrderIds.length > 0 && pageOrderIds.every(id => selectedIds.has(id));
  const someSelectedOnPage = pageOrderIds.some(id => selectedIds.has(id)) && !allSelectedOnPage;

  const toggleOne = (id, e) => {
    e?.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelectedOnPage) {
        pageOrderIds.forEach(id => next.delete(id));
      } else {
        pageOrderIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ── Bulk action runner ──
  const runBulk = async (payload) => {
    setBulkRunning(true);
    try {
      const r = await fetch('/api/orders/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          order_ids: Array.from(selectedIds),
          performed_by: performer,
          performed_by_email: userEmail,
        }),
      });
      const d = await r.json();
      if (!d.success) {
        showMsg('error', d.error || 'Bulk action failed');
        setBulkRunning(false);
        return;
      }

      setBulkResult(d);
      const { summary } = d;
      if (summary.failed === 0) {
        showMsg('success', `✓ ${summary.succeeded} order${summary.succeeded > 1 ? 's' : ''} updated`);
      } else {
        showMsg('error', `${summary.succeeded} succeeded, ${summary.failed} failed — details check karo`);
      }
      clearSelection();
      setBulkModal(null);
      load();
    } catch (e) {
      showMsg('error', e.message);
    }
    setBulkRunning(false);
  };

  const handleBulkConfirm = () => {
    if (!window.confirm(`${selectedIds.size} order${selectedIds.size > 1 ? 's' : ''} confirm karne hain?\n\n(Sirf pending/processing/attempted/hold orders confirm honge)`)) return;
    runBulk({ action: 'confirm' });
  };

  // ── Protocol Audit verify (May 2 2026) ──
  // CEO ek order ko "verified" mark karta — ye order Protocol Audit tab se gayab.
  // Use case: violation intentional thi (CEO ne khud handle kiya, manager approval, etc).
  const verifyProtocol = async (order_id, order_number) => {
    const note = window.prompt(
      `Order ${order_number} ko Protocol OK mark karna hai?\n\nReason (optional):`,
      ''
    );
    // null = user cancelled. Empty string = OK without reason.
    if (note === null) return;
    try {
      const r = await fetch('/api/orders/protocol-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id,
          performed_by: performer,
          performed_by_email: userEmail,
          note: note.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!d.success) {
        alert(`❌ Verify fail: ${d.error}`);
        return;
      }
      // Optimistic: remove order from current view
      setOrders(prev => prev.filter(o => o.id !== order_id));
      setGlobalCounts(prev => ({ ...prev, protocol_unfollowed: Math.max(0, (prev.protocol_unfollowed || 0) - 1) }));
    } catch (e) {
      alert(`❌ ${e.message}`);
    }
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

  const cleanUndefinedOrders = null; // removed — endpoint /api/orders/cleanup doesn't exist

  const c = stats || {};
  const anySyncing = syncing;

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff' }}>
      {selected && <OrderDrawer order={selected} onClose={() => setSelected(null)} onRefresh={() => load()} performer={performer} />}

      {/* Bulk action modals */}
      {bulkModal === 'cancel' && (
        <BulkCancelModal
          count={selectedIds.size}
          running={bulkRunning}
          onClose={() => setBulkModal(null)}
          onConfirm={(reason) => runBulk({ action: 'cancel', reason })}
        />
      )}
      {bulkModal === 'status' && (
        <BulkStatusModal
          count={selectedIds.size}
          running={bulkRunning}
          onClose={() => setBulkModal(null)}
          onConfirm={({ status, notes }) => runBulk({ action: 'status', status, notes })}
        />
      )}
      {bulkModal === 'assign' && (
        <BulkAssignModal
          count={selectedIds.size}
          running={bulkRunning}
          onClose={() => setBulkModal(null)}
          onConfirm={({ assigned_to }) => runBulk({ action: 'assign', assigned_to })}
        />
      )}
      {bulkResult && (
        <BulkResultModal result={bulkResult} onClose={() => setBulkResult(null)} />
      )}

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

        {/* Apr 28 2026 — Date range filter (right-aligned, before sync msg).
            Default: empty (no filter, all dates). When user picks a date,
            tab counts AND list both narrow to that range. */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
          {(dateRange.from || dateRange.to) && (
            <div style={{
              fontSize: 11, color: gold, fontWeight: 600,
              padding: '5px 10px', background: 'rgba(201,169,110,0.1)',
              border: `1px solid ${gold}55`, borderRadius: 6,
            }}>
              📅 {dateRange.from || '...'} → {dateRange.to || 'today'}
              <button onClick={() => { setDateRange({ from: '', to: '' }); setPage(1); }}
                title="Clear date filter"
                style={{
                  background: 'transparent', border: 'none', color: gold,
                  fontSize: 13, cursor: 'pointer', marginLeft: 6, padding: 0,
                  fontFamily: 'inherit',
                }}>✕</button>
            </div>
          )}
          <button onClick={() => setShowDatePicker(s => !s)}
            style={{
              background: showDatePicker ? `${gold}22` : '#0a0a0a',
              border: `1px solid ${showDatePicker ? gold : border}`,
              color: showDatePicker ? gold : '#bbb',
              borderRadius: 7, padding: '7px 12px', fontSize: 12,
              cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            📅 Date Filter
          </button>

          {showDatePicker && (
            <>
              {/* Backdrop */}
              <div onClick={() => setShowDatePicker(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
              {/* Picker */}
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                background: card, border: `1px solid ${border}`, borderRadius: 10,
                padding: 16, zIndex: 51, minWidth: 320,
                boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e5e5', marginBottom: 12 }}>
                  Filter orders by date
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>From</div>
                  <input type="date" value={dateRange.from}
                    onChange={e => setDateRange(r => ({ ...r, from: e.target.value }))}
                    style={{
                      width: '100%', background: '#0a0a0a', border: `1px solid ${border}`,
                      color: '#fff', borderRadius: 6, padding: '8px 10px',
                      fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
                      colorScheme: 'dark',
                    }} />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>To</div>
                  <input type="date" value={dateRange.to}
                    onChange={e => setDateRange(r => ({ ...r, to: e.target.value }))}
                    style={{
                      width: '100%', background: '#0a0a0a', border: `1px solid ${border}`,
                      color: '#fff', borderRadius: 6, padding: '8px 10px',
                      fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
                      colorScheme: 'dark',
                    }} />
                </div>

                {/* Quick presets */}
                <div style={{ fontSize: 10, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Quick presets</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
                  {(() => {
                    const today = new Date();
                    const fmt = (d) => d.toISOString().split('T')[0];
                    const presets = [
                      { label: 'Today', from: fmt(today), to: fmt(today) },
                      { label: 'Yesterday', from: fmt(new Date(today.getTime() - 86400000)), to: fmt(new Date(today.getTime() - 86400000)) },
                      { label: 'Last 7 days', from: fmt(new Date(today.getTime() - 6 * 86400000)), to: fmt(today) },
                      { label: 'Last 30 days', from: fmt(new Date(today.getTime() - 29 * 86400000)), to: fmt(today) },
                      { label: 'This month', from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmt(today) },
                      { label: 'Last month', from: fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: fmt(new Date(today.getFullYear(), today.getMonth(), 0)) },
                    ];
                    return presets.map(p => (
                      <button key={p.label} onClick={() => setDateRange({ from: p.from, to: p.to })}
                        style={{
                          background: '#0a0a0a', border: `1px solid ${border}`,
                          color: '#aaa', borderRadius: 5, padding: '5px 9px',
                          fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                        }}>{p.label}</button>
                    ));
                  })()}
                </div>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <button onClick={() => { setDateRange({ from: '', to: '' }); setPage(1); }}
                    style={{
                      background: 'transparent', border: `1px solid ${border}`,
                      color: '#888', borderRadius: 6, padding: '7px 14px',
                      fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                    }}>Clear</button>
                  <button onClick={() => { setShowDatePicker(false); setPage(1); }}
                    style={{
                      background: gold, border: 'none', color: '#000',
                      borderRadius: 6, padding: '7px 18px',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    }}>Apply</button>
                </div>
              </div>
            </>
          )}
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

      {/* ── Status Tabs ── */}
      {/* Apr 27 2026 redesign:
          - flex-wrap: wide screens 1 row, narrow screens auto-wraps to 2 rows
          - Logical sequence: Overview → Active Workflow → Side States → Payment → Closed/Exception
          - groupStart flag: extra left margin between groups for visual separation
          - Tighter padding (8/12 vs 9/14) to fit more on one row */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, rowGap: 6, alignItems: 'flex-end' }}>
          {[
            // ── Overview ──
            { label: 'All Orders', value: null, color: gold, count: globalCounts.pending + globalCounts.confirmed + globalCounts.on_packing + globalCounts.packed + globalCounts.dispatched + globalCounts.delivered + globalCounts.attempted + globalCounts.hold + globalCounts.rto + globalCounts.cancelled },
            { label: '📦 Unfulfilled', value: 'unfulfilled', filterType: 'fulfillment', color: '#f59e0b', count: globalCounts.unfulfilled || 0, tooltip: 'Shopify side pe abhi tak fulfill nahi hue — yahi pack karne hain', groupStart: true },
            // ── Active Workflow (forward flow) ──
            { label: 'Pending',    value: 'pending',    color: '#888',    count: globalCounts.pending, groupStart: true },
            { label: 'Confirmed',  value: 'confirmed',  color: '#3b82f6', count: globalCounts.confirmed },
            { label: 'On Packing', value: 'on_packing', color: '#f59e0b', count: globalCounts.on_packing },
            { label: 'Packed',     value: 'packed',     color: '#06b6d4', count: globalCounts.packed },
            { label: 'Dispatched', value: 'dispatched', color: '#a855f7', count: globalCounts.dispatched },
            { label: 'Delivered',  value: 'delivered',  color: '#22c55e', count: globalCounts.delivered },
            // ── Side States (delivery exceptions) ──
            { label: 'Attempted',  value: 'attempted',  color: '#f97316', count: globalCounts.attempted, groupStart: true },
            { label: 'Hold',       value: 'hold',       color: '#64748b', count: globalCounts.hold },
            { label: 'RTO',        value: 'rto',        color: '#ef4444', count: globalCounts.rto },
            // ── Payment ──
            { label: '⏳ Pending Payment', value: 'pending_payment', filterType: 'payment_state', color: '#f59e0b', count: globalCounts.pending_payment || 0, tooltip: 'Order delivered ho chuka hai lekin courier se abhi paisa nahi aaya', groupStart: true },
            { label: '💰 Paid',           value: 'paid',            filterType: 'payment_state', color: '#10b981', count: globalCounts.paid || 0, tooltip: 'Courier ne payment settle kar di — paisa account mein aagaya' },
            // ── Closed / Exceptions ──
            { label: 'Cancelled',  value: 'cancelled',  color: '#ef4444', count: globalCounts.cancelled, groupStart: true },
            { label: '⚠️ Review',  value: 'wa_cancelled', filterType: 'review', color: '#fbbf24', count: globalCounts.wa_cancelled, tooltip: 'WhatsApp se cancel hue orders — team review zaroori' },
            // ── Protocol Audit (May 2 2026) — CEO-only highlighted tab ──
            // Operations ne kahan shortcut liya: skipped assignment / packing scan
            // / confirmation. CEO verify karke close kar sakta intentional cases.
            ...(canAuditProtocol ? [{
              label: '🚨 Protocol Audit',
              value: 'protocol_unfollowed',
              filterType: 'audit',
              color: '#ef4444',
              count: globalCounts.protocol_unfollowed || 0,
              tooltip: 'Office protocol skip hua — confirm/assign/pack ke kadam chod ke aage badh gaye orders',
              groupStart: true,
              highlighted: true, // special red border styling
            }] : []),
          ].map(tab => {
            const tabFilterType = tab.filterType || 'status';
            const isActive = tab.value === null
              ? filter.type === null
              : (filter.type === tabFilterType && filter.value === tab.value);
            return (
              <button
                key={tab.value ?? 'all'}
                title={tab.tooltip || ''}
                onClick={() => {
                  setFilter(tab.value ? { type: tabFilterType, value: tab.value } : { type: null, value: null });
                  setPage(1);
                }}
                style={{
                  // Protocol Audit tab special styling: red glow when count > 0 to draw CEO attention
                  background: tab.highlighted && tab.count > 0
                    ? (isActive ? tab.color + '22' : 'rgba(239,68,68,0.08)')
                    : (isActive ? tab.color + '18' : 'transparent'),
                  border: tab.highlighted && tab.count > 0
                    ? `1px solid ${tab.color}66`
                    : (isActive ? `1px solid ${tab.color}55` : `1px solid transparent`),
                  borderBottom: isActive ? `2px solid ${tab.color}` : '2px solid transparent',
                  color: isActive
                    ? tab.color
                    : (tab.highlighted && tab.count > 0 ? tab.color : '#555'),
                  borderRadius: '8px 8px 0 0',
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: isActive ? 600 : (tab.highlighted && tab.count > 0 ? 600 : 400),
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  whiteSpace: 'nowrap',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                  marginLeft: tab.groupStart ? 8 : 0,
                  boxShadow: tab.highlighted && tab.count > 0
                    ? `0 0 0 1px ${tab.color}33, 0 0 12px ${tab.color}22`
                    : 'none',
                }}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    background: isActive ? tab.color + '22' : '#1a1a1a',
                    color: isActive ? tab.color : '#444',
                    padding: '1px 7px',
                    borderRadius: 10,
                    minWidth: 20,
                    textAlign: 'center',
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ borderBottom: `1px solid ${border}`, marginTop: -1 }} />
      </div>

      {/* ── Search + Secondary filters + Buttons ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search order, customer, phone, tracking, SKU, product, confirmation..." style={{ flex: 1, minWidth: 200, background: card, border: `1px solid ${border}`, color: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13 }} />

        {/* Secondary filter — Type / Courier / Payment only (Status handled by tabs) */}
        <FilterDropdown
          current={filter}
          onChange={(f) => { setFilter(f); setPage(1); }}
          globalCounts={globalCounts}
        />

        <button onClick={load} style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>⟳ Refresh</button>

        {canCreate && (
        <Link href="/orders/create"
          style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: '1px solid #22c55e', color: '#000', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          + Create Order
        </Link>
        )}

        {canSync && (
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
        )}

        {/* FIX: Clean button removed — /api/orders/cleanup endpoint doesn't exist */}

        <style jsx>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>

      {/* ── Bulk Action Toolbar — shows when selection > 0 AND user has bulk perm ── */}
      {canBulk && selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 10,
          background: gold + '11', border: `1px solid ${gold}55`, borderRadius: 8,
        }}>
          <span style={{ color: gold, fontSize: 13, fontWeight: 700 }}>
            {selectedIds.size} selected
          </span>
          <div style={{ width: 1, height: 20, background: border }} />

          {canBulkConfirm && (
          <button
            onClick={handleBulkConfirm}
            disabled={bulkRunning}
            title="Confirm all selected pending/processing orders"
            style={{ background: '#3b82f622', border: '1px solid #3b82f6', color: '#3b82f6', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: bulkRunning ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: bulkRunning ? 0.5 : 1 }}>
            ✓ Confirm
          </button>
          )}

          {canBulkAssign && (
          <button
            onClick={() => setBulkModal('assign')}
            disabled={bulkRunning}
            title="Assign a packer to selected orders"
            style={{ background: '#f59e0b22', border: '1px solid #f59e0b', color: '#f59e0b', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: bulkRunning ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: bulkRunning ? 0.5 : 1 }}>
            👤 Assign Packer
          </button>
          )}

          {canBulkStatus && (
          <button
            onClick={() => setBulkModal('status')}
            disabled={bulkRunning}
            title="Change status for selected orders"
            style={{ background: gold + '22', border: `1px solid ${gold}`, color: gold, borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: bulkRunning ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: bulkRunning ? 0.5 : 1 }}>
            ⚙ Change Status
          </button>
          )}

          {canBulkCancel && (
          <button
            onClick={() => setBulkModal('cancel')}
            disabled={bulkRunning}
            title="Cancel selected orders"
            style={{ background: '#ef444422', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: bulkRunning ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: bulkRunning ? 0.5 : 1 }}>
            ✕ Cancel
          </button>
          )}

          <div style={{ flex: 1 }} />

          {bulkRunning && (
            <span style={{ color: gold, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
              Processing...
            </span>
          )}

          <button
            onClick={clearSelection}
            disabled={bulkRunning}
            style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: bulkRunning ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            ✕ Clear
          </button>
        </div>
      )}

      {/* Table — mobile pe hide ho ke cards dikhte hain (CSS .mobile-card-table) */}
      <div className="mobile-card-table" style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${border}` }}>
                {canBulk && (
                <th style={{ padding: '12px 8px 12px 16px', width: 36, textAlign: 'left' }}>
                  <input
                    type="checkbox"
                    checked={allSelectedOnPage}
                    ref={el => { if (el) el.indeterminate = someSelectedOnPage; }}
                    onChange={toggleAllOnPage}
                    title={allSelectedOnPage ? 'Deselect all on page' : 'Select all on page'}
                    style={{ cursor: 'pointer', width: 15, height: 15, accentColor: gold }}
                  />
                </th>
                )}
                {['Order', 'Customer', 'City', 'COD', 'Office Status', 'Payment', 'Courier', 'Courier Status', 'Assigned', 'Date', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#555', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={canBulk ? 12 : 11} style={{ padding: 40, textAlign: 'center', color: '#444' }}>Loading...</td></tr>
              )}
              {!loading && orders.length === 0 && (
                <tr><td colSpan={canBulk ? 12 : 11} style={{ padding: 40, textAlign: 'center', color: '#444' }}>No orders found</td></tr>
              )}
              {orders.map((order, i) => {
                let typeIcon = '';
                if (order.is_wholesale) typeIcon = '🏢';
                else if (order.is_international) typeIcon = '🌍';
                else if (order.is_walkin) typeIcon = '🚶';
                const courierStatusRaw = order.courier_status_raw;
                const isWaCancelledReview = order.status === 'cancelled'
                  && Array.isArray(order.tags)
                  && order.tags.some(t => String(t).toLowerCase() === 'whatsapp_cancelled');
                const isSelected = selectedIds.has(order.id);
                const rowBg = isSelected
                  ? gold + '12'
                  : (isWaCancelledReview ? '#fbbf2408' : (i % 2 === 0 ? 'transparent' : '#0a0a0a'));
                return (
                  <tr key={order.id} style={{ borderBottom: `1px solid #1a1a1a`, background: rowBg }}
                    onClick={() => setSelected(order)} className="order-row">
                    {canBulk && (
                    <td style={{ padding: '12px 8px 12px 16px', width: 36 }} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => toggleOne(order.id, e)}
                        style={{ cursor: 'pointer', width: 15, height: 15, accentColor: gold }}
                      />
                    </td>
                    )}
                    <td style={{ padding: '12px 16px', color: gold, fontWeight: 600, cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Link
                          href={`/orders/${order.id}`}
                          onClick={e => {
                            // Regular left-click (no modifier keys) → drawer
                            // Ctrl/Cmd/middle-click → new tab (browser default)
                            if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelected(order);
                            }
                          }}
                          style={{ color: gold, textDecoration: 'none', fontWeight: 600 }}
                        >
                          {order.order_number || '#' + order.id}
                        </Link>
                        {isWaCancelledReview && (
                          <span
                            title="Customer ne WhatsApp se cancel kiya — review zaroori"
                            style={{ color: '#fbbf24', background: '#fbbf2422', border: '1px solid #fbbf2455', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}
                          >
                            ⚠️ Review
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#ccc' }}>{order.customer_name}</td>
                    <td style={{ padding: '12px 16px', color: '#888' }}>{order.customer_city}</td>
                    <td style={{ padding: '12px 16px', color: '#fff', fontWeight: 600 }}>{canViewAmount ? fmt(order.total_amount) : '••••'}</td>
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
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <a
                          href={`/orders/${order.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          title="Naye tab mein kholo"
                          style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '5px 9px', fontSize: 12, textDecoration: 'none', lineHeight: 1 }}
                        >↗</a>
                        <button onClick={e => { e.stopPropagation(); setSelected(order); }}
                          style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: gold, borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Actions →
                        </button>
                        {/* Protocol Audit verify button (May 2 2026) */}
                        {filter.type === 'audit' && filter.value === 'protocol_unfollowed' && canVerifyProtocol && (
                          <button
                            onClick={e => { e.stopPropagation(); verifyProtocol(order.id, order.order_number); }}
                            title="Mark as protocol OK — order tab se gayab ho jayega"
                            style={{
                              background: '#001a0a', border: '1px solid #003300',
                              color: '#22c55e', borderRadius: 6,
                              padding: '5px 10px', fontSize: 11, fontWeight: 600,
                              cursor: 'pointer', fontFamily: 'inherit',
                            }}>
                            ✓ Verify
                          </button>
                        )}
                      </div>
                      {/* Violation reason badges — only in audit view */}
                      {filter.type === 'audit' && filter.value === 'protocol_unfollowed' && protocolReasons[order.id] && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                          {protocolReasons[order.id].skipped_assignment && (
                            <span title="Order packed/dispatched without anyone being assigned"
                              style={{ background: '#3a0000', color: '#f87171', fontSize: 9, padding: '2px 6px', borderRadius: 3, fontWeight: 600, letterSpacing: 0.3 }}>
                              🔴 NO ASSIGN
                            </span>
                          )}
                          {protocolReasons[order.id].skipped_packing_log && (
                            <span title="No packing scan log — force-packed without ERP scan"
                              style={{ background: '#3a1a00', color: '#fb923c', fontSize: 9, padding: '2px 6px', borderRadius: 3, fontWeight: 600, letterSpacing: 0.3 }}>
                              🟠 NO SCAN
                            </span>
                          )}
                          {protocolReasons[order.id].skipped_confirmation && (
                            <span title="Dispatched/delivered without ever being confirmed"
                              style={{ background: '#3a3300', color: '#fbbf24', fontSize: 9, padding: '2px 6px', borderRadius: 3, fontWeight: 600, letterSpacing: 0.3 }}>
                              🟡 NO CONFIRM
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ─── MOBILE CARD VIEW ─────────────────────────────────────────
            CSS controls visibility — desktop pe hide, mobile pe show.
            Table jo 12 columns wide hai, wo mobile pe tap-friendly cards
            bana deta hai. Same click handler (setSelected) use karta hai. */}
        <div className="mobile-card-view">
          {loading && (
            <div style={{ padding: 40, textAlign: 'center', color: '#444', fontSize: 13 }}>Loading...</div>
          )}
          {!loading && orders.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#444', fontSize: 13 }}>No orders found</div>
          )}
          {orders.map(order => {
            const isWaCancelledReview = order.status === 'cancelled'
              && Array.isArray(order.tags)
              && order.tags.some(t => String(t).toLowerCase() === 'whatsapp_cancelled');
            const isSelected = selectedIds.has(order.id);
            return (
              <div
                key={order.id}
                onClick={() => setSelected(order)}
                className={`mobile-card-row${isSelected ? ' selected' : ''}`}
              >
                <div className="mobile-card-row-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    {canBulk && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onClick={e => e.stopPropagation()}
                      onChange={e => toggleOne(order.id, e)}
                      style={{ width: 18, height: 18, accentColor: gold, flexShrink: 0 }}
                    />
                    )}
                    <span style={{ color: gold, fontWeight: 700, fontSize: 14 }}>
                      {order.order_number || '#' + order.id}
                    </span>
                    {order.is_wholesale && <span style={{ fontSize: 11 }}>🏢</span>}
                    {order.is_international && <span style={{ fontSize: 11 }}>🌍</span>}
                    {order.is_walkin && <span style={{ fontSize: 11 }}>🚶</span>}
                    {isWaCancelledReview && (
                      <span style={{ color: '#fbbf24', background: '#fbbf2422', border: '1px solid #fbbf2455', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>⚠️</span>
                    )}
                  </div>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>
                    {canViewAmount ? fmt(order.total_amount) : '••••'}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: '#ccc', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {order.customer_name}
                    </div>
                    <div style={{ color: '#666', fontSize: 11 }}>
                      {order.customer_city || '—'} · {timeAgo(order.created_at)}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <StatusBadge status={order.status} />
                  <PaymentBadge payment_status={order.payment_status} />
                  {order.dispatched_courier && (
                    <span style={{ color: '#888', background: '#1a1a1a', border: `1px solid ${border}`, padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                      🚚 {order.dispatched_courier}
                    </span>
                  )}
                  {order.courier_status_raw && (
                    <span style={{ color: '#8b5cf6', background: '#8b5cf611', border: '1px solid #8b5cf633', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                      {order.courier_status_raw}
                    </span>
                  )}
                  {order.assigned_to_name && (
                    <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 600 }}>
                      👤 {order.assigned_to_name}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={e => { e.stopPropagation(); setSelected(order); }}
                    style={{ flex: 1, background: gold + '22', border: `1px solid ${gold}`, color: gold, borderRadius: 6, padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Actions →
                  </button>
                  <a
                    href={`/orders/${order.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '8px 12px', fontSize: 12, textDecoration: 'none', lineHeight: 1 }}
                  >↗</a>
                </div>
              </div>
            );
          })}
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
