'use client';
import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@/context/UserContext';

const gold = '#c9a96e';
const dark = '#0f0f0f';
const card = '#141414';
const border = '#222';

// ─── Helpers ──────────────────────────────────────────────────
const fmt = n => `Rs ${Number(n || 0).toLocaleString()}`;
const timeAgo = iso => {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const statusColor = s => {
  if (s === 'delivered') return '#22c55e';
  if (s === 'rto') return '#ef4444';
  if (s === 'in_transit') return gold;
  return '#555';
};

const statusLabel = s => ({
  delivered: 'Delivered',
  rto: 'RTO',
  in_transit: 'In Transit',
  booked: 'Booked',
}[s] || s);

// ─── Stat Card ────────────────────────────────────────────────
function StatCard({ label, value, sub, color, big }) {
  return (
    <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: big ? '20px 24px' : '16px 20px' }}>
      <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: big ? 28 : 22, fontWeight: 700, color: color || '#fff' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── Sync Tab ─────────────────────────────────────────────────
function SyncTab() {
  const [data, setData] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/courier/sync');
      const d = await r.json();
      setData(d);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runSync = async (courier = null) => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await fetch('/api/courier/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courier }),
      });
      const d = await r.json();
      setSyncResult(d);
      load();
    } catch (e) {
      setSyncResult({ error: e.message });
    }
    setSyncing(false);
  };

  if (loading) return <div style={{ color: '#444', padding: 40, textAlign: 'center' }}>Loading...</div>;

  const todayDeliveredCOD = (data?.todayDelivered || []).reduce((a, r) => a + parseFloat(r.cod_amount || 0), 0);
  const todayRTOCOD = (data?.todayRTO || []).reduce((a, r) => a + parseFloat(r.cod_amount || 0), 0);

  const activeByCourier = {};
  for (const s of data?.activeShipments || []) {
    if (!activeByCourier[s.courier_name]) activeByCourier[s.courier_name] = 0;
    activeByCourier[s.courier_name]++;
  }

  return (
    <div>
      {/* Sync Controls */}
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#fff', marginBottom: 4 }}>Courier Sync</div>
            <div style={{ fontSize: 12, color: '#555' }}>
              Last sync: <span style={{ color: '#888' }}>{timeAgo(data?.lastSync)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['PostEx', 'Leopards', 'Kangaroo'].map(c => (
              <button key={c} onClick={() => runSync(c)} disabled={syncing}
                style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#aaa', borderRadius: 7, padding: '8px 14px', fontSize: 12, cursor: syncing ? 'not-allowed' : 'pointer' }}>
                Sync {c}
              </button>
            ))}
            <button onClick={() => runSync(null)} disabled={syncing}
              style={{ background: syncing ? '#1a1a1a' : gold, color: syncing ? '#555' : '#000', border: 'none', borderRadius: 7, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: syncing ? 'not-allowed' : 'pointer' }}>
              {syncing ? '⟳ Syncing...' : '⟳ Sync All'}
            </button>
          </div>
        </div>

        {syncResult && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: syncResult.error ? '#1a0000' : '#001a0a', borderRadius: 8, border: `1px solid ${syncResult.error ? '#330000' : '#003300'}` }}>
            {syncResult.error ? (
              <span style={{ color: '#ef4444', fontSize: 12 }}>Error: {syncResult.error}</span>
            ) : (
              <div style={{ fontSize: 12, color: '#22c55e' }}>
                ✅ Sync complete — {syncResult.summary?.synced} parcels synced |
                {' '}{syncResult.summary?.delivered} delivered |
                {' '}{syncResult.summary?.rto} RTO |
                {' '}{fmt(syncResult.summary?.cod_collected)} COD collected |
                {' '}{syncResult.summary?.auto_settled} auto-settled
                {syncResult.results?.filter(r => !r.success).map(r => (
                  <span key={r.courier} style={{ color: '#f87171', marginLeft: 12 }}>⚠ {r.courier}: {r.error}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Today Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Delivered Today" value={data?.todayDelivered?.length || 0} sub={fmt(todayDeliveredCOD) + ' COD'} color="#22c55e" />
        <StatCard label="RTO Today" value={data?.todayRTO?.length || 0} sub={fmt(todayRTOCOD) + ' lost'} color="#ef4444" />
        <StatCard label="Active Shipments" value={data?.activeShipments?.length || 0} sub="in transit + booked" color={gold} />
        {Object.entries(activeByCourier).map(([c, n]) => (
          <StatCard key={c} label={c + ' Active'} value={n} color="#888" />
        ))}
      </div>

      {/* Active Shipments Table */}
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Active Shipments</span>
          <span style={{ fontSize: 12, color: '#555' }}>{data?.activeShipments?.length} parcels</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${border}` }}>
                {['Tracking', 'Courier', 'Customer', 'City', 'COD', 'Status', 'Updated'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.activeShipments || []).slice(0, 100).map((s, i) => (
                <tr key={i} style={{ borderBottom: `1px solid #1a1a1a` }}>
                  <td style={{ padding: '10px 14px', color: gold, fontFamily: 'monospace' }}>{s.tracking_number}</td>
                  <td style={{ padding: '10px 14px', color: '#888' }}>{s.courier_name}</td>
                  <td style={{ padding: '10px 14px', color: '#ccc' }}>{s.customer_name}</td>
                  <td style={{ padding: '10px 14px', color: '#888' }}>{s.city}</td>
                  <td style={{ padding: '10px 14px', color: '#fff' }}>{fmt(s.cod_amount)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ color: statusColor(s.status), fontSize: 11, background: statusColor(s.status) + '22', padding: '3px 8px', borderRadius: 4 }}>
                      {statusLabel(s.status)}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#555' }}>{timeAgo(s.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.activeShipments || []).length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: '#444' }}>No active shipments. Run sync first.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── RTO Tab ──────────────────────────────────────────────────
function RTOTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const r = await fetch('/api/courier/rto-alerts');
    const d = await r.json();
    setData(d);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const acknowledge = async (id) => {
    await fetch('/api/courier/rto-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'acknowledge' }),
    });
    load();
  };

  if (loading) return <div style={{ color: '#444', padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Unacknowledged RTOs" value={data?.rto_count || 0} color="#ef4444" big />
        <StatCard label="Stale Shipments" value={data?.stale_count || 0} sub="No update in 10+ days" color="#f97316" />
        <StatCard label="COD At Risk" value={fmt(data?.cod_at_risk)} sub="Stale shipments" color="#f97316" />
      </div>

      {/* Unacknowledged RTOs */}
      {(data?.unacknowledged_rto || []).length > 0 && (
        <div style={{ background: '#140000', border: '1px solid #330000', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #330000', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#ef4444', fontSize: 16 }}>🔴</span>
            <span style={{ fontWeight: 600, color: '#ef4444', fontSize: 14 }}>New RTOs — Action Required ({data.unacknowledged_rto.length})</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #330000' }}>
                {['Tracking', 'Courier', 'Customer', 'Phone', 'City', 'COD', 'Status', 'When', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#663333', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.unacknowledged_rto.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1a0000' }}>
                  <td style={{ padding: '10px 14px', color: '#f87171', fontFamily: 'monospace' }}>{r.tracking_number}</td>
                  <td style={{ padding: '10px 14px', color: '#888' }}>{r.courier_name}</td>
                  <td style={{ padding: '10px 14px', color: '#ccc' }}>{r.customer_name}</td>
                  <td style={{ padding: '10px 14px', color: '#888' }}>{r.customer_phone}</td>
                  <td style={{ padding: '10px 14px', color: '#888' }}>{r.city}</td>
                  <td style={{ padding: '10px 14px', color: '#fff' }}>{fmt(r.cod_amount)}</td>
                  <td style={{ padding: '10px 14px', color: '#ef4444', fontSize: 11 }}>{r.courier_status_raw}</td>
                  <td style={{ padding: '10px 14px', color: '#555' }}>{timeAgo(r.updated_at)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <button onClick={() => acknowledge(r.id)}
                      style={{ background: '#1a0000', border: '1px solid #440000', color: '#f87171', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                      ✓ Acknowledge
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Stale Shipments */}
      {(data?.stale_shipments || []).length > 0 && (
        <div style={{ background: card, border: `1px solid #332200`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #332200', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <span style={{ fontWeight: 600, color: '#f97316', fontSize: 14 }}>Stale Shipments — No Update in 10+ Days ({data.stale_shipments.length})</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #332200' }}>
                {['Tracking', 'Courier', 'Customer', 'City', 'COD', 'Last Update'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#664400', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.stale_shipments.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1a1000' }}>
                  <td style={{ padding: '10px 14px', color: '#f97316', fontFamily: 'monospace' }}>{s.tracking_number}</td>
                  <td style={{ padding: '10px 14px', color: '#888' }}>{s.courier_name}</td>
                  <td style={{ padding: '10px 14px', color: '#ccc' }}>{s.customer_name}</td>
                  <td style={{ padding: '10px 14px', color: '#888' }}>{s.city}</td>
                  <td style={{ padding: '10px 14px', color: '#fff' }}>{fmt(s.cod_amount)}</td>
                  <td style={{ padding: '10px 14px', color: '#f97316' }}>{timeAgo(s.last_tracked_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(data?.unacknowledged_rto || []).length === 0 && (data?.stale_shipments || []).length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
          <div>No active RTO alerts. All clear!</div>
        </div>
      )}
    </div>
  );
}

// ─── Settlements Tab ──────────────────────────────────────────
function SettlementsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [markForm, setMarkForm] = useState({ courier: '', amount: '', reference: '' });
  const [marking, setMarking] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const r = await fetch('/api/courier/auto-settle');
    const d = await r.json();
    setData(d);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const markDisbursed = async () => {
    if (!markForm.courier || !markForm.amount) return;
    setMarking(true);
    const r = await fetch('/api/courier/auto-settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courier: markForm.courier, amount: parseFloat(markForm.amount), reference: markForm.reference, date: new Date().toISOString() }),
    });
    const d = await r.json();
    setMsg(d.success ? `✅ Marked ${d.settled} settlements as disbursed` : '❌ ' + d.error);
    setMarking(false);
    load();
  };

  if (loading) return <div style={{ color: '#444', padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <div>
      {/* Courier settlement cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
        {Object.entries(data?.by_courier || {}).map(([c, s]) => (
          <div key={c} style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: gold, marginBottom: 12 }}>{c}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: '#555' }}>Total COD</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{fmt(s.total_cod)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: '#555' }}>Pending</span>
                <span style={{ color: '#f97316' }}>{s.pending} settlements</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: '#555' }}>Disbursed</span>
                <span style={{ color: '#22c55e' }}>{s.disbursed} settlements</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pending COD summary */}
      <div style={{ background: '#0a1400', border: '1px solid #1a3300', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#4a7a00', marginBottom: 4 }}>💰 Total COD Pending Disbursement</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#22c55e' }}>{fmt(data?.pending_cod)}</div>
        <div style={{ fontSize: 12, color: '#4a7a00', marginTop: 4 }}>{data?.unsettled_count} delivered parcels not yet paid by courier</div>
      </div>

      {/* Mark as disbursed form */}
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '20px 24px' }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Mark COD as Received (Courier Paid Us)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>Courier</div>
            <select value={markForm.courier} onChange={e => setMarkForm(f => ({...f, courier: e.target.value}))}
              style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, width: '100%' }}>
              <option value="">Select...</option>
              {['PostEx', 'Leopards', 'Kangaroo'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>Amount Received</div>
            <input type="number" placeholder="Rs amount" value={markForm.amount} onChange={e => setMarkForm(f => ({...f, amount: e.target.value}))}
              style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>Reference (optional)</div>
            <input type="text" placeholder="Bank ref / transaction ID" value={markForm.reference} onChange={e => setMarkForm(f => ({...f, reference: e.target.value}))}
              style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
          </div>
          <button onClick={markDisbursed} disabled={marking}
            style={{ background: gold, color: '#000', border: 'none', borderRadius: 7, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: marking ? 'not-allowed' : 'pointer' }}>
            {marking ? '...' : 'Mark Paid'}
          </button>
        </div>
        {msg && <div style={{ marginTop: 10, fontSize: 12, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
const ALL_TABS = [
  { id: 'sync',        label: '⟳ Live Sync',        perm: 'courier.sync' },
  { id: 'rto',         label: '🔴 RTO Alerts',      perm: 'courier.rto_alerts' },
  { id: 'settlements', label: '💰 COD Settlements', perm: 'courier.settle' },
];

export default function CourierSyncPage() {
  const { can } = useUser();

  // ── Tab visibility filter ──
  const TABS = ALL_TABS.filter(t => can(t.perm));
  const defaultTab = TABS[0]?.id || 'sync';

  const [tab, setTab] = useState(defaultTab);

  // Edge case: zero perms → empty state
  if (TABS.length === 0) {
    return (
      <div style={{ fontFamily: 'Inter, sans-serif', padding: 60, textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, color: '#fff', fontWeight: 600, marginBottom: 8 }}>Permission denied</div>
        <div style={{ fontSize: 13, color: '#666' }}>Courier Sync ke kisi tab ki ijazat tumhe nahi hai.</div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff', padding: '0' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' }}>Courier Sync</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>
          Auto-pull from PostEx, Leopards & Kangaroo — real-time status, RTO alerts, COD tracking
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#0a0a0a', padding: 4, borderRadius: 9, width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? '#1e1e1e' : 'transparent',
              border: `1px solid ${tab === t.id ? '#2a2a2a' : 'transparent'}`,
              borderRadius: 7, padding: '7px 16px', cursor: 'pointer',
              fontSize: 13, color: tab === t.id ? gold : '#555',
              fontWeight: tab === t.id ? 600 : 400, fontFamily: 'inherit',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'sync' && <SyncTab />}
      {tab === 'rto' && <RTOTab />}
      {tab === 'settlements' && <SettlementsTab />}
    </div>
  );
}
