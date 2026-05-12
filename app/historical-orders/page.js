// ============================================================================
// RS ZEVAR ERP — Historical Orders — Browse + Import
// /historical-orders
// May 5 2026
// ----------------------------------------------------------------------------
// PURPOSE:
//   Main archive page with two tabs:
//     1. 📁 Browse Archive — search + filter + paginated list of archive orders
//     2. ⬆ Import CSV     — upload Shopify CSV exports (super_admin only)
//
//   Default tab: Browse Archive (more frequently used)
//
//   Click on any order row → /historical-orders/[id] (read-only detail page)
//
// AUTH:
//   - Browse: any authenticated user (RLS allows read)
//   - Import: super_admin only (UI gates + server enforces)
// ============================================================================

'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';
import { createClient as createAuthClient } from '@/lib/supabase/client';

const gold    = '#c9a96e';
const danger  = '#ef4444';
const warning = '#f59e0b';
const success = '#22c55e';

const fmtNum   = (n) => Number(n || 0).toLocaleString('en-PK');
const fmtMoney = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
const fmtMs    = (ms) => ms < 1000 ? `${ms}ms` : `${(ms/1000).toFixed(1)}s`;
const fmtMB    = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}

const FIN_BADGE = {
  paid:           { label: 'Paid',       color: success, bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.3)' },
  pending:        { label: 'Pending',    color: warning, bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  voided:         { label: 'Voided',     color: '#888',  bg: 'rgba(136,136,136,0.12)', border: 'rgba(136,136,136,0.3)' },
  refunded:       { label: 'Refunded',   color: danger,  bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)' },
  partially_paid: { label: 'Partial',    color: warning, bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  expired:        { label: 'Expired',    color: '#888',  bg: 'rgba(136,136,136,0.12)', border: 'rgba(136,136,136,0.3)' },
};

const FUL_BADGE = {
  fulfilled:           { label: 'Fulfilled',   color: success, bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.3)' },
  unfulfilled:         { label: 'Unfulfilled', color: warning, bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  partially_fulfilled: { label: 'Partial',     color: warning, bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  restocked:           { label: 'Restocked',   color: '#888',  bg: 'rgba(136,136,136,0.12)', border: 'rgba(136,136,136,0.3)' },
};

export default function HistoricalOrdersPage() {
  const { profile, isSuperAdmin } = useUser();
  const [tab, setTab] = useState('browse');  // 'browse' | 'import'

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1240, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, margin: 0, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          📦 Historical Orders <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>archive · read-only</span>
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text2)', margin: '6px 0 0' }}>
          Pre-existing Shopify orders ka archive. Active workflow se bilkul alag — koi sync, dispatch, packing, ya credit module isse nahi chhuti.
        </p>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 18, marginBottom: 18,
        borderBottom: '1px solid var(--border)',
      }}>
        <TabButton active={tab === 'browse'} onClick={() => setTab('browse')}>
          📁 Browse Archive
        </TabButton>
        {isSuperAdmin && (
          <TabButton active={tab === 'import'} onClick={() => setTab('import')}>
            ⬆ Import CSV
          </TabButton>
        )}
      </div>

      {tab === 'browse' && <BrowseArchiveTab />}
      {tab === 'import' && isSuperAdmin && <ImportCsvTab />}
    </div>
  );
}

// ─── Browse Archive Tab ─────────────────────────────────────────────────────

function BrowseArchiveTab() {
  const [search, setSearch]       = useState('');
  const [debounced, setDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage]           = useState(1);
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const abortRef = useRef(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when filter/search changes
  useEffect(() => { setPage(1); }, [debounced, statusFilter]);

  // Fetch
  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({
          page: String(page),
          limit: '50',
          status: statusFilter,
        });
        if (debounced) params.set('search', debounced);
        const res = await fetch(`/api/historical-orders/list?${params}`, { signal: ctrl.signal });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); }
        catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 100)}`); }
        if (ctrl.signal.aborted) return;
        if (!json.success) throw new Error(json.error || 'Failed to load');
        setData(json);
      } catch (e) {
        if (e.name === 'AbortError') return;
        setError(e.message);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();

    return () => ctrl.abort();
  }, [debounced, statusFilter, page]);

  const orders = data?.orders || [];
  const counts = data?.global_counts || {};
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 50));

  const filterChips = [
    { value: 'all',         label: 'All',         color: gold,    count: counts.all || 0 },
    { value: 'fulfilled',   label: 'Fulfilled',   color: success, count: counts.fulfilled || 0 },
    { value: 'unfulfilled', label: 'Unfulfilled', color: warning, count: counts.unfulfilled || 0 },
    { value: 'cancelled',   label: 'Cancelled',   color: danger,  count: counts.cancelled || 0 },
    { value: 'paid',        label: 'Paid',        color: success, count: counts.paid || 0 },
    { value: 'voided',      label: 'Voided',      color: '#888',  count: counts.voided || 0 },
  ];

  return (
    <div>
      {/* Search */}
      <div style={{ marginBottom: 14 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search archive: order #, customer name, phone, email…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            color: 'var(--text)', borderRadius: 8, padding: '11px 14px',
            fontSize: 13, fontFamily: 'inherit', outline: 'none',
          }}
        />
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {filterChips.map(chip => {
          const isActive = statusFilter === chip.value;
          return (
            <button
              key={chip.value}
              onClick={() => setStatusFilter(chip.value)}
              style={{
                background: isActive ? chip.color + '18' : 'transparent',
                border: isActive ? `1px solid ${chip.color}55` : '1px solid var(--border)',
                color: isActive ? chip.color : 'var(--text2)',
                borderRadius: 7, padding: '6px 12px',
                fontSize: 12, fontWeight: isActive ? 600 : 500,
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              {chip.label}
              <span style={{
                fontSize: 10, fontWeight: 600,
                background: isActive ? chip.color + '22' : 'var(--bg-section)',
                color: isActive ? chip.color : 'var(--text3)',
                padding: '1px 6px', borderRadius: 8, minWidth: 18, textAlign: 'center',
              }}>{fmtNum(chip.count)}</span>
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 14px', marginBottom: 14,
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5', borderRadius: 7, fontSize: 12,
        }}>⚠ {error}</div>
      )}

      {/* List */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 10, overflow: 'hidden',
      }}>
        {/* Header row */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1.4fr 1.6fr 1.2fr 0.9fr 1.1fr 0.9fr 0.9fr 70px',
          gap: 10, padding: '11px 16px',
          background: 'var(--bg-section)', borderBottom: '1px solid var(--border)',
          fontSize: 10, color: 'var(--text3)', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: 0.7,
        }}>
          <div>Order #</div>
          <div>Customer</div>
          <div>City</div>
          <div>Total</div>
          <div>Items</div>
          <div>Financial</div>
          <div>Fulfillment</div>
          <div></div>
        </div>

        {loading && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            Loading…
          </div>
        )}

        {!loading && orders.length === 0 && !error && (
          <div style={{ padding: '50px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
            <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>
              {debounced || statusFilter !== 'all' ? 'Koi matching order nahi mila' : 'Archive khali hai'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
              {debounced || statusFilter !== 'all' ? 'Search/filter clear karke try karo' : 'Import CSV tab se data add karo'}
            </div>
          </div>
        )}

        {!loading && orders.map((o, idx) => (
          <Link
            key={o.id}
            href={`/historical-orders/${o.id}`}
            style={{ textDecoration: 'none' }}
          >
            <div
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              style={{
                display: 'grid', gridTemplateColumns: '1.4fr 1.6fr 1.2fr 0.9fr 1.1fr 0.9fr 0.9fr 70px',
                gap: 10, padding: '12px 16px',
                borderBottom: idx === orders.length - 1 ? 'none' : '1px solid var(--border)',
                alignItems: 'center', cursor: 'pointer',
                transition: 'background 0.12s',
              }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: gold, fontWeight: 500 }}>{o.order_number}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                  {formatDate(o.created_at)}
                </div>
              </div>
              <div style={{ minWidth: 0, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {o.customer_name || '—'}
                {o.customer_phone && (
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace', marginTop: 2 }}>
                    {o.customer_phone}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {o.shipping_city || '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text1)', fontWeight: 500 }}>
                {fmtMoney(o.total_amount)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {o.items_count || 0} item{o.items_count !== 1 ? 's' : ''}
                {o.items_summary && (
                  <div style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {o.items_summary}
                  </div>
                )}
              </div>
              <div>
                {o.financial_status && FIN_BADGE[o.financial_status] && <Badge {...FIN_BADGE[o.financial_status]} />}
              </div>
              <div>
                {o.cancelled_at ? (
                  <Badge label="Cancelled" color={danger} bg="rgba(239,68,68,0.12)" border="rgba(239,68,68,0.3)" />
                ) : (
                  o.fulfillment_status && FUL_BADGE[o.fulfillment_status] && <Badge {...FUL_BADGE[o.fulfillment_status]} />
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{
                  fontSize: 10, color: 'var(--text3)',
                  border: '1px solid var(--border)', borderRadius: 5,
                  padding: '4px 8px',
                }}>View →</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Pagination */}
      {!loading && orders.length > 0 && (
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text3)' }}>
          <div>
            Showing {((page - 1) * 50) + 1}–{Math.min(page * 50, total)} of {fmtNum(total)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                color: page === 1 ? 'var(--text3)' : 'var(--text1)',
                borderRadius: 6, padding: '6px 12px', fontSize: 12,
                cursor: page === 1 ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}>← Prev</button>
            <span style={{ alignSelf: 'center', padding: '0 8px', color: 'var(--text2)' }}>
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                color: page >= totalPages ? 'var(--text3)' : 'var(--text1)',
                borderRadius: 6, padding: '6px 12px', fontSize: 12,
                cursor: page >= totalPages ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Import CSV Tab ─────────────────────────────────────────────────────────

function ImportCsvTab() {
  const [file, setFile]     = useState(null);
  const [stage, setStage]   = useState('idle');
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [stats, setStats]   = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createAuthClient();
        const { count } = await supabase
          .from('historical_orders')
          .select('*', { count: 'exact', head: true });
        setStats({ archive_count: count || 0 });
      } catch {}
    })();
  }, [stage]);

  const handleImport = async () => {
    if (!file) return;
    setStage('uploading');
    setResult(null);
    setProgress({ step: 'CSV upload to Supabase Storage…', detail: fmtMB(file.size) });

    const supabase = createAuthClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = `imports/${Date.now()}_${safeName}`;

    const { error: uplErr } = await supabase.storage
      .from('historical-imports')
      .upload(path, file, { upsert: false, contentType: 'text/csv' });

    if (uplErr) {
      setStage('error');
      setProgress(null);
      setResult({ success: false, error: `Storage upload failed: ${uplErr.message}` });
      return;
    }

    setStage('importing');
    setProgress({ step: 'Server parsing CSV + inserting…', detail: 'thoda waqt lag sakta hai (~20-30 sec for 10k orders)' });

    try {
      const res = await fetch('/api/historical-orders/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path: path }),
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 200)}`); }
      if (!json.success) throw new Error(json.error || 'Import failed');

      setStage('done');
      setProgress(null);
      setResult(json);
    } catch (e) {
      setStage('error');
      setProgress(null);
      setResult({ success: false, error: e.message });
    }
  };

  const reset = () => {
    setFile(null);
    setStage('idle');
    setResult(null);
    setProgress(null);
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {stats && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 18px', marginBottom: 18,
        }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, letterSpacing: 0.7 }}>CURRENT ARCHIVE COUNT</div>
          <div style={{ fontSize: 26, fontWeight: 600, color: gold, marginTop: 4 }}>
            {fmtNum(stats.archive_count)} <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 400 }}>orders</span>
          </div>
        </div>
      )}

      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 22,
      }}>
        {stage === 'idle' && (
          <>
            <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text)' }}>Shopify CSV file select karo</strong> (zip se extract karke)
            </div>
            <label style={{
              display: 'block', cursor: 'pointer',
              border: `2px dashed ${file ? gold : 'var(--border)'}`,
              borderRadius: 10, padding: '32px 20px', textAlign: 'center',
              background: file ? 'rgba(201,169,110,0.05)' : 'transparent',
              transition: 'all 0.15s',
            }}>
              <input type="file" accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ display: 'none' }} />
              {file ? (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                  <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>{file.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{fmtMB(file.size)} · click to change</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>📁</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>Click karke .csv file select karo</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>Tip: zip ko pehle extract karo (Right-click → Extract All)</div>
                </>
              )}
            </label>
            <button onClick={handleImport} disabled={!file}
              style={{
                marginTop: 14, width: '100%',
                background: file ? gold : 'var(--bg-section)',
                color: file ? '#000' : 'var(--text3)',
                border: 'none', borderRadius: 8,
                padding: '12px 18px', fontSize: 13, fontWeight: 600,
                cursor: file ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              }}>⬆ Upload + Import</button>
          </>
        )}

        {(stage === 'uploading' || stage === 'importing') && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500, marginBottom: 6 }}>{progress?.step || 'Working…'}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{progress?.detail || ''}</div>
          </div>
        )}

        {stage === 'done' && result?.success && (
          <div>
            <div style={{
              padding: '14px 16px', marginBottom: 14,
              background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 14, color: success, fontWeight: 600 }}>✓ Import successful</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>Duration: {fmtMs(result.duration_ms || 0)}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
              <ResultCard label="CSV rows" value={fmtNum(result.total_rows_in_csv)} color="var(--text2)" />
              <ResultCard label="Unique orders" value={fmtNum(result.unique_orders)} color="var(--text1)" />
              <ResultCard label="Inserted" value={fmtNum(result.inserted)} color={success} />
              <ResultCard label="Skipped" value={fmtNum(result.skipped_duplicates)} color={warning} />
            </div>
            <button onClick={reset} style={{
              width: '100%',
              background: 'transparent', color: 'var(--text2)',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '10px 16px', fontSize: 12, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>+ Import another file</button>
          </div>
        )}

        {stage === 'error' && (
          <div>
            <div style={{
              padding: '14px 16px', marginBottom: 14,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 14, color: danger, fontWeight: 600 }}>✗ Import failed</div>
              <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 6, wordBreak: 'break-word' }}>{result?.error}</div>
            </div>
            <button onClick={reset} style={{
              width: '100%',
              background: 'var(--bg-section)', color: 'var(--text1)',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '10px 16px', fontSize: 12, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>← Try again</button>
          </div>
        )}
      </div>

      <div style={{
        marginTop: 18, padding: 16,
        background: 'rgba(201,169,110,0.05)', border: '1px solid rgba(201,169,110,0.2)',
        borderRadius: 8, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7,
      }}>
        <div style={{ color: gold, fontWeight: 600, marginBottom: 6 }}>📌 Notes:</div>
        <div>• Same CSV dobara upload safe — duplicates auto-skip (UNIQUE on order_number)</div>
        <div>• Active orders me already mojood order_numbers DB trigger se silently skip</div>
        <div>• Active workflow (dispatch, packing, courier, credits) ko bilkul disturb nahi karta</div>
      </div>
    </div>
  );
}

// ─── Helper Components ──────────────────────────────────────────────────────

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

function Badge({ label, color, bg, border }) {
  return (
    <span style={{
      display: 'inline-block',
      background: bg, color, border: `1px solid ${border}`,
      borderRadius: 4, padding: '2px 8px',
      fontSize: 10, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: 0.4,
    }}>{label}</span>
  );
}

function ResultCard({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--bg-section)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 600, letterSpacing: 0.7, marginBottom: 4 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
