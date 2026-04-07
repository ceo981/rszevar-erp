'use client';
import { useState, useEffect } from 'react';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';

const SECTIONS = [
  {
    id: 'shopify',
    label: '🛍️ Shopify',
    category: 'shopify',
    fields: [
      { key: 'SHOPIFY_STORE_URL', label: 'Store URL', placeholder: 'yourstore.myshopify.com' },
      { key: 'SHOPIFY_ACCESS_TOKEN', label: 'Access Token', placeholder: 'shpat_xxxxxxxxxxxx', secret: true },
    ],
  },
  {
    id: 'postex',
    label: '📦 PostEx',
    category: 'postex',
    fields: [
      { key: 'POSTEX_API_TOKEN', label: 'API Token', placeholder: 'ZmU2...', secret: true },
      { key: 'POSTEX_STORE_ID', label: 'Store ID', placeholder: 'Your store ID' },
    ],
  },
  {
    id: 'leopards',
    label: '🐆 Leopards',
    category: 'leopards',
    fields: [
      { key: 'LEOPARDS_API_KEY', label: 'API Key', placeholder: 'xxxxxxxx', secret: true },
      { key: 'LEOPARDS_API_PASSWORD', label: 'API Password', placeholder: 'xxxxxxxx', secret: true },
      { key: 'LEOPARDS_SHIPPER_ID', label: 'Shipper ID', placeholder: 'Your shipper ID' },
    ],
  },
  {
    id: 'kangaroo',
    label: '🦘 Kangaroo',
    category: 'kangaroo',
    fields: [
      { key: 'KANGAROO_CLIENT_ID', label: 'Client ID', placeholder: '549' },
      { key: 'KANGAROO_API_PASSWORD', label: 'API Password', placeholder: 'xxxxxxxx', secret: true },
    ],
  },
  {
    id: 'store',
    label: '🏪 Store Info',
    category: 'store',
    fields: [
      { key: 'STORE_NAME', label: 'Store Name', placeholder: 'RS ZEVAR' },
      { key: 'STORE_PHONE', label: 'WhatsApp Number', placeholder: '923XXXXXXXXX' },
      { key: 'STORE_EMAIL', label: 'Email', placeholder: 'info@rszevar.com' },
      { key: 'STORE_ADDRESS', label: 'Address', placeholder: 'Karachi, Pakistan' },
    ],
  },
];

function SecretField({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 0 }}>
      <input
        type={show ? 'text' : 'password'}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, background: '#1a1a1a', border: `1px solid ${border}`, borderRight: 'none', color: '#fff', borderRadius: '7px 0 0 7px', padding: '9px 12px', fontSize: 13 }}
      />
      <button onClick={() => setShow(s => !s)}
        style={{ background: '#1e1e1e', border: `1px solid ${border}`, color: '#555', borderRadius: '0 7px 7px 0', padding: '0 12px', cursor: 'pointer', fontSize: 12 }}>
        {show ? '🙈' : '👁'}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [activeSection, setActiveSection] = useState('shopify');

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        // Flatten settings
        const flat = {};
        for (const [cat, keys] of Object.entries(d.settings || {})) {
          for (const [k, v] of Object.entries(keys)) flat[k] = v;
        }
        setValues(flat);
        setLoading(false);
      });
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg('');
    // Group by category
    const grouped = {};
    for (const section of SECTIONS) {
      grouped[section.category] = {};
      for (const field of section.fields) {
        grouped[section.category][field.key] = values[field.key] || '';
      }
    }
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: grouped }),
    });
    const d = await r.json();
    setMsg(d.success ? '✅ Settings saved!' : '❌ ' + d.error);
    setSaving(false);
  };

  const section = SECTIONS.find(s => s.id === activeSection);

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff', padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Settings</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>API keys aur store configuration manage karo</p>
      </div>

      <div style={{ display: 'flex', gap: 20 }}>
        {/* Sidebar */}
        <div style={{ width: 180, flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setActiveSection(s.id)}
                style={{ background: activeSection === s.id ? '#1e1e1e' : 'transparent', border: `1px solid ${activeSection === s.id ? '#333' : 'transparent'}`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: activeSection === s.id ? gold : '#555', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1 }}>
          {loading ? (
            <div style={{ color: '#444', padding: 40, textAlign: 'center' }}>Loading...</div>
          ) : (
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '24px 28px' }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{section?.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {section?.fields.map(field => (
                  <div key={field.key}>
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{field.label}</div>
                    {field.secret ? (
                      <SecretField value={values[field.key]} onChange={v => setValues(prev => ({...prev, [field.key]: v}))} placeholder={field.placeholder} />
                    ) : (
                      <input type="text" value={values[field.key] || ''} onChange={e => setValues(prev => ({...prev, [field.key]: e.target.value}))} placeholder={field.placeholder}
                        style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
                    )}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={save} disabled={saving}
                  style={{ background: gold, color: '#000', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer' }}>
                  {saving ? 'Saving...' : '💾 Save Settings'}
                </button>
                {msg && <span style={{ fontSize: 13, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</span>}
              </div>

              {/* Note about Vercel */}
              <div style={{ marginTop: 20, padding: '12px 16px', background: '#0a0a0a', border: `1px solid ${border}`, borderRadius: 8, fontSize: 12, color: '#555' }}>
                ⚠️ Note: Yeh settings Supabase mein save hongi. Courier sync ke liye Vercel environment variables bhi update karo (Vercel → Settings → Environment Variables).
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
