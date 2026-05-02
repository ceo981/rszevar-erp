'use client';
import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@/context/UserContext';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';

const TABS = [
  { id: 'store',          label: '🏪 Store Info',      category: 'store',          ready: true, kind: 'settings' },
  { id: 'business_rules', label: '⚙️ Business Rules',  category: 'business_rules', ready: true, kind: 'settings' },
  { id: 'shopify',        label: '🛒 Shopify',         ready: true, kind: 'diagnostics', check: 'shopify'  },
  { id: 'leopards',       label: '🐆 Leopards',        ready: true, kind: 'diagnostics', check: 'leopards' },
  { id: 'postex',         label: '📦 PostEx',          ready: true, kind: 'diagnostics', check: 'postex'   },
  { id: 'kangaroo',       label: '🦘 Kangaroo',        ready: true, kind: 'diagnostics', check: 'kangaroo' },
  { id: 'tags',           label: '🏷️ Tags',            ready: true, kind: 'tags' },
  { id: 'notifications',  label: '🔔 Notifications',   category: 'notifications', ready: true, kind: 'settings' },
  { id: 'whatsapp',       label: '💬 WhatsApp',         category: 'whatsapp',      ready: true, kind: 'whatsapp' },
  { id: 'system',         label: '💻 System Health',   ready: true, kind: 'diagnostics', check: 'system' },
  { id: 'audit',          label: '📋 Audit Log',       ready: true, kind: 'audit' },
];

// ─── Shared styles ────────────────────────────────────────────────────────
const inputStyle = { width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 8, padding: '10px 14px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' };
const labelStyle = { display: 'block', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontWeight: 600 };
const helpStyle = { fontSize: 11, color: '#555', marginTop: 6, lineHeight: 1.5 };
const sectionStyle = { background: card, border: `1px solid ${border}`, borderRadius: 12, padding: 24, marginBottom: 16 };

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

const fmtDate = iso => iso ? new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

// ─── Atoms ────────────────────────────────────────────────────────────────
function StatusDot({ status }) {
  const colors = { ok: '#22c55e', error: '#ef4444', not_tested: '#888', loading: '#60a5fa' };
  const c = colors[status] || '#888';
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}`, marginRight: 8 }} />;
}

function KV({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${border}` }}>
      <span style={{ fontSize: 12, color: '#888' }}>{label}</span>
      <span style={{ fontSize: 12, color: '#ccc', fontFamily: mono ? 'monospace' : 'inherit', textAlign: 'right', maxWidth: '60%', wordBreak: 'break-all' }}>
        {value ?? <span style={{ color: '#444' }}>—</span>}
      </span>
    </div>
  );
}

function Badge({ children, color = '#888' }) {
  return <span style={{ display: 'inline-block', background: color + '22', color, border: `1px solid ${color}44`, padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>{children}</span>;
}

function VercelLink({ envVar }) {
  return (
    <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#60a5fa', textDecoration: 'none', padding: '6px 10px', border: '1px solid #60a5fa44', borderRadius: 6, background: 'rgba(96,165,250,0.08)' }}
      title={`Update ${envVar} in Vercel`}
    >🔗 Update in Vercel</a>
  );
}

function Toggle({ value, onChange, disabled }) {
  return (
    <div onClick={() => !disabled && onChange(!value)} style={{ width: 44, height: 24, borderRadius: 12, background: value ? '#22c55e' : '#333', position: 'relative', transition: 'all 0.2s', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, display: 'inline-block' }}>
      <div style={{ position: 'absolute', top: 2, left: value ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }} />
    </div>
  );
}

// ─── Setting Row ──────────────────────────────────────────────────────────
function SettingRow({ setting, value, onChange, disabled }) {
  const isBool = typeof setting.value === 'boolean';
  const isNumber = typeof setting.value === 'number';
  const isArray = Array.isArray(setting.value);

  return (
    <div style={{ marginBottom: 20 }}>
      <label style={labelStyle}>{setting.label || setting.key}</label>
      {isBool && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Toggle value={value} onChange={onChange} disabled={disabled} />
          <span style={{ color: value ? '#22c55e' : '#888', fontSize: 13, fontWeight: 600 }}>{value ? 'Enabled' : 'Disabled'}</span>
        </label>
      )}
      {isNumber && <input type="number" value={value ?? 0} onChange={e => onChange(Number(e.target.value))} disabled={disabled} style={{ ...inputStyle, maxWidth: 200, opacity: disabled ? 0.5 : 1 }} />}
      {isArray && <input type="text" value={Array.isArray(value) ? value.join(', ') : ''} onChange={e => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))} disabled={disabled} placeholder="comma, separated" style={{ ...inputStyle, opacity: disabled ? 0.5 : 1 }} />}
      {!isBool && !isNumber && !isArray && <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} style={{ ...inputStyle, opacity: disabled ? 0.5 : 1 }} />}
      {setting.description && <div style={helpStyle}>{setting.description}</div>}
    </div>
  );
}

// ─── Tags Management Tab ──────────────────────────────────────────────────
function TagsTab({ isSuperAdmin }) {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ tag_key: '', label: '', description: '', category: 'custom', color: '#888', sort_order: 100 });
  const [editingId, setEditingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/settings/tags')
      .then(r => r.json())
      .then(d => { if (d.success) setTags(d.tags || []); setLoading(false); })
      .catch(e => { setMsg({ type: 'error', text: e.message }); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const showMsg = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000); };

  const openNew = () => {
    setEditingId(null);
    setForm({ tag_key: '', label: '', description: '', category: 'custom', color: '#888', sort_order: 100 });
    setShowForm(true);
  };

  const openEdit = (tag) => {
    setEditingId(tag.id);
    setForm({ ...tag });
    setShowForm(true);
  };

  const save = async () => {
    try {
      const r = await fetch('/api/settings/tags', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { id: editingId, ...form } : form),
      });
      const d = await r.json();
      if (d.success) {
        showMsg('success', `✓ Tag ${editingId ? 'updated' : 'created'}`);
        setShowForm(false);
        load();
      } else {
        showMsg('error', `✗ ${d.error}`);
      }
    } catch (e) { showMsg('error', `✗ ${e.message}`); }
  };

  const toggleActive = async (tag) => {
    try {
      const r = await fetch('/api/settings/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tag.id, is_active: !tag.is_active }),
      });
      const d = await r.json();
      if (d.success) { showMsg('success', `✓ Tag ${tag.is_active ? 'disabled' : 'enabled'}`); load(); }
      else showMsg('error', `✗ ${d.error}`);
    } catch (e) { showMsg('error', `✗ ${e.message}`); }
  };

  const del = async (tag) => {
    if (!confirm(`Delete tag "${tag.tag_key}"? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/settings/tags?id=${tag.id}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) { showMsg('success', '✓ Tag deleted'); load(); }
      else showMsg('error', `✗ ${d.error}`);
    } catch (e) { showMsg('error', `✗ ${e.message}`); }
  };

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#555' }}>Loading tags...</div>;

  const CORE = ['wholesale', 'international', 'walkin', 'kangaroo', 'order_confirmed'];

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: gold }}>🏷️ Tags Management</h3>
          <p style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
            Define tags that auto-classify orders. These are the exact tags you add in Shopify.
          </p>
        </div>
        {isSuperAdmin && (
          <button onClick={openNew} style={{ background: 'linear-gradient(135deg, #c9a96e 0%, #b8975d 100%)', border: `1px solid ${gold}`, color: '#000', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ New Tag</button>
        )}
      </div>

      {msg && (
        <div style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, marginBottom: 12, background: msg.type === 'success' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)', border: `1px solid ${msg.type === 'success' ? '#4ade80' : '#f87171'}`, color: msg.type === 'success' ? '#4ade80' : '#f87171' }}>
          {msg.text}
        </div>
      )}

      {showForm && (
        <div style={{ background: '#0a0a0a', border: `1px solid ${gold}`, borderRadius: 10, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: gold, fontWeight: 600, marginBottom: 12 }}>{editingId ? 'Edit Tag' : 'New Tag'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Tag Key (lowercase, no spaces)</label>
              <input value={form.tag_key} onChange={e => setForm({ ...form, tag_key: e.target.value.toLowerCase().replace(/\s+/g, '') })} disabled={!!editingId} placeholder="e.g. vip" style={{ ...inputStyle, opacity: editingId ? 0.5 : 1 }} />
              {editingId && <div style={helpStyle}>Cannot change tag key after creation</div>}
            </div>
            <div>
              <label style={labelStyle}>Display Label</label>
              <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. ⭐ VIP Customer" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={inputStyle}>
                <option value="type">Type</option>
                <option value="courier">Courier</option>
                <option value="workflow">Workflow</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Color (hex)</label>
              <input value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} placeholder="#888" style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Description (optional)</label>
            <input value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What is this tag for?" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowForm(false)} style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '8px 16px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={save} style={{ background: gold, border: 'none', color: '#000', borderRadius: 7, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{editingId ? 'Update' : 'Create'}</button>
          </div>
        </div>
      )}

      {/* Tags list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tags.map(tag => (
          <div key={tag.id} style={{ background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: tag.is_active ? tag.color || gold : '#555' }}>{tag.label}</span>
                <code style={{ background: '#1a1a1a', color: '#888', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>{tag.tag_key}</code>
                <Badge color={tag.category === 'type' ? '#8b5cf6' : tag.category === 'courier' ? '#22d3ee' : tag.category === 'workflow' ? '#3b82f6' : '#888'}>{tag.category}</Badge>
                {CORE.includes(tag.tag_key) && <Badge color="#f59e0b">core</Badge>}
                {!tag.is_active && <Badge color="#ef4444">disabled</Badge>}
              </div>
              {tag.description && <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{tag.description}</div>}
              {tag.auto_action && Object.keys(tag.auto_action).length > 0 && (
                <div style={{ fontSize: 10, color: '#555', marginTop: 4, fontFamily: 'monospace' }}>auto: {JSON.stringify(tag.auto_action)}</div>
              )}
            </div>
            {isSuperAdmin && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => toggleActive(tag)} title={tag.is_active ? 'Disable' : 'Enable'} style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {tag.is_active ? '⏸' : '▶'}
                </button>
                <button onClick={() => openEdit(tag)} style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: gold, borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Edit</button>
                {!CORE.includes(tag.tag_key) && (
                  <button onClick={() => del(tag)} style={{ background: '#1a0000', border: '1px solid #660000', color: '#ef4444', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>🗑</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20, padding: 12, background: '#001a2a', border: '1px solid #004466', borderRadius: 8, fontSize: 11, color: '#60a5fa' }}>
        💡 <strong>How to use:</strong> Add a tag here, then go to Shopify Admin → any order → Add tag with the exact tag_key (lowercase). ERP will auto-classify on next webhook/sync. Core tags cannot be deleted, only disabled.
      </div>
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────
function AuditLogTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/settings/audit?limit=50').then(r => r.json()).then(d => {
      if (d.success) setEntries(d.entries || []); else setError(d.error);
      setLoading(false);
    }).catch(e => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#555' }}>Loading audit log...</div>;
  if (error) return <div style={{ padding: 20, color: '#ef4444' }}>{error}</div>;

  return (
    <div style={sectionStyle}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16, color: gold }}>Recent Settings Changes</h3>
      {entries.length === 0 && <div style={{ color: '#444', textAlign: 'center', padding: 40, fontSize: 13 }}>No changes recorded yet</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map(e => (
          <div key={e.id} style={{ background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontWeight: 600, color: gold, fontSize: 13 }}>{e.setting_key}</div>
              <div style={{ fontSize: 11, color: '#555' }}>{fmtDate(e.changed_at)}</div>
            </div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>by {e.changed_by_email || 'unknown'}</div>
            <div style={{ display: 'flex', gap: 10, fontSize: 11, flexWrap: 'wrap' }}>
              <div style={{ background: '#1a0000', border: '1px solid #330000', color: '#f87171', padding: '4px 10px', borderRadius: 5 }}>from: {JSON.stringify(e.old_value)}</div>
              <div style={{ background: '#001a0a', border: '1px solid #003300', color: '#22c55e', padding: '4px 10px', borderRadius: 5 }}>to: {JSON.stringify(e.new_value)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Diagnostics Tab (wraps individual views) ─────────────────────────────

// ── WhatsApp Diagnostics Tab ─────────────────────────────────────────────────
function WhatsAppTab({ isSuperAdmin }) {
  const [status, setStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testResult, setTestResult] = useState('');

  useEffect(() => { checkStatus(); }, []);

  async function checkStatus() {
    try {
      const r = await fetch('/api/whatsapp/status');
      const d = await r.json();
      setStatus(d);
    } catch (e) {
      setStatus({ error: e.message });
    }
  }

  async function sendTest() {
    if (!testPhone) return;
    setTesting(true);
    setTestResult('');
    try {
      const r = await fetch('/api/whatsapp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testPhone }),
      });
      const d = await r.json();
      setTestResult(d.success ? '✅ Message sent! Check your WhatsApp.' : '❌ Failed: ' + (d.error || d.reason));
    } catch (e) {
      setTestResult('❌ Error: ' + e.message);
    }
    setTesting(false);
  }

  const card = { background: '#141414', border: '1px solid #222', borderRadius: 10, padding: '16px 20px', marginBottom: 12 };
  const label = { fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 };
  const value = { fontSize: 14, color: '#e2e8f0', fontWeight: 500 };

  return (
    <div style={{ padding: 4 }}>
      <h3 style={{ color: '#c9a96e', marginBottom: 4, fontSize: 16 }}>💬 WhatsApp Status</h3>
      <p style={{ fontSize: 12, color: '#555', marginBottom: 20 }}>Meta Cloud API connection status aur test messages</p>

      {/* Connection Status */}
      <div style={card}>
        <div style={{ ...label }}>Connection</div>
        {!status ? (
          <div style={{ color: '#555' }}>Checking...</div>
        ) : status.error ? (
          <div style={{ color: '#ef4444' }}>❌ Error: {status.error}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={label}>Phone Number ID</div>
              <div style={value}>{status.phone_number_id ? '✅ ' + status.phone_number_id.slice(0,8) + '...' : '❌ Not set'}</div>
            </div>
            <div>
              <div style={label}>Access Token</div>
              <div style={value}>{status.token_set ? '✅ Set' : '❌ Not set'}</div>
            </div>
            <div>
              <div style={label}>Webhook Verify Token</div>
              <div style={value}>{status.webhook_token_set ? '✅ Set' : '❌ Not set'}</div>
            </div>
            <div>
              <div style={label}>Overall Status</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: status.ready ? '#22c55e' : '#ef4444' }}>
                {status.ready ? '✅ Ready' : '❌ Not configured'}
              </div>
            </div>
          </div>
        )}
        <button onClick={checkStatus} style={{ marginTop: 12, background: '#1a1a1a', border: '1px solid #333', color: '#888', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
          🔄 Refresh Status
        </button>
      </div>

      {/* Templates Status */}
      <div style={card}>
        <div style={label}>Approved Templates</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {[
            { name: 'rs_zevar_order_interactive', desc: 'Order confirmation with Yes/Cancel buttons' },
            { name: 'rs_zevar_order_dispatched', desc: 'Dispatch notification with tracking' },
          ].map(t => (
            <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#0f0f0f', borderRadius: 6 }}>
              <span style={{ color: '#22c55e' }}>✅</span>
              <div>
                <div style={{ fontSize: 12, color: '#e2e8f0' }}>{t.name}</div>
                <div style={{ fontSize: 11, color: '#555' }}>{t.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Webhook Status */}
      <div style={card}>
        <div style={label}>Shopify Webhook</div>
        <div style={{ fontSize: 13, color: '#e2e8f0', marginTop: 6 }}>
          <div>📍 URL: <span style={{ color: '#c9a96e' }}>erp.rszevar.com/api/shopify/webhooks/orders-create</span></div>
          <div style={{ marginTop: 4 }}>📍 URL: <span style={{ color: '#c9a96e' }}>erp.rszevar.com/api/shopify/webhooks/orders-fulfilled</span></div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#555' }}>Shopify Admin → Settings → Notifications → Webhooks mein register karein</div>
        </div>
      </div>

      {/* Test Message */}
      {isSuperAdmin && (
        <div style={card}>
          <div style={label}>Test Message Bhejo</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <input
              value={testPhone}
              onChange={e => setTestPhone(e.target.value)}
              placeholder="03001234567"
              style={{ flex: 1, background: '#0f0f0f', border: '1px solid #333', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}
            />
            <button onClick={sendTest} disabled={testing || !testPhone} style={{ background: '#c9a96e', color: '#000', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {testing ? 'Sending...' : '📤 Send Test'}
            </button>
          </div>
          {testResult && (
            <div style={{ marginTop: 10, fontSize: 13, color: testResult.startsWith('✅') ? '#22c55e' : '#ef4444' }}>
              {testResult}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>Test hello_world template message bhejega</div>
        </div>
      )}
    </div>
  );
}

function DiagnosticsTab({ check, label }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(`/api/settings/diagnostics?check=${check}`).then(r => r.json()).then(d => {
      if (d.success) setData(d[check]); else setError(d.error);
      setLoading(false);
    }).catch(e => { setError(e.message); setLoading(false); });
  }, [check, refreshKey]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#555' }}>⟳ Running diagnostics…</div>;
  if (error) return (
    <div style={sectionStyle}>
      <div style={{ color: '#ef4444' }}>❌ {error}</div>
      <button onClick={() => setRefreshKey(k => k + 1)} style={{ marginTop: 10, background: '#1a1a1a', border: `1px solid ${border}`, color: '#ccc', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>Retry</button>
    </div>
  );

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: gold }}>{label}</h3>
        <button onClick={() => setRefreshKey(k => k + 1)} style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>⟳ Refresh</button>
      </div>
      {check === 'shopify' && <ShopifyView data={data} />}
      {check === 'leopards' && <LeopardsView data={data} />}
      {check === 'postex' && <PostExView data={data} />}
      {check === 'kangaroo' && <KangarooView data={data} />}
      {check === 'system' && <SystemView data={data} />}
    </div>
  );
}

function ShopifyView({ data }) {
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
        </div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Credentials</div>
        <KV label="Store Domain" value={data.store_domain} mono />
        <KV label="Access Token" value={data.access_token} mono />
        <KV label="Webhook Secret" value={data.webhook_secret} mono />
        <div style={{ marginTop: 10 }}><VercelLink envVar="SHOPIFY_ACCESS_TOKEN" /></div>
      </div>
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
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Webhooks ({data.webhooks?.registered || 0})</div>
        {data.webhooks?.list?.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.webhooks.list.map((w, i) => (
              <div key={i} style={{ background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
                <div style={{ color: gold, fontWeight: 600 }}>{w.topic}</div>
                <div style={{ color: '#666', marginTop: 2, fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all' }}>{w.address}</div>
              </div>
            ))}
          </div>
        ) : <div style={{ fontSize: 12, color: '#555' }}>No webhooks registered</div>}
      </div>
      <div>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Last Sync</div>
        <KV label="Last synced at" value={fmtDate(data.last_sync)} />
        <KV label="Total orders" value={data.order_counts?.total ?? 0} />
      </div>
    </div>
  );
}

function LeopardsView({ data }) {
  if (!data) return null;
  const c = data.connection || {};
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Connection</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusDot status={c.status} />
          <span style={{ color: c.status === 'ok' ? '#22c55e' : '#ef4444', fontSize: 13, fontWeight: 600 }}>
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
        <div style={{ marginTop: 10 }}><VercelLink envVar="LEOPARDS_API_KEY" /></div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Order Counts</div>
        <KV label="Total" value={data.counts?.total} />
        <KV label="Delivered" value={data.counts?.delivered} />
        <KV label="Paid" value={data.counts?.paid} />
        <KV label="Unpaid" value={data.counts?.unpaid} />
      </div>
      {data.last_status_sync && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Last Status Sync</div>
          <KV label="Ran" value={`${timeAgo(data.last_status_sync.created_at)} (${fmtDate(data.last_status_sync.created_at)})`} />
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
          <KV label="Ran" value={`${timeAgo(data.last_payment_sync.created_at)} (${fmtDate(data.last_payment_sync.created_at)})`} />
          <KV label="Marked paid" value={data.last_payment_sync.marked_paid} />
          <KV label="Duration" value={`${data.last_payment_sync.duration_ms}ms`} />
        </div>
      )}
    </div>
  );
}

function PostExView({ data }) {
  if (!data) return null;
  return (
    <div>
      <div style={{ background: '#2a1a00', border: '1px solid #664400', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 12, color: '#fbbf24' }}>
        ⚠️ <strong>Deprecated.</strong> {data.note}
      </div>
      <KV label="Configured" value={data.configured ? 'Yes' : 'No'} />
      <KV label="API Token" value={data.api_token} mono />
      <KV label="Store ID" value={data.store_id} mono />
      <KV label="PostEx orders" value={data.order_count} />
      <div style={{ marginTop: 16 }}><VercelLink envVar="POSTEX_API_TOKEN" /></div>
    </div>
  );
}

function KangarooView({ data }) {
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
      <KV label="Kangaroo orders" value={data.order_count} />
      <div style={{ marginTop: 16 }}><VercelLink envVar="KANGAROO_API_PASSWORD" /></div>
    </div>
  );
}

function SystemView({ data }) {
  if (!data) return null;
  const s = data.supabase || {};
  return (
    <div>
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
            <KV label="Orders" value={data.db_stats.orders} />
            <KV label="Products" value={data.db_stats.products} />
            <KV label="Customers" value={data.db_stats.customers} />
          </>
        )}
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Environment Variables</div>
        {Object.entries(data.env_vars || {}).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${border}` }}>
            <span style={{ fontSize: 11, color: '#ccc', fontFamily: 'monospace' }}>{k}</span>
            <Badge color={v ? '#22c55e' : '#ef4444'}>{v ? 'SET' : 'MISSING'}</Badge>
          </div>
        ))}
      </div>
      <div>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Recent Sync Runs ({data.recent_syncs?.length || 0})</div>
        {data.recent_syncs?.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.recent_syncs.map((sync, i) => (
              <div key={i} style={{ background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
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
        ) : <div style={{ fontSize: 12, color: '#555' }}>No sync runs recorded yet</div>}
      </div>
    </div>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────
export default function SettingsPage() {
  const { can } = useUser();
  // ── Granular perm gates (May 2 2026) ──
  // Pehle role==='super_admin' tha. Ab settings.edit perm-driven hai.
  // Custom roles bhi settings access pa sakte hain via /roles toggle.
  const canEdit          = can('settings.edit');
  const canTags          = can('settings.tags');
  const canBusinessRules = can('settings.business_rules');
  const canDiagnostics   = can('settings.diagnostics');

  const [settings, setSettings] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [activeTab, setActiveTab] = useState('store');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [role, setRole] = useState(null);

  // isSuperAdmin alias for backwards compat — settings.edit holders are
  // effectively "super-admin equivalents" for settings UI gating.
  const isSuperAdmin = canEdit;

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

  const handleChange = (key, value) => setDrafts(d => ({ ...d, [key]: value }));

  const hasChanges = Object.keys(drafts).length > 0;

  const save = async () => {
    if (!hasChanges) return;
    setSaving(true); setMsg(null);
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
      } else setMsg({ type: 'error', text: `✗ ${d.error || 'Save failed'}` });
    } catch (e) { setMsg({ type: 'error', text: `✗ ${e.message}` }); }
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
            {role && <span style={{ marginLeft: 10, color: isSuperAdmin ? '#22c55e' : '#f87171' }}>· Role: {role}{!isSuperAdmin && ' (read-only)'}</span>}
          </p>
        </div>
        {msg && (
          <div style={{
            padding: '8px 14px', borderRadius: 8, fontSize: 12, maxWidth: 600,
            background: msg.type === 'success' ? 'rgba(74,222,128,0.12)' : msg.type === 'error' ? 'rgba(248,113,113,0.12)' : 'rgba(96,165,250,0.12)',
            border: `1px solid ${msg.type === 'success' ? '#4ade80' : msg.type === 'error' ? '#f87171' : '#60a5fa'}`,
            color: msg.type === 'success' ? '#4ade80' : msg.type === 'error' ? '#f87171' : '#60a5fa',
          }}>{msg.text}</div>
        )}
      </div>

      {!isSuperAdmin && (
        <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid #ef444444', color: '#f87171', padding: '12px 16px', borderRadius: 8, fontSize: 12, marginBottom: 16 }}>
          ⚠️ Only super admin can modify settings. You are viewing in read-only mode.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: 8, height: 'fit-content' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => { setActiveTab(t.id); setDrafts({}); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: activeTab === t.id ? '#1a1a1a' : 'transparent',
                border: 'none', borderLeft: activeTab === t.id ? `3px solid ${gold}` : '3px solid transparent',
                color: activeTab === t.id ? gold : '#aaa',
                padding: '11px 14px', fontSize: 13, fontWeight: activeTab === t.id ? 600 : 400,
                cursor: 'pointer', borderRadius: 6, marginBottom: 2, fontFamily: 'inherit',
              }}>{t.label}</button>
          ))}
        </div>

        <div>
          {loading && <div style={{ textAlign: 'center', padding: 60, color: '#555' }}>Loading settings...</div>}
          {!loading && tab.kind === 'audit' && <AuditLogTab />}
          {!loading && tab.kind === 'tags' && <TagsTab isSuperAdmin={canTags} />}
          {!loading && tab.kind === 'diagnostics' && <DiagnosticsTab check={tab.check} label={tab.label} />}
          {!loading && tab.kind === 'whatsapp' && <WhatsAppTab isSuperAdmin={canEdit} />}
          {!loading && tab.kind === 'settings' && (
            <>
              <div style={sectionStyle}>
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ margin: 0, fontSize: 16, color: gold }}>{tab.label}</h3>
                  <p style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                    {tab.id === 'store' && 'General store information used across ERP and invoices'}
                    {tab.id === 'business_rules' && 'Control how ERP handles orders, statuses, and automation'}
                    {tab.id === 'notifications' && 'Configure email/WhatsApp alerts (WhatsApp is a future feature)'}
                  </p>
                </div>
                {tabSettings.length === 0 && <div style={{ color: '#444', padding: 20, textAlign: 'center', fontSize: 13 }}>No settings in this category yet</div>}
                {tabSettings.map(s => {
                  // Business rules tab gated separately; other settings categories use canEdit
                  const rowEditable = tab.id === 'business_rules' ? canBusinessRules : canEdit;
                  return (
                    <SettingRow key={s.key} setting={s} value={getCurrentValue(s)} onChange={(v) => handleChange(s.key, v)} disabled={!rowEditable} />
                  );
                })}
              </div>
              {hasChanges && isSuperAdmin && (
                <div style={{ position: 'sticky', bottom: 16, background: '#0a0a0a', border: `1px solid ${gold}`, borderRadius: 12, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                  <div style={{ fontSize: 13, color: gold }}>{Object.keys(drafts).length} unsaved change{Object.keys(drafts).length !== 1 ? 's' : ''}</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={discard} disabled={saving} style={{ background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 8, padding: '9px 18px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Discard</button>
                    <button onClick={save} disabled={saving} style={{ background: saving ? '#1a1a1a' : 'linear-gradient(135deg, #c9a96e 0%, #b8975d 100%)', border: `1px solid ${saving ? border : '#c9a96e'}`, color: saving ? '#888' : '#000', borderRadius: 8, padding: '9px 22px', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>{saving ? 'Saving...' : '💾 Save Changes'}</button>
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
