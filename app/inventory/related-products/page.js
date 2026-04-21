'use client';

// RS ZEVAR ERP — Related Products Generator
// v2.2 — 15s cooldown between auto-batches + failure reason surfacing

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const AUTO_CONTINUE_DELAY_MS = 15000;  // 15 seconds between auto-batches — lets rate limit window recover

export default function RelatedProductsPage() {
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [running, setRunning] = useState(false);
  const [batchSize, setBatchSize] = useState(8);
  const [autoRun, setAutoRun] = useState(false);
  const [log, setLog] = useState([]);
  const [singleId, setSingleId] = useState('');
  const [singleResult, setSingleResult] = useState(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch('/api/products/related/generate-batch');
      const data = await res.json();
      if (data.success) setStats(data);
    } catch (e) { console.error(e); }
    setLoadingStats(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Cooldown countdown effect
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const t = setInterval(() => setCooldownRemaining(x => Math.max(0, x - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldownRemaining]);

  const runBatch = useCallback(async () => {
    if (running) return;
    setRunning(true);
    const startedAt = new Date();
    setLog(prev => [{ ts: startedAt.toLocaleTimeString(), msg: `Starting batch of ${batchSize}...`, type: 'info' }, ...prev].slice(0, 80));
    try {
      const res = await fetch('/api/products/related/generate-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_size: batchSize, concurrency: 2 }),
      });
      const data = await res.json();
      const finishedAt = new Date();
      if (data.success) {
        const mainLine = `✓ ${data.processed} done, ${data.failed} failed | AI calls: ${data.ai_calls} | Rs ${data.batch_cost_pkr} | ${(data.duration_ms / 1000).toFixed(1)}s | ${data.remaining} pending`;
        setLog(prev => [{ ts: finishedAt.toLocaleTimeString(), msg: mainLine, type: 'ok' }, ...prev].slice(0, 80));
        // If any failures, log the grouped reasons
        if (data.failed > 0 && data.failure_reasons) {
          for (const [reason, count] of Object.entries(data.failure_reasons)) {
            setLog(prev => [{ ts: finishedAt.toLocaleTimeString(), msg: `  ⚠ ${count}× "${reason}"`, type: 'warn' }, ...prev].slice(0, 80));
          }
        }
        await fetchStats();
        if (autoRun && data.remaining > 0) {
          // Cool down 15s between batches — allows Anthropic rate limit window to recover
          setCooldownRemaining(AUTO_CONTINUE_DELAY_MS / 1000);
          setTimeout(() => runBatch(), AUTO_CONTINUE_DELAY_MS);
          setRunning(false);
          return;
        }
      } else {
        setLog(prev => [{ ts: finishedAt.toLocaleTimeString(), msg: `✗ ${data.error}`, type: 'err' }, ...prev].slice(0, 80));
      }
    } catch (e) {
      setLog(prev => [{ ts: new Date().toLocaleTimeString(), msg: `✗ ${e.message}`, type: 'err' }, ...prev].slice(0, 80));
    }
    setRunning(false);
  }, [batchSize, running, autoRun, fetchStats]);

  const runSingle = async () => {
    if (!singleId.trim()) return;
    setSingleResult({ loading: true });
    try {
      const res = await fetch('/api/products/related/generate-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopify_product_id: singleId.trim() }),
      });
      const data = await res.json();
      setSingleResult(data);
      if (data.success) await fetchStats();
    } catch (e) {
      setSingleResult({ success: false, error: e.message });
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/inventory" style={{ fontSize: 12, color: 'var(--text3)', textDecoration: 'none' }}>← Inventory</Link>
        <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 600, color: 'var(--gold)', letterSpacing: 1, marginTop: 8 }}>Related Products Generator</h1>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>AI picks 4 best companion products for each item — drives "Complete the Look" cross-sell on storefront.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Products', value: stats?.total_products ?? '—', color: 'var(--text)' },
          { label: 'Eligible (active + in stock)', value: stats?.eligible_products ?? '—', color: 'var(--text2)' },
          { label: 'With Related Picks', value: stats?.with_related ?? '—', color: '#4ade80' },
          { label: 'Pending', value: stats?.pending ?? '—', color: '#fbbf24' },
        ].map(s => (
          <div key={s.label} style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: s.color, marginTop: 6, fontFamily: 'monospace' }}>{loadingStats ? '...' : s.value}</div>
          </div>
        ))}
      </div>

      {stats && stats.eligible_products > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>
            <span>{stats.with_related} / {stats.eligible_products} done ({stats.progress_pct}%)</span>
            <span>Total spend so far: ${stats.total_cost_usd_so_far?.toFixed(4) || '0.0000'} (≈ Rs {Math.round((stats.total_cost_usd_so_far || 0) * 285)})</span>
          </div>
          <div style={{ height: 8, background: 'var(--bg-card)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div style={{ width: `${stats.progress_pct}%`, height: '100%', background: 'linear-gradient(90deg, var(--gold), #4ade80)', transition: 'width 0.5s' }} />
          </div>
        </div>
      )}

      <div style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Batch Generation</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--text2)' }}>
            Batch size:&nbsp;
            <input type="number" min="1" max="15" value={batchSize} onChange={e => setBatchSize(parseInt(e.target.value) || 8)}
              style={{ width: 60, padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'inherit' }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} />
            Auto-continue until done (15s cooldown between batches)
          </label>
          <button onClick={runBatch} disabled={running || cooldownRemaining > 0 || !stats?.pending}
            style={{ padding: '10px 20px', background: (running || cooldownRemaining > 0) ? 'var(--border)' : 'var(--gold)', color: (running || cooldownRemaining > 0) ? 'var(--text3)' : 'var(--bg)', border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: (running || cooldownRemaining > 0) ? 'wait' : 'pointer' }}>
            {running ? 'Processing...' : cooldownRemaining > 0 ? `Cooldown ${cooldownRemaining}s...` : `Run next ${batchSize}`}
          </button>
          <button onClick={fetchStats} disabled={loadingStats}
            style={{ padding: '10px 16px', background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>
            Refresh stats
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
          ~Rs 3-4 per product. Full catalog estimated Rs 2,500-3,500 total. Conservative batch size keeps success rate 95%+.
        </div>
      </div>

      <div style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Single Product Test</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" placeholder="shopify_product_id (e.g. 7234567890123)" value={singleId} onChange={e => setSingleId(e.target.value)}
            style={{ flex: 1, padding: '10px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'monospace', fontSize: 12 }} />
          <button onClick={runSingle} disabled={!singleId.trim() || singleResult?.loading}
            style={{ padding: '10px 20px', background: 'var(--gold)', color: 'var(--bg)', border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
            {singleResult?.loading ? '...' : 'Generate'}
          </button>
        </div>
        {singleResult && !singleResult.loading && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg2)', borderRadius: 'var(--radius)', fontSize: 12 }}>
            {singleResult.success ? (
              <>
                <div style={{ color: '#4ade80', fontWeight: 600, marginBottom: 8 }}>✓ {singleResult.target_title} — {singleResult.picks?.length || 0} picks ({singleResult.ai_used ? 'AI' : 'rule-based'}, {singleResult.duration_ms}ms, ${singleResult.cost_usd?.toFixed(4) || '0'})</div>
                {(singleResult.picks || []).map((p, i) => (
                  <div key={i} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      {p.image_snapshot && <img src={p.image_snapshot} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />}
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'var(--text)', fontWeight: 500 }}>{p.title_snapshot || p.shopify_product_id}</div>
                        <div style={{ color: 'var(--text3)', fontSize: 11, marginTop: 2, fontStyle: 'italic' }}>{p.rationale}</div>
                      </div>
                      <div style={{ color: 'var(--gold)', fontWeight: 600, whiteSpace: 'nowrap' }}>Rs {p.price_snapshot?.toLocaleString() || '—'}</div>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div style={{ color: 'var(--red)' }}>✗ {singleResult.error}</div>
            )}
          </div>
        )}
      </div>

      {log.length > 0 && (
        <div style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Activity Log</div>
          <div style={{ maxHeight: 400, overflowY: 'auto', fontSize: 12, fontFamily: 'monospace' }}>
            {log.map((l, i) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', color: l.type === 'ok' ? '#4ade80' : l.type === 'err' ? '#f87171' : l.type === 'warn' ? '#fbbf24' : 'var(--text3)' }}>
                <span style={{ color: 'var(--text3)' }}>{l.ts}</span>&nbsp;&nbsp;{l.msg}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
