// ============================================================================
// RS ZEVAR ERP — Customer Credits Dashboard
// /credits
// May 2 2026 · Step 4 of 6
// ----------------------------------------------------------------------------
// PURPOSE:
//   List all credit (udhaar) customers with outstanding balance.
//   Real data from /api/credits endpoint.
//
//   Behavior:
//   - 4 summary cards (total outstanding, active customers, this month
//     received, pending orders)
//   - Search by name/phone (debounced)
//   - Sort by outstanding (default), name, recent
//   - Click on customer row → navigates to /credits/[phone]
//   - Empty state: friendly message with CTA explaining how to add
//     a customer to credits (via "Convert to credit order" button —
//     built in Step 6)
//
// PRODUCTION SAFETY:
//   - Read-only — no mutations from this page
//   - Defensive JSON parse (Vercel can return text on infra errors)
//   - AbortController for stale request guard
//   - Empty state graceful (won't break if 0 customers)
// ============================================================================

'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';

const gold   = '#c9a96e';
const danger = '#ef4444';
const warning = '#f59e0b';
const success = '#22c55e';

const fmtMoney = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;

function timeAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr > 1 ? 's' : ''} ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) > 1 ? 's' : ''} ago`;
}

export default function CustomerCreditsPage() {
  const { profile } = useUser();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('outstanding');  // outstanding | name | recent
  const abortRef = useRef(null);

  // ── Fetch dashboard data (debounced via search) ──
  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({ sort });
        if (search.trim()) params.set('search', search.trim());

        const res = await fetch(`/api/credits?${params}`, { signal: ctrl.signal });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); }
        catch {
          throw new Error(`Server returned non-JSON: ${text.slice(0, 100)}`);
        }
        if (ctrl.signal.aborted) return;

        if (!json.success) throw new Error(json.error || 'Failed to load credits');
        setData(json);
      } catch (e) {
        if (e.name === 'AbortError') return;
        setError(e.message);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    };

    // Debounce search by 300ms
    const t = setTimeout(fetchData, search ? 300 : 0);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [search, sort]);

  const customers = data?.customers || [];
  const summary = data?.summary || { total_outstanding: 0, active_customers: 0, this_month_received: 0, pending_orders: 0 };

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1240, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, margin: 0, color: '#fff', letterSpacing: '-0.01em' }}>
            📒 Customer Credits
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text2)', margin: '6px 0 0' }}>
            Udhaar customers ka khaata · {summary.active_customers} customer{summary.active_customers !== 1 ? 's' : ''} · {fmtMoney(summary.total_outstanding)} outstanding
          </p>
        </div>
        <Link href="/orders"
          style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            color: 'var(--text2)', borderRadius: 7, padding: '8px 14px',
            fontSize: 12, fontFamily: 'inherit', textDecoration: 'none',
          }}>← Back to Orders</Link>
      </div>

      {/* ── Summary cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12,
        marginBottom: 22,
      }}>
        <SummaryCard
          label="TOTAL OUTSTANDING"
          value={fmtMoney(summary.total_outstanding)}
          accent={summary.total_outstanding > 0 ? danger : 'var(--text2)'}
          icon="💰"
        />
        <SummaryCard
          label="ACTIVE CUSTOMERS"
          value={summary.active_customers.toLocaleString()}
          accent={gold}
          icon="👥"
        />
        <SummaryCard
          label="THIS MONTH RECEIVED"
          value={fmtMoney(summary.this_month_received)}
          accent={success}
          icon="📥"
        />
        <SummaryCard
          label="PENDING ORDERS"
          value={summary.pending_orders.toLocaleString()}
          accent={warning}
          icon="📋"
        />
      </div>

      {/* ── Search + sort bar ── */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <input
          type="text"
          placeholder="🔍 Search by name or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: '1 1 280px',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            color: '#fff', borderRadius: 8, padding: '10px 14px', fontSize: 13,
            fontFamily: 'inherit', outline: 'none',
          }}
        />
        <div style={{
          display: 'flex', gap: 4, padding: 4,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8,
        }}>
          {[
            { v: 'outstanding', l: 'Outstanding ↓' },
            { v: 'name', l: 'Name A-Z' },
            { v: 'recent', l: 'Recent payment' },
          ].map(opt => (
            <button key={opt.v} onClick={() => setSort(opt.v)}
              style={{
                background: sort === opt.v ? gold : 'transparent',
                color: sort === opt.v ? '#000' : 'var(--text2)',
                border: 'none', borderRadius: 5,
                padding: '6px 12px', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{opt.l}</button>
          ))}
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5', borderRadius: 8, padding: '12px 16px',
          fontSize: 13, marginBottom: 16,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Customers list ── */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 10, overflow: 'hidden',
      }}>
        {/* Header row */}
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 1.2fr 90px',
          gap: 12, padding: '11px 18px',
          background: 'var(--bg-section)', borderBottom: '1px solid var(--border)',
          fontSize: 10, color: 'var(--text3)', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: 0.7,
        }}>
          <div>Customer</div>
          <div>Orders</div>
          <div>Outstanding</div>
          <div>Last payment</div>
          <div></div>
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            Loading khaata...
          </div>
        )}

        {/* Empty state */}
        {!loading && customers.length === 0 && !error && (
          <EmptyState searchActive={!!search.trim()} />
        )}

        {/* Customer rows */}
        {!loading && customers.map((c, idx) => (
          <Link
            key={c.phone}
            href={`/credits/${encodeURIComponent(c.phone)}`}
            style={{ textDecoration: 'none' }}
          >
            <div
              style={{
                display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 1.2fr 90px',
                gap: 12, padding: '14px 18px',
                borderBottom: idx === customers.length - 1 ? 'none' : '1px solid var(--border)',
                alignItems: 'center', cursor: 'pointer',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {/* Customer name + phone */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name || '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, fontFamily: 'monospace' }}>
                  {c.phone}
                </div>
              </div>

              {/* Orders count */}
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                {c.orders_count} unpaid
                {c.partial_count > 0 && (
                  <span style={{ color: warning, marginLeft: 6 }}>· {c.partial_count} partial</span>
                )}
              </div>

              {/* Outstanding */}
              <div style={{
                fontSize: 14, fontWeight: 600,
                color: c.outstanding > 10000 ? danger : c.outstanding > 3000 ? warning : 'var(--text1)',
              }}>
                {fmtMoney(c.outstanding)}
              </div>

              {/* Last payment */}
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                {c.last_payment_at ? timeAgo(c.last_payment_at) : 'Never'}
              </div>

              {/* Open arrow */}
              <div style={{ textAlign: 'right' }}>
                <span style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text2)', borderRadius: 6,
                  padding: '5px 10px', fontSize: 11, fontWeight: 500,
                  display: 'inline-block',
                }}>Open →</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Footer note */}
      {!loading && customers.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
          Showing {customers.length} customer{customers.length !== 1 ? 's' : ''}
          {search ? ` matching "${search}"` : ''}
        </div>
      )}
    </div>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────

function SummaryCard({ label, value, accent, icon }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px',
    }}>
      <div style={{
        fontSize: 10, color: 'var(--text3)', fontWeight: 600,
        letterSpacing: 0.7, marginBottom: 6,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{label}</span>
        <span style={{ fontSize: 14 }}>{icon}</span>
      </div>
      <div style={{
        fontSize: 22, fontWeight: 600, color: accent,
        lineHeight: 1.1,
      }}>{value}</div>
    </div>
  );
}

function EmptyState({ searchActive }) {
  if (searchActive) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
        <div style={{ fontSize: 15, color: '#fff', fontWeight: 500, marginBottom: 6 }}>
          No customer found
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', maxWidth: 340, margin: '0 auto', lineHeight: 1.6 }}>
          Tumhari search se koi credit customer match nahi hua. Phone number ya naam check karo.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 14 }}>📒</div>
      <div style={{ fontSize: 16, color: '#fff', fontWeight: 500, marginBottom: 8 }}>
        Abhi koi credit customer nahi
      </div>
      <div style={{ fontSize: 13, color: 'var(--text2)', maxWidth: 460, margin: '0 auto 18px', lineHeight: 1.6 }}>
        Jab tum kisi order ko <strong style={{ color: gold }}>"Credit / Udhaar"</strong> mark karoge, woh customer yahan automatically aa jayega.
      </div>
      <div style={{
        display: 'inline-block',
        background: 'rgba(201,169,110,0.05)', border: '1px solid rgba(201,169,110,0.2)',
        borderRadius: 8, padding: '12px 18px', fontSize: 12, color: 'var(--text2)',
        textAlign: 'left', maxWidth: 460,
      }}>
        <strong style={{ color: gold }}>Kaise add karein?</strong>
        <ol style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Koi order khol (delivered + unpaid)</li>
          <li><em>"Convert to credit order"</em> button click karo</li>
          <li>Customer is dashboard mein aa jayega</li>
        </ol>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>
          Yeh button Step 6 mein build hoga. Abhi yeh page test pe hai.
        </div>
      </div>
    </div>
  );
}
