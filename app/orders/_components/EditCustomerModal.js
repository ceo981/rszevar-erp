'use client';

// ============================================================================
// RS ZEVAR ERP — Edit Customer Contact Modal (May 2026)
// File: app/orders/_components/EditCustomerModal.js
//
// Shopify-style centered modal popup for editing customer contact info on an
// order (name + phone). Used by /orders/[id] page kebab menu and OrderDrawer.
//
// Props:
//   order      — { id, customer_name, customer_phone, ... }
//   performer  — string (logged-in user name)
//   userEmail  — string
//   onClose    — () => void
//   onSaved    — (patch) => void   // called on successful save with the patched fields
//
// IMPORTS: Use relative paths (Next.js 16 Turbopack issue with @/ on new files)
// ============================================================================

import { useState, useEffect } from 'react';

const gold   = '#c9a96e';
const card   = '#141414';
const border = '#222';
const bg     = '#0a0a0a';

export default function EditCustomerModal({ order, performer, userEmail, onClose, onSaved }) {
  const [name, setName]   = useState(order?.customer_name || '');
  const [phone, setPhone] = useState(order?.customer_phone || '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Sync state if order prop changes
  useEffect(() => {
    setName(order?.customer_name || '');
    setPhone(order?.customer_phone || '');
  }, [order?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ESC key closes modal
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, saving]);

  const dirty =
    (name.trim()  !== (order?.customer_name  || '').trim()) ||
    (phone.trim() !== (order?.customer_phone || '').trim());

  const handleSave = async () => {
    if (!dirty) { onClose(); return; }
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/orders/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          // Address fields not sent — modal limited to contact only
          notes: reason.trim() || undefined,
          performed_by: performer || 'Staff',
          performed_by_email: userEmail || null,
        }),
      });

      // Defensive JSON parse — Vercel can return plain text on infra errors.
      let d;
      const text = await r.text();
      try { d = JSON.parse(text); }
      catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 120)}`); }

      if (!d.success) {
        throw new Error(d.error || 'Save failed');
      }

      // Optional warning surfaced as alert, not error
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
          width: '100%', maxWidth: 500,
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}>
        {/* Header */}
        <div style={{
          padding: '16px 22px', borderBottom: `1px solid ${border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
            ✏️ Edit contact information
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
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 500 }}>
              Customer name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={saving}
              autoFocus
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
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 500 }}>
              Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              disabled={saving}
              placeholder="03XX-XXXXXXX"
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
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 500 }}>
              Reason for change <span style={{ color: '#555', fontWeight: 400 }}>(audit log mein save hoga)</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={saving}
              placeholder="e.g. Customer ne phone update kaha"
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
            fontSize: 11, color: '#555', marginBottom: 14,
            padding: '8px 10px', background: 'rgba(201,169,110,0.05)',
            border: '1px solid rgba(201,169,110,0.15)', borderRadius: 6,
          }}>
            💡 Save Shopify pe bhi sync hoga. Address change karna ho to "Edit shipping address" use karein.
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
