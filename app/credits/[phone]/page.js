// ============================================================================
// RS ZEVAR ERP — Customer Credits — Per-Customer Khaata Page
// /credits/[phone]
// May 2 2026 · Step 5 of 6 · File 2 of 2
// May 5 2026 · UPDATED — "+ Add order to khaata" feature
//   - Import button (super_admin / credits.import_order)
//   - Imported orders show "🔗 from +92 311…" badge
//   - Remove button on imported orders (back to natural khaata)
// ----------------------------------------------------------------------------
// PURPOSE:
//   Single customer ka complete khaata view:
//   - Header with name + phone + actions (Record payment, Add order)
//   - 3 summary cards (outstanding, total billed, total received)
//   - Tabs: Orders + Payments
//   - Orders list with status badges + balance + import badges
//   - Payments list with screenshot + allocations + void (super_admin)
//   - PaymentModal + ImportOrderModal integration
// ============================================================================

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';
import PaymentModal from '../_components/PaymentModal';
import ImportOrderModal from '../_components/ImportOrderModal';

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

const STATUS_BADGE = {
  pending:    { label: 'Pending', color: 'var(--text3)', bg: 'rgba(138,133,128,0.12)', border: 'rgba(138,133,128,0.3)' },
  confirmed:  { label: 'Confirmed', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.3)' },
  on_packing: { label: 'Packing', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
  packed:     { label: 'Packed', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
  dispatched: { label: 'Dispatched', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  delivered:  { label: 'Delivered', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)' },
  cancelled:  { label: 'Cancelled', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
  attempted:  { label: 'Attempted', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  hold:       { label: 'Hold', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
};

const PAYMENT_BADGE = {
  paid:    { label: 'Paid', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)' },
  partial: { label: 'Partial', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  unpaid:  { label: 'Unpaid', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
};

export default function CustomerKhaataPage() {
  const params = useParams();
  const router = useRouter();
  const { profile, performer, isSuperAdmin, can } = useUser();

  // ── Granular permission gates (May 2 2026) ──
  const canRecordPayment = can('credits.payment_record');
  const canVoidPayment   = can('credits.payment_void');
  // May 5 2026 — Import order permission (super_admin OR explicit perm)
  const canImportOrder   = isSuperAdmin || can('credits.import_order');

  const phone = decodeURIComponent(params.phone || '');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('orders');  // 'orders' | 'payments'
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [voidingId, setVoidingId] = useState(null);
  // May 5 2026 — import-order state
  const [showImportModal, setShowImportModal] = useState(false);
  const [removingImportId, setRemovingImportId] = useState(null);

  // ── Fetch khaata data ──
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/credits/${encodeURIComponent(phone)}`);
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 100)}`); }
      if (!json.success) throw new Error(json.error || 'Failed to load khaata');
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (phone) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  // ── Payment success handler ──
  const handlePaymentSuccess = (result) => {
    setShowPaymentModal(false);
    fetchData();  // refresh

    // Show success message
    const flipped = result.orders_now_paid?.length || 0;
    const partial = result.orders_now_partial?.length || 0;
    let msg = `Payment recorded: ${fmtMoney(result.payment.amount)}`;
    if (flipped > 0) msg += `\n✓ ${flipped} order${flipped > 1 ? 's' : ''} marked PAID`;
    if (partial > 0) msg += `\n⚠ ${partial} order${partial > 1 ? 's' : ''} now PARTIAL`;
    if (result.unallocated_amount > 0) msg += `\n💰 ${fmtMoney(result.unallocated_amount)} unallocated`;
    alert(msg);
  };

  // ── May 5 2026: Import-order handlers ──
  const handleImportSuccess = ({ order_number, moved_from, moved_to }) => {
    setShowImportModal(false);
    fetchData();
    alert(`✓ Order ${order_number} added to this khaata${moved_from ? ` (moved from ${moved_from})` : ''}`);
  };

  const handleRemoveImport = async (orderId, orderNumber) => {
    const ok = confirm(
      `Order ${orderNumber} ko is khaate se remove karna hai?\n\n` +
      `Yeh order wapas apne natural khaate me chala jayega (us order ke customer_phone wala khaata).`
    );
    if (!ok) return;
    try {
      setRemovingImportId(orderId);
      const res = await fetch(`/api/credits/import-order?order_id=${encodeURIComponent(orderId)}`, {
        method: 'DELETE',
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 100)}`); }
      if (!json.success) throw new Error(json.error || 'Remove failed');
      fetchData();
    } catch (e) {
      alert(`Failed to remove: ${e.message}`);
    } finally {
      setRemovingImportId(null);
    }
  };

  // ── Void payment handler ──
  const handleVoid = async (paymentId) => {
    const reason = prompt('Void karne ki wajah likhein (optional):');
    if (reason === null) return;  // cancelled

    try {
      setVoidingId(paymentId);
      const res = await fetch(`/api/credits/payment/${paymentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voided_reason: reason || 'No reason provided',
          performer: performer || null,
        }),
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 100)}`); }
      if (!json.success) throw new Error(json.error || 'Void failed');
      const reverted = json.orders_reverted?.length || 0;
      alert(`Payment voided. ${reverted} order(s) status reverted.`);
      fetchData();
    } catch (e) {
      alert(`Failed to void: ${e.message}`);
    } finally {
      setVoidingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
        Loading khaata...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{
          display: 'inline-block', padding: '14px 20px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5', borderRadius: 8, fontSize: 13,
        }}>⚠ {error}</div>
        <div style={{ marginTop: 16 }}>
          <Link href="/credits" style={{ color: gold, fontSize: 12 }}>← Back to Credits</Link>
        </div>
      </div>
    );
  }

  const customer = data?.customer || {};
  const summary = data?.summary || {};
  const orders = data?.orders || [];
  const payments = data?.payments || [];

  // Open orders for FIFO modal — only unpaid/partial active credit orders
  const ACTIVE_STATUSES = ['pending', 'confirmed', 'on_packing', 'packed', 'dispatched', 'attempted', 'hold', 'delivered'];
  const openOrders = orders.filter(o =>
    ACTIVE_STATUSES.includes(o.status) && ['unpaid', 'partial'].includes(o.payment_status)
  );

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1100, margin: '0 auto' }}>

      {/* ── Breadcrumb + Header ── */}
      <div style={{ marginBottom: 4 }}>
        <Link href="/credits"
          style={{ fontSize: 12, color: 'var(--text3)', textDecoration: 'none' }}>← Back to Credits</Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, margin: '6px 0 0', color: 'var(--text)', letterSpacing: '-0.01em' }}>
            {customer.name || '—'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text2)', margin: '6px 0 0', fontFamily: 'monospace' }}>
            {customer.phone}
            {customer.first_seen && <span style={{ marginLeft: 12, fontFamily: 'inherit', color: 'var(--text3)' }}>
              · Customer since {formatDate(customer.first_seen)}
            </span>}
          </p>
        </div>
        {/* May 5 2026 — Action buttons row */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canImportOrder && (
            <button onClick={() => setShowImportModal(true)}
              title="Add an existing order from another phone to this khaata"
              style={{
                background: 'transparent', color: gold,
                border: `1px solid ${gold}`, borderRadius: 8,
                padding: '10px 16px', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>🔗 Add order to khaata</button>
          )}
          {canRecordPayment && openOrders.length > 0 && (
            <button onClick={() => setShowPaymentModal(true)}
              style={{
                background: gold, color: '#000',
                border: 'none', borderRadius: 8,
                padding: '10px 18px', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>+ Record payment</button>
          )}
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 12, marginBottom: 22,
      }}>
        <SummaryCard
          label="OUTSTANDING BALANCE"
          value={fmtMoney(summary.outstanding)}
          accent={summary.outstanding > 0 ? danger : success}
          highlight
        />
        <SummaryCard
          label="TOTAL BILLED"
          value={fmtMoney(summary.total_billed)}
        />
        <SummaryCard
          label="TOTAL RECEIVED"
          value={fmtMoney(summary.total_received)}
          accent={success}
        />
      </div>

      {/* ── Tabs ── */}
      <div style={{
        display: 'flex', gap: 18, marginBottom: 14,
        borderBottom: '1px solid var(--border)',
      }}>
        <TabButton active={tab === 'orders'} onClick={() => setTab('orders')}>
          Orders ({orders.length})
        </TabButton>
        <TabButton active={tab === 'payments'} onClick={() => setTab('payments')}>
          Payments ({payments.length})
        </TabButton>
      </div>

      {/* ── Orders tab ── */}
      {tab === 'orders' && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          {orders.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              Koi credit order nahi
            </div>
          ) : (
            <>
              <div style={{
                display: 'grid', gridTemplateColumns: '1.3fr 2fr 1fr 1.3fr 100px',
                gap: 12, padding: '11px 18px',
                background: 'var(--bg-section)', borderBottom: '1px solid var(--border)',
                fontSize: 10, color: 'var(--text3)', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: 0.7,
              }}>
                <div>Order #</div>
                <div>Items</div>
                <div>Total</div>
                <div>Paid / Balance</div>
                <div>Status</div>
              </div>

              {orders.map((o, idx) => {
                const orderStatus = STATUS_BADGE[o.status] || STATUS_BADGE.pending;
                const payStatus = PAYMENT_BADGE[o.payment_status] || PAYMENT_BADGE.unpaid;
                return (
                  <div key={o.id} style={{
                    display: 'grid', gridTemplateColumns: '1.3fr 2fr 1fr 1.3fr 100px',
                    gap: 12, padding: '14px 18px',
                    borderBottom: idx === orders.length - 1 ? 'none' : '1px solid var(--border)',
                    alignItems: 'center',
                    background: o.is_imported ? 'rgba(201,169,110,0.04)' : 'transparent',
                  }}>
                    <div>
                      <Link href={`/orders/${o.id}`}
                        style={{ fontSize: 12, color: gold, fontWeight: 500, textDecoration: 'none' }}>
                        {o.order_number}
                      </Link>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                        {formatDate(o.created_at)}
                      </div>
                      {/* May 2026 — Download invoice link.
                          Opens print invoice page in new tab. Customer ko PDF
                          chahiye toh wahan se Print → Save as PDF kar sakte hain.
                          Invoice page mein partial-payment breakdown bhi dikhta
                          hai (Total / Paid / Balance Due). */}
                      <a
                        href={`/orders/${o.id}/print/invoice`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open invoice — Print/Save as PDF"
                        style={{
                          display: 'inline-block',
                          marginTop: 6,
                          fontSize: 10,
                          color: gold,
                          textDecoration: 'none',
                          background: 'rgba(201,169,110,0.08)',
                          border: '1px solid rgba(201,169,110,0.25)',
                          borderRadius: 3,
                          padding: '2px 7px',
                          fontWeight: 500,
                        }}
                      >
                        📄 Download Invoice
                      </a>
                      {/* May 5 2026 — Import badge + remove button */}
                      {o.is_imported && (
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span title={`Imported from ${o.source_phone}${o.imported_by_name ? ` by ${o.imported_by_name}` : ''}`}
                            style={{
                              fontSize: 9, color: gold, fontWeight: 500,
                              background: 'rgba(201,169,110,0.1)',
                              border: '1px solid rgba(201,169,110,0.3)',
                              borderRadius: 3, padding: '1px 6px',
                              fontFamily: 'monospace',
                            }}>
                            🔗 {o.source_phone}
                          </span>
                          {canImportOrder && (
                            <button
                              onClick={() => handleRemoveImport(o.id, o.order_number)}
                              disabled={removingImportId === o.id}
                              title="Remove from this khaata (back to natural khaata)"
                              style={{
                                background: 'transparent', border: 'none',
                                color: 'var(--text3)', fontSize: 9,
                                fontWeight: 500, padding: 0, cursor: removingImportId === o.id ? 'not-allowed' : 'pointer',
                                textDecoration: 'underline', fontFamily: 'inherit',
                              }}>
                              {removingImportId === o.id ? 'removing…' : 'remove'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.items_summary || '—'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text1)', fontWeight: 500 }}>
                      {fmtMoney(o.total_amount)}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: o.paid_amount > 0 ? success : 'var(--text3)' }}>
                        {fmtMoney(o.paid_amount)} paid
                      </div>
                      {o.balance > 0 && (
                        <div style={{ fontSize: 11, color: danger, marginTop: 2 }}>
                          Balance: {fmtMoney(o.balance)}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <Badge {...payStatus} />
                      <Badge {...orderStatus} small />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── Payments tab ── */}
      {tab === 'payments' && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          {payments.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              Abhi koi payment record nahi
            </div>
          ) : (
            payments.map((p, idx) => (
              <div key={p.id} style={{
                padding: '16px 18px',
                borderBottom: idx === payments.length - 1 ? 'none' : '1px solid var(--border)',
                opacity: p.voided_at ? 0.5 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 14, fontWeight: 600,
                        color: p.voided_at ? 'var(--text3)' : success,
                        textDecoration: p.voided_at ? 'line-through' : 'none',
                      }}>
                        {fmtMoney(p.amount)} received
                      </span>
                      {p.method && <span style={{
                        background: 'var(--bg-section)', border: '1px solid var(--border)',
                        color: 'var(--text2)', borderRadius: 4,
                        padding: '2px 8px', fontSize: 10, fontWeight: 500,
                      }}>{p.method}</span>}
                      {p.voided_at && <Badge label="VOIDED" color={danger} bg="rgba(239,68,68,0.12)" border="rgba(239,68,68,0.3)" />}
                      {/* May 5 2026: payment was recorded under a different (alias) phone */}
                      {p.recorded_under_phone && (
                        <span title={`This payment was recorded under ${p.recorded_under_phone} (before order import)`}
                          style={{
                            fontSize: 9, color: gold, fontWeight: 500,
                            background: 'rgba(201,169,110,0.1)',
                            border: '1px solid rgba(201,169,110,0.3)',
                            borderRadius: 3, padding: '1px 6px',
                            fontFamily: 'monospace',
                          }}>
                          🔗 under {p.recorded_under_phone}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                      {formatDateTime(p.paid_at)}
                      {p.created_by_name && <span> · by {p.created_by_name}</span>}
                    </div>

                    {/* Allocations */}
                    {p.allocations?.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text2)' }}>
                        <span style={{ color: 'var(--text3)' }}>→ Allocated: </span>
                        {p.allocations.map((a, i) => (
                          <span key={a.order_id}>
                            <Link href={`/orders/${a.order_id}`}
                              style={{ color: gold, textDecoration: 'none' }}>
                              {a.order_number}
                            </Link>
                            <span style={{ color: 'var(--text3)' }}> ({fmtMoney(a.amount)})</span>
                            {i < p.allocations.length - 1 && <span style={{ color: 'var(--text3)' }}>, </span>}
                          </span>
                        ))}
                      </div>
                    )}

                    {p.unallocated > 0 && (
                      <div style={{ marginTop: 4, fontSize: 11, color: warning }}>
                        ⚠ {fmtMoney(p.unallocated)} unallocated
                      </div>
                    )}

                    {p.note && (
                      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>
                        Note: {p.note}
                      </div>
                    )}

                    {p.voided_at && p.voided_reason && (
                      <div style={{ marginTop: 4, fontSize: 11, color: danger, fontStyle: 'italic' }}>
                        Void reason: {p.voided_reason}
                      </div>
                    )}
                  </div>

                  {/* Receipt + actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {p.receipt_url && (
                      <a href={p.receipt_url} target="_blank" rel="noopener noreferrer"
                        style={{
                          width: 44, height: 44,
                          background: 'var(--bg-section)', border: '1px solid var(--border)',
                          borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--text2)', textDecoration: 'none', fontSize: 16,
                        }}
                        title="View receipt">📷</a>
                    )}
                    {canVoidPayment && !p.voided_at && (
                      <button onClick={() => handleVoid(p.id)}
                        disabled={voidingId === p.id}
                        title="Void this payment"
                        style={{
                          background: 'transparent', border: '1px solid rgba(239,68,68,0.3)',
                          color: danger, borderRadius: 6,
                          padding: '6px 10px', fontSize: 11, fontWeight: 500,
                          cursor: voidingId === p.id ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                        }}>
                        {voidingId === p.id ? '...' : '× Void'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Payment Modal ── */}
      {showPaymentModal && (
        <PaymentModal
          customer={{
            phone: customer.phone,
            name: customer.name,
            outstanding: summary.outstanding,
          }}
          openOrders={openOrders}
          performer={performer}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={handlePaymentSuccess}
        />
      )}

      {/* ── May 5 2026: Import Order Modal ── */}
      {showImportModal && (
        <ImportOrderModal
          khaataPhone={customer.phone}
          khaataName={customer.name}
          onClose={() => setShowImportModal(false)}
          onSuccess={handleImportSuccess}
        />
      )}
    </div>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────

function SummaryCard({ label, value, accent, highlight }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: highlight ? `1px solid ${accent}` : '1px solid var(--border)',
      borderLeft: highlight ? `3px solid ${accent}` : '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px',
    }}>
      <div style={{
        fontSize: 10, color: 'var(--text3)', fontWeight: 600,
        letterSpacing: 0.7, marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontSize: 22, fontWeight: 600,
        color: accent || 'var(--text1)',
        lineHeight: 1.1,
      }}>{value}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        background: 'transparent', border: 'none',
        color: active ? '#fff' : 'var(--text3)',
        padding: '10px 0', fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer', fontFamily: 'inherit',
        borderBottom: active ? `2px solid ${gold}` : '2px solid transparent',
        marginBottom: -1,
      }}>{children}</button>
  );
}

function Badge({ label, color, bg, border, small }) {
  return (
    <span style={{
      display: 'inline-block',
      background: bg, color, border: `1px solid ${border}`,
      borderRadius: 4, padding: small ? '1px 6px' : '2px 8px',
      fontSize: small ? 9 : 10, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: 0.4,
    }}>{label}</span>
  );
}
