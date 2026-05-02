'use client';

// ============================================================================
// RS ZEVAR ERP — Edit Shipping Address Modal (May 2026)
// File: app/orders/_components/EditShippingModal.js
//
// Shopify-style centered modal popup for editing shipping address on an order
// (address line + city). Mirrors Shopify admin's "Edit shipping address" flow
// — validates non-empty city + address before save.
//
// Props:
//   order      — { id, customer_address, customer_city, customer_phone, ... }
//   performer  — string
//   userEmail  — string
//   onClose    — () => void
//   onSaved    — (patch) => void
// ============================================================================

import { useState, useEffect } from 'react';

const gold   = '#c9a96e';
const card   = '#141414';
const border = '#222';
const bg     = '#0a0a0a';

// Major Pakistani cities for quick-select. Customer can still type any city.
const COMMON_CITIES = [
  'Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad',
  'Multan', 'Peshawar', 'Quetta', 'Hyderabad', 'Sialkot',
  'Gujranwala', 'Bahawalpur', 'Sargodha', 'Sukkur', 'Larkana',
];

export default function EditShippingModal({ order, performer, userEmail, onClose, onSaved }) {
  const [address, setAddress] = useState(order?.customer_address || '');
  const [city, setCity]       = useState(order?.customer_city || '');
  const [reason, setReason]   = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    setAddress(order?.customer_address || '');
    setCity(order?.customer_city || '');
  }, [order?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ESC key closes
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, saving]);

  const dirty =
    (address.trim() !== (order?.customer_address || '').trim()) ||
    (city.trim()    !== (order?.customer_city    || '').trim());

  const handleSave = async () => {
    if (!dirty) { onClose(); return; }
    if (!address.trim()) { setError('Address khali nahi ho sakta'); return; }
    if (!city.trim())    { setError('City khali nahi ho sakti'); return; }

    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/orders/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          customer_address: address.trim(),
          customer_city: city.trim(),
          notes: reason.trim() || undefined,
          performed_by: performer || 'Staff',
          performed_by_email: userEmail || null,
        }),
      });

      let d;
      const text = await r.text();
      try { d = JSON.parse(text); }
      catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 120)}`); }

      if (!d.success) {
        throw new Error(d.error || 'Save failed');
      }

      if (d.warning) {
        // eslint-disable-next-line no-alert
        alert(`Saved — but: ${d.warning}`);
      }

      onSaved && onSaved(d.patch || {});
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={() => { if (!saving) onClose(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 3000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0f0f0f',
          border: `1px solid ${border}`,
          borderRadius: 12,
          width: '100%', maxWidth: 540,
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}>
        {/* Header */}
        <div style={{
          padding: '16px 22px', borderBottom: `1px solid ${border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
            📍 Edit shipping address
          </div>
          <button onClick={onClose} disabled={saving}
            style={{
              background: 'transparent', border: 'none',
              color: '#888', fontSize: 22, cursor: saving ? 'not-allowed' : 'pointer',
              lineHeight: 1, padding: '0 4px',
            }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 22 }}>
          {/* Country (read-only — always Pakistan for RS ZEVAR) */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 500 }}>
              Country / region
            </label>
            <div style={{
              padding: '10px 12px', background: '#0a0a0a',
              border: `1px solid ${border}`, borderRadius: 7,
              color: '#888', fontSize: 13,
            }}>🇵🇰 Pakistan</div>
          </div>

          {/* Address */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 500 }}>
              Address <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <textarea
              value={address}
              onChange={e => setAddress(e.target.value)}
              disabled={saving}
              autoFocus
              rows={3}
              placeholder="Street + house/apartment + landmark"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: bg, border: `1px solid ${border}`,
                borderRadius: 7, padding: '10px 12px',
                color: '#fff', fontSize: 14, fontFamily: 'inherit',
                outline: 'none', resize: 'vertical',
              }}
              onFocus={e => e.target.style.borderColor = gold}
              onBlur={e => e.target.style.borderColor = border}
            />
          </div>

          {/* City */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 500 }}>
              City <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={city}
              onChange={e => setCity(e.target.value)}
              disabled={saving}
              list="cities-list"
              placeholder="Karachi"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: bg, border: `1px solid ${border}`,
                borderRadius: 7, padding: '10px 12px',
                color: '#fff', fontSize: 14, fontFamily: 'inherit',
                outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = gold}
              onBlur={e => e.target.style.borderColor = border}
            />
            <datalist id="cities-list">
              {COMMON_CITIES.map(c => <option key={c} value={c} />)}
            </datalist>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
              {COMMON_CITIES.slice(0, 6).map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCity(c)}
                  disabled={saving}
                  style={{
                    background: city === c ? gold + '22' : '#1a1a1a',
                    border: `1px solid ${city === c ? gold : border}`,
                    color: city === c ? gold : '#888',
                    borderRadius: 5, padding: '4px 10px', fontSize: 11,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>{c}</button>
              ))}
            </div>
          </div>

          {/* Phone (read-only — pull from order, edit via Edit Contact modal) */}
          {order?.customer_phone && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 500 }}>
                Phone <span style={{ color: '#555', fontWeight: 400 }}>(edit via "Edit contact" option)</span>
              </label>
              <div style={{
                padding: '10px 12px', background: '#0a0a0a',
                border: `1px solid ${border}`, borderRadius: 7,
                color: '#888', fontSize: 13,
              }}>{order.customer_phone}</div>
            </div>
          )}

          {/* Reason */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 500 }}>
              Reason for change <span style={{ color: '#555', fontWeight: 400 }}>(audit log)</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={saving}
              placeholder="e.g. Customer ne address change kaha"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: bg, border: `1px solid ${border}`,
                borderRadius: 7, padding: '10px 12px',
                color: '#fff', fontSize: 13, fontFamily: 'inherit',
                outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = gold}
              onBlur={e => e.target.style.borderColor = border}
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 12px', marginBottom: 14,
              background: '#1a0000', border: '1px solid #330000',
              borderRadius: 7, color: '#ef4444', fontSize: 12,
            }}>
              ❌ {error}
            </div>
          )}

          <div style={{
            fontSize: 11, color: '#555', marginBottom: 4,
            padding: '8px 10px', background: 'rgba(201,169,110,0.05)',
            border: '1px solid rgba(201,169,110,0.15)', borderRadius: 6,
          }}>
            💡 Save karne pe Shopify ka shipping address bhi auto-update hoga.
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px', borderTop: `1px solid ${border}`,
          display: 'flex', gap: 10, justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              background: 'transparent', border: `1px solid ${border}`,
              color: '#888', borderRadius: 7,
              padding: '9px 18px', fontSize: 13,
              cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{
              background: (saving || !dirty) ? '#1a1a1a' : gold,
              border: `1px solid ${(saving || !dirty) ? border : gold}`,
              color: (saving || !dirty) ? '#555' : '#000',
              borderRadius: 7,
              padding: '9px 22px', fontSize: 13, fontWeight: 700,
              cursor: (saving || !dirty) ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}>
            {saving ? '⟳ Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
