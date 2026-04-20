'use client';

// ============================================================================
// RS ZEVAR ERP — Order Edit Page (Shopify Order Editing API)
// Route: /orders/[id]/edit
// ----------------------------------------------------------------------------
// Flow:
//   1. Mount → POST /edit-begin → get calculatedOrder (draft) from Shopify
//   2. User interacts:
//      - Quantity spinner → POST /edit-stage { set_quantity }
//      - Remove item (X)  → POST /edit-stage { set_quantity: 0, restock: true }
//      - Add product      → modal → POST /edit-stage { add_variant }
//      - Add custom item  → modal → POST /edit-stage { add_custom }
//      - Per-item discount → modal → POST /edit-stage { add_discount }
//      - Shipping fee     → inline input → POST /edit-stage { update_ship }
//   3. User fills "Reason for edit" + toggles "Notify customer"
//   4. "Update order"  → POST /edit-commit → Shopify commits + ERP resyncs
//   5. Navigate back to /orders/[id]
//
// If commit never called, nothing changes in Shopify or ERP. Safe to abandon.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';

// ─── Constants ──────────────────────────────────────────────────────────────
const gold = '#c9a96e';
const card = '#141414';
const border = '#222';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'customer_support']);

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n) => 'Rs ' + Math.round(Number(n || 0)).toLocaleString('en-PK');

// ─── Small UI atoms ─────────────────────────────────────────────────────────
function Card({ title, children, noPadBody }) {
  return (
    <div style={{
      background: card,
      border: `1px solid ${border}`,
      borderRadius: 10,
      marginBottom: 16,
      overflow: 'hidden',
    }}>
      {title && (
        <div style={{
          padding: '14px 20px',
          borderBottom: `1px solid ${border}`,
          fontSize: 13, fontWeight: 600, color: '#e5e5e5',
          background: 'rgba(201,169,110,0.03)',
        }}>
          {title}
        </div>
      )}
      <div style={{ padding: noPadBody ? 0 : '18px 20px' }}>{children}</div>
    </div>
  );
}

function Btn({ onClick, children, disabled, variant = 'default', type, style }) {
  const variants = {
    default:  { bg: '#1a1a1a', border: border, color: '#ccc' },
    primary:  { bg: gold, border: gold, color: '#000' },
    danger:   { bg: '#1a0000', border: '#660000', color: '#ef4444' },
    subtle:   { bg: 'transparent', border: border, color: '#888' },
    success:  { bg: '#22c55e', border: '#22c55e', color: '#000' },
  };
  const v = variants[variant] || variants.default;
  return (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: v.bg, border: `1px solid ${v.border}`, color: v.color,
        borderRadius: 7, padding: '8px 16px', fontSize: 12, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
        opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
        ...(style || {}),
      }}
    >{children}</button>
  );
}

function Modal({ title, onClose, children, width = 520 }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0f0f0f', border: `1px solid ${border}`,
          borderRadius: 10, width: '100%', maxWidth: width, maxHeight: '85vh',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{
          padding: '14px 20px', borderBottom: `1px solid ${border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{title}</div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: '#888',
            fontSize: 18, cursor: 'pointer', padding: 4, lineHeight: 1,
          }}>×</button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Add Product modal ──────────────────────────────────────────────────────
function AddProductModal({ onClose, onPick, busy }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/products?search=${encodeURIComponent(q)}&view=flat&limit=20`);
      const d = await r.json();
      setResults(d.products || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(search), 300);
    return () => clearTimeout(t);
  }, [search, doSearch]);

  return (
    <Modal title="Add product" onClose={onClose} width={640}>
      <input
        autoFocus
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by title, SKU, or vendor..."
        style={{
          width: '100%', background: '#0a0a0a', border: `1px solid ${border}`,
          color: '#fff', borderRadius: 6, padding: '10px 14px', fontSize: 13,
          boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 14,
          outline: 'none',
        }}
      />

      {loading && <div style={{ padding: 20, color: '#555', fontSize: 12, textAlign: 'center' }}>Searching…</div>}
      {!loading && search.length >= 2 && results.length === 0 && (
        <div style={{ padding: 20, color: '#555', fontSize: 12, textAlign: 'center' }}>No products found</div>
      )}
      {!loading && search.length < 2 && (
        <div style={{ padding: 20, color: '#555', fontSize: 12, textAlign: 'center' }}>
          Kam se kam 2 letters type karo
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map(p => {
          const outOfStock = (p.stock_quantity || 0) === 0;
          const canAdd = !!p.shopify_variant_id && !busy;
          return (
            <div key={p.id} style={{
              display: 'flex', gap: 12, padding: 10,
              background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 7,
              alignItems: 'center',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 6, background: '#1a1a1a',
                overflow: 'hidden', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${border}`,
              }}>
                {p.image_url
                  ? <img src={p.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ color: '#444', fontSize: 18 }}>📦</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#fff', fontWeight: 500 }}>
                  {p.title}
                  {p.variant_title && p.variant_title !== 'Default Title' && (
                    <span style={{ color: '#888' }}> — {p.variant_title}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 2, fontFamily: 'monospace' }}>
                  SKU: {p.sku || '—'} · Stock: {outOfStock
                    ? <span style={{ color: '#ef4444' }}>0</span>
                    : <span style={{ color: p.stock_quantity <= 3 ? '#f59e0b' : '#22c55e' }}>{p.stock_quantity}</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>{fmt(p.selling_price)}</div>
                <button
                  onClick={() => canAdd && onPick(p)}
                  disabled={!canAdd}
                  title={!p.shopify_variant_id ? 'No Shopify variant link' : outOfStock ? 'Out of stock (Shopify may still allow)' : ''}
                  style={{
                    marginTop: 6, background: canAdd ? gold : '#2a2a2a',
                    color: canAdd ? '#000' : '#555', border: 'none',
                    borderRadius: 5, padding: '4px 12px', fontSize: 11, fontWeight: 600,
                    cursor: canAdd ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                  }}
                >Add</button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ─── Add Custom Item modal ──────────────────────────────────────────────────
function AddCustomModal({ onClose, onSubmit, busy }) {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');

  const valid = title.trim() && Number(price) > 0 && Number(quantity) >= 1;

  return (
    <Modal title="Add custom item" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Item name</div>
          <input
            autoFocus value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Gift wrap charge"
            style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Price (Rs)</div>
            <input
              type="number" min="0" step="1" value={price}
              onChange={e => setPrice(e.target.value)} placeholder="0"
              style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Quantity</div>
            <input
              type="number" min="1" step="1" value={quantity}
              onChange={e => setQuantity(e.target.value)}
              style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
            />
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <Btn variant="subtle" onClick={onClose}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={!valid || busy}
          onClick={() => onSubmit({ title: title.trim(), price: Number(price), quantity: Number(quantity) })}
        >{busy ? 'Adding…' : 'Add item'}</Btn>
      </div>
    </Modal>
  );
}

// ─── Discount modal ─────────────────────────────────────────────────────────
function DiscountModal({ item, onClose, onSubmit, busy }) {
  const [type, setType] = useState('FIXED_AMOUNT');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  const valid = Number(value) > 0;

  return (
    <Modal title={`Discount on ${item.title}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Discount type</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { k: 'FIXED_AMOUNT', l: 'Fixed (Rs)' },
              { k: 'PERCENTAGE', l: 'Percentage (%)' },
            ].map(opt => (
              <button
                key={opt.k}
                onClick={() => setType(opt.k)}
                style={{
                  flex: 1, background: type === opt.k ? gold + '22' : '#0a0a0a',
                  border: `1px solid ${type === opt.k ? gold : border}`,
                  color: type === opt.k ? gold : '#888',
                  borderRadius: 6, padding: '8px 10px', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >{opt.l}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
            Value {type === 'PERCENTAGE' ? '(0–100)' : '(Rs)'}
          </div>
          <input
            autoFocus type="number" min="0"
            max={type === 'PERCENTAGE' ? 100 : undefined}
            step={type === 'PERCENTAGE' ? '0.1' : '1'}
            value={value} onChange={e => setValue(e.target.value)}
            style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Reason (optional)</div>
          <input
            value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Loyalty discount"
            style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <Btn variant="subtle" onClick={onClose}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={!valid || busy}
          onClick={() => onSubmit({
            line_item_id: item.id,
            discount_type: type,
            discount_value: Number(value),
            description: reason.trim() || 'ERP discount',
          })}
        >{busy ? 'Applying…' : 'Apply discount'}</Btn>
      </div>
    </Modal>
  );
}

// ─── Main Edit Page ─────────────────────────────────────────────────────────
export default function EditOrderPage() {
  const params = useParams();
  const router = useRouter();
  const { profile, userEmail } = useUser();
  const performer = profile?.full_name || profile?.email || 'Staff';
  const userRole = profile?.role || '';

  const id = params?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [permDenied, setPermDenied] = useState(false);
  const [session, setSession] = useState(null); // calculatedOrder normalized
  const [orderMeta, setOrderMeta] = useState({ order_number: '', original_total: 0 });
  const [staging, setStaging] = useState(false);
  const [msg, setMsg] = useState(null);

  // UI state
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [discountItem, setDiscountItem] = useState(null); // item object or null
  const [editingShipping, setEditingShipping] = useState(null); // shipping_line obj or null
  const [shippingInput, setShippingInput] = useState('');
  const [reason, setReason] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(false);
  const [showCommitConfirm, setShowCommitConfirm] = useState(false);
  const [committing, setCommitting] = useState(false);

  const flash = (type, text, ms = 5000) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), ms);
  };

  // ─── Permission + role gate ─────────────────────────────────────────────
  useEffect(() => {
    if (!profile) return; // still loading user
    if (!ALLOWED_ROLES.has(userRole)) {
      setPermDenied(true);
      setLoading(false);
    }
  }, [profile, userRole]);

  // ─── Begin edit session ──────────────────────────────────────────────────
  const beginSession = useCallback(async () => {
    if (!id) return;
    if (permDenied) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/orders/edit-begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: id, performed_by_email: userEmail }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Edit session failed to start');

      setSession(d);
      setOrderMeta({
        order_number: d.order_number,
        original_total: d.total, // Shopify's view at session start
      });
      // Prefill shipping input from first shipping line
      if (d.shipping_lines?.length > 0) {
        setShippingInput(String(d.shipping_lines[0].price));
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [id, userEmail, permDenied]);

  useEffect(() => {
    if (!permDenied && id) beginSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permDenied, id]);

  // ─── Stage helpers ───────────────────────────────────────────────────────
  const stage = async (action, extraParams) => {
    if (!session?.calculated_order_id) return;
    setStaging(true);
    try {
      const r = await fetch('/api/orders/edit-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calculated_order_id: session.calculated_order_id,
          action,
          ...extraParams,
        }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Stage failed');
      // Merge back — note: d has same shape as session (normalized)
      setSession({ ...session, ...d });
      return d;
    } catch (e) {
      flash('error', e.message);
      return null;
    } finally {
      setStaging(false);
    }
  };

  // Quantity changes — spinner +/- or direct input
  const changeQty = (item, newQty) => {
    const q = Math.max(0, Math.floor(Number(newQty) || 0));
    if (q === item.quantity) return;
    if (item.editable_quantity != null && q > item.editable_quantity && q > item.quantity) {
      flash('error', `Max editable qty for this item: ${item.editable_quantity}`);
      return;
    }
    stage('set_quantity', { line_item_id: item.id, quantity: q, restock: true });
  };

  const removeItem = (item) => {
    if (!confirm(`Remove "${item.title}" from order?`)) return;
    stage('set_quantity', { line_item_id: item.id, quantity: 0, restock: true });
  };

  const pickProduct = async (product) => {
    setShowAddProduct(false);
    const result = await stage('add_variant', {
      variant_id: product.shopify_variant_id,
      quantity: 1,
    });
    if (result) flash('success', `Added: ${product.title}`);
  };

  const submitCustom = async (payload) => {
    setShowAddCustom(false);
    const result = await stage('add_custom', payload);
    if (result) flash('success', `Added: ${payload.title}`);
  };

  const submitDiscount = async (payload) => {
    setDiscountItem(null);
    const result = await stage('add_discount', payload);
    if (result) flash('success', 'Discount applied');
  };

  const saveShipping = async () => {
    if (!editingShipping) return;
    const p = Number(shippingInput);
    if (isNaN(p) || p < 0) {
      flash('error', 'Valid shipping price do');
      return;
    }
    const result = await stage('update_ship', {
      shipping_line_id: editingShipping.id,
      price: p,
    });
    if (result) {
      setEditingShipping(null);
      flash('success', 'Shipping updated');
    }
  };

  // ─── Commit ──────────────────────────────────────────────────────────────
  const commit = async () => {
    if (!session?.calculated_order_id) return;
    setCommitting(true);
    try {
      const r = await fetch('/api/orders/edit-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: id,
          calculated_order_id: session.calculated_order_id,
          reason: reason.trim() || null,
          notify_customer: notifyCustomer,
          performed_by: performer,
          performed_by_email: userEmail,
        }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Commit failed');

      // Success — navigate back
      if (d.warning) {
        alert(`Order edit Shopify pe commit ho gaya. Lekin ERP sync mein chhoti si dikkat — ` +
              `webhook thodi der mein reconcile kar dega. Warning: ${d.warning}`);
      }
      router.push(`/orders/${id}`);
    } catch (e) {
      flash('error', e.message);
      setCommitting(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  if (permDenied) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, padding: 20 }}>
        <div style={{ fontSize: 16, color: '#ef4444' }}>⛔ Access denied</div>
        <div style={{ fontSize: 13, color: '#888', textAlign: 'center', maxWidth: 400 }}>
          Order line items edit karne ke liye super admin, manager, ya customer support role chahiye.<br/>
          Aap ka role: <strong style={{ color: '#ccc' }}>{userRole || '—'}</strong>
        </div>
        <Link href={`/orders/${id}`} style={{ color: gold, fontSize: 13, textDecoration: 'none' }}>
          ← Back to order
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
        ⟳ Opening edit session…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, padding: 20 }}>
        <div style={{ fontSize: 14, color: '#ef4444' }}>⚠ {error}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn onClick={beginSession}>⟳ Retry</Btn>
          <Link href={`/orders/${id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: gold, fontSize: 12, textDecoration: 'none' }}>
            ← Back
          </Link>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const hasChanges = Math.abs(session.total - orderMeta.original_total) > 0.001;
  const totalDelta = session.total - orderMeta.original_total;
  const shippingLine = session.shipping_lines?.[0];

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#e5e5e5' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 24px 40px' }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
            <Link href={`/orders/${id}`} style={{ color: '#888', textDecoration: 'none', fontSize: 13 }}>
              ← {orderMeta.order_number}
            </Link>
            <span style={{ color: '#333' }}>/</span>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff' }}>Edit order</h1>
          </div>
          <div style={{ fontSize: 12, color: '#666' }}>
            Shopify draft session · Changes save nahi honge jab tak "Update order" dabao
          </div>
        </div>

        {/* Status message */}
        {msg && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16,
            background: msg.type === 'success' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
            border: `1px solid ${msg.type === 'success' ? '#4ade80' : '#f87171'}`,
            color:  msg.type === 'success' ? '#4ade80' : '#f87171',
          }}>{msg.text}</div>
        )}

        {/* Two column */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 20 }}>

          {/* LEFT — Items + Shipping + Reason */}
          <div>

            {/* Items card */}
            <Card
              title={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <span>Items ({session.items.length})</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn onClick={() => setShowAddProduct(true)} disabled={staging}>+ Add product</Btn>
                    <Btn onClick={() => setShowAddCustom(true)} disabled={staging}>+ Add custom item</Btn>
                  </div>
                </div>
              }
              noPadBody
            >
              {session.items.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: '#666', fontSize: 13 }}>
                  All items removed. Add product ya commit se cancel.
                </div>
              ) : session.items.map((item, idx) => {
                const isUneditable = !!item.uneditable_reason;
                return (
                  <div key={item.id} style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 20px',
                    borderBottom: idx < session.items.length - 1 ? `1px solid ${border}` : 'none',
                    opacity: isUneditable ? 0.55 : 1,
                  }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 6,
                      background: '#1a1a1a', border: `1px solid ${border}`,
                      overflow: 'hidden', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {item.image_url
                        ? <img src={item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ color: '#444', fontSize: 20 }}>📦</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>
                        {item.product_title || item.title}
                        {item.variant_title && item.variant_title !== 'Default Title' && (
                          <span style={{ color: '#888' }}> — {item.variant_title}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 3, fontFamily: 'monospace' }}>
                        {item.sku && <>SKU: {item.sku} · </>}
                        {fmt(item.unit_price)} each
                        {item.has_discount && <span style={{ color: '#22c55e', marginLeft: 6 }}>• discount applied</span>}
                      </div>
                      {isUneditable && (
                        <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 3, fontStyle: 'italic' }}>
                          ⚠ {item.uneditable_reason}
                        </div>
                      )}
                    </div>

                    {/* Qty spinner */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={() => changeQty(item, item.quantity - 1)}
                        disabled={staging || isUneditable || item.quantity <= 0}
                        style={{ width: 28, height: 28, borderRadius: 5, background: '#1a1a1a', border: `1px solid ${border}`, color: '#ccc', cursor: (staging || isUneditable || item.quantity <= 0) ? 'not-allowed' : 'pointer', fontSize: 14, fontFamily: 'inherit', opacity: (staging || isUneditable || item.quantity <= 0) ? 0.5 : 1 }}
                      >−</button>
                      <input
                        type="number" min="0" value={item.quantity}
                        onChange={e => changeQty(item, e.target.value)}
                        disabled={staging || isUneditable}
                        style={{ width: 48, textAlign: 'center', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 5, padding: '4px 6px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                      />
                      <button
                        onClick={() => changeQty(item, item.quantity + 1)}
                        disabled={staging || isUneditable}
                        style={{ width: 28, height: 28, borderRadius: 5, background: '#1a1a1a', border: `1px solid ${border}`, color: '#ccc', cursor: (staging || isUneditable) ? 'not-allowed' : 'pointer', fontSize: 14, fontFamily: 'inherit', opacity: (staging || isUneditable) ? 0.5 : 1 }}
                      >+</button>
                    </div>

                    {/* Line total */}
                    <div style={{ minWidth: 90, textAlign: 'right' }}>
                      <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{fmt(item.line_total)}</div>
                    </div>

                    {/* Actions */}
                    {!isUneditable && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => setDiscountItem(item)}
                          disabled={staging}
                          title="Apply discount"
                          style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 5, padding: '4px 8px', fontSize: 11, cursor: staging ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: staging ? 0.5 : 1 }}
                        >%</button>
                        <button
                          onClick={() => removeItem(item)}
                          disabled={staging}
                          title="Remove item"
                          style={{ background: 'transparent', border: `1px solid ${border}`, color: '#ef4444', borderRadius: 5, padding: '4px 8px', fontSize: 11, cursor: staging ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: staging ? 0.5 : 1 }}
                        >×</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>

            {/* Shipping card */}
            <Card title="Shipping">
              {shippingLine ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{shippingLine.title || 'Shipping'}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>
                      Currently: {fmt(shippingLine.price)}
                    </div>
                  </div>
                  {editingShipping?.id === shippingLine.id ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="number" min="0" step="1" value={shippingInput}
                        onChange={e => setShippingInput(e.target.value)}
                        autoFocus
                        style={{ width: 100, background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 5, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                      />
                      <Btn variant="primary" onClick={saveShipping} disabled={staging}>Save</Btn>
                      <Btn variant="subtle" onClick={() => { setEditingShipping(null); setShippingInput(String(shippingLine.price)); }}>Cancel</Btn>
                    </div>
                  ) : (
                    <Btn onClick={() => { setEditingShipping(shippingLine); setShippingInput(String(shippingLine.price)); }} disabled={staging}>
                      ✏️ Edit
                    </Btn>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#555', fontStyle: 'italic' }}>
                  No shipping line on this order
                </div>
              )}
            </Card>

            {/* Reason */}
            <Card title="Reason for edit">
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder="Kyun edit kar rahe ho? (Shopify timeline pe dikhega)"
                style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 6, padding: '10px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
              />
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox" id="notify" checked={notifyCustomer}
                  onChange={e => setNotifyCustomer(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="notify" style={{ fontSize: 12, color: '#ccc', cursor: 'pointer' }}>
                  Customer ko email notification bhejein (Shopify default template)
                </label>
              </div>
            </Card>
          </div>

          {/* RIGHT — Summary + Commit */}
          <div>
            <Card title="Summary">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#888' }}>Subtotal</span>
                  <span style={{ color: '#ccc' }}>{fmt(session.subtotal)}</span>
                </div>
                {session.cart_discount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#888' }}>Discount</span>
                    <span style={{ color: '#f87171' }}>-{fmt(session.cart_discount)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#888' }}>Shipping</span>
                  <span style={{ color: '#ccc' }}>{fmt(session.shipping)}</span>
                </div>
                <div style={{ borderTop: `1px solid ${border}`, margin: '6px 0', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700 }}>
                  <span style={{ color: '#fff' }}>New total</span>
                  <span style={{ color: '#fff' }}>{fmt(session.total)}</span>
                </div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                  Original: {fmt(orderMeta.original_total)}
                </div>
                {hasChanges && (
                  <div style={{
                    marginTop: 8, padding: '8px 10px', borderRadius: 6,
                    background: totalDelta > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(74,222,128,0.1)',
                    border: `1px solid ${totalDelta > 0 ? '#f59e0b44' : '#4ade8044'}`,
                    fontSize: 12, color: totalDelta > 0 ? '#f59e0b' : '#4ade80',
                  }}>
                    {totalDelta > 0 ? '⚠️ ' : '✓ '}
                    Total {totalDelta > 0 ? 'badh' : 'kam ho'} raha hai {fmt(Math.abs(totalDelta))} se
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {showCommitConfirm ? (
                  <div style={{ padding: 12, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 7 }}>
                    <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 600, marginBottom: 8 }}>
                      Sure? Ye change Shopify pe apply ho jayega.
                    </div>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Btn variant="subtle" onClick={() => setShowCommitConfirm(false)}>No</Btn>
                      <Btn variant="success" onClick={commit} disabled={committing}>
                        {committing ? 'Committing…' : '✓ Yes, update'}
                      </Btn>
                    </div>
                  </div>
                ) : (
                  <Btn
                    variant="primary"
                    onClick={() => setShowCommitConfirm(true)}
                    disabled={!hasChanges || staging || committing}
                    style={{ padding: '10px 16px', fontSize: 13 }}
                  >
                    {hasChanges ? '💾 Update order' : 'No changes made'}
                  </Btn>
                )}
                <Link href={`/orders/${id}`} style={{ textAlign: 'center' }}>
                  <Btn variant="subtle" style={{ width: '100%' }}>Cancel & back</Btn>
                </Link>
              </div>
            </Card>

            <Card title="About order editing">
              <div style={{ fontSize: 11, color: '#666', lineHeight: 1.6 }}>
                • Changes Shopify ke draft pe stage hoti hain — real order pe asar nahi jab tak "Update order" dabao.<br/>
                • Commit ke baad Shopify aur ERP dono update hote hain.<br/>
                • Stock Shopify automatic adjust karega.<br/>
                • Customer ko email tab hi jayega agar checkbox on ho.
              </div>
            </Card>
          </div>
        </div>

        {/* Modals */}
        {showAddProduct && (
          <AddProductModal
            onClose={() => setShowAddProduct(false)}
            onPick={pickProduct}
            busy={staging}
          />
        )}
        {showAddCustom && (
          <AddCustomModal
            onClose={() => setShowAddCustom(false)}
            onSubmit={submitCustom}
            busy={staging}
          />
        )}
        {discountItem && (
          <DiscountModal
            item={discountItem}
            onClose={() => setDiscountItem(null)}
            onSubmit={submitDiscount}
            busy={staging}
          />
        )}

        {/* Staging indicator */}
        {staging && (
          <div style={{
            position: 'fixed', bottom: 20, right: 20,
            background: 'rgba(201,169,110,0.15)', border: `1px solid ${gold}44`,
            color: gold, padding: '8px 14px', borderRadius: 7, fontSize: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)', zIndex: 200,
          }}>
            ⟳ Syncing with Shopify…
          </div>
        )}
      </div>
    </div>
  );
}
