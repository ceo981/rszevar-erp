'use client';

// ============================================================================
// RS ZEVAR ERP — Customer Invoice Print Page
// Route: /orders/[id]/print/invoice
// ----------------------------------------------------------------------------
// Customer-facing branded invoice. Elegant typography, gold + black theme
// consistent with RS ZEVAR's luxury jewelry brand identity.
//
// Design notes:
//   - Playfair Display (serif) for headers — elegant jewelry feel
//   - Inter (sans-serif) for body — clean readability
//   - Gold accent color #c9a96e + black + cream for print
//   - "PAID" watermark when paid (rotated stamp effect)
//   - Bilingual thank you note (English + Hinglish per RS ZEVAR communication style)
//   - Fonts loaded via Google Fonts CDN (fallbacks to system fonts if blocked)
// ============================================================================

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

const fmt = (n) => 'Rs ' + Math.round(Number(n || 0)).toLocaleString('en-PK');

function formatFullDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

export default function InvoicePage() {
  const params = useParams();
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

  useEffect(() => {
    if (order?.order_number) {
      document.title = `Invoice — ${order.order_number}`;
    }
  }, [order]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#666', fontFamily: 'sans-serif' }}>Loading invoice…</div>;
  }

  if (error || !order) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#c00', fontFamily: 'sans-serif' }}>
        {error || 'Order not found'}
      </div>
    );
  }

  const items = order.order_items || [];
  const subtotal = parseFloat(order.subtotal || 0);
  const discount = parseFloat(order.discount || 0);
  const shipping = parseFloat(order.shipping_fee || 0);
  const total = parseFloat(order.total_amount || 0);
  const isPaid = order.payment_status === 'paid';
  const isCOD = order.payment_method === 'COD' || !order.payment_method;
  const isCancelled = order.status === 'cancelled';

  return (
    <>
      {/* Google Fonts — Playfair Display + Cormorant Garamond (luxury) + Inter (sans) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;900&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500;600;700&display=swap"
      />

      <style>{`
        @page {
          size: A4;
          margin: 0;
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          padding: 0;
          background: #2a2a2a;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #1a1a1a;
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
          box-shadow: 0 2px 12px rgba(0,0,0,0.5);
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

        .invoice-wrap {
          max-width: 210mm;
          min-height: 297mm;
          margin: 20px auto;
          background: #fff;
          box-shadow: 0 8px 30px rgba(0,0,0,0.4);
          position: relative;
          overflow: hidden;
        }

        /* Gold top border */
        .gold-band {
          height: 8px;
          background: linear-gradient(90deg, #c9a96e 0%, #d4b882 50%, #c9a96e 100%);
        }

        .invoice {
          padding: 20mm 18mm 15mm;
          position: relative;
        }

        /* Header */
        .inv-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
          padding-bottom: 20px;
          border-bottom: 2px solid #111;
        }
        .brand img {
          height: 80px;
          width: auto;
          object-fit: contain;
        }
        .brand .tagline {
          /* Luxury italic serif — sits just under the RS ZEVAR logo */
          font-family: 'Cormorant Garamond', 'Playfair Display', Georgia, serif;
          font-size: 14pt;
          font-style: italic;
          color: #b8935a;
          letter-spacing: 2px;
          margin-top: 4px;
          font-weight: 500;
        }
        .inv-title {
          text-align: right;
        }
        .inv-title h1 {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 34pt;
          font-weight: 900;
          color: #111;
          margin: 0;
          letter-spacing: 4px;
        }
        .inv-title .sub {
          font-size: 9pt;
          color: #c9a96e;
          letter-spacing: 2px;
          text-transform: uppercase;
          margin-top: 4px;
          font-weight: 600;
        }

        /* Meta row */
        .meta {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 18px;
          margin-bottom: 28px;
        }
        .meta-item .label {
          font-size: 9pt;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 2px;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .meta-item .value {
          font-size: 12pt;
          color: #111;
          font-weight: 600;
        }
        .meta-item .value-accent {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 16pt;
          font-weight: 700;
          color: #c9a96e;
        }

        /* Addresses */
        .addr-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: 28px;
        }
        .addr-box {
          background: #faf7f2;
          border-left: 3px solid #c9a96e;
          padding: 14px 18px;
          border-radius: 3px;
        }
        .addr-box .label {
          font-size: 9pt;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 2px;
          font-weight: 600;
          margin-bottom: 6px;
        }
        .addr-box .name {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 14pt;
          font-weight: 700;
          color: #111;
          margin-bottom: 4px;
        }
        .addr-box .details {
          font-size: 10.5pt;
          color: #333;
          line-height: 1.55;
        }

        /* Items table */
        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 24px;
        }
        .items-table thead th {
          background: #111;
          color: #c9a96e;
          font-size: 9pt;
          text-transform: uppercase;
          letter-spacing: 2px;
          font-weight: 600;
          padding: 10px 12px;
          text-align: left;
        }
        .items-table thead th.right { text-align: right; }
        .items-table thead th.center { text-align: center; }

        .items-table tbody td {
          padding: 14px 12px;
          border-bottom: 1px solid #eee;
          font-size: 11pt;
          vertical-align: middle;
        }
        .items-table tbody tr:last-child td {
          border-bottom: 2px solid #111;
        }
        .items-table .thumb {
          width: 56px;
          height: 56px;
          object-fit: cover;
          border-radius: 4px;
          border: 1px solid #e5d9c1;
        }
        .items-table .title {
          font-weight: 600;
          color: #111;
          font-size: 11.5pt;
        }
        .items-table .sku {
          font-family: 'Courier New', monospace;
          color: #888;
          font-size: 9pt;
          margin-top: 3px;
        }
        .items-table .qty { text-align: center; font-weight: 600; color: #111; }
        .items-table .price { text-align: right; color: #333; }
        .items-table .total {
          text-align: right;
          font-weight: 700;
          color: #111;
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 12pt;
        }

        /* Totals box */
        .totals-wrap {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 28px;
        }
        .totals {
          width: 55%;
        }
        .totals-row {
          display: flex;
          justify-content: space-between;
          padding: 6px 0;
          font-size: 11pt;
          color: #333;
        }
        .totals-row .label { color: #666; }
        .totals-grand {
          margin-top: 8px;
          padding-top: 12px;
          border-top: 2px solid #111;
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        .totals-grand .label {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 18pt;
          font-weight: 700;
          color: #111;
        }
        .totals-grand .value {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 22pt;
          font-weight: 900;
          color: #c9a96e;
        }

        /* Payment info */
        .payment-info {
          background: #faf7f2;
          padding: 14px 18px;
          border-radius: 4px;
          margin-bottom: 24px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .payment-info .item .label {
          font-size: 9pt;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          font-weight: 600;
          margin-bottom: 3px;
        }
        .payment-info .item .value {
          font-size: 11pt;
          color: #111;
          font-weight: 600;
        }
        .status-paid {
          color: #059669 !important;
        }
        .status-pending {
          color: #d97706 !important;
        }

        /* PAID watermark */
        .paid-stamp {
          position: absolute;
          top: 45%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-15deg);
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 100pt;
          font-weight: 900;
          color: rgba(5, 150, 105, 0.1);
          letter-spacing: 10px;
          pointer-events: none;
          z-index: 1;
          border: 8px solid rgba(5, 150, 105, 0.15);
          padding: 8px 40px;
          border-radius: 8px;
        }
        .cancelled-stamp {
          position: absolute;
          top: 45%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-15deg);
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 80pt;
          font-weight: 900;
          color: rgba(220, 38, 38, 0.12);
          letter-spacing: 10px;
          pointer-events: none;
          z-index: 1;
          border: 8px solid rgba(220, 38, 38, 0.15);
          padding: 8px 40px;
          border-radius: 8px;
        }

        /* Thank you section */
        .thanks {
          text-align: center;
          padding: 20px 0;
          margin-bottom: 16px;
          border-top: 1px dashed #c9a96e;
          border-bottom: 1px dashed #c9a96e;
        }
        .thanks .main {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 16pt;
          font-weight: 600;
          color: #111;
          margin-bottom: 4px;
        }
        .thanks .urdu {
          font-size: 11pt;
          color: #555;
          font-style: italic;
        }

        /* Footer */
        .footer {
          margin-top: 18px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          padding-top: 14px;
          font-size: 9pt;
          color: #666;
        }
        .footer h3 {
          font-size: 9pt;
          color: #111;
          text-transform: uppercase;
          letter-spacing: 2px;
          font-weight: 600;
          margin: 0 0 6px;
        }
        .footer p { margin: 2px 0; line-height: 1.5; }
        .footer a { color: #c9a96e; text-decoration: none; font-weight: 500; }

        /* Print optimizations */
        @media print {
          body { background: #fff; }
          .controls { display: none !important; }
          .invoice-wrap {
            margin: 0;
            box-shadow: none;
            max-width: none;
            width: 100%;
          }
        }
      `}</style>

      <div className="controls">
        <a className="back" href={`/orders/${id}`}>← Back to order</a>
        <button onClick={() => window.print()}>🖨 Print / Save as PDF</button>
      </div>

      <div className="invoice-wrap">
        <div className="gold-band"></div>

        <div className="invoice">
          {/* Watermark stamps */}
          {isPaid && !isCancelled && <div className="paid-stamp">PAID</div>}
          {isCancelled && <div className="cancelled-stamp">CANCELLED</div>}

          {/* Header */}
          <div className="inv-header">
            <div className="brand">
              <img src="/rs_zevar_logo_transparent.png" alt="RS ZEVAR" />
              <div className="tagline">Designer Jewellery</div>
            </div>
            <div className="inv-title">
              <h1>INVOICE</h1>
              <div className="sub">Thank you for your purchase</div>
            </div>
          </div>

          {/* Meta row */}
          <div className="meta">
            <div className="meta-item">
              <div className="label">Invoice No.</div>
              <div className="value value-accent">{order.order_number}</div>
            </div>
            <div className="meta-item">
              <div className="label">Invoice Date</div>
              <div className="value">{formatFullDate(order.created_at)}</div>
            </div>
            <div className="meta-item">
              <div className="label">Payment Method</div>
              <div className="value">{isCOD ? 'Cash on Delivery' : (order.payment_method || 'Online')}</div>
            </div>
          </div>

          {/* Addresses */}
          <div className="addr-grid">
            <div className="addr-box">
              <div className="label">Billed To</div>
              <div className="name">{order.customer_name || 'Customer'}</div>
              <div className="details">
                {order.customer_phone && <div>📞 {order.customer_phone}</div>}
              </div>
            </div>
            <div className="addr-box">
              <div className="label">Ship To</div>
              <div className="name">{order.customer_name || 'Customer'}</div>
              <div className="details">
                {order.customer_address && <div>{order.customer_address}</div>}
                {order.customer_city && <div>{order.customer_city}</div>}
                <div>Pakistan</div>
                {order.customer_phone && <div style={{ marginTop: 4 }}>📞 {order.customer_phone}</div>}
              </div>
            </div>
          </div>

          {/* Items */}
          <table className="items-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}></th>
                <th>Description</th>
                <th className="center" style={{ width: 60 }}>Qty</th>
                <th className="right" style={{ width: 100 }}>Unit Price</th>
                <th className="right" style={{ width: 120 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id || idx}>
                  <td>
                    {item.image_url
                      ? <img src={item.image_url} alt="" className="thumb" />
                      : <div style={{ width: 56, height: 56, background: '#faf7f2', borderRadius: 4, border: '1px solid #e5d9c1', textAlign: 'center', lineHeight: '56px', fontSize: 24 }}>📦</div>
                    }
                  </td>
                  <td>
                    <div className="title">{item.title}</div>
                    {item.sku && <div className="sku">SKU: {item.sku}</div>}
                  </td>
                  <td className="qty">{item.quantity}</td>
                  <td className="price">{fmt(item.unit_price)}</td>
                  <td className="total">{fmt(item.total_price || (item.unit_price * item.quantity))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="totals-wrap">
            <div className="totals">
              <div className="totals-row">
                <span className="label">Subtotal</span>
                <span>{fmt(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="totals-row">
                  <span className="label">Discount</span>
                  <span style={{ color: '#dc2626' }}>-{fmt(discount)}</span>
                </div>
              )}
              <div className="totals-row">
                <span className="label">Shipping</span>
                <span>{fmt(shipping)}</span>
              </div>
              <div className="totals-grand">
                <span className="label">Total</span>
                <span className="value">{fmt(total)}</span>
              </div>
            </div>
          </div>

          {/* Payment info strip */}
          <div className="payment-info">
            <div className="item">
              <div className="label">Payment Status</div>
              <div className={`value ${isPaid ? 'status-paid' : 'status-pending'}`}>
                {isPaid ? '✓ Paid' : isCancelled ? 'Cancelled' : 'Payment Pending (COD)'}
              </div>
            </div>
            <div className="item" style={{ textAlign: 'right' }}>
              <div className="label">Amount Due</div>
              <div className="value" style={{ fontSize: '13pt' }}>
                {isPaid || isCancelled ? 'Rs 0' : fmt(total)}
              </div>
            </div>
          </div>

          {/* Thank you */}
          <div className="thanks">
            <div className="main">Thank you for choosing RS ZEVAR ❤️</div>
            <div className="urdu">Thank you for trusting us. We look forward to serving you again, InshaAllah!</div>
          </div>

          {/* Footer */}
          <div className="footer">
            <div>
              <h3>Contact Us</h3>
              <p>WhatsApp: <a href="https://wa.me/923032244550">+92 303 2244550</a></p>
              <p>Website: <a href="https://rszevar.com">rszevar.com</a></p>
              <p>Address: Suite #604, Falak Corporate City, Seari Quarters, Karachi</p>
            </div>
            <div>
              <h3>Return &amp; Exchange Policy</h3>
              <p>• 10-day exchange/return window from purchase date</p>
              <p>• Defective products: free exchange or refund</p>
              <p>• Other returns: Rs 200 fee, item must be unused in original packaging</p>
              <p>• Sale items, custom orders &amp; transit damage non-refundable</p>
            </div>
          </div>
        </div>

        <div className="gold-band"></div>
      </div>
    </>
  );
}
