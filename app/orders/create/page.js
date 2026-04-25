// ============================================================================
// RS ZEVAR ERP — Create Order Page (Shopify-style UX)
// /orders/create
//
// Replicates Shopify's Create Order flow:
//   - Product picker (search by SKU/title)
//   - Per-line quantity + custom price + per-line discount
//   - Customer search/select OR inline create
//   - Shipping address fields
//   - Manual shipping price + order-level discount
//   - Tags + internal note
//   - Submit → POST /api/orders/create → redirect /orders/{erp_order_id}
//
// Shopify saath sync hota hai (calls Shopify Draft Order API + completes).
// ============================================================================

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const gold   = '#c9a96e';
const border = '#222';
const card   = '#0f0f0f';
const danger = '#ef4444';
const success = '#22c55e';

const inpStyle = {
  width: '100%', background: '#1a1a1a', border: `1px solid ${border}`,
  color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13,
  boxSizing: 'border-box', fontFamily: 'inherit',
};

const labelStyle = { fontSize: 11, color: '#888', marginBottom: 5, fontWeight: 500 };

const fmt = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;

// ─── Product Picker Modal ──────────────────────────────────────────────────
function ProductPicker({ onClose, onAdd }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState({}); // {variant_id: {qty}}
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search
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
      if (next[v.shopify_variant_id]) delete next[v.shopify_variant_id];
      else next[v.shopify_variant_id] = { ...v, quantity: 1 };
      return next;
    });
  };

  const confirm = () => {
    const items = Object.values(selected);
    if (items.length === 0) return;
    onAdd(items);
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, width: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Select products</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: 22, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${border}` }}>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="🔍 Search products by name or SKU..." style={inpStyle} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loading && <div style={{ textAlign: 'center', padding: 20, color: '#666' }}>Searching...</div>}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: '#666' }}>Koi product nahi mila</div>
          )}
          {!loading && query.length < 2 && (
            <div style={{ textAlign: 'center', padding: 20, color: '#666' }}>Search karne ke liye type karo (min 2 chars)</div>
          )}
          {results.map(p => {
            const isSelected = !!selected[p.shopify_variant_id];
            return (
              <div key={p.id || p.shopify_variant_id} onClick={() => toggle(p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 8,
                  background: isSelected ? 'rgba(201,169,110,0.1)' : 'transparent',
                  border: `1px solid ${isSelected ? gold : 'transparent'}`,
                  cursor: 'pointer', marginBottom: 4,
                }}>
                <input type="checkbox" checked={isSelected} onChange={() => {}} style={{ cursor: 'pointer' }} />
                {p.image_url ? (
                  <img src={p.image_url} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: 6, background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>💍</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#fff', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.title || p.parent_title}
                  </div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                    SKU: {p.sku || '—'} • Stock: {p.stock_quantity ?? 0}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 13, color: gold, fontWeight: 600 }}>{fmt(p.selling_price)}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: '#888' }}>{Object.keys(selected).length} item(s) selected</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={confirm} disabled={Object.keys(selected).length === 0}
              style={{
                background: Object.keys(selected).length === 0 ? '#1a1a1a' : gold,
                border: `1px solid ${gold}`,
                color: Object.keys(selected).length === 0 ? '#444' : '#000',
                borderRadius: 7, padding: '8px 18px', fontSize: 13, fontWeight: 600,
                cursor: Object.keys(selected).length === 0 ? 'not-allowed' : 'pointer',
              }}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Customer Picker (autocomplete dropdown) ──────────────────────────────
function CustomerSearch({ onSelect, onCreateNew }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/customers?search=${encodeURIComponent(query)}`);
        const d = await r.json();
        setResults((d.customers || []).slice(0, 8));
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Click-outside handler — dropdown band karne ke liye
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input value={query} onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
        onFocus={() => setShowDropdown(true)}
        placeholder="🔍 Search or create a customer..." style={inpStyle} />
      {showDropdown && (query.length >= 2 || results.length > 0) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: '#1a1a1a', border: `1px solid ${border}`, borderRadius: 8,
          maxHeight: 280, overflowY: 'auto', zIndex: 100,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        }}>
          <div onClick={() => { onCreateNew(query); setShowDropdown(false); setQuery(''); }}
            style={{ padding: '12px 14px', borderBottom: `1px solid ${border}`, color: gold, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>+</span> Create new customer
          </div>
          {loading && <div style={{ padding: 12, color: '#666', fontSize: 12, textAlign: 'center' }}>Searching...</div>}
          {!loading && results.map((c, i) => (
            <div key={i} onClick={() => { onSelect(c); setShowDropdown(false); setQuery(''); }}
              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: i < results.length - 1 ? `1px solid #222` : 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = '#252525'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{c.name || 'Unknown'}</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{c.phone} • {c.city || 'No city'} • {c.orders} orders</div>
            </div>
          ))}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div style={{ padding: 12, color: '#666', fontSize: 12, textAlign: 'center' }}>No matching customer</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Discount Modal (per-line OR order-level) ─────────────────────────────
function DiscountModal({ initial, onClose, onSave, label }) {
  const [type,  setType]  = useState(initial?.type  || 'amount');
  const [value, setValue] = useState(initial?.value || '');

  const save = () => {
    const v = parseFloat(value) || 0;
    if (v <= 0) { onSave(null); onClose(); return; }
    onSave({ type, value: v });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: 24, width: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{label || 'Add discount'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Discount type</div>
          <select value={type} onChange={e => setType(e.target.value)} style={inpStyle}>
            <option value="amount">Amount (Rs)</option>
            <option value="percentage">Percentage (%)</option>
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={labelStyle}>Value</div>
          <input type="number" min="0" step="0.01" value={value} onChange={e => setValue(e.target.value)}
            placeholder={type === 'percentage' ? '10' : '100'} style={inpStyle} autoFocus />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {initial && (
            <button onClick={() => { onSave(null); onClose(); }}
              style={{ background: 'transparent', border: `1px solid ${danger}`, color: danger, borderRadius: 7, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }}>Remove</button>
          )}
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} style={{ background: gold, border: `1px solid ${gold}`, color: '#000', borderRadius: 7, padding: '8px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────
export default function CreateOrderPage() {
  const router = useRouter();

  // Items
  const [items, setItems] = useState([]);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [lineDiscountIdx, setLineDiscountIdx] = useState(null);
  const [editPriceIdx, setEditPriceIdx] = useState(null);

  // Customer
  const [customer, setCustomer] = useState(null); // { name, phone, city, address }
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [customerForm, setCustomerForm] = useState({ first_name: '', last_name: '', phone: '', email: '', address1: '', city: 'Karachi' });

  // Shipping + discount
  const [shippingAmt,  setShippingAmt]  = useState(250);
  const [orderDiscount, setOrderDiscount] = useState(null);
  const [showOrderDiscount, setShowOrderDiscount] = useState(false);

  // Meta
  const [tags, setTags] = useState('whatsapp_confirmed');
  const [note, setNote] = useState('');
  const [source, setSource] = useState('WhatsApp');

  // Submit
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // ─── Calculations ────────────────────────────────────────────────────────
  const calcLineTotal = (item) => {
    const sub = (item.unit_price || 0) * (item.quantity || 0);
    if (!item.discount) return sub;
    const d = item.discount;
    return d.type === 'percentage'
      ? sub - (sub * d.value / 100)
      : sub - (d.value * (item.quantity || 0)); // Shopify "value per unit"
  };

  const subtotal = items.reduce((s, it) => s + calcLineTotal(it), 0);
  const orderDiscountAmt = orderDiscount
    ? (orderDiscount.type === 'percentage' ? subtotal * orderDiscount.value / 100 : orderDiscount.value)
    : 0;
  const total = Math.max(0, subtotal - orderDiscountAmt + (parseFloat(shippingAmt) || 0));

  // ─── Handlers ───────────────────────────────────────────────────────────
  const handleAddProducts = (newItems) => {
    setItems(prev => {
      const merged = [...prev];
      for (const ni of newItems) {
        const existing = merged.findIndex(x => x.shopify_variant_id === ni.shopify_variant_id);
        if (existing >= 0) {
          merged[existing] = { ...merged[existing], quantity: merged[existing].quantity + 1 };
        } else {
          merged.push({
            shopify_variant_id: ni.shopify_variant_id,
            title: ni.title || ni.parent_title,
            sku: ni.sku,
            image_url: ni.image_url,
            quantity: 1,
            unit_price: ni.selling_price || 0,
            use_custom_price: false,
            discount: null,
          });
        }
      }
      return merged;
    });
  };

  const handleCustomerSelect = (c) => {
    // From /api/customers result — has { name, phone, city }
    const [first_name, ...rest] = (c.name || 'Customer').split(' ');
    setCustomer({
      first_name,
      last_name:  rest.join(' ') || '.',
      phone:      c.phone,
      address1:   c.address || '',
      city:       c.city || 'Karachi',
    });
  };

  const handleCustomerCreate = (typedName) => {
    const [fn, ...rest] = (typedName || '').split(' ');
    setCustomerForm(f => ({ ...f, first_name: fn || '', last_name: rest.join(' ') || '' }));
    setShowCustomerForm(true);
  };

  const handleCustomerFormSave = () => {
    if (!customerForm.first_name && !customerForm.last_name) { alert('Name zaroori hai'); return; }
    if (!customerForm.phone) { alert('Phone zaroori hai'); return; }
    setCustomer({
      first_name: customerForm.first_name,
      last_name:  customerForm.last_name || '.',
      phone:      customerForm.phone,
      email:      customerForm.email,
      address1:   customerForm.address1,
      city:       customerForm.city,
    });
    setShowCustomerForm(false);
  };

  const handleSubmit = async () => {
    setError('');
    if (items.length === 0) { setError('Kam az kam 1 product zaroori hai'); return; }
    if (!customer) { setError('Customer add karo'); return; }
    if (!customer.phone) { setError('Customer phone zaroori hai'); return; }

    // Phone normalize karo: spaces, dashes, brackets hata do
    const cleanPhone = String(customer.phone).replace(/[\s\-()]/g, '');

    setCreating(true);
    try {
      const tagsList = tags.split(',').map(t => t.trim()).filter(Boolean);
      const r = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line_items: items.map(it => ({
            shopify_variant_id: it.shopify_variant_id,
            quantity: it.quantity,
            unit_price: it.unit_price,
            use_custom_price: it.use_custom_price,
            discount: it.discount,
          })),
          customer: {
            first_name: customer.first_name,
            last_name:  customer.last_name,
            phone:      cleanPhone,
            email:      customer.email || undefined,
          },
          shipping_address: {
            address1: customer.address1 || '',
            city:     customer.city || 'Karachi',
            country:  'Pakistan',
            phone:    cleanPhone,
          },
          shipping_line: parseFloat(shippingAmt) > 0 ? { title: 'Shipping Charges', price: parseFloat(shippingAmt) } : null,
          order_discount: orderDiscount,
          note,
          tags: [...tagsList, source].filter(Boolean),
        }),
      });
      const d = await r.json();
      if (!d.success) {
        setError(d.error || 'Order create nahi hua');
        setCreating(false);
        return;
      }
      // Success → redirect to order page
      if (d.erp_order_id) {
        router.push(`/orders/${d.erp_order_id}`);
      } else {
        router.push('/orders');
      }
    } catch (e) {
      setError(e.message);
      setCreating(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', color: '#fff', fontFamily: 'inherit' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <Link href="/orders" style={{ color: '#888', fontSize: 13, textDecoration: 'none' }}>← Orders</Link>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Create order</div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: `1px solid ${danger}`, color: danger, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20 }}>

        {/* ─── LEFT COLUMN ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Products card */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Products</div>

            <div style={{ display: 'flex', gap: 10, marginBottom: items.length > 0 ? 16 : 0 }}>
              <button onClick={() => setShowProductPicker(true)}
                style={{ flex: 1, background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                🔍 Search & add products
              </button>
              <button onClick={() => setShowProductPicker(true)}
                style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Browse
              </button>
            </div>

            {items.length > 0 && (
              <div style={{ borderTop: `1px solid ${border}`, paddingTop: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 30px', gap: 12, fontSize: 11, color: '#666', marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border}` }}>
                  <div>Product</div>
                  <div style={{ textAlign: 'center' }}>Quantity</div>
                  <div style={{ textAlign: 'right' }}>Total</div>
                  <div></div>
                </div>

                {items.map((item, idx) => {
                  const lineTotal = calcLineTotal(item);
                  const lineSub   = (item.unit_price || 0) * (item.quantity || 0);
                  return (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 30px', gap: 12, alignItems: 'center', padding: '12px 0', borderBottom: idx < items.length - 1 ? `1px solid ${border}` : 'none' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
                        {item.image_url ? (
                          <img src={item.image_url} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 44, height: 44, borderRadius: 6, background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>💍</div>
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, color: '#fff', fontWeight: 500, lineHeight: 1.3, wordBreak: 'break-word' }}>{item.title}</div>
                          {item.sku && <div style={{ fontSize: 10, color: '#666', marginTop: 2, fontFamily: 'monospace' }}>SKU: {item.sku}</div>}
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
                            {editPriceIdx === idx ? (
                              <input type="number" step="0.01" min="0" autoFocus value={item.unit_price}
                                onChange={e => setItems(arr => arr.map((it, i) => i === idx ? { ...it, unit_price: parseFloat(e.target.value) || 0, use_custom_price: true } : it))}
                                onBlur={() => setEditPriceIdx(null)}
                                onKeyDown={e => { if (e.key === 'Enter') setEditPriceIdx(null); }}
                                style={{ ...inpStyle, width: 90, padding: '4px 8px', fontSize: 12 }} />
                            ) : (
                              <span onClick={() => setEditPriceIdx(idx)}
                                style={{ fontSize: 12, color: gold, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
                                {fmt(item.unit_price)}
                              </span>
                            )}
                            <button onClick={() => setLineDiscountIdx(idx)}
                              style={{ background: 'none', border: 'none', color: item.discount ? success : '#888', fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
                              {item.discount ? `Discount: ${item.discount.type === 'percentage' ? item.discount.value + '%' : fmt(item.discount.value)}` : 'Add discount'}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <button onClick={() => setItems(a => a.map((it, i) => i === idx ? { ...it, quantity: Math.max(1, it.quantity - 1) } : it))}
                          style={{ width: 24, height: 24, background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 5, cursor: 'pointer', fontSize: 14, padding: 0 }}>−</button>
                        <input type="number" min="1" value={item.quantity}
                          onChange={e => setItems(a => a.map((it, i) => i === idx ? { ...it, quantity: parseInt(e.target.value) || 1 } : it))}
                          style={{ width: 38, textAlign: 'center', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 5, padding: '4px', fontSize: 12, fontFamily: 'inherit' }} />
                        <button onClick={() => setItems(a => a.map((it, i) => i === idx ? { ...it, quantity: it.quantity + 1 } : it))}
                          style={{ width: 24, height: 24, background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 5, cursor: 'pointer', fontSize: 14, padding: 0 }}>+</button>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        {item.discount && lineTotal !== lineSub && (
                          <div style={{ fontSize: 10, color: '#666', textDecoration: 'line-through' }}>{fmt(lineSub)}</div>
                        )}
                        <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{fmt(lineTotal)}</div>
                      </div>

                      <button onClick={() => setItems(a => a.filter((_, i) => i !== idx))}
                        style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16, padding: 4 }}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Payment summary card */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Payment</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#bbb' }}>
                <span>Subtotal ({items.length} {items.length === 1 ? 'item' : 'items'})</span>
                <span>{fmt(subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => setShowOrderDiscount(true)} style={{ background: 'none', border: 'none', color: gold, fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}>
                  {orderDiscount ? `Discount (${orderDiscount.type === 'percentage' ? orderDiscount.value + '%' : fmt(orderDiscount.value)})` : '+ Add order discount'}
                </button>
                <span style={{ color: '#bbb' }}>{orderDiscount ? `− ${fmt(orderDiscountAmt)}` : 'Rs 0'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#888' }}>Shipping</span>
                  <input type="number" min="0" step="1" value={shippingAmt}
                    onChange={e => setShippingAmt(e.target.value)}
                    style={{ ...inpStyle, width: 90, padding: '5px 9px', fontSize: 12 }} />
                </div>
                <span style={{ color: '#bbb' }}>{fmt(parseFloat(shippingAmt) || 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${border}`, paddingTop: 10, marginTop: 4, fontSize: 14, fontWeight: 700, color: '#fff' }}>
                <span>Total</span>
                <span>{fmt(total)}</span>
              </div>
            </div>

            <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(201,169,110,0.06)', borderRadius: 7, fontSize: 11, color: '#888' }}>
              Payment method: <strong style={{ color: gold }}>COD</strong> (Cash on Delivery) — customer collect karega courier ke saath.
            </div>
          </div>

          {/* Note */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 18 }}>
            <div style={labelStyle}>Internal note (optional)</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="Customer requirements, agar koi internal note ho..."
              style={{ ...inpStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        </div>

        {/* ─── RIGHT COLUMN ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Customer card */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Customer</div>
            {!customer ? (
              <CustomerSearch onSelect={handleCustomerSelect} onCreateNew={handleCustomerCreate} />
            ) : (
              <div>
                <div style={{ background: '#1a1a1a', border: `1px solid ${border}`, borderRadius: 7, padding: 12, fontSize: 13 }}>
                  <div style={{ color: gold, fontWeight: 600 }}>{customer.first_name} {customer.last_name}</div>
                  <div style={{ color: '#888', marginTop: 4, fontSize: 12 }}>📞 {customer.phone}</div>
                  {customer.address1 && <div style={{ color: '#888', marginTop: 3, fontSize: 12 }}>📍 {customer.address1}, {customer.city}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => { setCustomerForm({
                    first_name: customer.first_name, last_name: customer.last_name === '.' ? '' : customer.last_name,
                    phone: customer.phone, email: customer.email || '',
                    address1: customer.address1 || '', city: customer.city || 'Karachi',
                  }); setShowCustomerForm(true); }}
                    style={{ flex: 1, background: 'transparent', border: `1px solid ${border}`, color: '#bbb', borderRadius: 6, padding: '6px', fontSize: 11, cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => setCustomer(null)}
                    style={{ flex: 1, background: 'transparent', border: `1px solid ${danger}`, color: danger, borderRadius: 6, padding: '6px', fontSize: 11, cursor: 'pointer' }}>Remove</button>
                </div>
              </div>
            )}
          </div>

          {/* Shipping address (only if customer added) */}
          {customer && (
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Shipping address</div>
              <div style={{ marginBottom: 8 }}>
                <div style={labelStyle}>Address</div>
                <input value={customer.address1 || ''} onChange={e => setCustomer(c => ({...c, address1: e.target.value}))}
                  placeholder="Street address" style={inpStyle} />
              </div>
              <div style={{ marginBottom: 0 }}>
                <div style={labelStyle}>City</div>
                <input value={customer.city || ''} onChange={e => setCustomer(c => ({...c, city: e.target.value}))} style={inpStyle} />
              </div>
            </div>
          )}

          {/* Tags + Source */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Tags & Source</div>
            <div style={{ marginBottom: 8 }}>
              <div style={labelStyle}>Source</div>
              <select value={source} onChange={e => setSource(e.target.value)} style={inpStyle}>
                <option value="WhatsApp">WhatsApp</option>
                <option value="Facebook">Facebook</option>
                <option value="Instagram">Instagram</option>
                <option value="Phone">Phone Call</option>
                <option value="Walk-in">Walk-in</option>
                <option value="Manual">Manual / Other</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Tags (comma separated)</div>
              <input value={tags} onChange={e => setTags(e.target.value)}
                placeholder="whatsapp_confirmed, repeat_customer..." style={inpStyle} />
              <div style={{ fontSize: 10, color: '#555', marginTop: 5 }}>
                Note: <code>walk-in</code> tag instant delivered+paid kar deta hai.
              </div>
            </div>
          </div>

          {/* Submit */}
          <button onClick={handleSubmit} disabled={creating || items.length === 0 || !customer}
            style={{
              background: creating || items.length === 0 || !customer
                ? '#1a1a1a'
                : 'linear-gradient(135deg, #c9a96e 0%, #b8975d 100%)',
              border: `1px solid ${gold}`,
              color: creating || items.length === 0 || !customer ? '#444' : '#000',
              borderRadius: 8, padding: '12px', fontSize: 14, fontWeight: 700,
              cursor: creating || items.length === 0 || !customer ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}>
            {creating ? '⟳ Creating order in Shopify...' : '✓ Create order'}
          </button>
          <div style={{ fontSize: 10, color: '#555', textAlign: 'center', marginTop: -8 }}>
            Order Shopify mein bhi ban jayega aur ERP mein appear hoga.
          </div>
        </div>
      </div>

      {/* Modals */}
      {showProductPicker && <ProductPicker onClose={() => setShowProductPicker(false)} onAdd={handleAddProducts} />}
      {lineDiscountIdx !== null && (
        <DiscountModal initial={items[lineDiscountIdx]?.discount}
          label="Line item discount"
          onClose={() => setLineDiscountIdx(null)}
          onSave={(d) => setItems(a => a.map((it, i) => i === lineDiscountIdx ? { ...it, discount: d } : it))} />
      )}
      {showOrderDiscount && (
        <DiscountModal initial={orderDiscount}
          label="Order-level discount"
          onClose={() => setShowOrderDiscount(false)}
          onSave={setOrderDiscount} />
      )}
      {showCustomerForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: 24, width: 500, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{customer ? 'Edit customer' : 'New customer'}</div>
              <button onClick={() => setShowCustomerForm(false)} style={{ background: 'none', border: 'none', color: '#666', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <div style={labelStyle}>First name *</div>
                <input value={customerForm.first_name} onChange={e => setCustomerForm(f => ({...f, first_name: e.target.value}))} style={inpStyle} />
              </div>
              <div>
                <div style={labelStyle}>Last name</div>
                <input value={customerForm.last_name} onChange={e => setCustomerForm(f => ({...f, last_name: e.target.value}))} style={inpStyle} />
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={labelStyle}>Phone *</div>
              <input value={customerForm.phone} onChange={e => setCustomerForm(f => ({...f, phone: e.target.value}))} placeholder="03001234567" style={inpStyle} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={labelStyle}>Email (optional)</div>
              <input value={customerForm.email} onChange={e => setCustomerForm(f => ({...f, email: e.target.value}))} style={inpStyle} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={labelStyle}>Address</div>
              <input value={customerForm.address1} onChange={e => setCustomerForm(f => ({...f, address1: e.target.value}))} style={inpStyle} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={labelStyle}>City</div>
              <input value={customerForm.city} onChange={e => setCustomerForm(f => ({...f, city: e.target.value}))} style={inpStyle} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCustomerForm(false)} style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCustomerFormSave} style={{ background: gold, border: `1px solid ${gold}`, color: '#000', borderRadius: 7, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
