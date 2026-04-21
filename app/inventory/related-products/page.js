'use client';

// RS ZEVAR ERP — Related Products Generator + Metafield Pusher
// v3.0 — adds Shopify metafield push section (Day 2 Step 2)

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const AUTO_CONTINUE_DELAY_MS = 15000;     // gen cooldown — Anthropic rate limit window
const PUSH_AUTO_CONTINUE_DELAY_MS = 2000; // push cooldown — Shopify bucket already paced internally

export default function RelatedProductsPage() {
  // ─── Generation state ───
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [running, setRunning] = useState(false);
  const [batchSize, setBatchSize] = useState(8);
  const [autoRun, setAutoRun] = useState(false);
  const [singleId, setSingleId] = useState('');
  const [singleResult, setSingleResult] = useState(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // ─── Push state ───
  const [pushStats, setPushStats] = useState(null);
  const [pushRunning, setPushRunning] = useState(false);
  const [pushBatchSize, setPushBatchSize] = useState(20);
  const [pushAutoRun, setPushAutoRun] = useState(false);
  const [pushCooldownRemaining, setPushCooldownRemaining] = useState(0);
  const [pushSingleId, setPushSingleId] = useState('');
  const [pushSingleResult, setPushSingleResult] = useState(null);

  // ─── Shared log ───
  const [log, setLog] = useState([]);

  const addLog = useCallback((msg, type = 'info') => {
    setLog(prev => [{ ts: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 120));
  }, []);

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const [gen, push] = await Promise.all([
        fetch('/api/products/related/generate-batch').then(r => r.json()),
        fetch('/api/products/metafields/push-related-batch').then(r => r.json()),
      ]);
      if (gen.success) setStats(gen);
      if (push.success) setPushStats(push);
    } catch (e) { console.error(e); }
    setLoadingStats(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const t = setInterval(() => setCooldownRemaining(x => Math.max(0, x - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldownRemaining]);

  useEffect(() => {
    if (pushCooldownRemaining <= 0) return;
    const t = setInterval(() => setPushCooldownRemaining(x => Math.max(0, x - 1)), 1000);
    return () => clearInterval(t);
  }, [pushCooldownRemaining]);

  // ─── GENERATION: Batch run ───
  const runBatch = useCallback(async () => {
    if (running) return;
    setRunning(true);
    addLog(`[gen] Starting batch of ${batchSize}...`, 'info');
    try {
      const res = await fetch('/api/products/related/generate-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_size: batchSize, concurrency: 2 }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(
          `[gen] ✓ ${data.processed} done, ${data.failed} failed | AI calls: ${data.ai_calls} | Rs ${data.batch_cost_pkr} | ${(data.duration_ms / 1000).toFixed(1)}s | ${data.remaining} pending`,
          'ok'
        );
        if (data.failed > 0 && data.failure_reasons) {
          for (const [reason, count] of Object.entries(data.failure_reasons)) {
            addLog(`[gen]   ⚠ ${count}× "${reason}"`, 'warn');
          }
        }
        await fetchStats();
        if (autoRun && data.remaining > 0) {
          setCooldownRemaining(AUTO_CONTINUE_DELAY_MS / 1000);
          setTimeout(() => runBatch(), AUTO_CONTINUE_DELAY_MS);
          setRunning(false);
          return;
        }
      } else {
        addLog(`[gen] ✗ ${data.error}`, 'err');
      }
    } catch (e) {
      addLog(`[gen] ✗ ${e.message}`, 'err');
    }
    setRunning(false);
  }, [batchSize, running, autoRun, fetchStats, addLog]);

  // ─── GENERATION: Single test ───
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

  // ─── PUSH: Batch run ───
  const runPushBatch = useCallback(async () => {
    if (pushRunning) return;
    setPushRunning(true);
    addLog(`[push] Starting batch of ${pushBatchSize}...`, 'info');
    try {
      const res = await fetch('/api/products/metafields/push-related-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_size: pushBatchSize }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(
          `[push] ✓ ${data.processed} pushed, ${data.failed} failed | ${(data.duration_ms / 1000).toFixed(1)}s | ${data.remaining} pending`,
          'ok'
        );
        if (data.failed > 0 && data.failure_reasons) {
          for (const [reason, count] of Object.entries(data.failure_reasons)) {
            addLog(`[push]   ⚠ ${count}× "${reason}"`, 'warn');
          }
        }
        await fetchStats();
        if (pushAutoRun && data.remaining > 0) {
          setPushCooldownRemaining(PUSH_AUTO_CONTINUE_DELAY_MS / 1000);
          setTimeout(() => runPushBatch(), PUSH_AUTO_CONTINUE_DELAY_MS);
          setPushRunning(false);
          return;
        }
      } else {
        addLog(`[push] ✗ ${data.error}`, 'err');
      }
    } catch (e) {
      addLog(`[push] ✗ ${e.message}`, 'err');
    }
    setPushRunning(false);
  }, [pushBatchSize, pushRunning, pushAutoRun, fetchStats, addLog]);

  // ─── PUSH: Single test ───
  const runPushSingle = async () => {
    if (!pushSingleId.trim()) return;
    setPushSingleResult({ loading: true });
    try {
      const res = await fetch('/api/products/metafields/push-related-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopify_product_id: pushSingleId.trim() }),
      });
      const data = await res.json();
      setPushSingleResult(data);
      if (data.success) await fetchStats();
    } catch (e) {
      setPushSingleResult({ success: false, error: e.message });
    }
  };

  const cardStyle = { padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' };
  const sectionStyle = { ...cardStyle, marginBottom: 20 };
  const labelStyle = { fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 };
  const valueStyle = (color) => ({ fontSize: 26, fontWeight: 700, color, marginTop: 6, fontFamily: 'monospace' });

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/inventory" style={{ fontSize: 12, color: 'var(--text3)', textDecoration: 'none' }}>← Inventory</Link>
        <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 600, color: 'var(--gold)', letterSpacing: 1, marginTop: 8 }}>Related Products Generator</h1>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>AI picks 4 best companion products → Shopify metafield → storefront cross-sell carousel.</p>
      </div>

      {/* Generation stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        {[
          { label: 'Total Products', value: stats?.total_products ?? '—', color: 'var(--text)' },
          { label: 'Eligible (active + in stock)', value: stats?.eligible_products ?? '—', color: 'var(--text2)' },
          { label: 'With Related Picks', value: stats?.with_related ?? '—', color: '#4ade80' },
          { label: 'Pending Gen', value: stats?.pending ?? '—', color: '#fbbf24' },
        ].map(s => (
          <div key={s.label} style={cardStyle}>
            <div style={labelStyle}>{s.label}</div>
            <div style={valueStyle(s.color)}>{loadingStats ? '...' : s.value}</div>
          </div>
        ))}
      </div>

      {stats && stats.eligible_products > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>
            <span>Generation: {stats.with_related} / {stats.eligible_products} done ({stats.progress_pct}%)</span>
            <span>AI spend: ${stats.total_cost_usd_so_far?.toFixed(4) || '0.0000'} (≈ Rs {Math.round((stats.total_cost_usd_so_far || 0) * 285)})</span>
          </div>
          <div style={{ height: 8, background: 'var(--bg-card)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div style={{ width: `${stats.progress_pct}%`, height: '100%', background: 'linear-gradient(90deg, var(--gold), #4ade80)', transition: 'width 0.5s' }} />
          </div>
        </div>
      )}

      {/* Push stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
        {[
          { label: 'With Picks (ready)', value: pushStats?.with_picks ?? '—', color: 'var(--text2)' },
          { label: 'Metafield Pushed', value: pushStats?.pushed ?? '—', color: '#60a5fa' },
          { label: 'Pending Push', value: pushStats?.pending ?? '—', color: '#fbbf24' },
        ].map(s => (
          <div key={s.label} style={cardStyle}>
            <div style={labelStyle}>{s.label}</div>
            <div style={valueStyle(s.color)}>{loadingStats ? '...' : s.value}</div>
          </div>
        ))}
      </div>

      {pushStats && pushStats.with_picks > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>
            <span>Shopify push: {pushStats.pushed} / {pushStats.with_picks} done ({pushStats.progress_pct}%)</span>
            <span>namespace: rszevar.related_products (list.product_reference)</span>
          </div>
          <div style={{ height: 8, background: 'var(--bg-card)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div style={{ width: `${pushStats.progress_pct}%`, height: '100%', background: 'linear-gradient(90deg, #60a5fa, #4ade80)', transition: 'width 0.5s' }} />
          </div>
        </div>
      )}

      {/* Generation batch */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>① AI Generation — Related Picks</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--text2)' }}>
            Batch size:&nbsp;
            <input type="number" min="1" max="15" value={batchSize} onChange={e => setBatchSize(parseInt(e.target.value) || 8)}
              style={{ width: 60, padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'inherit' }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} />
            Auto-continue (15s cooldown)
          </label>
          <button onClick={runBatch} disabled={running || cooldownRemaining > 0 || !stats?.pending}
            style={{ padding: '10px 20px', background: (running || cooldownRemaining > 0) ? 'var(--border)' : 'var(--gold)', color: (running || cooldownRemaining > 0) ? 'var(--text3)' : 'var(--bg)', border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: (running || cooldownRemaining > 0) ? 'wait' : 'pointer' }}>
            {running ? 'Processing...' : cooldownRemaining > 0 ? `Cooldown ${cooldownRemaining}s...` : `Run next ${batchSize}`}
          </button>
          <button onClick={fetchStats} disabled={loadingStats}
            style={{ padding: '10px 16px', background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>
            Refresh
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
          ~Rs 3-4 per product · Anthropic Claude API · 15s cooldown between batches
        </div>
      </div>

      {/* Push batch */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>② Shopify Metafield Push</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--text2)' }}>
            Batch size:&nbsp;
            <input type="number" min="1" max="40" value={pushBatchSize} onChange={e => setPushBatchSize(parseInt(e.target.value) || 20)}
              style={{ width: 60, padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'inherit' }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={pushAutoRun} onChange={e => setPushAutoRun(e.target.checked)} />
            Auto-continue (2s cooldown)
          </label>
          <button onClick={runPushBatch} disabled={pushRunning || pushCooldownRemaining > 0 || !pushStats?.pending}
            style={{ padding: '10px 20px', background: (pushRunning || pushCooldownRemaining > 0) ? 'var(--border)' : '#60a5fa', color: (pushRunning || pushCooldownRemaining > 0) ? 'var(--text3)' : 'var(--bg)', border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: (pushRunning || pushCooldownRemaining > 0) ? 'wait' : 'pointer' }}>
            {pushRunning ? 'Pushing...' : pushCooldownRemaining > 0 ? `Cooldown ${pushCooldownRemaining}s...` : `Push next ${pushBatchSize}`}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
          Shopify REST · 2 req/sec pacing · ~1-2 sec per product · idempotent (skips already-pushed)
        </div>
      </div>

      {/* Single tests (shared) */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Single Product Test</div>

        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>① Generate picks (AI)</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input type="text" placeholder="shopify_product_id (e.g. 7234567890123)" value={singleId} onChange={e => setSingleId(e.target.value)}
            style={{ flex: 1, padding: '10px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'monospace', fontSize: 12 }} />
          <button onClick={runSingle} disabled={!singleId.trim() || singleResult?.loading}
            style={{ padding: '10px 20px', background: 'var(--gold)', color: 'var(--bg)', border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
            {singleResult?.loading ? '...' : 'Generate'}
          </button>
        </div>
        {singleResult && !singleResult.loading && (
          <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg2)', borderRadius: 'var(--radius)', fontSize: 12 }}>
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
              <div style={{ color: '#f87171' }}>✗ {singleResult.error}</div>
            )}
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>② Push to Shopify (metafield)</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" placeholder="shopify_product_id (must have picks)" value={pushSingleId} onChange={e => setPushSingleId(e.target.value)}
            style={{ flex: 1, padding: '10px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'monospace', fontSize: 12 }} />
          <button onClick={runPushSingle} disabled={!pushSingleId.trim() || pushSingleResult?.loading}
            style={{ padding: '10px 20px', background: '#60a5fa', color: 'var(--bg)', border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
            {pushSingleResult?.loading ? '...' : 'Push'}
          </button>
        </div>
        {pushSingleResult && !pushSingleResult.loading && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg2)', borderRadius: 'var(--radius)', fontSize: 12 }}>
            {pushSingleResult.success ? (
              pushSingleResult.skipped ? (
                <div style={{ color: '#fbbf24' }}>⊘ {pushSingleResult.reason} (pushed at {new Date(pushSingleResult.pushed_at).toLocaleString()})</div>
              ) : (
                <div style={{ color: '#4ade80', fontWeight: 600 }}>✓ {pushSingleResult.title} — metafield {pushSingleResult.created ? 'created' : 'updated'} (id: {pushSingleResult.metafield_id}, {pushSingleResult.pushed_ids?.length || 0} picks, {pushSingleResult.duration_ms}ms)</div>
              )
            ) : (
              <div style={{ color: '#f87171' }}>✗ {pushSingleResult.error}</div>
            )}
          </div>
        )}
      </div>

      {/* Activity Log */}
      {log.length > 0 && (
        <div style={cardStyle}>
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
