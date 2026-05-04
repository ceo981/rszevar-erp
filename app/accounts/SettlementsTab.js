'use client';
// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR ERP — SettlementsTab
// ----------------------------------------------------------------------------
// Upload courier settlement files (PostEx CSV, Leopards PDF/XLS, Kangaroo XLSX),
// preview parsed rows, then apply to mark orders Paid / RTO and create the
// settlement record.
//
// May 5 2026 — Mobile-first cleanup
//   • All Roman Urdu copy converted to professional English.
//   • History list switches to card view on mobile (table was unusable narrow).
//   • Courier picker: 3-col on desktop, 1-col stack on mobile — no cramping.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@/context/UserContext';

const gold   = '#c9a96e';
const border = '#222';
const card   = '#111';

const COURIERS = [
  { id: 'Leopards', label: '🐆 Leopards', format: 'PDF / XLS', accept: '.pdf,.xls,.xlsx' },
  { id: 'Kangaroo', label: '🦘 Kangaroo', format: 'XLSX',      accept: '.xlsx,.xls' },
  { id: 'PostEx',   label: '📦 PostEx',   format: 'CSV',        accept: '.csv' },
];

const fmt     = n => `Rs ${Number(n || 0).toLocaleString()}`;
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// Mobile detection — kept local to this file so it ships standalone.
function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const c = () => setM(window.innerWidth < 768);
    c();
    window.addEventListener('resize', c);
    return () => window.removeEventListener('resize', c);
  }, []);
  return m;
}

// ──────────────────────────────────────────────────────────────────────────
// UPLOAD SECTION — pick courier, upload file, preview, apply.
// ──────────────────────────────────────────────────────────────────────────
function UploadSection({ onDone }) {
  const isMobile = useIsMobile();
  const [courier, setCourier]     = useState('Leopards');
  const [file, setFile]           = useState(null);
  const [referenceNo, setRefNo]   = useState('');
  const [settledAt, setSettledAt] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading]     = useState(false);
  const [preview, setPreview]     = useState(null);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState('');

  const selectedCourier = COURIERS.find(c => c.id === courier);
  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(''); };

  const handlePreview = async () => {
    if (!file) { setError('Please select a file first'); return; }
    setLoading(true); setError(''); setPreview(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('courier', courier);
      fd.append('reference_no', referenceNo); fd.append('settled_at', settledAt);
      fd.append('apply', 'false');
      const r = await fetch('/api/courier/settlements/upload', { method: 'POST', body: fd });
      const d = await r.json();
      if (d.success) setPreview(d); else setError(d.error || 'Failed to parse file');
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const handleApply = async () => {
    if (!file || !preview) return;
    setLoading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('courier', courier);
      fd.append('reference_no', referenceNo); fd.append('settled_at', settledAt);
      fd.append('apply', 'true');
      const r = await fetch('/api/courier/settlements/upload', { method: 'POST', body: fd });
      const d = await r.json();
      if (d.success) {
        setResult(d); setPreview(null);
        window.dispatchEvent(new CustomEvent('settlementApplied', { detail: d }));
        onDone?.();
      } else setError(d.error || 'Failed to apply settlement');
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const inp = { background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ maxWidth: 700, marginBottom: 36 }}>
      {result && (
        <div style={{ background: '#001a0a', border: '1px solid #003300', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#22c55e', marginBottom: 12 }}>✅ Settlement Applied</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              ['💰 Marked Paid',     result.orders_paid,   '#22c55e'],
              ['↩️ Marked RTO',      result.orders_rto,    '#ef4444'],
              ['⏭ Already Paid',    result.already_paid,  '#888'],
              ['🔍 Not Found',       result.not_found,     '#f59e0b'],
              ['⏩ Skipped',          result.skipped,       '#555'],
              ['📋 Total Parsed',    result.total_parsed,  gold],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color }}>{val}</div>
              </div>
            ))}
          </div>
          {result.meta?.totalDeliveryCharges > 0 && (
            <div style={{ fontSize: 12, color: '#555', borderTop: `1px solid ${border}`, paddingTop: 10 }}>
              📦 Delivery Charges: <span style={{ color: '#f59e0b' }}>Rs {Number(result.meta.totalDeliveryCharges).toLocaleString()}</span>
              {result.meta?.totalWHT > 0 && <> &nbsp;·&nbsp; Taxes: <span style={{ color: '#ef4444' }}>Rs {Number(result.meta.totalWHT + (result.meta.totalGST || 0)).toLocaleString()}</span></>}
            </div>
          )}
          <button onClick={reset} style={{ marginTop: 14, background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '8px 16px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            🔄 Upload Another File
          </button>
        </div>
      )}

      {!result && (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: gold, marginBottom: 20 }}>📁 Upload Settlement File</div>

          {/* Courier picker — 3-col desktop, 1-col mobile */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Courier</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 8 }}>
              {COURIERS.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setCourier(c.id); reset(); }}
                  style={{
                    padding: '10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    fontWeight: 600,
                    background: courier === c.id ? gold + '22' : '#0a0a0a',
                    border: `1px solid ${courier === c.id ? gold : border}`,
                    color: courier === c.id ? gold : '#666',
                  }}
                >
                  {c.label}
                  <div style={{ fontSize: 10, fontWeight: 400, color: courier === c.id ? gold + 'aa' : '#444', marginTop: 2 }}>{c.format}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>File ({selectedCourier?.format})</div>
            <input
              type="file"
              accept={selectedCourier?.accept}
              onChange={e => { setFile(e.target.files[0] || null); setPreview(null); setError(''); }}
              style={{ ...inp, width: '100%', cursor: 'pointer' }}
            />
            {file && <div style={{ fontSize: 11, color: '#22c55e', marginTop: 6, wordBreak: 'break-word' }}>✓ {file.name}</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Reference No (optional)</div>
              <input value={referenceNo} onChange={e => setRefNo(e.target.value)} placeholder="e.g. CPR-LDHDY348060" style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Settlement Date</div>
              <input type="date" value={settledAt} onChange={e => setSettledAt(e.target.value)} style={{ ...inp, width: '100%' }} />
            </div>
          </div>

          {error && (
            <div style={{ background: '#1a0000', border: '1px solid #330000', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#ef4444', marginBottom: 16 }}>
              ❌ {error}
            </div>
          )}

          {preview && (
            <div style={{ background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: gold, marginBottom: 12 }}>📋 Preview — review before applying</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                {[
                  ['💰 Will mark Paid',  preview.to_mark_paid, '#22c55e'],
                  ['↩️ Will mark RTO',   preview.to_mark_rto,  '#ef4444'],
                  ['⏭ Already Paid',   preview.already_paid, '#888'],
                  ['🔍 Not Found',      preview.not_found,    '#f59e0b'],
                  ['⏩ Skip (zero amt)', preview.skipped,      '#555'],
                  ['📋 Total',          preview.total_parsed, gold],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ textAlign: 'center', padding: '8px', background: '#111', borderRadius: 7, border: `1px solid ${border}` }}>
                    <div style={{ fontSize: 9, color: '#555', marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color }}>{val}</div>
                  </div>
                ))}
              </div>
              {preview.sample_paid?.length > 0       && <div style={{ fontSize: 11, color: '#22c55e99', marginBottom: 4 }}>Paid sample: {preview.sample_paid.join(', ')}</div>}
              {preview.sample_rto?.length > 0        && <div style={{ fontSize: 11, color: '#ef444499', marginBottom: 4 }}>RTO sample: {preview.sample_rto.join(', ')}</div>}
              {preview.sample_not_found?.length > 0  && <div style={{ fontSize: 11, color: '#f59e0b99' }}>Not found: {preview.sample_not_found.join(', ')}</div>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            {!preview ? (
              <button
                onClick={handlePreview}
                disabled={!file || loading}
                style={{
                  flex: 1,
                  background: file ? gold + '22' : '#0a0a0a',
                  border: `1px solid ${file ? gold : border}`,
                  color: file ? gold : '#555',
                  borderRadius: 8,
                  padding: '11px',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: file && !loading ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                }}
              >
                {loading ? '⟳ Parsing...' : '🔍 Preview'}
              </button>
            ) : (
              <>
                <button
                  onClick={() => setPreview(null)}
                  disabled={loading}
                  style={{ flex: 1, background: '#0a0a0a', border: `1px solid ${border}`, color: '#888', borderRadius: 8, padding: '11px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  ✕ Back
                </button>
                <button
                  onClick={handleApply}
                  disabled={loading}
                  style={{ flex: 2, background: '#22c55e22', border: '1px solid #22c55e44', color: '#22c55e', borderRadius: 8, padding: '11px', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {loading ? '⟳ Applying...' : `✅ Apply — ${preview.to_mark_paid} Paid + ${preview.to_mark_rto} RTO`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// HISTORY SECTION — past settlements list. Mobile uses cards, desktop uses table.
// ──────────────────────────────────────────────────────────────────────────
function HistorySection({ refresh }) {
  const isMobile = useIsMobile();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('All');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/courier/settlements/upload');
      const d = await r.json();
      setRecords(d.settlements || []);
    } catch (e) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refresh]);

  const filtered = filter === 'All' ? records : records.filter(r => r.courier === filter);
  const courierColor = { PostEx: '#4caf79', Kangaroo: '#9b7fe8', Leopards: '#e87d44' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: gold }}>📋 Settlement History</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['All', 'Leopards', 'Kangaroo', 'PostEx'].map(c => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              style={{
                background: filter === c ? '#1e1e1e' : 'transparent',
                border: `1px solid ${filter === c ? '#2a2a2a' : 'transparent'}`,
                color: filter === c ? gold : '#666',
                borderRadius: 6,
                padding: '5px 12px',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >{c}</button>
          ))}
          <button onClick={load} style={{ background: 'transparent', border: `1px solid ${border}`, color: '#666', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>⟳</button>
        </div>
      </div>

      {loading ? (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 30, textAlign: 'center', color: '#444', fontSize: 13 }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: card, border: `1px dashed ${border}`, borderRadius: 10, padding: 32, textAlign: 'center', color: '#444' }}>
          <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>📦</div>
          <div style={{ fontSize: 13, color: '#888' }}>No records yet</div>
          <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>Upload your first settlement file to begin</div>
        </div>
      ) : isMobile ? (
        // Mobile cards
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(s => (
            <div key={s.id} style={{ background: card, border: `1px solid ${border}`, borderLeft: `3px solid ${courierColor[s.courier] || '#888'}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ color: courierColor[s.courier] || '#888', fontWeight: 700, fontSize: 13 }}>{s.courier}</span>
                    <span style={{ fontSize: 11, color: '#666' }}>{fmtDate(s.invoice_date || s.created_at)}</span>
                  </div>
                  {s.invoice_number && <div style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>Ref: {s.invoice_number}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#22c55e', letterSpacing: -0.3 }}>{fmt(s.net_amount)}</div>
                  <div style={{ fontSize: 10, color: '#555' }}>net</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, paddingTop: 8, borderTop: `1px solid ${border}` }}>
                <div>
                  <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>Parcels</div>
                  <div style={{ fontSize: 13, color: '#ddd', fontWeight: 600 }}>{s.total_parcels || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>COD</div>
                  <div style={{ fontSize: 13, color: '#ddd', fontWeight: 600 }}>{fmt(s.total_cod_collected)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>Charges</div>
                  <div style={{ fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>{fmt(s.courier_charges)}</div>
                </div>
              </div>
              {s.discrepancy_notes && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${border}`, fontSize: 11, color: '#555', wordBreak: 'break-word' }}>
                  {s.discrepancy_notes.split(' | ').slice(0, 3).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        // Desktop table
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${border}` }}>
                {['Date', 'Courier', 'Ref#', 'Parcels', 'Total COD', 'Charges', 'Net', 'Notes'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: `1px solid #111`, background: i % 2 === 0 ? 'transparent' : '#0a0a0a' }}>
                  <td style={{ padding: '10px 14px', color: '#888' }}>{fmtDate(s.invoice_date || s.created_at)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ color: courierColor[s.courier] || '#888', fontWeight: 600, fontSize: 12 }}>{s.courier}</span>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#666', fontSize: 12 }}>{s.invoice_number || '—'}</td>
                  <td style={{ padding: '10px 14px', color: '#ccc' }}>{s.total_parcels || '—'}</td>
                  <td style={{ padding: '10px 14px', color: '#fff', fontWeight: 600 }}>{fmt(s.total_cod_collected)}</td>
                  <td style={{ padding: '10px 14px', color: '#f59e0b' }}>{fmt(s.courier_charges)}</td>
                  <td style={{ padding: '10px 14px', color: '#22c55e', fontWeight: 600 }}>{fmt(s.net_amount)}</td>
                  <td style={{ padding: '10px 14px', color: '#444', fontSize: 11, maxWidth: 200 }}>
                    {s.discrepancy_notes ? s.discrepancy_notes.split(' | ').slice(0, 3).join(' · ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SettlementsTab() {
  const { can } = useUser();
  const canUpload = can('accounts.settlements_upload');

  const [historyRefresh, setHistoryRefresh] = useState(0);
  return (
    <div>
      {canUpload && <UploadSection onDone={() => setHistoryRefresh(k => k + 1)} />}
      <HistorySection refresh={historyRefresh} />
    </div>
  );
}
