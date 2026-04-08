'use client';
import { useState, useEffect, useCallback } from 'react';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';

// ─── Tab definitions (Chunks 2 & 3 will fill the "comingSoon" tabs) ────────
const TABS = [
  { id: 'store',          label: '🏪 Store Info',      category: 'store',          ready: true  },
  { id: 'business_rules', label: '⚙️ Business Rules',  category: 'business_rules', ready: true  },
  { id: 'shopify',        label: '🛒 Shopify',         category: 'shopify',        ready: false },
  { id: 'leopards',       label: '🐆 Leopards',        category: 'leopards',       ready: false },
  { id: 'postex',         label: '📦 PostEx',          category: 'postex',         ready: false },
  { id: 'kangaroo',       label: '🦘 Kangaroo',        category: 'kangaroo',       ready: false },
  { id: 'tags',           label: '🏷️ Tags',            category: 'tags',           ready: false },
  { id: 'notifications',  label: '🔔 Notifications',   category: 'notifications',  ready: false },
  { id: 'system',         label: '💻 System Health',   category: 'system',         ready: false },
  { id: 'audit',          label: '📋 Audit Log',       category: 'audit',          ready: true  },
];

// ─── Small styled inputs ──────────────────────────────────────────────────
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

// ─── Reusable setting row ─────────────────────────────────────────────────
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
              width: 44,
              height: 24,
              borderRadius: 12,
              background: value ? '#22c55e' : '#333',
              position: 'relative',
              transition: 'all 0.2s',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <div style={{
              position: 'absolute',
              top: 2,
              left: value ? 22 : 2,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: '#fff',
              transition: 'all 0.2s',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }} />
          </div>
          <span style={{ color: value ? '#22c55e' : '#888', fontSize: 13, fontWeight: 600 }}>
            {value ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      )}

      {isNumber && (
        <input
          type="number"
          value={value ?? 0}
          onChange={e => onChange(Number(e.target.value))}
          disabled={disabled}
          style={{ ...inputStyle, maxWidth: 200, opacity: disabled ? 0.5 : 1 }}
        />
      )}

      {isArray && (
        <input
          type="text"
          value={Array.isArray(value) ? value.join(', ') : ''}
          onChange={e => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          disabled={disabled}
          placeholder="comma, separated, values"
          style={{ ...inputStyle, opacity: disabled ? 0.5 : 1 }}
        />
      )}

      {!isBool && !isNumber && !isArray && (
        <input
          type="text"
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          style={{ ...inputStyle, opacity: disabled ? 0.5 : 1 }}
        />
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
        <p style={{ fontSize: 12, color: '#555', marginTop: 4 }}>Last 50 changes by any super admin</p>
      </div>

      {entries.length === 0 && (
        <div style={{ color: '#444', textAlign: 'center', padding: 40, fontSize: 13 }}>No changes recorded yet</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map(e => (
          <div key={e.id} style={{ background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
              <div style={{ fontWeight: 600, color: gold, fontSize: 13 }}>{e.setting_key}</div>
              <div style={{ fontSize: 11, color: '#555', whiteSpace: 'nowrap' }}>
                {new Date(e.changed_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
              by {e.changed_by_email || 'unknown'}
            </div>
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

// ─── Coming Soon placeholder ──────────────────────────────────────────────
function ComingSoonTab({ title }) {
  return (
    <div style={sectionStyle}>
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
        <h3 style={{ margin: 0, color: gold, fontSize: 18 }}>{title}</h3>
        <p style={{ fontSize: 13, color: '#666', marginTop: 10 }}>
          Chunk 2 / 3 mein aayega — coming in the next phase
        </p>
      </div>
    </div>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────
export default function SettingsPage() {
  const [settings, setSettings] = useState([]);
  const [drafts, setDrafts] = useState({}); // { key: value } — uncommitted changes
  const [activeTab, setActiveTab] = useState('store');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [role, setRole] = useState(null);

  const isSuperAdmin = role === 'super_admin';

  // Load all settings + user role
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

  // Active tab settings with drafts applied
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

  // ─── Render ───────────────────────────────────────────────────────────
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
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 9,
                  background: '#333',
                  color: '#888',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}>soon</span>
              )}
            </button>
          ))}
        </div>

        {/* Main content */}
        <div>
          {loading && <div style={{ textAlign: 'center', padding: 60, color: '#555' }}>Loading settings...</div>}

          {!loading && tab.id === 'audit' && <AuditLogTab />}

          {!loading && !tab.ready && tab.id !== 'audit' && (
            <ComingSoonTab title={tab.label} />
          )}

          {!loading && tab.ready && tab.id !== 'audit' && (
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

              {/* Save bar */}
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
                    <button
                      onClick={discard}
                      disabled={saving}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${border}`,
                        color: '#888',
                        borderRadius: 8,
                        padding: '9px 18px',
                        fontSize: 13,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      Discard
                    </button>
                    <button
                      onClick={save}
                      disabled={saving}
                      style={{
                        background: saving ? '#1a1a1a' : 'linear-gradient(135deg, #c9a96e 0%, #b8975d 100%)',
                        border: `1px solid ${saving ? border : '#c9a96e'}`,
                        color: saving ? '#888' : '#000',
                        borderRadius: 8,
                        padding: '9px 22px',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: saving ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {saving ? 'Saving...' : '💾 Save Changes'}
                    </button>
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
