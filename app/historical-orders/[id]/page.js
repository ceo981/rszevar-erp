// ============================================================================
// RS ZEVAR ERP — Historical Orders — Read-Only Detail Page
// /historical-orders/[id]
// May 5 2026
// ----------------------------------------------------------------------------
// PURPOSE:
//   Full read-only view of an archive order. NO edit, dispatch, packing, or
//   credit actions — yeh purely historical reference hai.
//
// LAYOUT:
//   - Header: order_number + Archive badge + Back link
//   - Status row: financial_status + fulfillment_status + cancelled state
//   - Customer card: name, phone, email
//   - Shipping card: full address
//   - Line items table: name, sku, qty, price, compare_at
//   - Money summary: subtotal, shipping, discount, total
//   - Dates timeline: created → paid → fulfilled → cancelled
//   - Tracking (if present)
//   - Tags + notes
// ============================================================================

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

const gold    = '#c9a96e';
const danger  = '#ef4444';
const warning = '#f59e0b';
const success = '#22c55e';

const fmtMoney = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-PK', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

const FIN_BADGE = {
  paid:           { label: 'Paid',     color: success, bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.3)' },
  pending:        { label: 'Pending',  color: warning, bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  voided:         { label: 'Voided',   color: '#888',  bg: 'rgba(136,136,136,0.12)', border: 'rgba(136,136,136,0.3)' },
  refunded:       { label: 'Refunded', color: danger,  bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)' },
  partially_paid: { label: 'Partial',  color: warning, bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  expired:        { label: 'Expired',  color: '#888',  bg: 'rgba(136,136,136,0.12)', border: 'rgba(136,136,136,0.3)' },
};
const FUL_BADGE = {
  fulfilled:           { label: 'Fulfilled',   color: success, bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.3)' },
  unfulfilled:         { label: 'Unfulfilled', color: warning, bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  partially_fulfilled: { label: 'Partial',     color: warning, bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  restocked:           { label: 'Restocked',   color: '#888',  bg: 'rgba(136,136,136,0.12)', border: 'rgba(136,136,136,0.3)' },
};

export default function ArchiveOrderDetailPage() {
  const params = useParams();
  const id = params.id;

  const [order, setOrder]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/historical-orders/${id}`);
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); }
        catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 100)}`); }
        if (!json.success) throw new Error(json.error || 'Failed to load order');
        setOrder(json.order);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  if (error || !order) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{
          display: 'inline-block', padding: '14px 20px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5', borderRadius: 8, fontSize: 13,
        }}>⚠ {error || 'Order not found'}</div>
        <div style={{ marginTop: 16 }}>
          <Link href="/historical-orders" style={{ color: gold, fontSize: 12 }}>← Back to Archive</Link>
        </div>
      </div>
    );
  }

  const items = Array.isArray(order.items) ? order.items : [];

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1080, margin: '0 auto' }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 6 }}>
        <Link href="/historical-orders"
          style={{ fontSize: 12, color: 'var(--text3)', textDecoration: 'none' }}>← Back to Archive</Link>
      </div>

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        gap: 12, flexWrap: 'wrap', marginBottom: 18,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 26, fontWeight: 600, margin: 0, color: '#fff' }}>
              {order.order_number}
            </h1>
            <span style={{
              fontSize: 10, color: gold, fontWeight: 600,
              background: 'rgba(201,169,110,0.1)', border: '1px solid rgba(201,169,110,0.3)',
              borderRadius: 4, padding: '2px 8px',
              textTransform: 'uppercase', letterSpacing: 0.4,
            }}>📁 Archive · Read-only</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text2)', margin: '6px 0 0' }}>
            Created {formatDateTime(order.created_at)}
            {order.imported_from && <span style={{ color: 'var(--text3)', marginLeft: 10, fontSize: 11 }}>· imported from {order.imported_from}</span>}
          </p>
        </div>

        {/* Status badges */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {order.financial_status && FIN_BADGE[order.financial_status] && (
            <Badge {...FIN_BADGE[order.financial_status]} />
          )}
          {order.cancelled_at ? (
            <Badge label="Cancelled" color={danger} bg="rgba(239,68,68,0.12)" border="rgba(239,68,68,0.3)" />
          ) : (
            order.fulfillment_status && FUL_BADGE[order.fulfillment_status] && (
              <Badge {...FUL_BADGE[order.fulfillment_status]} />
            )
          )}
        </div>
      </div>

      {/* Top summary cards */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 10, marginBottom: 18,
      }}>
        <SummaryCard label="TOTAL" value={fmtMoney(order.total_amount)} accent={gold} />
        <SummaryCard label="SUBTOTAL" value={fmtMoney(order.subtotal)} />
        <SummaryCard label="SHIPPING" value={fmtMoney(order.shipping_amount)} />
        {(order.discount_amount > 0) && <SummaryCard label="DISCOUNT" value={'-' + fmtMoney(order.discount_amount)} accent={warning} />}
        {(order.refunded_amount > 0) && <SummaryCard label="REFUNDED" value={fmtMoney(order.refunded_amount)} accent={danger} />}
      </div>

      {/* Two-column layout */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 16, marginBottom: 18,
      }}>
        {/* Customer card */}
        <Card title="Customer">
          <Field label="Name" value={order.customer_name} />
          <Field label="Phone" value={order.customer_phone || order.customer_phone_raw} mono />
          <Field label="Email" value={order.customer_email} />
          {order.payment_method && <Field label="Payment Method" value={order.payment_method} />}
          {order.tags && <Field label="Tags" value={order.tags} />}
        </Card>

        {/* Shipping card */}
        <Card title="Shipping">
          <Field label="Recipient" value={order.shipping_name} />
          <Field label="Phone" value={order.shipping_phone || order.shipping_phone_raw} mono />
          <Field label="Address" value={order.shipping_address} />
          <Field label="City" value={order.shipping_city} />
          {order.shipping_province && <Field label="Province" value={order.shipping_province} />}
          {order.shipping_country && <Field label="Country" value={order.shipping_country} />}
          {order.shipping_zip && <Field label="ZIP" value={order.shipping_zip} />}
          {order.shipping_method && <Field label="Method" value={order.shipping_method} />}
        </Card>
      </div>

      {/* Line items */}
      <Card title={`Line Items (${items.length})`}>
        {items.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
            Koi line items nahi mile
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={thStyle}>Product</th>
                  <th style={{ ...thStyle, width: 110 }}>SKU</th>
                  <th style={{ ...thStyle, width: 60, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...thStyle, width: 100, textAlign: 'right' }}>Price</th>
                  <th style={{ ...thStyle, width: 110, textAlign: 'right' }}>Compare At</th>
                  <th style={{ ...thStyle, width: 100, textAlign: 'right' }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const price = parseFloat(it.price) || 0;
                  const lineSubtotal = price * (it.qty || 0);
                  return (
                    <tr key={i} style={{ borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--border)' }}>
                      <td style={tdStyle}>{it.name || '—'}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', color: 'var(--text3)' }}>{it.sku || '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{it.qty || 0}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtMoney(price)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text3)' }}>
                        {it.compare_at ? fmtMoney(parseFloat(it.compare_at)) : '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>{fmtMoney(lineSubtotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Timeline + tracking + notes */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 16, marginTop: 18,
      }}>
        <Card title="Timeline">
          <Field label="Created" value={formatDateTime(order.created_at)} />
          {order.paid_at && <Field label="Paid" value={formatDateTime(order.paid_at)} />}
          {order.fulfilled_at && <Field label="Fulfilled" value={formatDateTime(order.fulfilled_at)} />}
          {order.cancelled_at && <Field label="Cancelled" value={formatDateTime(order.cancelled_at)} accent={danger} />}
          <Field label="Imported" value={formatDateTime(order.imported_at)} />
        </Card>

        {(order.tracking_number || order.tracking_company || order.notes) && (
          <Card title="Additional Info">
            {order.tracking_company && <Field label="Courier" value={order.tracking_company} />}
            {order.tracking_number && <Field label="Tracking #" value={order.tracking_number} mono />}
            {order.tracking_url && (
              <Field label="Tracking URL" value={
                <a href={order.tracking_url} target="_blank" rel="noopener noreferrer" style={{ color: gold, fontSize: 11 }}>
                  Open ↗
                </a>
              } />
            )}
            {order.source && <Field label="Source" value={order.source} />}
            {order.shopify_order_id && <Field label="Shopify ID" value={order.shopify_order_id} mono />}
            {order.notes && <Field label="Notes" value={order.notes} />}
          </Card>
        )}
      </div>

      {/* Footer note */}
      <div style={{
        marginTop: 22, padding: '12px 16px',
        background: 'rgba(201,169,110,0.05)', border: '1px solid rgba(201,169,110,0.2)',
        borderRadius: 8, fontSize: 11, color: 'var(--text3)', textAlign: 'center',
      }}>
        🔒 Yeh archive order hai — read-only. Active workflow modules (dispatch / packing / credits / inventory) is order ko dekhte tak nahi.
      </div>
    </div>
  );
}

// ─── Helper Components ──────────────────────────────────────────────────────

function Card({ title, children }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px',
    }}>
      <div style={{
        fontSize: 10, color: 'var(--text3)', fontWeight: 600,
        letterSpacing: 0.7, textTransform: 'uppercase',
        marginBottom: 10, paddingBottom: 8,
        borderBottom: '1px solid var(--border)',
      }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Field({ label, value, mono, accent }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={{ marginBottom: 8, display: 'flex', gap: 10, fontSize: 12 }}>
      <div style={{ minWidth: 90, color: 'var(--text3)', fontWeight: 500 }}>{label}:</div>
      <div style={{
        flex: 1, color: accent || 'var(--text1)',
        fontFamily: mono ? 'monospace' : 'inherit',
        wordBreak: 'break-word',
      }}>{value}</div>
    </div>
  );
}

function SummaryCard({ label, value, accent }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '12px 14px',
    }}>
      <div style={{
        fontSize: 9, color: 'var(--text3)', fontWeight: 600,
        letterSpacing: 0.7, marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 600,
        color: accent || 'var(--text1)',
      }}>{value}</div>
    </div>
  );
}

function Badge({ label, color, bg, border }) {
  return (
    <span style={{
      display: 'inline-block',
      background: bg, color, border: `1px solid ${border}`,
      borderRadius: 4, padding: '3px 10px',
      fontSize: 11, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: 0.4,
    }}>{label}</span>
  );
}

const thStyle = {
  fontSize: 9, color: 'var(--text3)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.7,
  textAlign: 'left', padding: '8px 6px',
};
const tdStyle = {
  padding: '10px 6px', color: 'var(--text1)',
  verticalAlign: 'top',
};
