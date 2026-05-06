'use client';

// ============================================================================
// RS ZEVAR ERP — Loadsheet Print Page (May 6 2026)
// Route: /orders/loadsheets/[id]/print
// ----------------------------------------------------------------------------
// Print-friendly RS ZEVAR-branded dispatch report. Use case: dispatcher saari
// parcels scan karne ke baad ye page open hota hai, courier walay ke saamne
// print karke signature lete hain (apne record ke liye proof of handover).
//
// Design:
//   - A4 portrait, white bg + black text (print)
//   - Gold accent color for RS ZEVAR branding (#c9a96e)
//   - Cormorant Garamond serif for headers (luxury jewelry feel)
//   - Inter sans-serif for body (readability)
//   - Compact table to fit 50+ rows on page
//   - Two signature blocks at bottom: Handed Over By + Received By
//
// Auto-print: page load par print dialog 500ms baad open ho jata hai
// (manager ki ek click bachane ke liye). Cancel kar ke manual print bhi OK.
// ============================================================================

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

const fmt = (n) => 'Rs ' + Math.round(Number(n || 0)).toLocaleString('en-PK');

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function LoadsheetPrintPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id;

  const [loadsheet, setLoadsheet] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const r = await fetch(`/api/loadsheets/${id}`);
        const d = await r.json();
        if (d.success) {
          setLoadsheet(d.loadsheet);
        } else {
          setError(d.error || 'Loadsheet load nahi hua');
        }
      } catch (e) {
        setError(e.message);
      }
      setLoading(false);
    })();
  }, [id]);

  // Auto-trigger print dialog after data loads (small delay for rendering)
  useEffect(() => {
    if (loadsheet && !loading) {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [loadsheet, loading]);

  if (loading) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#666' }}>
        Loadsheet load ho rahi hai...
      </div>
    );
  }

  if (error || !loadsheet) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#c00' }}>
        Error: {error || 'Loadsheet nahi mila'}
        <br/><br/>
        <button onClick={() => router.push('/orders/dispatch-scan')}>
          ← Dispatch Scan pe wapas jao
        </button>
      </div>
    );
  }

  const orders = loadsheet.orders || [];
  const couriersSummary = loadsheet.couriers_summary || {};

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap"
      />

      <style>{`
        @page {
          size: A4;
          margin: 12mm 10mm;
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          padding: 0;
          background: #f0f0f0;
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
        .controls .ghost {
          background: transparent;
          color: #c9a96e;
          border: 1px solid #c9a96e;
        }

        .page {
          background: #fff;
          max-width: 210mm;
          margin: 20px auto;
          padding: 16mm 14mm;
          box-shadow: 0 4px 24px rgba(0,0,0,0.18);
          min-height: 297mm;
        }

        @media print {
          body { background: #fff; }
          .controls { display: none !important; }
          .page {
            margin: 0;
            padding: 0;
            box-shadow: none;
            max-width: none;
            min-height: auto;
          }
        }

        /* Header */
        .brand {
          text-align: center;
          padding-bottom: 14px;
          border-bottom: 2px solid #c9a96e;
          margin-bottom: 18px;
        }
        .brand .name {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-size: 32px;
          font-weight: 700;
          color: #c9a96e;
          letter-spacing: 8px;
          margin: 0;
          line-height: 1;
        }
        .brand .tag {
          font-size: 9px;
          letter-spacing: 4px;
          color: #666;
          margin-top: 4px;
          text-transform: uppercase;
        }
        .brand .title {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-size: 22px;
          font-weight: 600;
          color: #1a1a1a;
          margin: 12px 0 0;
          letter-spacing: 3px;
          text-transform: uppercase;
        }

        /* Meta info */
        .meta {
          display: flex;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 16px;
          font-size: 11px;
        }
        .meta .row {
          display: flex;
          gap: 8px;
        }
        .meta .label {
          color: #666;
          font-weight: 500;
        }
        .meta .value {
          color: #1a1a1a;
          font-weight: 600;
        }

        /* Table */
        table.parcels {
          width: 100%;
          border-collapse: collapse;
          font-size: 10px;
          margin-bottom: 14px;
        }
        table.parcels th {
          background: #1a1a1a;
          color: #c9a96e;
          font-weight: 600;
          text-align: left;
          padding: 8px 6px;
          font-size: 10px;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          border: 1px solid #1a1a1a;
        }
        table.parcels td {
          padding: 6px 6px;
          border: 1px solid #ccc;
          vertical-align: top;
          font-size: 10px;
        }
        table.parcels tr:nth-child(even) td {
          background: #fafafa;
        }
        table.parcels .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        table.parcels .center {
          text-align: center;
        }
        table.parcels .mono {
          font-family: 'Courier New', monospace;
          font-size: 9.5px;
        }

        /* Totals row */
        .totals-row {
          display: flex;
          justify-content: flex-end;
          gap: 16px;
          padding: 10px 0;
          border-top: 2px solid #1a1a1a;
          border-bottom: 2px solid #1a1a1a;
          margin-bottom: 14px;
          font-size: 12px;
        }
        .totals-row .item {
          text-align: right;
        }
        .totals-row .label {
          font-size: 10px;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .totals-row .value {
          font-size: 14px;
          font-weight: 700;
          color: #1a1a1a;
          margin-top: 2px;
        }
        .totals-row .gold {
          color: #c9a96e;
        }

        /* Per-courier breakdown */
        .courier-breakdown {
          background: #fafafa;
          border: 1px solid #ddd;
          padding: 10px 12px;
          margin-bottom: 16px;
          border-radius: 4px;
          font-size: 11px;
        }
        .courier-breakdown .heading {
          font-weight: 600;
          color: #666;
          text-transform: uppercase;
          font-size: 9px;
          letter-spacing: 0.5px;
          margin-bottom: 6px;
        }
        .courier-breakdown .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 8px;
        }
        .courier-breakdown .pill {
          display: flex;
          justify-content: space-between;
          padding: 4px 8px;
          background: #fff;
          border: 1px solid #ddd;
          border-radius: 3px;
        }
        .courier-breakdown .courier {
          font-weight: 600;
          color: #1a1a1a;
        }
        .courier-breakdown .stats {
          color: #666;
          font-size: 10px;
        }

        /* Notes */
        .notes {
          padding: 8px 12px;
          background: #fffbe6;
          border-left: 3px solid #c9a96e;
          font-size: 11px;
          margin-bottom: 16px;
          color: #4a4a4a;
        }

        /* Signature block */
        .signatures {
          margin-top: 28px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 30px;
        }
        .signatures .sig {
          text-align: center;
        }
        .signatures .sig .heading {
          font-size: 11px;
          font-weight: 600;
          color: #1a1a1a;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 28px;
        }
        .signatures .sig .line {
          border-top: 1px solid #1a1a1a;
          margin: 0 12px;
          padding-top: 4px;
          font-size: 10px;
          color: #666;
        }
        .signatures .sig .fields {
          margin-top: 14px;
          font-size: 10px;
          color: #666;
          text-align: left;
        }
        .signatures .sig .fields .row {
          margin-bottom: 6px;
          border-bottom: 1px solid #999;
          padding-bottom: 2px;
        }

        /* Footer */
        .doc-footer {
          margin-top: 22px;
          padding-top: 10px;
          border-top: 1px solid #ddd;
          text-align: center;
          font-size: 9px;
          color: #999;
          letter-spacing: 0.5px;
        }
      `}</style>

      <div className="controls">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => router.push('/orders/dispatch-scan')} className="ghost">
            ← New Scan Session
          </button>
          <span style={{ fontSize: 13, color: '#999' }}>
            Loadsheet: <strong style={{ color: '#c9a96e' }}>{loadsheet.loadsheet_number}</strong>
          </span>
        </div>
        <button onClick={() => window.print()}>
          🖨️ Print
        </button>
      </div>

      <div className="page">

        {/* Brand header */}
        <div className="brand">
          <h1 className="name">RS ZEVAR</h1>
          <div className="tag">Luxury Jewelry · Pakistan</div>
          <div className="title">Dispatch Report</div>
        </div>

        {/* Meta info */}
        <div className="meta">
          <div className="row">
            <span className="label">Loadsheet #:</span>
            <span className="value">{loadsheet.loadsheet_number}</span>
          </div>
          <div className="row">
            <span className="label">Date:</span>
            <span className="value">{formatDateTime(loadsheet.generated_at)}</span>
          </div>
          <div className="row">
            <span className="label">Generated By:</span>
            <span className="value">{loadsheet.generated_by || '—'}</span>
          </div>
        </div>

        {/* Notes (if any) */}
        {loadsheet.notes && (
          <div className="notes">
            <strong>Note:</strong> {loadsheet.notes}
          </div>
        )}

        {/* Parcels table */}
        <table className="parcels">
          <thead>
            <tr>
              <th style={{ width: 30 }}>Sr</th>
              <th style={{ width: 90 }}>Order #</th>
              <th style={{ width: 110 }}>Tracking #</th>
              <th style={{ width: 70 }}>Courier</th>
              <th>Customer</th>
              <th style={{ width: 75 }}>City</th>
              <th style={{ width: 75 }}>COD</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="center">{o.position}</td>
                <td className="mono">{o.order_number}</td>
                <td className="mono">{o.tracking_number}</td>
                <td>{o.courier || '—'}</td>
                <td>{o.customer_name || '—'}</td>
                <td>{o.customer_city || '—'}</td>
                <td className="num">
                  {Number(o.cod_amount) > 0 ? fmt(o.cod_amount) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="totals-row">
          <div className="item">
            <div className="label">Total Parcels</div>
            <div className="value">{loadsheet.total_parcels}</div>
          </div>
          <div className="item">
            <div className="label">Total COD</div>
            <div className="value gold">{fmt(loadsheet.total_cod)}</div>
          </div>
        </div>

        {/* Per-courier breakdown */}
        {Object.keys(couriersSummary).length > 0 && (
          <div className="courier-breakdown">
            <div className="heading">Per Courier Breakdown</div>
            <div className="grid">
              {Object.entries(couriersSummary).map(([courier, stats]) => (
                <div key={courier} className="pill">
                  <span className="courier">{courier}</span>
                  <span className="stats">
                    {stats.count} parcels · {fmt(stats.cod)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Signature blocks */}
        <div className="signatures">
          <div className="sig">
            <div className="heading">Handed Over By</div>
            <div className="line">Signature & Date</div>
            <div className="fields">
              <div className="row">Name: {loadsheet.generated_by || ''}</div>
              <div className="row">Date: {formatDateTime(loadsheet.generated_at).split(',')[0]}</div>
            </div>
          </div>
          <div className="sig">
            <div className="heading">Received By (Courier)</div>
            <div className="line">Signature & Date</div>
            <div className="fields">
              <div className="row">Name: ____________________</div>
              <div className="row">Phone / CNIC: ____________</div>
            </div>
          </div>
        </div>

        {/* Document footer */}
        <div className="doc-footer">
          RS ZEVAR · rszevar.com · Karachi, Pakistan · Dispatch Report
        </div>

      </div>
    </>
  );
}
