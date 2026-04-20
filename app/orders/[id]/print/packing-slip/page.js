'use client';

// ============================================================================
// RS ZEVAR ERP — Packing Slip Print Page
// Route: /orders/[id]/print/packing-slip
// ----------------------------------------------------------------------------
// For packing staff. Minimal, functional, scannable.
// Opens in a new tab; user uses browser's Print dialog (Ctrl+P) to print
// or Save as PDF. Control bar (Print / Back buttons) is hidden in @media print.
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

  return (
    <>
      {/* Print CSS */}
      <style>{`
        @page {
          size: A4;
          margin: 15mm;
        }

        body {
          margin: 0;
          padding: 0;
          background: #eee;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #111;
        }

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

        .slip {
          max-width: 180mm;
          margin: 20px auto;
          background: #fff;
          padding: 18mm 14mm;
          box-shadow: 0 2px 12px rgba(0,0,0,0.1);
          font-size: 12pt;
          line-height: 1.5;
        }

        .slip h1 {
          margin: 0;
          font-size: 24pt;
          font-weight: 800;
          letter-spacing: 2px;
          color: #000;
        }
        .slip h2 {
          font-size: 14pt;
          margin: 0 0 4px;
          font-weight: 600;
        }
        .slip .muted {
          color: #666;
          font-size: 10pt;
        }

        .hr {
          border: none;
          border-top: 2px dashed #999;
          margin: 14px 0;
        }

        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 8px;
        }
        .items-table th {
          text-align: left;
          font-size: 10pt;
          text-transform: uppercase;
          color: #555;
          letter-spacing: 1px;
          padding: 6px 8px;
          border-bottom: 1.5px solid #333;
        }
        .items-table td {
          padding: 10px 8px;
          border-bottom: 1px dashed #ccc;
          vertical-align: top;
        }
        .items-table .check-box {
          width: 20px;
          height: 20px;
          border: 2px solid #333;
          border-radius: 3px;
          display: inline-block;
        }
        .items-table .qty {
          font-size: 16pt;
          font-weight: 800;
          color: #c9a96e;
          text-align: center;
          min-width: 60px;
        }
        .items-table img {
          width: 40px;
          height: 40px;
          object-fit: cover;
          border-radius: 4px;
          border: 1px solid #ddd;
        }

        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-bottom: 10px;
        }
        .info-box {
          background: #f6f6f6;
          border-left: 4px solid #c9a96e;
          padding: 10px 14px;
          border-radius: 4px;
        }
        .info-box .label {
          font-size: 9pt;
          text-transform: uppercase;
          color: #888;
          letter-spacing: 1px;
          margin-bottom: 2px;
        }
        .info-box .value {
          font-size: 12pt;
          font-weight: 600;
          color: #111;
        }
        .info-box .value-lg {
          font-size: 16pt;
          font-weight: 800;
        }

        .cod-alert {
          background: #fef3c7;
          border: 2px solid #f59e0b;
          border-radius: 6px;
          padding: 12px 16px;
          margin: 14px 0;
          text-align: center;
        }
        .cod-alert .label {
          font-size: 10pt;
          color: #92400e;
          text-transform: uppercase;
          letter-spacing: 2px;
          font-weight: 700;
        }
        .cod-alert .amount {
          font-size: 22pt;
          font-weight: 900;
          color: #78350f;
          margin-top: 4px;
        }

        .paid-note {
          background: #d1fae5;
          border: 2px solid #10b981;
          border-radius: 6px;
          padding: 10px 16px;
          margin: 14px 0;
          text-align: center;
          color: #065f46;
          font-weight: 700;
          font-size: 11pt;
        }

        .sign-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 30px;
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #ccc;
        }
        .sign-box {
          font-size: 10pt;
        }
        .sign-line {
          border-bottom: 1px solid #000;
          height: 30px;
          margin-bottom: 4px;
        }

        .order-number-footer {
          text-align: center;
          margin-top: 30px;
          padding: 20px;
          border: 3px dashed #c9a96e;
          border-radius: 8px;
        }
        .order-number-footer .label {
          font-size: 9pt;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 2px;
        }
        .order-number-footer .number {
          font-size: 28pt;
          font-weight: 900;
          color: #111;
          letter-spacing: 3px;
          font-family: 'Courier New', monospace;
          margin-top: 4px;
        }

        @media print {
          body { background: #fff; }
          .controls { display: none !important; }
          .slip {
            margin: 0;
            padding: 0;
            max-width: none;
            box-shadow: none;
          }
        }
      `}</style>

      <div className="controls">
        <a className="back" href={`/orders/${id}`}>← Back to order</a>
        <button onClick={() => window.print()}>🖨 Print / Save as PDF</button>
      </div>

      <div className="slip">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h1>RS ZEVAR</h1>
            <div className="muted">Luxury Jewelry · Karachi</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ color: '#c9a96e', textTransform: 'uppercase', letterSpacing: 2 }}>Packing Slip</h2>
            <div className="muted">{formatShortDate(order.created_at)}</div>
          </div>
        </div>

        <hr className="hr" />

        {/* Info grid */}
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

        {/* Ship to */}
        <div style={{ marginBottom: 10 }}>
          <div className="label" style={{ fontSize: '10pt', textTransform: 'uppercase', color: '#888', letterSpacing: 1, marginBottom: 4 }}>
            Ship To
          </div>
          <div style={{ fontSize: '13pt', fontWeight: 700, marginBottom: 2 }}>
            {order.customer_name || '—'}
          </div>
          <div style={{ fontSize: '11pt', color: '#333', lineHeight: 1.5 }}>
            {order.customer_address && <div>{order.customer_address}</div>}
            {order.customer_city && <div>{order.customer_city}</div>}
            {order.customer_phone && (
              <div style={{ marginTop: 4, fontWeight: 600 }}>
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

        {/* Courier */}
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

        {/* Items */}
        <h2 style={{ marginBottom: 6 }}>Items to Pack ({items.length} {items.length === 1 ? 'item' : 'items'}, {totalQty} units)</h2>

        <table className="items-table">
          <thead>
            <tr>
              <th style={{ width: 30 }}>✓</th>
              <th style={{ width: 50 }}></th>
              <th>Product</th>
              <th style={{ width: 100 }}>SKU</th>
              <th style={{ width: 70 }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id || idx}>
                <td><span className="check-box"></span></td>
                <td>
                  {item.image_url
                    ? <img src={item.image_url} alt="" />
                    : <div style={{ width: 40, height: 40, background: '#f0f0f0', borderRadius: 4, textAlign: 'center', lineHeight: '40px' }}>📦</div>
                  }
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{item.title}</div>
                </td>
                <td style={{ fontFamily: 'Courier New, monospace', fontSize: '10pt' }}>
                  {item.sku || '—'}
                </td>
                <td className="qty">× {item.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Notes from customer */}
        {order.confirmation_notes && (
          <div style={{ marginTop: 14, padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4 }}>
            <div className="label" style={{ fontSize: '9pt', textTransform: 'uppercase', color: '#92400e', letterSpacing: 1, marginBottom: 4 }}>
              Customer Note
            </div>
            <div style={{ fontSize: '11pt', color: '#78350f' }}>{order.confirmation_notes}</div>
          </div>
        )}

        {/* Signature grid */}
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
