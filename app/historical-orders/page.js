// ============================================================================
// RS ZEVAR ERP — Historical Orders Import — Admin UI
// /historical-orders
// May 5 2026
// ----------------------------------------------------------------------------
// PURPOSE:
//   Super admin uploads a Shopify CSV export → server parses + bulk-inserts
//   into historical_orders. Active workflow remains 100% untouched.
//
// FLOW:
//   1. User selects .csv file (extracted from Shopify export zip)
//   2. Browser uploads CSV directly to Supabase Storage (bypasses Vercel)
//   3. Browser triggers /api/historical-orders/import with storage_path
//   4. Server downloads, parses, transforms, bulk-inserts in batches of 500
//   5. UI shows results
//
// AUTH: super_admin only
// ============================================================================

'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@/context/UserContext';
import { createClient as createAuthClient } from '@/lib/supabase/client';

const gold    = '#c9a96e';
const danger  = '#ef4444';
const warning = '#f59e0b';
const success = '#22c55e';

const fmtNum = (n) => Number(n || 0).toLocaleString('en-PK');
const fmtMs = (ms) => ms < 1000 ? `${ms}ms` : `${(ms/1000).toFixed(1)}s`;
const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

export default function HistoricalOrdersImportPage() {
  const { profile, isSuperAdmin } = useUser();

  const [file, setFile]     = useState(null);
  const [stage, setStage]   = useState('idle');  // idle | uploading | importing | done | error
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [stats, setStats]   = useState(null);

  // Load current archive count on mount
  useEffect(() => {
    if (!isSuperAdmin) return;
    (async () => {
      try {
        const supabase = createAuthClient();
        const { count } = await supabase
          .from('historical_orders')
          .select('*', { count: 'exact', head: true });
        setStats({ archive_count: count || 0 });
      } catch {}
    })();
  }, [isSuperAdmin]);

  // Auth gate
  if (profile && !isSuperAdmin) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{
          display: 'inline-block', padding: '16px 22px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5', borderRadius: 8, fontSize: 14,
        }}>⚠ Yeh page sirf super admin ke liye hai</div>
      </div>
    );
  }

  const handleImport = async () => {
    if (!file) return;
    setStage('uploading');
    setResult(null);
    setProgress({ step: 'CSV upload to Supabase Storage…', detail: fmtMB(file.size) });

    const supabase = createAuthClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = `imports/${Date.now()}_${safeName}`;

    // 1. Direct browser → Supabase Storage upload (no Vercel)
    const { error: uplErr } = await supabase.storage
      .from('historical-imports')
      .upload(path, file, {
        upsert: false,
        contentType: 'text/csv',
      });

    if (uplErr) {
      setStage('error');
      setProgress(null);
      setResult({ success: false, error: `Storage upload failed: ${uplErr.message}` });
      return;
    }

    // 2. Trigger server-side parse + insert
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

      // Refresh archive count
      const { count } = await supabase
        .from('historical_orders')
        .select('*', { count: 'exact', head: true });
      setStats({ archive_count: count || 0 });
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
    <div style={{ padding: '28px 28px 60px', maxWidth: 880, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, margin: 0, color: '#fff', letterSpacing: '-0.01em' }}>
          📦 Import Historical Orders
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text2)', margin: '6px 0 0' }}>
          Shopify CSV export upload karo. Server khud parse karega + bulk insert.
          Active workflow se bilkul alag — read-only archive.
        </p>
      </div>

      {/* Stats card */}
      {stats && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 18px', marginBottom: 22,
        }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, letterSpacing: 0.7 }}>
            CURRENT ARCHIVE COUNT
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, color: gold, marginTop: 4 }}>
            {fmtNum(stats.archive_count)} <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 400 }}>orders</span>
          </div>
        </div>
      )}

      {/* Upload card */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 22,
      }}>
        {stage === 'idle' && (
          <>
            <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
              <strong style={{ color: '#fff' }}>Shopify CSV file select karo</strong> (zip se extract karke)
            </div>

            <label style={{
              display: 'block', cursor: 'pointer',
              border: `2px dashed ${file ? gold : 'var(--border)'}`,
              borderRadius: 10, padding: '32px 20px', textAlign: 'center',
              background: file ? 'rgba(201,169,110,0.05)' : 'transparent',
              transition: 'all 0.15s',
            }}>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ display: 'none' }}
              />
              {file ? (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                  <div style={{ fontSize: 14, color: '#fff', fontWeight: 500, marginBottom: 4 }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {fmtMB(file.size)} · click to change
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>📁</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                    Click karke .csv file select karo
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>
                    Tip: zip ko pehle extract karo (Right-click → Extract All)
                  </div>
                </>
              )}
            </label>

            <button
              onClick={handleImport}
              disabled={!file}
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
            <div style={{ fontSize: 14, color: '#fff', fontWeight: 500, marginBottom: 6 }}>
              {progress?.step || 'Working…'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              {progress?.detail || ''}
            </div>
          </div>
        )}

        {stage === 'done' && result?.success && (
          <div>
            <div style={{
              padding: '14px 16px', marginBottom: 14,
              background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 14, color: success, fontWeight: 600, marginBottom: 4 }}>
                ✓ Import successful
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                Duration: {fmtMs(result.duration_ms || 0)}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
              <ResultCard label="CSV rows" value={fmtNum(result.total_rows_in_csv)} color="var(--text2)" />
              <ResultCard label="Unique orders" value={fmtNum(result.unique_orders)} color="var(--text1)" />
              <ResultCard label="Inserted" value={fmtNum(result.inserted)} color={success} />
              <ResultCard label="Skipped" value={fmtNum(result.skipped_duplicates)} color={warning} />
            </div>

            {result.errors?.length > 0 && (
              <div style={{
                padding: '12px 14px',
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 8, marginBottom: 14,
              }}>
                <div style={{ fontSize: 12, color: danger, fontWeight: 600, marginBottom: 6 }}>
                  ⚠ {result.errors.length} batch error{result.errors.length !== 1 ? 's' : ''}
                </div>
                <pre style={{
                  fontSize: 10, color: 'var(--text2)', margin: 0,
                  maxHeight: 120, overflow: 'auto',
                  fontFamily: 'monospace', whiteSpace: 'pre-wrap',
                }}>{JSON.stringify(result.errors, null, 2)}</pre>
              </div>
            )}

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
              <div style={{ fontSize: 14, color: danger, fontWeight: 600, marginBottom: 4 }}>
                ✗ Import failed
              </div>
              <div style={{ fontSize: 12, color: '#fca5a5', wordBreak: 'break-word' }}>
                {result?.error || 'Unknown error'}
              </div>
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

      {/* Tips */}
      <div style={{
        marginTop: 18, padding: 16,
        background: 'rgba(201,169,110,0.05)', border: '1px solid rgba(201,169,110,0.2)',
        borderRadius: 8, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7,
      }}>
        <div style={{ color: gold, fontWeight: 600, marginBottom: 6 }}>📌 Notes:</div>
        <div>• Same CSV dobara upload karne se kuch nahi hota — duplicates auto-skip (UNIQUE on order_number)</div>
        <div>• Agar order_number active orders me already hai → DB trigger silently skip karega (Rule 1)</div>
        <div>• Active workflow (dispatch, packing, courier, credits) ko yeh bilkul disturb nahi karta</div>
        <div>• Customer khaata pe combined order history aa jayegi (active + archive)</div>
        <div>• File size: 50MB tak upload kar sakte ho ek baar me. Bigger zips multiple CSVs me split karke export karo.</div>
      </div>
    </div>
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
