// ============================================================================
// RS ZEVAR ERP — Customer Credits — Import Order Modal
// /app/credits/_components/ImportOrderModal.js
// May 5 2026
// ----------------------------------------------------------------------------
// PURPOSE:
//   Modal for searching credit orders and importing one into the current
//   khaata. Used to consolidate orders from same customer with multiple
//   phone numbers (e.g., Anum Taha with +92 322 + +92 311).
//
// PROPS:
//   khaataPhone  — string, the target khaata phone (where order will land)
//   khaataName   — string, customer name for display
//   onClose      — callback to close modal
//   onSuccess    — callback({ order_number, moved_from, moved_to }) after import
//
// FLOW:
//   1. User types in search → debounced GET /api/credits/import-order?q=...
//   2. Click on order row → confirmation panel slides in
//   3. Confirm → POST /api/credits/import-order → onSuccess + close
// ============================================================================

'use client';

import { useState, useEffect, useRef } from 'react';

const gold    = '#c9a96e';
const danger  = '#ef4444';
const warning = '#f59e0b';
const success = '#22c55e';

const fmtMoney = (n) =>
  `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;

const STATUS_COLORS = {
  pending:    '#9ca3af',
  confirmed:  '#60a5fa',
  on_packing: '#a78bfa',
  packed:     '#a78bfa',
  dispatched: '#f59e0b',
  delivered:  '#22c55e',
  cancelled:  '#ef4444',
  attempted:  '#f59e0b',
  hold:       '#f59e0b',
};

export default function ImportOrderModal({ khaataPhone, khaataName, onClose, onSuccess }) {
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [confirming, setConfirming] = useState(null);   // selected order pending confirmation
  const [submitting, setSubmitting] = useState(false);
  const abortRef = useRef(null);

  // ── Debounced search ──
  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const fetchResults = async () => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({ exclude_phone: khaataPhone });
        if (query.trim()) params.set('q', query.trim());
        const res = await fetch(`/api/credits/import-order?${params}`, { signal: ctrl.signal });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); }
        catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 100)}`); }
        if (ctrl.signal.aborted) return;
        if (!json.success) throw new Error(json.error || 'Search failed');
        setResults(json.results || []);
      } catch (e) {
        if (e.name === 'AbortError') return;
        setError(e.message);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    };

    const t = setTimeout(fetchResults, query ? 300 : 0);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, khaataPhone]);

  // ── Confirm import ──
  const handleConfirm = async () => {
    if (!confirming) return;
    try {
      setSubmitting(true);
      setError(null);
      const res = await fetch('/api/credits/import-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: confirming.id,
          target_phone: khaataPhone,
        }),
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 100)}`); }
      if (!json.success) throw new Error(json.error || 'Import failed');

      onSuccess?.({
        order_number: confirming.order_number,
        moved_from: json.moved_from,
        moved_to: json.moved_to,
      });
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  // ── Render ──
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}>
      <div style={{
        background: 'var(--bg-page, #1a1f2e)',
        border: '1px solid var(--border)',
        borderRadius: 12, width: '100%', maxWidth: 600, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#fff' }}>
              🔗 Add order to khaata
            </h2>
            <p style={{
              fontSize: 12, color: 'var(--text2)', margin: '4px 0 0',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              <strong style={{ color: gold }}>{khaataName || '—'}</strong>
              <span style={{ color: 'var(--text3)', fontFamily: 'monospace', marginLeft: 6 }}>
                ({khaataPhone})
              </span>
            </p>
          </div>
          <button onClick={onClose} disabled={submitting}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text3)',
              fontSize: 24, lineHeight: 1, padding: 0,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}>×</button>
        </div>

        {/* Confirmation view */}
        {confirming ? (
          <div style={{ padding: 22 }}>
            <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--text2)' }}>
              Yeh order is khaate me move karne wala hu — confirm karo:
            </div>

            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 14, marginBottom: 14,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <div style={{ fontSize: 14, color: '#fff', fontWeight: 600 }}>
                  {confirming.order_number}
                </div>
                <div style={{ fontSize: 14, color: confirming.balance > 0 ? danger : success, fontWeight: 600 }}>
                  {fmtMoney(confirming.balance)} <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 400 }}>balance</span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
                Customer: <strong style={{ color: 'var(--text1)' }}>{confirming.customer_name || '—'}</strong>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace', marginBottom: 8 }}>
                Currently in khaata: {confirming.current_khaata_phone}
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text2)' }}>
                <div>Total: <strong style={{ color: '#fff' }}>{fmtMoney(confirming.total_amount)}</strong></div>
                <div>Paid: <strong style={{ color: success }}>{fmtMoney(confirming.paid_amount)}</strong></div>
                <div>Status: <strong style={{ color: STATUS_COLORS[confirming.status] || 'var(--text1)' }}>{confirming.status}</strong></div>
              </div>
            </div>

            <div style={{
              background: 'rgba(201,169,110,0.05)', border: '1px solid rgba(201,169,110,0.2)',
              borderRadius: 7, padding: 11, marginBottom: 14, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6,
            }}>
              📌 Order ka customer phone (<strong style={{ color: 'var(--text1)' }}>{confirming.customer_phone}</strong>) <strong>change nahi hoga</strong> — sirf khaata grouping change hogi.
              WhatsApp, courier tracking, order details — sab same rahega. Sirf credit dashboard pe yeh order ab <strong style={{ color: gold }}>{khaataName}</strong> ke khaate me dikhega.
            </div>

            {error && (
              <div style={{
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#fca5a5', borderRadius: 6, padding: '10px 12px',
                fontSize: 12, marginBottom: 12,
              }}>⚠ {error}</div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setConfirming(null); setError(null); }} disabled={submitting}
                style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text2)', borderRadius: 7, padding: '9px 16px',
                  fontSize: 12, fontFamily: 'inherit', cursor: submitting ? 'not-allowed' : 'pointer',
                }}>← Back</button>
              <button onClick={handleConfirm} disabled={submitting}
                style={{
                  background: gold, color: '#000', border: 'none',
                  borderRadius: 7, padding: '9px 18px',
                  fontSize: 12, fontFamily: 'inherit', fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1,
                }}>{submitting ? 'Moving...' : 'Confirm — Add to khaata'}</button>
            </div>
          </div>
        ) : (
          <>
            {/* Search input */}
            <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--border)' }}>
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="🔍 Search by order # ya customer name…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  color: '#fff', borderRadius: 7, padding: '10px 14px',
                  fontSize: 13, fontFamily: 'inherit', outline: 'none',
                }}
              />
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 200 }}>
              {error && (
                <div style={{
                  margin: '12px 22px', padding: '10px 12px',
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                  color: '#fca5a5', borderRadius: 6, fontSize: 12,
                }}>⚠ {error}</div>
              )}

              {loading && (
                <div style={{ padding: '30px 22px', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                  Searching...
                </div>
              )}

              {!loading && results.length === 0 && !error && (
                <div style={{ padding: '40px 22px', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                  {query ? 'Koi matching order nahi mila' : 'Search karo ya recent credit orders dekho'}
                </div>
              )}

              {!loading && results.map((o) => {
                const balanceColor = o.balance > 10000 ? danger : o.balance > 3000 ? warning : 'var(--text1)';
                const statusColor  = STATUS_COLORS[o.status] || 'var(--text3)';
                return (
                  <div
                    key={o.id}
                    onClick={() => setConfirming(o)}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    style={{
                      padding: '12px 22px', cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                      transition: 'background 0.12s',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, color: gold, fontWeight: 500 }}>{o.order_number}</span>
                          <span style={{
                            fontSize: 9, fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: 0.4, color: statusColor,
                            background: `${statusColor}22`, border: `1px solid ${statusColor}55`,
                            borderRadius: 3, padding: '1px 6px',
                          }}>{o.status}</span>
                          {o.payment_status === 'partial' && (
                            <span style={{
                              fontSize: 9, fontWeight: 600, color: warning,
                              background: 'rgba(245,158,11,0.12)',
                              border: '1px solid rgba(245,158,11,0.3)',
                              borderRadius: 3, padding: '1px 6px',
                            }}>PARTIAL</span>
                          )}
                          {o.is_imported_elsewhere && (
                            <span title="Already imported into another khaata"
                              style={{
                                fontSize: 9, color: warning, fontWeight: 500,
                                background: 'rgba(245,158,11,0.1)',
                                border: '1px solid rgba(245,158,11,0.3)',
                                borderRadius: 3, padding: '1px 6px',
                              }}>🔗 imported</span>
                          )}
                        </div>
                        <div style={{
                          fontSize: 12, color: '#fff', marginBottom: 2,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {o.customer_name || '—'}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace' }}>
                          {o.current_khaata_phone}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 13, color: balanceColor, fontWeight: 600 }}>
                          {fmtMoney(o.balance)}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>balance</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer note */}
            <div style={{
              padding: '10px 22px', borderTop: '1px solid var(--border)',
              fontSize: 10, color: 'var(--text3)', textAlign: 'center',
            }}>
              {results.length > 0 && `Showing ${results.length} order${results.length !== 1 ? 's' : ''}`}
              {results.length >= 20 && ' (max 20 — refine search for more)'}
              {results.length === 0 && !loading && !error && !query && '— Type to search —'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
