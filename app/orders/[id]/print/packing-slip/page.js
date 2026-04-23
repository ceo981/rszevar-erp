'use client';

// ============================================================================
// RS ZEVAR ERP — Packing Slip Print Page
// Route: /orders/[id]/print/packing-slip
// ----------------------------------------------------------------------------
// For packing staff. Designed to ALWAYS fit on a single A4 page regardless of
// item count. Uses dynamic density mode:
//   ≤5 items   → 'comfortable' — images, spacious
//   6-10 items → 'compact'     — smaller images, tight spacing
//   ≥11 items  → 'dense'       — no images, minimal spacing, smaller fonts
//
// Note: AppShell (sidebar/nav) is automatically skipped for all `/print/*`
// routes via AppShell's isShellSkippedRoute() check — so this page renders
// standalone with zero chrome, perfect for Ctrl+P or Save-as-PDF.
// ============================================================================

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatShortDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export default function PackingSlipPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const r = await fetch(`/api/orders/${id}`);
        const d = await r.json();
        if (d.success) setOrder(d.order);
        else setError(d.error || 'Failed to load');
      } catch (e) {
        setError(e.message);
      }
      setLoading(false);
    })();
  }, [id]);

  // Set document title for print (shows as PDF filename)
  useEffect(() => {
    if (order?.order_number) {
      document.title = `Packing Slip — ${order.order_number}`;
    }
  }, [order]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#666', fontFamily: 'sans-serif' }}>Loading…</div>;
  }

  if (error || !order) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#c00', fontFamily: 'sans-serif' }}>
        {error || 'Order not found'}
      </div>
    );
  }

  const items = order.order_items || [];
  const totalQty = items.reduce((s, i) => s + (i.quantity || 0), 0);
  const total = parseFloat(order.total_amount || 0);
  const isPaid = order.payment_status === 'paid';
  const isCOD = order.payment_method === 'COD' || !order.payment_method;
  const codAmount = isPaid ? 0 : total;

  // ── Dynamic density — ensures A4 fit regardless of item count ──────────
  // 1-5 items: comfortable (40px images, 8pt padding)
  // 6-10 items: compact (28px images, 4pt padding)
  // 11+ items: dense (no images, minimal padding, smaller font)
  let density = 'comfortable';
  if (items.length >= 11) density = 'dense';
  else if (items.length >= 6) density = 'compact';

  return (
    <>
      {/* Print CSS */}
      <style>{`
        /* ── A4 page setup — 10mm margin for max content area ──────────── */
        @page {
          size: A4;
          margin: 10mm;
        }

        html, body {
          margin: 0;
          padding: 0;
          background: #eee;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #111;
        }

        /* ── Screen-only top controls (Print / Back buttons) ──────────── */
        .controls {
          position: sticky;
          top: 0;
          background: #111;
          color: #fff;
          padding: 12px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          z-index: 100;
        }
        .controls button, .controls a {
          background: #c9a96e;
          color: #000;
          border: none;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 600;
          border-radius: 6px;
          cursor: pointer;
          font-family: inherit;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .controls a.back {
          background: transparent;
          color: #c9a96e;
          border: 1px solid #c9a96e;
        }

        /* ── THE SLIP — fits A4 exactly (190mm × 277mm content area) ──── */
        .slip {
          width: 190mm;
          min-height: 277mm;
          margin: 20px auto;
          background: #fff;
          padding: 8mm 10mm;
          box-shadow: 0 2px 12px rgba(0,0,0,0.1);
          font-size: 10.5pt;
          line-height: 1.4;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
        }

        /* ── Header ──────────────────────────────────────────────────── */
        .slip h1 {
          margin: 0;
          font-size: 20pt;
          font-weight: 800;
          letter-spacing: 1.5px;
          color: #000;
          line-height: 1;
        }
        .slip h2 {
          font-size: 12pt;
          margin: 0 0 3px;
          font-weight: 600;
        }
        .slip .muted {
          color: #666;
          font-size: 9pt;
        }

        .hr {
          border: none;
          border-top: 1.5px dashed #999;
          margin: 8px 0;
        }

        /* ── Info boxes (compact grid) ───────────────────────────────── */
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 6px;
        }
        .info-box {
          background: #f6f6f6;
          border-left: 3px solid #c9a96e;
          padding: 5px 10px;
          border-radius: 3px;
        }
        .info-box .label {
          font-size: 8pt;
          text-transform: uppercase;
          color: #888;
          letter-spacing: 0.8px;
          margin-bottom: 1px;
        }
        .info-box .value {
          font-size: 10pt;
          font-weight: 600;
          color: #111;
        }
        .info-box .value-lg {
          font-size: 13pt;
          font-weight: 800;
        }

        /* ── Ship To section ─────────────────────────────────────────── */
        .ship-to {
          margin-bottom: 6px;
        }
        .ship-to .ship-label {
          font-size: 8pt;
          text-transform: uppercase;
          color: #888;
          letter-spacing: 0.8px;
          margin-bottom: 2px;
        }
        .ship-to .ship-name {
          font-size: 11pt;
          font-weight: 700;
          margin-bottom: 2px;
        }
        .ship-to .ship-addr {
          font-size: 10pt;
          color: #333;
          line-height: 1.35;
        }

        /* ── COD / Paid alerts ───────────────────────────────────────── */
        .cod-alert {
          background: #fef3c7;
          border: 1.5px solid #f59e0b;
          border-radius: 4px;
          padding: 6px 12px;
          margin: 6px 0;
          text-align: center;
        }
        .cod-alert .label {
          font-size: 9pt;
          color: #92400e;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          font-weight: 700;
        }
        .cod-alert .amount {
          font-size: 16pt;
          font-weight: 900;
          color: #78350f;
          margin-top: 1px;
          line-height: 1.1;
        }

        .paid-note {
          background: #d1fae5;
          border: 1.5px solid #10b981;
          border-radius: 4px;
          padding: 6px 12px;
          margin: 6px 0;
          text-align: center;
          color: #065f46;
          font-weight: 700;
          font-size: 10pt;
        }

        /* ── Items section — GROWS to fill available space ───────────── */
        .items-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          margin-top: 6px;
        }
        .items-heading {
          font-size: 11pt;
          font-weight: 700;
          margin-bottom: 3px;
        }

        .items-table {
          width: 100%;
          border-collapse: collapse;
        }
        .items-table th {
          text-align: left;
          font-size: 8.5pt;
          text-transform: uppercase;
          color: #555;
          letter-spacing: 0.8px;
          padding: 4px 6px;
          border-bottom: 1.5px solid #333;
        }
        .items-table td {
          padding: 5px 6px;
          border-bottom: 1px dashed #ddd;
          vertical-align: middle;
          font-size: 10pt;
        }
        .items-table .check-box {
          width: 14px;
          height: 14px;
          border: 1.5px solid #333;
          border-radius: 2px;
          display: inline-block;
        }
        .items-table .qty {
          font-size: 13pt;
          font-weight: 800;
          color: #c9a96e;
          text-align: center;
          min-width: 40px;
        }
        .items-table img {
          width: 36px;
          height: 36px;
          object-fit: cover;
          border-radius: 3px;
          border: 1px solid #ddd;
          display: block;
        }
        .items-table .img-placeholder {
          width: 36px;
          height: 36px;
          background: #f0f0f0;
          border-radius: 3px;
          text-align: center;
          line-height: 36px;
          font-size: 14px;
        }

        /* ── COMPACT density (6-10 items) ─────────────────────────── */
        .slip.compact {
          font-size: 9.5pt;
        }
        .slip.compact .items-table td {
          padding: 3px 6px;
          font-size: 9pt;
        }
        .slip.compact .items-table img,
        .slip.compact .items-table .img-placeholder {
          width: 24px;
          height: 24px;
          line-height: 24px;
          font-size: 11px;
        }
        .slip.compact .items-table .qty {
          font-size: 11pt;
        }
        .slip.compact .items-table .check-box {
          width: 12px;
          height: 12px;
        }

        /* ── DENSE density (11+ items) — no images, tight ──────────── */
        .slip.dense {
          font-size: 9pt;
        }
        .slip.dense .items-table th {
          font-size: 7.5pt;
          padding: 3px 5px;
        }
        .slip.dense .items-table td {
          padding: 2.5px 5px;
          font-size: 8.5pt;
        }
        .slip.dense .items-table .img-col,
        .slip.dense .items-table .img-cell {
          display: none;
        }
        .slip.dense .items-table .qty {
          font-size: 10pt;
        }
        .slip.dense .items-table .check-box {
          width: 10px;
          height: 10px;
          border-width: 1px;
        }
        /* Dense: also compact everything above items */
        .slip.dense h1 { font-size: 17pt; }
        .slip.dense h2 { font-size: 10pt; }
        .slip.dense .info-box { padding: 4px 8px; }
        .slip.dense .info-box .value-lg { font-size: 11pt; }
        .slip.dense .cod-alert { padding: 5px 10px; margin: 4px 0; }
        .slip.dense .cod-alert .amount { font-size: 13pt; }
        .slip.dense .ship-to .ship-name { font-size: 10pt; }
        .slip.dense .ship-to .ship-addr { font-size: 9pt; }
        .slip.dense .sign-grid { margin-top: 10px; padding-top: 8px; }
        .slip.dense .sign-line { height: 18px; }
        .slip.dense .order-number-footer { padding: 10px; margin-top: 10px; }
        .slip.dense .order-number-footer .number { font-size: 20pt; }

        /* ── Signature grid — compact ────────────────────────────────── */
        .sign-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-top: 14px;
          padding-top: 10px;
          border-top: 1px solid #ccc;
        }
        .sign-box {
          font-size: 9pt;
        }
        .sign-line {
          border-bottom: 1px solid #000;
          height: 22px;
          margin-bottom: 3px;
        }

        /* ── Big order number footer — essential for scan ───────────── */
        .order-number-footer {
          text-align: center;
          margin-top: 14px;
          padding: 12px;
          border: 2.5px dashed #c9a96e;
          border-radius: 6px;
        }
        .order-number-footer .label {
          font-size: 8pt;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 1.5px;
        }
        .order-number-footer .number {
          font-size: 22pt;
          font-weight: 900;
          color: #111;
          letter-spacing: 2px;
          font-family: 'Courier New', monospace;
          margin-top: 3px;
          line-height: 1;
        }

        /* ── Customer note — inline if present ──────────────────────── */
        .customer-note {
          margin-top: 8px;
          padding: 6px 10px;
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 3px;
          font-size: 9pt;
        }
        .customer-note .label {
          font-size: 8pt;
          text-transform: uppercase;
          color: #92400e;
          letter-spacing: 1px;
          margin-bottom: 1px;
          font-weight: 600;
        }
        .customer-note .text {
          color: #78350f;
        }

        /* ═══════════════════════════════════════════════════════════
           PRINT — make it fit A4 exactly, no extras
        ═══════════════════════════════════════════════════════════ */
        @media print {
          html, body {
            background: #fff !important;
            margin: 0;
            padding: 0;
          }
          .controls { display: none !important; }
          .slip {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            min-height: auto !important;
            box-shadow: none !important;
            page-break-inside: avoid;
          }
          /* Make sure NOTHING overflows to page 2 — if it does, scale down */
          .slip * {
            page-break-inside: avoid;
          }
          /* Keep item rows intact */
          .items-table tr {
            page-break-inside: avoid;
          }
        }
      `}</style>

      <div className="controls">
        <a className="back" href={`/orders/${id}`}>← Back to order</a>
        <button onClick={() => window.print()}>🖨 Print / Save as PDF</button>
      </div>

      {/* Density class applied dynamically based on item count */}
      <div className={`slip ${density}`}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <h1>RS ZEVAR</h1>
            <div className="muted">Luxury Jewelry · Karachi</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ color: '#c9a96e', textTransform: 'uppercase', letterSpacing: 1.5 }}>Packing Slip</h2>
            <div className="muted">{formatShortDate(order.created_at)}</div>
          </div>
        </div>

        <hr className="hr" />

        {/* Info grid — Order Number + Date */}
        <div className="info-grid">
          <div className="info-box">
            <div className="label">Order Number</div>
            <div className="value value-lg">{order.order_number}</div>
          </div>
          <div className="info-box">
            <div className="label">Order Date</div>
            <div className="value">{formatDate(order.created_at)}</div>
          </div>
        </div>

        {/* Ship To */}
        <div className="ship-to">
          <div className="ship-label">Ship To</div>
          <div className="ship-name">{order.customer_name || '—'}</div>
          <div className="ship-addr">
            {order.customer_address && <div>{order.customer_address}</div>}
            {order.customer_city && <div>{order.customer_city}</div>}
            {order.customer_phone && (
              <div style={{ marginTop: 2, fontWeight: 600 }}>
                📞 {order.customer_phone}
              </div>
            )}
          </div>
        </div>

        {/* COD alert or Paid indicator */}
        {isCOD && !isPaid && codAmount > 0 && (
          <div className="cod-alert">
            <div className="label">Cash on Delivery — Collect Amount</div>
            <div className="amount">Rs {codAmount.toLocaleString('en-PK')}</div>
          </div>
        )}
        {isPaid && (
          <div className="paid-note">
            ✓ PAYMENT RECEIVED — No cash to collect
          </div>
        )}

        {/* Courier info (if dispatched already) */}
        {order.dispatched_courier && (
          <div className="info-grid">
            <div className="info-box">
              <div className="label">Courier</div>
              <div className="value">{order.dispatched_courier}</div>
            </div>
            {order.tracking_number && (
              <div className="info-box">
                <div className="label">Tracking #</div>
                <div className="value" style={{ fontFamily: 'Courier New, monospace' }}>{order.tracking_number}</div>
              </div>
            )}
          </div>
        )}

        <hr className="hr" />

        {/* ═══════════ Items Section — grows to fill page ═══════════ */}
        <div className="items-section">
          <div className="items-heading">
            Items to Pack ({items.length} {items.length === 1 ? 'item' : 'items'}, {totalQty} units)
            {density !== 'comfortable' && (
              <span style={{ marginLeft: 8, fontSize: '8pt', color: '#888', fontWeight: 'normal' }}>
                {density === 'compact' ? '(compact view)' : '(dense view — no images)'}
              </span>
            )}
          </div>

          <table className="items-table">
            <thead>
              <tr>
                <th style={{ width: 22 }}>✓</th>
                {density !== 'dense' && <th className="img-col" style={{ width: density === 'compact' ? 32 : 44 }}></th>}
                <th>Product</th>
                <th style={{ width: 90 }}>SKU</th>
                <th style={{ width: 50 }}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id || idx}>
                  <td><span className="check-box"></span></td>
                  {density !== 'dense' && (
                    <td className="img-cell">
                      {item.image_url
                        ? <img src={item.image_url} alt="" />
                        : <div className="img-placeholder">📦</div>
                      }
                    </td>
                  )}
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.title}</div>
                  </td>
                  <td style={{ fontFamily: 'Courier New, monospace', fontSize: density === 'dense' ? '8pt' : '9pt' }}>
                    {item.sku || '—'}
                  </td>
                  <td className="qty">× {item.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Customer note — only if present and comfortable density */}
        {order.confirmation_notes && density !== 'dense' && (
          <div className="customer-note">
            <div className="label">Customer Note</div>
            <div className="text">{order.confirmation_notes}</div>
          </div>
        )}

        {/* Signature grid — always present but compact */}
        <div className="sign-grid">
          <div className="sign-box">
            <div className="sign-line"></div>
            <div style={{ color: '#666' }}>Packed by (Name + Time)</div>
          </div>
          <div className="sign-box">
            <div className="sign-line"></div>
            <div style={{ color: '#666' }}>Checked by (Name + Time)</div>
          </div>
        </div>

        {/* Big order number at bottom for easy scanning */}
        <div className="order-number-footer">
          <div className="label">Order Number</div>
          <div className="number">{order.order_number}</div>
        </div>
      </div>
    </>
  );
}
