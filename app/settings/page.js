'use client';
import { useState, useEffect, useCallback } from 'react';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';

// ─── Tab definitions ───────────────────────────────────────────────────────
const TABS = [
  { id: 'store',          label: '🏪 Store Info',      category: 'store',          ready: true,  kind: 'settings' },
  { id: 'business_rules', label: '⚙️ Business Rules',  category: 'business_rules', ready: true,  kind: 'settings' },
  { id: 'shopify',        label: '🛒 Shopify',         ready: true,                kind: 'diagnostics', check: 'shopify'  },
  { id: 'leopards',       label: '🐆 Leopards',        ready: true,                kind: 'diagnostics', check: 'leopards' },
  { id: 'postex',         label: '📦 PostEx',          ready: true,                kind: 'diagnostics', check: 'postex'   },
  { id: 'kangaroo',       label: '🦘 Kangaroo',        ready: true,                kind: 'diagnostics', check: 'kangaroo' },
  { id: 'tags',           label: '🏷️ Tags',            ready: false, kind: 'comingsoon' },
  { id: 'notifications',  label: '🔔 Notifications',   ready: false, kind: 'comingsoon' },
  { id: 'system',         label: '💻 System Health',   ready: true,  kind: 'diagnostics', check: 'system' },
  { id: 'audit',          label: '📋 Audit Log',       ready: true,  kind: 'audit' },
];

// ─── Shared styles ────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%',
  background: '#1a1a1a',
  border: `1px solid ${border}`,
  color: '#fff',
  borderRadius: 8,
  padding: '10px 14px',
  fontSize: 13,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const labelStyle = {
  display: 'block',
  fontSize: 11,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 6,
  fontWeight: 600,
};

const helpStyle = {
  fontSize: 11,
  color: '#555',
  marginTop: 6,
  lineHeight: 1.5,
};

const sectionStyle = {
  background: card,
  border: `1px solid ${border}`,
  borderRadius: 12,
  padding: 24,
  marginBottom: 16,
};

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

const fmtDate = iso => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
};

// ─── Small presentational helpers ─────────────────────────────────────────
function StatusDot({ status }) {
  const colors = {
    ok: '#22c55e',
    error: '#ef4444',
    not_tested: '#888',
    loading: '#60a5fa',
  };
  const c = colors[status] || '#888';
  return (
    <span style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: c,
      boxShadow: `0 0 8px ${c}`,
      marginRight: 8,
    }} />
  );
}

function KV({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${border}` }}>
      <span style={{ fontSize: 12, color: '#888' }}>{label}</span>
      <span style={{
        fontSize: 12,
        color: '#ccc',
        fontFamily: mono ? 'monospace' : 'inherit',
        textAlign: 'right',
        maxWidth: '60%',
        wordBreak: 'break-all',
      }}>
        {value ?? <span style={{ color: '#444' }}>—</span>}
      </span>
    </div>
  );
}

function Badge({ children, color = '#888' }) {
  return (
    <span style={{
      display: 'inline-block',
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
      padding: '3px 10px',
      borderRadius: 5,
      fontSize: 11,
      fontWeight: 600,
    }}>{children}</span>
  );
}

function VercelLink({ envVar }) {
  return (
    <a
      href="https://vercel.com/dashboard"
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        color: '#60a5fa',
        textDecoration: 'none',
        padding: '6px 10px',
        border: '1px solid #60a5fa44',
        borderRadius: 6,
        background: 'rgba(96,165,250,0.08)',
      }}
      title={`Update ${envVar} in Vercel Environment Variables`}
    >
      🔗 Update in Vercel
    </a>
  );
}

// ─── Setting input row (for Store / Business Rules tabs) ─────────────────
function SettingRow({ setting, value, onChange, disabled }) {
  const isBool = typeof setting.value === 'boolean';
  const isNumber = typeof setting.value === 'number';
  const isArray = Array.isArray(setting.value);

  return (
    <div style={{ marginBottom: 20 }}>
      <label style={labelStyle}>{setting.label || setting.key}</label>

      {isBool && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer' }}>
          <div
            onClick={() => !disabled && onChange(!value)}
            style={{
              width: 44, height: 24, borderRadius: 12,
              background: value ? '#22c55e' : '#333',
              position: 'relative', transition: 'all 0.2s',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <div style={{
              position: 'absolute', top: 2, left: value ? 22 : 2,
              width: 20, height: 20, borderRadius: '50%', background: '#fff',
              transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }} />
          </div>
          <span style={{ color: value ? '#22c55e' : '#888', fontSize: 13, fontWeight: 600 }}>
            {value ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      )}

      {isNumber && (
        <input type="number" value={value ?? 0} onChange={e => onChange(Number(e.target.value))}
          disabled={disabled} style={{ ...inputStyle, maxWidth: 200, opacity: disabled ? 0.5 : 1 }} />
      )}

      {isArray && (
        <input type="text" value={Array.isArray(value) ? value.join(', ') : ''}
          onChange={e => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          disabled={disabled} placeholder="comma, separated, values"
          style={{ ...inputStyle, opacity: disabled ? 0.5 : 1 }} />
      )}

      {!isBool && !isNumber && !isArray && (
        <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
          disabled={disabled} style={{ ...inputStyle, opacity: disabled ? 0.5 : 1 }} />
      )}

      {setting.description && <div style={helpStyle}>{setting.description}</div>}
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────
function AuditLogTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/settings/audit?limit=50')
      .then(r => r.json())
      .then(d => {
        if (d.success) setEntries(d.entries || []);
        else setError(d.error);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#555' }}>Loading audit log...</div>;
  if (error) return <div style={{ padding: 20, color: '#ef4444', background: '#1a0000', border: '1px solid #330000', borderRadius: 8 }}>{error}</div>;

  return (
    <div style={sectionStyle}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: gold }}>Recent Settings Changes</h3>
        <p style={{ fontSize: 12, color: '#555', marginTop: 4 }}>Last 50 changes</p>
      </div>

      {entries.length === 0 && (
        <div style={{ color: '#444', textAlign: 'center', padding: 40, fontSize: 13 }}>No changes recorded yet</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map(e => (
          <div key={e.id} style={{ background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
              <div style={{ fontWeight: 600, color: gold, fontSize: 13 }}>{e.setting_key}</div>
              <div style={{ fontSize: 11, color: '#555', whiteSpace: 'nowrap' }}>{fmtDate(e.changed_at)}</div>
            </div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>by {e.changed_by_email || 'unknown'}</div>
            <div style={{ display: 'flex', gap: 10, fontSize: 11, flexWrap: 'wrap' }}>
              <div style={{ background: '#1a0000', border: '1px solid #330000', color: '#f87171', padding: '4px 10px', borderRadius: 5 }}>
                <span style={{ opacity: 0.6 }}>from:</span> {JSON.stringify(e.old_value)}
              </div>
              <div style={{ background: '#001a0a', border: '1px solid #003300', color: '#22c55e', padding: '4px 10px', borderRadius: 5 }}>
                <span style={{ opacity: 0.6 }}>to:</span> {JSON.stringify(e.new_value)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Diagnostics Tab (generic wrapper for Shopify/Leopards/PostEx/Kangaroo/System) ─
function DiagnosticsTab({ check, label }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/settings/diagnostics?check=${check}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setData(d[check]);
        else setError(d.error);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [check, refreshKey]);

  const refresh = () => setRefreshKey(k => k + 1);

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#555' }}>⟳ Running diagnostics…</div>;
  if (error) return (
    <div style={sectionStyle}>
      <div style={{ color: '#ef4444' }}>❌ {error}</div>
      <button onClick={refresh} style={{ marginTop: 10, background: '#1a1a1a', border: `1px solid ${border}`, color: '#ccc', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>Retry</button>
    </div>
  );

  return (
    <div>
      <div style={{ ...sectionStyle, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: gold }}>{label}</h3>
          <button onClick={refresh} style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>⟳ Refresh</button>
        </div>

        {check === 'shopify' && <ShopifyDiagnostics data={data} />}
        {check === 'leopards' && <LeopardsDiagnostics data={data} />}
        {check === 'postex' && <PostExDiagnostics data={data} />}
        {check === 'kangaroo' && <KangarooDiagnostics data={data} />}
        {check === 'system' && <SystemDiagnostics data={data} />}
      </div>
    </div>
  );
}

// ─── Shopify diagnostics view ─────────────────────────────────────────────
function ShopifyDiagnostics({ data }) {
  if (!data) return null;
  const c = data.connection || {};
  return (
    <div>
      {/* Connection status */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Connection</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusDot status={c.status} />
          <span style={{ color: c.status === 'ok' ? '#22c55e' : c.status === 'error' ? '#ef4444' : '#888', fontSize: 13, fontWeight: 600 }}>
            {c.status === 'ok' ? 'Connected' : c.status === 'error' ? `Error: ${c.error}` : 'Not tested'}
          </span>
          {c.latency_ms != null && <span style={{ fontSize: 11, color: '#555' }}>· {c.latency_ms}ms</span>}
        </div>
      </div>

      {/* Credentials (masked) */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Credentials</div>
        <KV label="Store Domain" value={data.store_domain} mono />
        <KV label="Access Token" value={data.access_token} mono />
        <KV label="Webhook Secret" value={data.webhook_secret} mono />
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <VercelLink envVar="SHOPIFY_ACCESS_TOKEN" />
        </div>
      </div>

      {/* Shop info */}
      {data.shop_info && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Shop Info</div>
          <KV label="Name" value={data.shop_info.name} />
          <KV label="Email" value={data.shop_info.email} />
          <KV label="Country" value={data.shop_info.country} />
          <KV label="Currency" value={data.shop_info.currency} />
          <KV label="Plan" value={data.shop_info.plan} />
          <KV label="Timezone" value={data.shop_info.timezone} />
        </div>
      )}

      {/* Webhooks */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Webhooks ({data.webhooks?.registered || 0})
        </div>
        {data.webhooks?.list?.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.webhooks.list.map((w, i) => (
              <div key={i} style={{ background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
                <div style={{ color: gold, fontWeight: 600 }}>{w.topic}</div>
                <div style={{ color: '#666', marginTop: 2, fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all' }}>{w.address}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#555' }}>No webhooks registered</div>
        )}
      </div>

      {/* Sync info */}
      <div>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Last Sync</div>
        <KV label="Last synced at" value={fmtDate(data.last_sync)} />
        <KV label="Total orders in ERP" value={data.order_counts?.total ?? 0} />
      </div>
    </div>
  );
}

// ─── Leopards diagnostics view ────────────────────────────────────────────
function LeopardsDiagnostics({ data }) {
  if (!data) return null;
  const c = data.connection || {};
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Connection</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusDot status={c.status} />
          <span style={{ color: c.status === 'ok' ? '#22c55e' : c.status === 'error' ? '#ef4444' : '#888', fontSize: 13, fontWeight: 600 }}>
            {c.status === 'ok' ? 'Connected' : c.status === 'error' ? `Error: ${c.error}` : 'Not tested'}
          </span>
          {c.latency_ms != null && <span style={{ fontSize: 11, color: '#555' }}>· {c.latency_ms}ms</span>}
          {c.today_packets != null && <span style={{ fontSize: 11, color: '#888' }}>· {c.today_packets} packets today</span>}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Credentials</div>
        <KV label="API Key" value={data.api_key} mono />
        <KV label="API Password" value={data.api_password} mono />
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <VercelLink envVar="LEOPARDS_API_KEY" />
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Order Counts</div>
        <KV label="Total Leopards orders" value={data.counts?.total} />
        <KV label="Delivered" value={data.counts?.delivered} />
        <KV label="Paid" value={data.counts?.paid} />
        <KV label="Unpaid" value={data.counts?.unpaid} />
      </div>

      {data.last_status_sync && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Last Status Sync</div>
          <KV label="Ran" value={timeAgo(data.last_status_sync.created_at) + ` (${fmtDate(data.last_status_sync.created_at)})`} />
          <KV label="Packets fetched" value={data.last_status_sync.total_fetched} />
          <KV label="Orders matched" value={data.last_status_sync.matched_orders} />
          <KV label="Orders updated" value={data.last_status_sync.updated_orders} />
          <KV label="Duration" value={`${data.last_status_sync.duration_ms}ms`} />
          <KV label="Triggered by" value={data.last_status_sync.triggered_by} />
        </div>
      )}

      {data.last_payment_sync && (
        <div>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Last Payment Sync</div>
          <KV label="Ran" value={timeAgo(data.last_payment_sync.created_at) + ` (${fmtDate(data.last_payment_sync.created_at)})`} />
          <KV label="Orders checked" value={data.last_payment_sync.matched_orders} />
          <KV label="Marked paid" value={data.last_payment_sync.marked_paid} />
          <KV label="Duration" value={`${data.last_payment_sync.duration_ms}ms`} />
        </div>
      )}
    </div>
  );
}

// ─── PostEx diagnostics ───────────────────────────────────────────────────
function PostExDiagnostics({ data }) {
  if (!data) return null;
  return (
    <div>
      <div style={{ background: '#2a1a00', border: '1px solid #664400', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 12, color: '#fbbf24' }}>
        ⚠️ <strong>Deprecated.</strong> {data.note}
      </div>
      <KV label="Configured" value={data.configured ? 'Yes' : 'No'} />
      <KV label="API Token" value={data.api_token} mono />
      <KV label="Store ID" value={data.store_id} mono />
      <KV label="PostEx orders in ERP" value={data.order_count} />
      <div style={{ marginTop: 16 }}>
        <VercelLink envVar="POSTEX_API_TOKEN" />
      </div>
    </div>
  );
}

// ─── Kangaroo diagnostics ─────────────────────────────────────────────────
function KangarooDiagnostics({ data }) {
  if (!data) return null;
  return (
    <div>
      <div style={{ background: '#001a2a', border: '1px solid #004466', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 12, color: '#60a5fa' }}>
        ℹ️ {data.note}
      </div>
      <KV label="Configured" value={data.configured ? 'Yes' : 'No'} />
      <KV label="Client ID" value={data.client_id} mono />
      <KV label="API Password" value={data.api_password} mono />
      <KV label="Endpoint" value={data.endpoint} mono />
      <KV label="Kangaroo orders in ERP" value={data.order_count} />
      <div style={{ marginTop: 16 }}>
        <VercelLink envVar="KANGAROO_API_PASSWORD" />
      </div>
    </div>
  );
}

// ─── System diagnostics ───────────────────────────────────────────────────
function SystemDiagnostics({ data }) {
  if (!data) return null;
  const s = data.supabase || {};
  return (
    <div>
      {/* Supabase */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Supabase</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <StatusDot status={s.connection} />
          <span style={{ color: s.connection === 'ok' ? '#22c55e' : '#ef4444', fontSize: 13, fontWeight: 600 }}>
            {s.connection === 'ok' ? 'Connected' : `Error: ${s.error || 'not tested'}`}
          </span>
          {s.latency_ms != null && <span style={{ fontSize: 11, color: '#555' }}>· {s.latency_ms}ms</span>}
        </div>
        {data.db_stats && (
          <>
            <KV label="Total orders" value={data.db_stats.orders} />
            <KV label="Total products" value={data.db_stats.products} />
            <KV label="Total customers" value={data.db_stats.customers} />
          </>
        )}
      </div>

      {/* Env vars */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Environment Variables</div>
        {Object.entries(data.env_vars || {}).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${border}` }}>
            <span style={{ fontSize: 11, color: '#ccc', fontFamily: 'monospace' }}>{k}</span>
            <Badge color={v ? '#22c55e' : '#ef4444'}>{v ? 'SET' : 'MISSING'}</Badge>
          </div>
        ))}
      </div>

      {/* Recent syncs */}
      <div>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Recent Sync Runs ({data.recent_syncs?.length || 0})
        </div>
        {data.recent_syncs?.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.recent_syncs.map((sync, i) => (
              <div key={i} style={{ background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div>
                    <Badge color={sync.errors ? '#ef4444' : '#22c55e'}>{sync.courier} {sync.sync_type}</Badge>
                    <span style={{ marginLeft: 8, color: '#888' }}>{timeAgo(sync.created_at)}</span>
                    <span style={{ marginLeft: 8, color: '#555' }}>· {sync.triggered_by}</span>
                  </div>
                  <span style={{ color: '#555' }}>{sync.duration_ms}ms</span>
                </div>
                <div style={{ color: '#666' }}>
                  fetched: {sync.total_fetched} · matched: {sync.matched_orders} · updated: {sync.updated_orders}
                  {sync.marked_paid > 0 && ` · paid: ${sync.marked_paid}`}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#555' }}>No sync runs recorded yet</div>
        )}
      </div>
    </div>
  );
}

// ─── Coming Soon placeholder ──────────────────────────────────────────────
function ComingSoonTab({ title }) {
  return (
    <div style={sectionStyle}>
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
        <h3 style={{ margin: 0, color: gold, fontSize: 18 }}>{title}</h3>
        <p style={{ fontSize: 13, color: '#666', marginTop: 10 }}>Chunk 3 mein aayega</p>
      </div>
    </div>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────
export default function SettingsPage() {
  const [settings, setSettings] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [activeTab, setActiveTab] = useState('store');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [role, setRole] = useState(null);

  const isSuperAdmin = role === 'super_admin';

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const sRes = await fetch('/api/settings').then(r => r.json());
      if (sRes?.success) {
        setSettings(sRes.settings || []);
        if (sRes.user?.role) setRole(sRes.user.role);
      }
    } catch (e) {
      setMsg({ type: 'error', text: `Load failed: ${e.message}` });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const tab = TABS.find(t => t.id === activeTab) || TABS[0];
  const tabSettings = settings.filter(s => s.category === tab.category);
  const getCurrentValue = (s) => (drafts[s.key] !== undefined ? drafts[s.key] : s.value);

  const handleChange = (key, value) => {
    setDrafts(d => ({ ...d, [key]: value }));
  };

  const hasChanges = Object.keys(drafts).length > 0;

  const save = async () => {
    if (!hasChanges) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: drafts }),
      });
      const d = await r.json();
      if (d.success) {
        setMsg({ type: 'success', text: `✓ ${d.updated} settings saved` });
        setDrafts({});
        await loadAll();
      } else {
        setMsg({ type: 'error', text: `✗ ${d.error || 'Save failed'}` });
      }
    } catch (e) {
      setMsg({ type: 'error', text: `✗ ${e.message}` });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 5000);
  };

  const discard = () => {
    setDrafts({});
    setMsg({ type: 'info', text: 'Changes discarded' });
    setTimeout(() => setMsg(null), 3000);
  };

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff', maxWidth: 1200 }}>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Settings</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>
            Configure your ERP system
            {role && (
              <span style={{ marginLeft: 10, color: isSuperAdmin ? '#22c55e' : '#f87171' }}>
                · Role: {role}{!isSuperAdmin && ' (read-only)'}
              </span>
            )}
          </p>
        </div>

        {msg && (
          <div style={{
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: 12,
            background:
              msg.type === 'success' ? 'rgba(74,222,128,0.12)' :
              msg.type === 'error' ? 'rgba(248,113,113,0.12)' :
              'rgba(96,165,250,0.12)',
            border: `1px solid ${
              msg.type === 'success' ? '#4ade80' :
              msg.type === 'error' ? '#f87171' :
              '#60a5fa'
            }`,
            color:
              msg.type === 'success' ? '#4ade80' :
              msg.type === 'error' ? '#f87171' :
              '#60a5fa',
          }}>
            {msg.text}
          </div>
        )}
      </div>

      {!isSuperAdmin && (
        <div style={{
          background: 'rgba(248,113,113,0.08)',
          border: '1px solid #ef444444',
          color: '#f87171',
          padding: '12px 16px',
          borderRadius: 8,
          fontSize: 12,
          marginBottom: 16,
        }}>
          ⚠️ Only super admin can modify settings. You are viewing in read-only mode.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
        {/* Sidebar */}
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: 8, height: 'fit-content' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setActiveTab(t.id); setDrafts({}); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: activeTab === t.id ? '#1a1a1a' : 'transparent',
                border: 'none',
                borderLeft: activeTab === t.id ? `3px solid ${gold}` : '3px solid transparent',
                color: activeTab === t.id ? gold : '#aaa',
                padding: '11px 14px',
                fontSize: 13,
                fontWeight: activeTab === t.id ? 600 : 400,
                cursor: 'pointer',
                borderRadius: 6,
                marginBottom: 2,
                fontFamily: 'inherit',
                position: 'relative',
              }}
            >
              <span>{t.label}</span>
              {!t.ready && (
                <span style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 9, background: '#333', color: '#888',
                  padding: '2px 6px', borderRadius: 4,
                }}>soon</span>
              )}
            </button>
          ))}
        </div>

        {/* Main content */}
        <div>
          {loading && <div style={{ textAlign: 'center', padding: 60, color: '#555' }}>Loading settings...</div>}

          {!loading && tab.kind === 'audit' && <AuditLogTab />}

          {!loading && tab.kind === 'comingsoon' && <ComingSoonTab title={tab.label} />}

          {!loading && tab.kind === 'diagnostics' && (
            <DiagnosticsTab check={tab.check} label={tab.label} />
          )}

          {!loading && tab.kind === 'settings' && (
            <>
              <div style={sectionStyle}>
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ margin: 0, fontSize: 16, color: gold }}>{tab.label}</h3>
                  <p style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                    {tab.id === 'store' && 'General store information used across ERP and invoices'}
                    {tab.id === 'business_rules' && 'Control how ERP handles orders, statuses, and automation'}
                  </p>
                </div>

                {tabSettings.length === 0 && (
                  <div style={{ color: '#444', padding: 20, textAlign: 'center', fontSize: 13 }}>No settings in this category yet</div>
                )}

                {tabSettings.map(s => (
                  <SettingRow
                    key={s.key}
                    setting={s}
                    value={getCurrentValue(s)}
                    onChange={(v) => handleChange(s.key, v)}
                    disabled={!isSuperAdmin}
                  />
                ))}
              </div>

              {hasChanges && isSuperAdmin && (
                <div style={{
                  position: 'sticky',
                  bottom: 16,
                  background: '#0a0a0a',
                  border: `1px solid ${gold}`,
                  borderRadius: 12,
                  padding: '14px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                }}>
                  <div style={{ fontSize: 13, color: gold }}>
                    {Object.keys(drafts).length} unsaved change{Object.keys(drafts).length !== 1 ? 's' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={discard} disabled={saving} style={{
                      background: 'transparent', border: `1px solid ${border}`, color: '#888',
                      borderRadius: 8, padding: '9px 18px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                    }}>Discard</button>
                    <button onClick={save} disabled={saving} style={{
                      background: saving ? '#1a1a1a' : 'linear-gradient(135deg, #c9a96e 0%, #b8975d 100%)',
                      border: `1px solid ${saving ? border : '#c9a96e'}`,
                      color: saving ? '#888' : '#000',
                      borderRadius: 8, padding: '9px 22px', fontSize: 13, fontWeight: 700,
                      cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                    }}>{saving ? 'Saving...' : '💾 Save Changes'}</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
