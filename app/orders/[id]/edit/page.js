'use client';

// ============================================================================
// RS ZEVAR ERP — Shopify-style Order Edit Page
// Route: /orders/[id]/edit
// ----------------------------------------------------------------------------
// Apr 27 2026 — Rebuild after April 25 deletion.
//
// Flow (matches Shopify Admin Order Edit):
//   1. Mount   → POST /api/orders/edit-begin   (creates calculatedOrder draft)
//   2. Stage   → POST /api/orders/edit-stage   (each +/- / add / remove / discount)
//                Returns updated calculatedOrder state — replaces local state.
//   3. Commit  → POST /api/orders/edit-commit  (atomic apply + ERP resync)
//   4. Cancel  → just navigate back; calcOrder draft auto-expires in Shopify (~24h)
//
// All editing logic lives in lib/shopify-order-edit.js (GraphQL helpers).
// This page is a thin UI wrapper around that — no business logic here.
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '../../../context/UserContext';
import { gold, card, border, fmt } from '../../_components/OrderDrawer';

// ─── Style atoms ────────────────────────────────────────────────────────────
const inpStyle = {
  width: '100%', padding: '8px 10px', background: '#0a0a0a',
  border: `1px solid ${border}`, borderRadius: 6, color: '#fff',
  fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
};
const btnPrimary = {
  background: gold, border: 'none', color: '#000', borderRadius: 6,
  padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit',
};
const btnGhost = {
  background: 'transparent', border: `1px solid ${border}`, color: '#ccc',
  borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
};
const btnDanger = {
  background: 'transparent', border: '1px solid #5a2222', color: '#ff7070',
  borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
};

function Card({ title, children, right }) {
  return (
    <div style={{
      background: card, border: `1px solid ${border}`,
      borderRadius: 10, marginBottom: 16, overflow: 'hidden',
    }}>
      {title && (
        <div style={{
          padding: '14px 20px', borderBottom: `1px solid ${border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'rgba(201,169,110,0.03)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e5e5' }}>{title}</div>
          {right}
        </div>
      )}
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  );
}

// ─── Product Picker Modal ────────────────────────────────────────────────────
// Same pattern as orders/create page. Returns selected variants to onAdd.
function ProductPicker({ onClose, onAdd }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState({}); // {variant_id: variant_obj}
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/products?search=${encodeURIComponent(query)}&view=flat&limit=15`);
        const d = await r.json();
        setResults(d.products || []);
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const toggle = (v) => {
    setSelected(s => {
      const next = { ...s };
      const key = v.shopify_variant_id;
      if (next[key]) delete next[key];
      else next[key] = { ...v, quantity: 1 };
      return next;
    });
  };

  const setQty = (variantKey, qty) => {
    setSelected(s => ({ ...s, [variantKey]: { ...s[variantKey], quantity: Math.max(1, parseInt(qty) || 1) } }));
  };

  const confirm = () => {
    const items = Object.values(selected);
    if (items.length === 0) return;
    onAdd(items);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: card, border: `1px solid ${border}`, borderRadius: 12,
        width: 720, maxWidth: '100%', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Add products</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: 22, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${border}` }}>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="🔍 Search by name or SKU..." style={inpStyle} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loading && <div style={{ textAlign: 'center', padding: 20, color: '#666' }}>Searching...</div>}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: '#666' }}>Koi product nahi mila</div>
          )}
          {!loading && query.length < 2 && (
            <div style={{ textAlign: 'center', padding: 20, color: '#666' }}>Type karo (min 2 chars)</div>
          )}
          {results.map(p => {
            const key = p.shopify_variant_id;
            const isSel = !!selected[key];
            return (
              <div key={p.id || key} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 8,
                background: isSel ? 'rgba(201,169,110,0.1)' : 'transparent',
                border: `1px solid ${isSel ? gold : 'transparent'}`,
                marginBottom: 4,
              }}>
                <input type="checkbox" checked={isSel} onChange={() => toggle(p)} style={{ cursor: 'pointer' }} />
                {p.image_url ? (
                  <img src={p.image_url} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0, cursor: 'pointer' }} onClick={() => toggle(p)} />
                ) : (
                  <div onClick={() => toggle(p)} style={{ width: 44, height: 44, borderRadius: 6, background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, cursor: 'pointer' }}>💍</div>
                )}
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => toggle(p)}>
                  <div style={{ fontSize: 13, color: '#fff', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.title || p.parent_title}
                  </div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                    SKU: {p.sku || '—'} • Stock: {p.stock_quantity ?? 0}
                  </div>
                </div>
                {isSel ? (
                  <input type="number" min="1" value={selected[key].quantity}
                    onChange={e => setQty(key, e.target.value)}
                    onClick={e => e.stopPropagation()}
                    style={{ ...inpStyle, width: 60, padding: '5px 8px', textAlign: 'center' }} />
                ) : null}
                <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 75 }}>
                  <div style={{ fontSize: 13, color: gold, fontWeight: 600 }}>{fmt(p.selling_price)}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{
          padding: '14px 20px', borderTop: `1px solid ${border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 12, color: '#999' }}>
            {Object.keys(selected).length} product{Object.keys(selected).length === 1 ? '' : 's'} selected
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btnGhost}>Cancel</button>
            <button onClick={confirm} disabled={Object.keys(selected).length === 0}
              style={{ ...btnPrimary, opacity: Object.keys(selected).length === 0 ? 0.4 : 1, cursor: Object.keys(selected).length === 0 ? 'not-allowed' : 'pointer' }}>
              Add {Object.keys(selected).length > 0 ? `(${Object.keys(selected).length})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Discount Modal ──────────────────────────────────────────────────────────
function DiscountModal({ item, onClose, onApply }) {
  const [type, setType] = useState('FIXED_AMOUNT');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');

  const apply = () => {
    const v = parseFloat(value);
    if (!v || v <= 0) return;
    if (type === 'PERCENTAGE' && v > 100) {
      alert('Percentage 100 se zyada nahi ho sakta');
      return;
    }
    onApply({
      discount_type: type,
      discount_value: v,
      description: description.trim() || undefined,
    });
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      zIndex: 3100, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: card, border: `1px solid ${border}`, borderRadius: 12,
        width: 460, maxWidth: '100%',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Add discount</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: 22, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
            Item: <span style={{ color: '#ddd' }}>{item.title}</span>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button onClick={() => setType('FIXED_AMOUNT')}
              style={{
                flex: 1, padding: '8px', fontSize: 12, fontWeight: 500,
                background: type === 'FIXED_AMOUNT' ? gold : 'transparent',
                color: type === 'FIXED_AMOUNT' ? '#000' : '#ccc',
                border: `1px solid ${type === 'FIXED_AMOUNT' ? gold : border}`,
                borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              }}>Fixed (Rs)</button>
            <button onClick={() => setType('PERCENTAGE')}
              style={{
                flex: 1, padding: '8px', fontSize: 12, fontWeight: 500,
                background: type === 'PERCENTAGE' ? gold : 'transparent',
                color: type === 'PERCENTAGE' ? '#000' : '#ccc',
                border: `1px solid ${type === 'PERCENTAGE' ? gold : border}`,
                borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              }}>Percent (%)</button>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 5 }}>
              {type === 'PERCENTAGE' ? 'Percentage (1-100)' : 'Amount (Rs)'}
            </div>
            <input type="number" min="0" step="0.01" value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={type === 'PERCENTAGE' ? '10' : '500'}
              style={inpStyle} autoFocus />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 5 }}>Reason (optional)</div>
            <input type="text" value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Loyalty discount"
              style={inpStyle} />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnGhost}>Cancel</button>
            <button onClick={apply} disabled={!value} style={{ ...btnPrimary, opacity: !value ? 0.4 : 1 }}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function OrderEditPage() {
  const { id } = useParams();
  const router = useRouter();
  const { profile, userEmail, activeUser } = useUser();
  const performer = activeUser?.name || profile?.full_name || profile?.email || 'Staff';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [calcOrder, setCalcOrder] = useState(null);
  // Snapshot of original totals to show delta vs original
  const [original, setOriginal] = useState(null);
  const [orderNumber, setOrderNumber] = useState('');

  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  const [showPicker, setShowPicker] = useState(false);
  const [discountFor, setDiscountFor] = useState(null); // item being discounted

  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(false);
  const [committing, setCommitting] = useState(false);

  const [shipDraft, setShipDraft] = useState({}); // {shipping_line_id: edited_price_string}

  // ── Begin edit on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/orders/edit-begin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: id, performed_by_email: userEmail }),
        });
        const d = await r.json();
        if (cancelled) return;
        if (!d.success) {
          setError(d.error || 'Edit session shuru nahi ho sakti');
          setLoading(false);
          return;
        }
        setCalcOrder(d);
        setOriginal({ subtotal: d.subtotal, total: d.total, shipping: d.shipping, item_count: d.items.length });
        setOrderNumber(d.order_number || '');
        // Seed shipping draft so input shows current value
        const shipSeed = {};
        for (const sl of (d.shipping_lines || [])) {
          shipSeed[sl.id] = String(sl.price);
        }
        setShipDraft(shipSeed);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Network error');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Stage helper — applies action and updates calcOrder state ──
  const stage = useCallback(async (action, params, msg = 'Updating...') => {
    if (!calcOrder) return;
    setBusy(true);
    setBusyMsg(msg);
    try {
      const r = await fetch('/api/orders/edit-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calculated_order_id: calcOrder.calculated_order_id,
          action, ...params,
        }),
      });
      const d = await r.json();
      if (!d.success) {
        alert(`❌ ${d.error || 'Update fail hua'}`);
      } else {
        // Preserve the IDs and metadata from begin response, replace items/totals
        setCalcOrder(prev => ({
          ...prev,
          subtotal: d.subtotal,
          total: d.total,
          shipping: d.shipping,
          cart_discount: d.cart_discount,
          items: d.items,
          shipping_lines: d.shipping_lines,
        }));
        setHasChanges(true);
      }
    } catch (e) {
      alert(`❌ ${e.message}`);
    }
    setBusy(false);
    setBusyMsg('');
  }, [calcOrder]);

  // ── Action handlers ──
  const setQty = (item, newQty) => {
    const q = Math.max(0, parseInt(newQty) || 0);
    if (q === item.quantity) return;
    if (item.uneditable_reason) {
      alert(`Yeh item edit nahi ho sakta:\n${item.uneditable_reason}`);
      return;
    }
    stage('set_quantity', { line_item_id: item.id, quantity: q, restock: true },
      q === 0 ? 'Item remove ho raha hai...' : 'Quantity update ho rahi hai...');
  };

  const removeItem = (item) => {
    if (!window.confirm(`"${item.title}" ko order se hata dein?`)) return;
    setQty(item, 0);
  };

  const addProducts = async (items) => {
    // Sequentially stage each variant — Shopify mutations are not batched
    for (const v of items) {
      await stage('add_variant', {
        variant_id: v.shopify_variant_id,
        quantity: v.quantity || 1,
      }, `${v.title || 'Product'} add ho raha hai...`);
    }
  };

  const applyDiscount = async (item, payload) => {
    await stage('add_discount', {
      line_item_id: item.id,
      discount_type: payload.discount_type,
      discount_value: payload.discount_value,
      description: payload.description,
    }, 'Discount apply ho raha hai...');
  };

  const applyShipping = (sl) => {
    const newPrice = parseFloat(shipDraft[sl.id]);
    if (isNaN(newPrice) || newPrice < 0) {
      alert('Valid shipping amount daalo (0 ya zyada)');
      return;
    }
    if (newPrice === sl.price) return;
    stage('update_ship', { shipping_line_id: sl.id, price: newPrice },
      'Shipping update ho rahi hai...');
  };

  // ── Commit ──
  const commit = async () => {
    if (!hasChanges) {
      alert('Koi changes nahi hain');
      return;
    }
    if (!reason.trim()) {
      if (!window.confirm('Reason field khali hai. Phir bhi commit karna hai?')) return;
    }
    setCommitting(true);
    try {
      const r = await fetch('/api/orders/edit-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: id,
          calculated_order_id: calcOrder.calculated_order_id,
          reason: reason.trim() || undefined,
          notify_customer: notify,
          performed_by: performer,
          performed_by_email: userEmail,
        }),
      });
      const d = await r.json();
      if (!d.success) {
        alert(`❌ Commit fail: ${d.error}`);
        setCommitting(false);
        return;
      }
      // Success — show toast then navigate back
      const warn = d.warning ? `\n⚠️ ${d.warning}\n(Webhook se sync ho jayega 5 second mein)` : '';
      alert(`✅ Order updated!\nNaya total: Rs ${Number(d.shopify_new_total || d.total_amount || 0).toLocaleString('en-PK')}${warn}`);
      router.push(`/orders/${id}`);
    } catch (e) {
      alert(`❌ ${e.message}`);
      setCommitting(false);
    }
  };

  const cancelEdit = () => {
    if (hasChanges && !window.confirm('Saari changes discard ho jayengi. Wapas chalein?')) return;
    router.push(`/orders/${id}`);
  };

  // ── Loading / error states ──
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>Edit session shuru ho rahi hai...</div>
        <div style={{ fontSize: 11, color: '#555' }}>Shopify se calculatedOrder draft create ho raha hai</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
        <div style={{
          padding: 18, background: '#2a1818', border: '1px solid #5a2222',
          borderRadius: 8, color: '#ff8080', fontSize: 13, marginBottom: 14,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>❌ Edit nahi ho sakta</div>
          <div>{error}</div>
        </div>
        <Link href={`/orders/${id}`} style={{ ...btnGhost, display: 'inline-block', textDecoration: 'none' }}>
          ← Order pe wapas jao
        </Link>
      </div>
    );
  }
  if (!calcOrder) return null;

  // ── Derived values ──
  const totalDelta = original ? calcOrder.total - original.total : 0;
  const itemsDelta = original ? calcOrder.items.length - original.item_count : 0;

  return (
    <div style={{ padding: '18px 22px', maxWidth: 1100, margin: '0 auto', position: 'relative' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 18, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Link href={`/orders/${id}`} style={{
            color: '#888', textDecoration: 'none', fontSize: 13,
            padding: '6px 10px', border: `1px solid ${border}`, borderRadius: 6,
          }}>← Back</Link>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>
              Edit order {orderNumber ? `#${orderNumber}` : ''}
            </div>
            <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>
              {hasChanges ? '● Unsaved changes' : 'No changes yet'}
              {hasChanges && totalDelta !== 0 && (
                <span style={{ marginLeft: 8, color: totalDelta > 0 ? '#7dc88a' : '#e8a76d' }}>
                  ({totalDelta > 0 ? '+' : ''}Rs {totalDelta.toLocaleString('en-PK', { maximumFractionDigits: 2 })})
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={cancelEdit} disabled={committing} style={btnGhost}>Cancel</button>
          <button onClick={commit} disabled={!hasChanges || committing}
            style={{
              ...btnPrimary,
              opacity: (!hasChanges || committing) ? 0.4 : 1,
              cursor: (!hasChanges || committing) ? 'not-allowed' : 'pointer',
            }}>
            {committing ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Busy indicator strip */}
      {busy && (
        <div style={{
          padding: '8px 14px', background: 'rgba(201,169,110,0.08)',
          border: `1px solid rgba(201,169,110,0.3)`, borderRadius: 6,
          fontSize: 12, color: gold, marginBottom: 14,
        }}>
          ⏳ {busyMsg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
        {/* ── Left column: items + shipping ── */}
        <div>
          <Card title="Items" right={
            <button onClick={() => setShowPicker(true)} disabled={busy} style={{
              background: 'transparent', border: `1px solid ${gold}`, color: gold,
              borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 500,
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
              fontFamily: 'inherit',
            }}>+ Add product</button>
          }>
            {calcOrder.items.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#666', fontSize: 12 }}>
                Order khaali hai. Kam-az-kam ek item add karo.
              </div>
            ) : (
              <div>
                {calcOrder.items.map(item => {
                  const locked = !!item.uneditable_reason;
                  return (
                    <div key={item.id} style={{
                      display: 'flex', gap: 12, padding: '12px 0',
                      borderBottom: `1px solid ${border}`, alignItems: 'flex-start',
                    }}>
                      {item.image_url ? (
                        <img src={item.image_url} alt="" style={{
                          width: 56, height: 56, borderRadius: 6,
                          objectFit: 'cover', flexShrink: 0,
                        }} />
                      ) : (
                        <div style={{
                          width: 56, height: 56, borderRadius: 6, background: '#1a1a1a',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 22, flexShrink: 0,
                        }}>💍</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>
                          {item.title || item.product_title || 'Unknown product'}
                        </div>
                        <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>
                          {item.variant_title && item.variant_title !== 'Default Title' && (
                            <span style={{ marginRight: 8 }}>{item.variant_title}</span>
                          )}
                          SKU: {item.sku || '—'} • Unit: {fmt(item.unit_price)}
                          {item.has_discount && (
                            <span style={{ marginLeft: 6, color: '#7dc88a' }}>• discounted</span>
                          )}
                        </div>
                        {locked && (
                          <div style={{
                            marginTop: 5, fontSize: 11, color: '#e8a76d',
                            background: 'rgba(232,167,109,0.08)',
                            border: '1px solid rgba(232,167,109,0.25)',
                            padding: '3px 8px', borderRadius: 4, display: 'inline-block',
                          }}>🔒 {item.uneditable_reason}</div>
                        )}
                        {!locked && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                            <button onClick={() => setDiscountFor(item)} disabled={busy} style={{
                              background: 'transparent', border: `1px solid ${border}`,
                              color: '#aaa', borderRadius: 4, padding: '3px 8px',
                              fontSize: 11, cursor: busy ? 'not-allowed' : 'pointer',
                              fontFamily: 'inherit',
                            }}>+ Discount</button>
                            <button onClick={() => removeItem(item)} disabled={busy} style={btnDanger}>
                              🗑 Remove
                            </button>
                          </div>
                        )}
                      </div>
                      {/* Qty controls */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => setQty(item, item.quantity - 1)}
                          disabled={busy || locked || item.quantity <= 1}
                          style={{
                            width: 28, height: 28, borderRadius: 4,
                            background: 'transparent', border: `1px solid ${border}`,
                            color: '#ccc', fontSize: 14, fontWeight: 600,
                            cursor: (busy || locked || item.quantity <= 1) ? 'not-allowed' : 'pointer',
                            opacity: (busy || locked || item.quantity <= 1) ? 0.4 : 1,
                            fontFamily: 'inherit',
                          }}>−</button>
                        <div style={{
                          width: 36, textAlign: 'center', fontSize: 13,
                          fontWeight: 600, color: '#fff',
                        }}>{item.quantity}</div>
                        <button onClick={() => setQty(item, item.quantity + 1)}
                          disabled={busy || locked}
                          style={{
                            width: 28, height: 28, borderRadius: 4,
                            background: 'transparent', border: `1px solid ${border}`,
                            color: '#ccc', fontSize: 14, fontWeight: 600,
                            cursor: (busy || locked) ? 'not-allowed' : 'pointer',
                            opacity: (busy || locked) ? 0.4 : 1,
                            fontFamily: 'inherit',
                          }}>+</button>
                      </div>
                      <div style={{
                        minWidth: 90, textAlign: 'right', fontSize: 13,
                        color: gold, fontWeight: 600, flexShrink: 0,
                      }}>{fmt(item.line_total)}</div>
                    </div>
                  );
                })}
              </div>
            )}
            {itemsDelta !== 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#888' }}>
                {itemsDelta > 0 ? `+${itemsDelta}` : itemsDelta} items vs original
              </div>
            )}
          </Card>

          {/* Shipping */}
          {calcOrder.shipping_lines && calcOrder.shipping_lines.length > 0 && (
            <Card title="Shipping">
              {calcOrder.shipping_lines.map(sl => (
                <div key={sl.id} style={{
                  display: 'flex', gap: 12, alignItems: 'center',
                  padding: '8px 0',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: '#fff' }}>{sl.title || 'Shipping'}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      Current: {fmt(sl.price)}
                    </div>
                  </div>
                  <input type="number" min="0" step="0.01"
                    value={shipDraft[sl.id] ?? ''}
                    onChange={e => setShipDraft(s => ({ ...s, [sl.id]: e.target.value }))}
                    style={{ ...inpStyle, width: 110, textAlign: 'right' }}
                    disabled={busy} />
                  <button onClick={() => applyShipping(sl)}
                    disabled={busy || parseFloat(shipDraft[sl.id]) === sl.price}
                    style={{
                      ...btnGhost,
                      opacity: (busy || parseFloat(shipDraft[sl.id]) === sl.price) ? 0.4 : 1,
                    }}>Update</button>
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* ── Right column: totals + commit form ── */}
        <div>
          <Card title="Updated totals">
            <div style={{ fontSize: 13 }}>
              <Row label="Subtotal" value={fmt(calcOrder.subtotal)} />
              {calcOrder.cart_discount > 0 && (
                <Row label="Cart discount" value={`− ${fmt(calcOrder.cart_discount)}`} color="#7dc88a" />
              )}
              <Row label="Shipping" value={fmt(calcOrder.shipping)} />
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                paddingTop: 10, marginTop: 6, borderTop: `1px solid ${border}`,
                fontSize: 14, fontWeight: 600, color: '#fff',
              }}>
                <span>Total</span>
                <span style={{ color: gold }}>{fmt(calcOrder.total)}</span>
              </div>
              {original && totalDelta !== 0 && (
                <div style={{
                  marginTop: 8, padding: '6px 10px', borderRadius: 5,
                  background: totalDelta > 0 ? 'rgba(125,200,138,0.08)' : 'rgba(232,167,109,0.08)',
                  fontSize: 11, color: totalDelta > 0 ? '#7dc88a' : '#e8a76d',
                  display: 'flex', justifyContent: 'space-between',
                }}>
                  <span>Was {fmt(original.total)}</span>
                  <span>{totalDelta > 0 ? '+' : ''}{fmt(totalDelta)}</span>
                </div>
              )}
            </div>
          </Card>

          <Card title="Commit changes">
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 5 }}>
                Reason (audit log mein save hoga)
              </div>
              <textarea value={reason} onChange={e => setReason(e.target.value)}
                placeholder="e.g. Customer ne bracelet add karne ko kaha"
                rows={3}
                style={{ ...inpStyle, resize: 'vertical', minHeight: 60 }} />
            </div>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, color: '#ccc', marginBottom: 14, cursor: 'pointer',
            }}>
              <input type="checkbox" checked={notify}
                onChange={e => setNotify(e.target.checked)}
                style={{ cursor: 'pointer' }} />
              Customer ko Shopify se email bhejo
            </label>
            <button onClick={commit} disabled={!hasChanges || committing}
              style={{
                ...btnPrimary, width: '100%',
                opacity: (!hasChanges || committing) ? 0.4 : 1,
                cursor: (!hasChanges || committing) ? 'not-allowed' : 'pointer',
              }}>
              {committing ? 'Saving to Shopify...' : 'Save changes'}
            </button>
            <div style={{ marginTop: 10, fontSize: 10, color: '#666', lineHeight: 1.5 }}>
              Save karne par Shopify pe atomic edit hota hai aur ERP turant resync ho jata hai. Webhook safety net 5 sec mein verify karta hai.
            </div>
          </Card>
        </div>
      </div>

      {showPicker && (
        <ProductPicker onClose={() => setShowPicker(false)} onAdd={addProducts} />
      )}
      {discountFor && (
        <DiscountModal item={discountFor} onClose={() => setDiscountFor(null)}
          onApply={(payload) => applyDiscount(discountFor, payload)} />
      )}
    </div>
  );
}

// ─── Local Row helper (for totals) ───────────────────────────────────────────
function Row({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '5px 0', fontSize: 13,
    }}>
      <span style={{ color: '#aaa' }}>{label}</span>
      <span style={{ color: color || '#ddd' }}>{value}</span>
    </div>
  );
}
