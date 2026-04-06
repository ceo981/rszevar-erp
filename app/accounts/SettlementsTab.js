'use client';
// ============================================================
// SETTLEMENT UPLOAD COMPONENT
// Replace your existing SettlementsTab in app/accounts/page.js
// with this full updated version
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';

const COURIERS = ['PostEx', 'Kangaroo', 'Leopards'];

function fmt(n) {
  if (!n && n !== 0) return '—';
  return 'Rs. ' + parseFloat(n).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}

const inputStyle = {
  width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a',
  borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};
const selectStyle = {
  background: '#111', border: '1px solid #222', borderRadius: 8,
  padding: '8px 12px', color: '#888', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
const btnStyle = {
  background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8,
  padding: '8px 16px', color: '#c9a96e', fontSize: 13, cursor: 'pointer',
  fontFamily: 'inherit', fontWeight: 600, transition: 'all 0.15s',
};
const labelStyle = {
  display: 'block', fontSize: 11, color: '#555', marginBottom: 6,
  fontFamily: 'monospace', letterSpacing: 0.5,
};
const tdStyle = { padding: '12px 16px', fontSize: 13, color: '#888', verticalAlign: 'middle' };

// ── UPLOAD ZONE ───────────────────────────────────────────────
function UploadZone({ onUploadComplete }) {
  const [courier, setCourier] = useState('Leopards');
  const [file, setFile] = useState(null);
  const [ref, setRef] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    setResult(null);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('courier', courier);
    fd.append('settlement_ref', ref);
    fd.append('settled_at', date);

    try {
      const res = await fetch('/api/accounts/settlements/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) {
        setResult(data);
        setFile(null);
        if (fileRef.current) fileRef.current.value = '';
        onUploadComplete?.();
      } else {
        setError(data.error || 'Upload failed');
      }
    } catch (e) {
      setError(e.message);
    }
    setUploading(false);
  };

  const courierColors = { PostEx: '#4caf79', Kangaroo: '#9b7fe8', Leopards: '#e87d44' };

  return (
    <div style={{ background: '#111', border: '1px solid #c9a96e33', borderRadius: 12, padding: 24, marginBottom: 20 }}>
      <div style={{ fontSize: 14, color: '#c9a96e', fontWeight: 700, marginBottom: 20 }}>
        📤 Upload Settlement File
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
        {/* Courier Select */}
        <div>
          <label style={labelStyle}>Courier</label>
          <select value={courier} onChange={e => setCourier(e.target.value)} style={inputStyle}>
            {COURIERS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        {/* Ref */}
        <div>
          <label style={labelStyle}>Settlement Ref# (optional)</label>
          <input placeholder="e.g. CPR-R0GC3578113" value={ref} onChange={e => setRef(e.target.value)} style={inputStyle} />
        </div>

        {/* Date */}
        <div>
          <label style={labelStyle}>Payment Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
        </div>
      </div>

      {/* File Drop Zone */}
      <div
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${file ? '#c9a96e' : '#2a2a2a'}`,
          borderRadius: 10, padding: '28px 20px', textAlign: 'center',
          cursor: 'pointer', marginBottom: 16, transition: 'border 0.2s',
          background: file ? '#1a1500' : '#0d0d0d',
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => setFile(e.target.files?.[0] || null)}
        />
        {file ? (
          <div>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
            <div style={{ color: '#c9a96e', fontWeight: 600, fontSize: 14 }}>{file.name}</div>
            <div style={{ color: '#555', fontSize: 12, marginTop: 4 }}>
              {(file.size / 1024).toFixed(1)} KB — click to change
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
            <div style={{ color: '#555', fontSize: 13 }}>Click to upload PDF or Excel file</div>
            <div style={{ color: '#333', fontSize: 11, marginTop: 4 }}>
              Leopards PDF · PostEx CPR PDF · Kangaroo Excel
            </div>
          </div>
        )}
      </div>

      {/* Upload Button */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          onClick={upload}
          disabled={!file || uploading}
          style={{
            ...btnStyle,
            background: file && !uploading ? '#c9a96e' : '#1e1e1e',
            color: file && !uploading ? '#000' : '#444',
            cursor: file && !uploading ? 'pointer' : 'not-allowed',
            padding: '10px 24px',
          }}
        >
          {uploading ? '⏳ Processing...' : '🚀 Upload & Match Orders'}
        </button>
        <div style={{ fontSize: 12, color: '#444' }}>
          System will auto-match ZEVAR order IDs and mark as settled
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginTop: 16, background: '#3a1e1e', border: '1px solid #e8444433', borderRadius: 8, padding: '12px 16px', color: '#e84444', fontSize: 13 }}>
          ❌ {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{ marginTop: 16, background: '#1e3a2e', border: '1px solid #4caf7933', borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 14, color: '#4caf79', fontWeight: 700, marginBottom: 14 }}>
            ✅ Settlement Processed!
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Total Parsed', value: result.summary.total_parsed, color: '#ddd' },
              { label: 'Matched', value: result.summary.matched, color: '#4caf79' },
              { label: 'Unmatched', value: result.summary.unmatched, color: result.summary.unmatched > 0 ? '#e87d44' : '#555' },
              { label: 'Amount', value: fmt(result.summary.total_amount), color: '#c9a96e' },
            ].map(s => (
              <div key={s.label} style={{ background: '#0d2a1e', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#3a8a5e', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {result.summary.unmatched > 0 && (
            <div style={{ fontSize: 12, color: '#e87d44', background: '#2a1e0d', borderRadius: 6, padding: '8px 12px' }}>
              ⚠️ {result.summary.unmatched} orders not found in ERP — may not be synced from Shopify yet. Run "Sync Orders" first.
            </div>
          )}

          {result.matched_orders?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: '#3a8a5e', marginBottom: 8 }}>Matched Orders (first 10):</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {result.matched_orders.slice(0, 10).map(o => (
                  <span key={o.name} style={{ background: '#0a1a12', border: '1px solid #2a5a3e', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#4caf79' }}>
                    {o.name}
                  </span>
                ))}
                {result.matched_orders.length > 10 && (
                  <span style={{ fontSize: 11, color: '#3a6a4e', padding: '2px 8px' }}>
                    +{result.matched_orders.length - 10} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SETTLEMENTS LIST ──────────────────────────────────────────
function SettlementsList({ refresh }) {
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [courier, setCourier] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (courier) params.set('courier', courier);
    params.set('limit', '50');
    const res = await fetch(`/api/accounts/settlements?${params}`);
    const d = await res.json();
    setSettlements(d.settlements || []);
    setLoading(false);
  }, [courier]);

  useEffect(() => { load(); }, [load, refresh]);

  const del = async (id) => {
    if (!confirm('Delete this settlement?')) return;
    await fetch(`/api/accounts/settlements?id=${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select value={courier} onChange={e => setCourier(e.target.value)} style={selectStyle}>
          <option value="">All Couriers</option>
          {COURIERS.map(c => <option key={c}>{c}</option>)}
        </select>
        <span style={{ fontSize: 13, color: '#555', alignSelf: 'center' }}>
          {settlements.length} records
        </span>
      </div>

      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
              {['Date', 'Courier', 'Ref#', 'Orders', 'Amount', 'Note', ''].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#444' }}>Loading...</td></tr>
            ) : settlements.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#444' }}>No settlements yet — upload a file above</td></tr>
            ) : settlements.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                <td style={tdStyle}>{fmtDate(s.settled_at)}</td>
                <td style={tdStyle}>
                  <span style={{
                    background: s.courier_name === 'PostEx' ? '#1e3a2e' : s.courier_name === 'Kangaroo' ? '#2a1e3a' : '#3a2a1e',
                    color: s.courier_name === 'PostEx' ? '#4caf79' : s.courier_name === 'Kangaroo' ? '#9b7fe8' : '#e87d44',
                    padding: '2px 8px', borderRadius: 4, fontSize: 11,
                  }}>
                    {s.courier_name}
                  </span>
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#666', fontSize: 12 }}>{s.settlement_ref || '—'}</td>
                <td style={tdStyle}>{s.orders_count || '—'}</td>
                <td style={{ ...tdStyle, color: '#4caf79', fontWeight: 600 }}>{fmt(s.amount)}</td>
                <td style={{ ...tdStyle, color: '#555', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.note || '—'}</td>
                <td style={tdStyle}>
                  <button onClick={() => del(s.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16 }}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── MAIN EXPORT ───────────────────────────────────────────────
export default function SettlementsTab() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div>
      <UploadZone onUploadComplete={() => setRefreshKey(k => k + 1)} />
      <SettlementsList refresh={refreshKey} />
    </div>
  );
}
