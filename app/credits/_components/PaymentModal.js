'use client';

// ============================================================================
// RS ZEVAR ERP — Customer Credits — Record Payment Modal
// File: app/credits/_components/PaymentModal.js
// May 2 2026 · Step 5 of 6
// ----------------------------------------------------------------------------
// PURPOSE:
//   Modal for recording a payment from a credit customer.
//   - Live FIFO allocation preview (recomputes as user types amount)
//   - Manual override option (checkbox per order with custom amount)
//   - Screenshot upload (compressed client-side, posted to /api/credits/upload-receipt)
//   - Method dropdown, paid date, optional note
//
// PROPS:
//   customer       — { phone, name, outstanding }
//   openOrders     — [{ id, order_number, total_amount, paid_amount, balance, created_at }]
//                    (only unpaid + partial CREDIT orders, oldest first)
//   onClose        — () => void
//   onSuccess      — (result) => void  // result = response from POST /api/credits/payment
//   performer      — string  // for created_by_name snapshot
// ============================================================================

import { useState, useEffect, useMemo } from 'react';

const gold    = '#c9a96e';
const danger  = '#ef4444';
const success = '#22c55e';
const warning = '#f59e0b';

const fmtMoney = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;

// Client-side image compression (reuses inventory editor pattern)
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round(height * (MAX_DIMENSION / width));
            width = MAX_DIMENSION;
          } else {
            width = Math.round(width * (MAX_DIMENSION / height));
            height = MAX_DIMENSION;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        resolve({ dataUrl, width, height, sizeKb: Math.round(dataUrl.length * 3 / 4 / 1024) });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

const PAYMENT_METHODS = [
  'JazzCash',
  'EasyPaisa',
  'Bank Transfer',
  'Cash',
  'Cheque',
  'Other',
];

export default function PaymentModal({ customer, openOrders, onClose, onSuccess, performer }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('JazzCash');
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [mode, setMode] = useState('fifo');  // 'fifo' | 'manual'
  const [manualAlloc, setManualAlloc] = useState({});  // {order_id: amount_string}

  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [receiptCompressed, setReceiptCompressed] = useState(null);  // {dataUrl, sizeKb}

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [progressMsg, setProgressMsg] = useState('');

  const numAmount = parseFloat(amount) || 0;
  const totalOutstanding = openOrders.reduce((s, o) => s + (o.balance || 0), 0);

  // ── Live FIFO preview ──
  const fifoPreview = useMemo(() => {
    if (mode !== 'fifo' || numAmount <= 0) return [];
    let remaining = numAmount;
    const allocs = [];
    for (const o of openOrders) {
      if (remaining <= 0.01) break;
      const allocAmount = Math.min(remaining, o.balance);
      allocs.push({
        order_id: o.id,
        order_number: o.order_number,
        amount: allocAmount,
        is_full: allocAmount >= o.balance - 0.01,
        balance_before: o.balance,
      });
      remaining -= allocAmount;
    }
    return { allocs, unallocated: Math.max(0, remaining) };
  }, [mode, numAmount, openOrders]);

  // ── Manual allocation totals ──
  const manualTotal = useMemo(() => {
    return Object.values(manualAlloc).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }, [manualAlloc]);

  // ── Image compression ──
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Sirf image files allowed (JPG/PNG/WebP)');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File too large. Max 10MB.');
      return;
    }
    try {
      setError(null);
      const compressed = await compressImage(file);
      setReceiptFile(file);
      setReceiptPreview(compressed.dataUrl);
      setReceiptCompressed(compressed);
    } catch (err) {
      setError(`Image processing failed: ${err.message}`);
    }
  };

  const removeReceipt = () => {
    setReceiptFile(null);
    setReceiptPreview(null);
    setReceiptCompressed(null);
  };

  // ── Submit ──
  const handleSubmit = async () => {
    setError(null);

    if (!numAmount || numAmount <= 0) {
      setError('Amount zaroori hai aur 0 se zyada honi chahiye');
      return;
    }

    if (mode === 'manual') {
      const sum = manualTotal;
      if (Math.abs(sum - numAmount) > 0.01) {
        setError(`Manual allocations ka sum (${fmtMoney(sum)}) payment amount (${fmtMoney(numAmount)}) ke equal hona chahiye`);
        return;
      }
      // Check no order over-allocated
      for (const [orderId, val] of Object.entries(manualAlloc)) {
        const v = parseFloat(val) || 0;
        if (v <= 0) continue;
        const ord = openOrders.find(o => o.id === orderId);
        if (!ord) continue;
        if (v > ord.balance + 0.01) {
          setError(`Order ${ord.order_number} ki balance ${fmtMoney(ord.balance)} hai, lekin ${fmtMoney(v)} allocate kar rahe ho`);
          return;
        }
      }
    }

    try {
      setSubmitting(true);

      // ── Step 1: Upload receipt if provided ──
      let receipt_url = null;
      if (receiptCompressed) {
        setProgressMsg('Receipt upload kar rahe hain...');
        const upRes = await fetch('/api/credits/upload-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: receiptFile?.name || 'receipt.jpg',
            attachment: receiptCompressed.dataUrl,
            customer_phone: customer.phone,
          }),
        });
        const upText = await upRes.text();
        let upJson;
        try { upJson = JSON.parse(upText); }
        catch { throw new Error(`Upload failed (non-JSON response): ${upText.slice(0, 100)}`); }
        if (!upJson.success) throw new Error(upJson.error || 'Receipt upload failed');
        receipt_url = upJson.signed_url;
      }

      // ── Step 2: Record payment ──
      setProgressMsg('Payment record + allocate ho raha hai...');

      const body = {
        customer_phone: customer.phone,
        customer_name: customer.name,
        amount: numAmount,
        paid_at: new Date(paidAt).toISOString(),
        method,
        receipt_url,
        note: note.trim() || null,
        allocation_mode: mode,
        created_by_name: performer || 'Staff',
      };
      if (mode === 'manual') {
        body.manual_allocations = Object.entries(manualAlloc)
          .map(([order_id, val]) => ({ order_id, amount: parseFloat(val) || 0 }))
          .filter(a => a.amount > 0);
      }

      const payRes = await fetch('/api/credits/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payText = await payRes.text();
      let payJson;
      try { payJson = JSON.parse(payText); }
      catch { throw new Error(`Payment failed (non-JSON response): ${payText.slice(0, 100)}`); }
      if (!payJson.success) throw new Error(payJson.error || 'Payment record failed');

      setProgressMsg('');
      onSuccess(payJson);
    } catch (e) {
      setError(e.message);
      setProgressMsg('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div onClick={submitting ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, overflowY: 'auto',
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 12, width: 540, maxWidth: '100%', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>

        {/* Header */}
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>+ Record payment</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {customer.name} · Outstanding {fmtMoney(totalOutstanding)}
            </div>
          </div>
          <button onClick={onClose} disabled={submitting}
            style={{ background: 'transparent', border: 'none', color: 'var(--text3)', fontSize: 22, cursor: submitting ? 'not-allowed' : 'pointer', lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1 }}>

          {/* Amount + Method + Date */}
          <div style={{ marginBottom: 14 }}>
            <Label>Amount received (Rs)</Label>
            <input type="number" min="0" step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)}
              autoFocus
              placeholder="13700"
              style={{ ...inputStyle, fontSize: 18, fontWeight: 600 }} />
            {numAmount > totalOutstanding && (
              <div style={{ fontSize: 11, color: warning, marginTop: 4 }}>
                ℹ Amount outstanding ({fmtMoney(totalOutstanding)}) se zyada hai. Excess Rs {(numAmount - totalOutstanding).toLocaleString()} unallocated rahega.
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <Label>Date</Label>
              <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)}
                style={inputStyle} />
            </div>
            <div>
              <Label>Method</Label>
              <select value={method} onChange={e => setMethod(e.target.value)}
                style={inputStyle}>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Allocation mode toggle */}
          {openOrders.length > 0 && numAmount > 0 && (
            <div style={{ marginBottom: 14 }}>
              <Label>Allocation</Label>
              <div style={{
                display: 'flex', gap: 4, padding: 4,
                background: 'var(--bg-section)', border: '1px solid var(--border)',
                borderRadius: 7,
              }}>
                {[
                  { v: 'fifo', l: '⚡ Auto (FIFO)' },
                  { v: 'manual', l: '✏️ Manual' },
                ].map(opt => (
                  <button key={opt.v} onClick={() => setMode(opt.v)}
                    style={{
                      flex: 1,
                      background: mode === opt.v ? gold : 'transparent',
                      color: mode === opt.v ? '#000' : 'var(--text2)',
                      border: 'none', borderRadius: 4,
                      padding: '7px 12px', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>{opt.l}</button>
                ))}
              </div>

              {/* FIFO preview */}
              {mode === 'fifo' && (
                <div style={{
                  marginTop: 10, padding: '10px 12px',
                  background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)',
                  borderRadius: 7,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, fontWeight: 600 }}>
                    PREVIEW — yeh allocate hoga oldest orders pe pehle:
                  </div>
                  {fifoPreview.allocs?.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>
                      Koi unpaid order nahi — full Rs {numAmount.toLocaleString()} unallocated rahega.
                    </div>
                  )}
                  {fifoPreview.allocs?.map(a => (
                    <div key={a.order_id} style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '4px 0', fontSize: 12, color: 'var(--text2)',
                    }}>
                      <span>{a.order_number}</span>
                      <span style={{ color: a.is_full ? success : warning, fontWeight: 600 }}>
                        → {fmtMoney(a.amount)} {a.is_full ? '(full)' : '(partial)'}
                      </span>
                    </div>
                  ))}
                  {fifoPreview.unallocated > 0 && (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '6px 0 0', borderTop: '1px dashed var(--border)',
                      marginTop: 4, fontSize: 11, color: 'var(--text3)',
                    }}>
                      <span>Unallocated</span>
                      <span>{fmtMoney(fifoPreview.unallocated)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Manual allocation rows */}
              {mode === 'manual' && (
                <div style={{
                  marginTop: 10, padding: '10px 12px',
                  background: 'var(--bg-section)', border: '1px solid var(--border)',
                  borderRadius: 7,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, fontWeight: 600 }}>
                    Har order pe amount specify karo:
                  </div>
                  {openOrders.map(o => (
                    <div key={o.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 110px',
                      gap: 8, padding: '6px 0', alignItems: 'center',
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--text1)' }}>{o.order_number}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>Balance: {fmtMoney(o.balance)}</div>
                      </div>
                      <input type="number" min="0" step="0.01" max={o.balance}
                        value={manualAlloc[o.id] || ''}
                        onChange={e => setManualAlloc(prev => ({ ...prev, [o.id]: e.target.value }))}
                        placeholder="0"
                        style={{
                          ...inputStyle, padding: '6px 10px', fontSize: 12, textAlign: 'right',
                        }} />
                    </div>
                  ))}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    padding: '8px 0 0', marginTop: 4,
                    borderTop: '1px solid var(--border)', fontSize: 12,
                  }}>
                    <span style={{ color: 'var(--text3)' }}>Total allocated</span>
                    <span style={{
                      color: Math.abs(manualTotal - numAmount) < 0.01 ? success : danger,
                      fontWeight: 600,
                    }}>
                      {fmtMoney(manualTotal)} / {fmtMoney(numAmount)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Receipt upload */}
          <div style={{ marginBottom: 14 }}>
            <Label>Receipt screenshot (optional)</Label>
            {!receiptPreview ? (
              <label style={{
                display: 'block', padding: '24px',
                background: 'var(--bg-section)', border: '1px dashed var(--border2)',
                borderRadius: 7, textAlign: 'center', cursor: 'pointer',
                fontSize: 12, color: 'var(--text3)',
              }}>
                📎 Click to upload · JPG/PNG up to 10MB
                <input type="file" accept="image/*" onChange={handleFileSelect}
                  style={{ display: 'none' }} />
              </label>
            ) : (
              <div style={{
                position: 'relative',
                background: 'var(--bg-section)', border: '1px solid var(--border)',
                borderRadius: 7, padding: 8,
              }}>
                <img src={receiptPreview} alt="Receipt"
                  style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 4 }} />
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginTop: 6, fontSize: 10, color: 'var(--text3)',
                }}>
                  <span>{receiptCompressed?.sizeKb}KB · compressed</span>
                  <button onClick={removeReceipt}
                    style={{ background: 'none', border: 'none', color: danger, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
                    ✕ Remove
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Note */}
          <div style={{ marginBottom: 6 }}>
            <Label>Note (optional)</Label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. JazzCash transfer ref 4567... ya kuch context"
              style={{ ...inputStyle, resize: 'vertical', minHeight: 56, fontFamily: 'inherit' }} />
          </div>

          {/* Error / progress */}
          {error && (
            <div style={{
              marginTop: 12, padding: '10px 12px',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 7, fontSize: 12, color: '#fca5a5',
            }}>⚠ {error}</div>
          )}
          {submitting && progressMsg && (
            <div style={{
              marginTop: 12, padding: '10px 12px',
              background: 'rgba(201,169,110,0.05)', border: '1px solid rgba(201,169,110,0.3)',
              borderRadius: 7, fontSize: 12, color: gold,
            }}>⏳ {progressMsg}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          flexShrink: 0,
        }}>
          <button onClick={onClose} disabled={submitting}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text2)', borderRadius: 7,
              padding: '9px 16px', fontSize: 12, fontWeight: 500,
              cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              opacity: submitting ? 0.5 : 1,
            }}>Cancel</button>
          <button onClick={handleSubmit}
            disabled={submitting || !numAmount || numAmount <= 0}
            style={{
              background: (!numAmount || numAmount <= 0) ? 'var(--border)' : gold,
              color: (!numAmount || numAmount <= 0) ? 'var(--text3)' : '#000',
              border: 'none', borderRadius: 7,
              padding: '9px 20px', fontSize: 12, fontWeight: 600,
              cursor: (submitting || !numAmount) ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}>
            {submitting ? '⏳ Recording...' : '💾 Record & allocate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%',
  background: 'var(--bg-section)',
  border: '1px solid var(--border)',
  color: '#fff',
  borderRadius: 7,
  padding: '9px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

function Label({ children }) {
  return (
    <div style={{
      fontSize: 11, color: 'var(--text3)', marginBottom: 5, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: 0.4,
    }}>{children}</div>
  );
}
