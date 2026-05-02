'use client';
import { useState, useEffect } from 'react';
import { useUser } from '@/context/UserContext';

const ROLES = [
  { id: 'dispatcher',     label: 'Dispatcher',              name: 'Adil' },
  { id: 'ops_manager',    label: 'Operations Manager',       name: 'Sharjeel' },
  { id: 'social_media',   label: 'Social Media Manager',     name: 'Salman' },
  { id: 'wholesale',      label: 'Wholesale & Product Content', name: 'Farhan' },
  { id: 'packing',        label: 'Packing Team',             name: '' },
  { id: 'inventory',      label: 'Inventory Manager',        name: 'Abrar' },
];

const EMPLOYEES = [
  'Abrar', 'Sharjeel', 'Adil', 'Salman', 'Farhan',
  'Hassan', 'Umer', 'Ahmed', 'Zeeshan', 'Anis', 'Mustafa', 'Fahad',
];

function today() { return new Date().toISOString().slice(0, 10); }
function thisMonth() { return new Date().toISOString().slice(0, 7); }

const inp = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
  color: '#e2e8f0', padding: '8px 12px', fontSize: 14, outline: 'none', width: '100%',
};
const btn = {
  background: '#c9a96e', color: '#0f172a', border: 'none', borderRadius: 6,
  padding: '10px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 14,
};
const card = { background: '#1e293b', borderRadius: 10, padding: 16, marginBottom: 12 };
const label = { color: '#94a3b8', fontSize: 12, marginBottom: 6, display: 'block' };
const gold = '#c9a96e';

// ── Role-specific form fields ──────────────────────────────────────────────

function DispatcherForm({ data, onChange }) {
  const f = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div>
      <h4 style={{ color: gold, marginBottom: 12 }}>Aaj ke Dispatched Orders</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
        {[['postex', 'PostEx'], ['leopards', 'Leopards'], ['kangaroo', 'Kangaroo']].map(([k, label]) => (
          <div key={k}>
            <span style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>{label}</span>
            <input type="number" min="0" value={data[k] || 0} onChange={e => f(k, e.target.value)} style={inp} />
          </div>
        ))}
      </div>
      <div>
        <span style={label}>Notes (optional)</span>
        <textarea value={data.notes || ''} onChange={e => f('notes', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="Koi special case, issue, etc." />
      </div>
    </div>
  );
}

function OpsManagerForm({ data, onChange }) {
  const f = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div>
      <h4 style={{ color: gold, marginBottom: 12 }}>Aaj ka Operations Summary</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
        {[
          ['orders_confirmed', 'Orders Confirm kiye'],
          ['orders_dispatched', 'Orders Dispatch kiye'],
          ['international_cleared', 'International Cleared'],
          ['pending_orders', 'Pending Orders (abhi)'],
          ['attempts_made', 'Follow-up Attempts'],
          ['returned_handled', 'Returns Handle kiye'],
        ].map(([k, lbl]) => (
          <div key={k}>
            <span style={label}>{lbl}</span>
            <input type="number" min="0" value={data[k] || 0} onChange={e => f(k, e.target.value)} style={inp} />
          </div>
        ))}
      </div>
      <div>
        <span style={label}>Notes</span>
        <textarea value={data.notes || ''} onChange={e => f('notes', e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} placeholder="Koi issues, important updates..." />
      </div>
    </div>
  );
}

function SocialMediaForm({ data, onChange }) {
  const f = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div>
      <h4 style={{ color: gold, marginBottom: 12 }}>Aaj ki Social Media Activity</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
        {[
          ['fb_posts', 'Facebook Posts'],
          ['insta_posts', 'Instagram Posts'],
          ['yt_shorts', 'YouTube Shorts'],
          ['tiktok_reels', 'TikTok Reels'],
          ['pinterest_pins', 'Pinterest Pins'],
          ['stories', 'Stories (FB/Insta)'],
        ].map(([k, lbl]) => (
          <div key={k}>
            <span style={label}>{lbl}</span>
            <input type="number" min="0" value={data[k] || 0} onChange={e => f(k, e.target.value)} style={inp} />
          </div>
        ))}
      </div>
      <h4 style={{ color: gold, marginBottom: 12 }}>Sales (Approx)</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
        {[
          ['whatsapp_orders', 'WhatsApp se Orders (approx)'],
          ['fb_orders', 'Facebook se Orders (approx)'],
          ['insta_orders', 'Instagram se Orders (approx)'],
          ['dm_inquiries', 'DM Inquiries'],
        ].map(([k, lbl]) => (
          <div key={k}>
            <span style={label}>{lbl}</span>
            <input type="number" min="0" value={data[k] || 0} onChange={e => f(k, e.target.value)} style={inp} />
          </div>
        ))}
      </div>
      <div>
        <span style={label}>Notes / Campaigns</span>
        <textarea value={data.notes || ''} onChange={e => f('notes', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} />
      </div>
    </div>
  );
}

function WholesaleForm({ data, onChange }) {
  const f = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div>
      <h4 style={{ color: gold, marginBottom: 12 }}>Wholesale & Product Content</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
        <div>
          <span style={label}>Aaj ki Sales (Rs)</span>
          <input type="number" min="0" value={data.sales_amount || 0} onChange={e => f('sales_amount', e.target.value)} style={inp} />
        </div>
        <div>
          <span style={label}>Product Shoots / Pics liye</span>
          <input type="number" min="0" value={data.product_shoots || 0} onChange={e => f('product_shoots', e.target.value)} style={inp} />
        </div>
        <div>
          <span style={label}>Total Pictures</span>
          <input type="number" min="0" value={data.total_pictures || 0} onChange={e => f('total_pictures', e.target.value)} style={inp} />
        </div>
        <div>
          <span style={label}>New Products Listed</span>
          <input type="number" min="0" value={data.products_listed || 0} onChange={e => f('products_listed', e.target.value)} style={inp} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <span style={label}>Wholesale Order IDs (agar placement ki ho)</span>
        <input value={data.wholesale_order_ids || ''} onChange={e => f('wholesale_order_ids', e.target.value)} style={inp} placeholder="ZEVAR-XXXX, ZEVAR-XXXX (comma separated)" />
      </div>
      <div>
        <span style={label}>Notes</span>
        <textarea value={data.notes || ''} onChange={e => f('notes', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} />
      </div>
    </div>
  );
}

function PackingForm({ data, onChange }) {
  const f = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div>
      <h4 style={{ color: gold, marginBottom: 8 }}>Packing Summary</h4>
      <p style={{ color: '#475569', fontSize: 13, marginBottom: 12 }}>* Items packed automatically track hote hain order assignment se. Yahan extra notes add karo.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
        <div>
          <span style={label}>Orders Packed Today</span>
          <input type="number" min="0" value={data.orders_packed || 0} onChange={e => f('orders_packed', e.target.value)} style={inp} />
        </div>
        <div>
          <span style={label}>Items Packed Today</span>
          <input type="number" min="0" value={data.items_packed || 0} onChange={e => f('items_packed', e.target.value)} style={inp} />
        </div>
      </div>
      <div>
        <span style={label}>Notes / Issues</span>
        <textarea value={data.notes || ''} onChange={e => f('notes', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="Koi packing issue, missing item, etc." />
      </div>
    </div>
  );
}

function InventoryForm({ data, onChange }) {
  const f = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div>
      <h4 style={{ color: gold, marginBottom: 12 }}>Inventory Summary</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
        {[
          ['items_restocked', 'Items Restock kiye'],
          ['items_counted', 'Items Count kiye'],
          ['discrepancies', 'Discrepancies mile'],
          ['damage_reported', 'Damage Report kiye'],
        ].map(([k, lbl]) => (
          <div key={k}>
            <span style={label}>{lbl}</span>
            <input type="number" min="0" value={data[k] || 0} onChange={e => f(k, e.target.value)} style={inp} />
          </div>
        ))}
      </div>
      <div>
        <span style={label}>Notes</span>
        <textarea value={data.notes || ''} onChange={e => f('notes', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} />
      </div>
    </div>
  );
}

// ── Submit Form ────────────────────────────────────────────────────────────

function SubmitForm() {
  const [selectedRole, setSelectedRole] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [formData, setFormData] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const role = ROLES.find(r => r.id === selectedRole);

  async function handleSubmit() {
    if (!selectedRole || !employeeName) { setMsg('❌ Role aur name select karo'); return; }
    setSubmitting(true);
    const r = await fetch('/api/hr/work-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_name: employeeName, role: selectedRole, data: formData }),
    });
    const d = await r.json();
    if (d.success) {
      setMsg('✅ Aapka kaam submit ho gaya!');
      setSubmitted(true);
    } else {
      setMsg('❌ ' + d.error);
    }
    setSubmitting(false);
  }

  if (submitted) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
        <h2 style={{ color: gold, marginBottom: 8 }}>Shukriya {employeeName}!</h2>
        <p style={{ color: '#94a3b8' }}>Aapka aaj ka kaam submit ho gaya.</p>
        <button onClick={() => { setSubmitted(false); setFormData({}); setMsg(''); }} style={{ ...btn, marginTop: 20 }}>
          Dobara Submit Karo
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <h2 style={{ color: gold, marginBottom: 4 }}>📋 Submit Your Work</h2>
      <p style={{ color: '#475569', marginBottom: 20, fontSize: 14 }}>Aaj ka kaam yahan submit karo</p>

      {/* Step 1: Select who you are */}
      <div style={card}>
        <h4 style={{ color: gold, marginBottom: 12 }}>Pehle batao — Aap kaun hain?</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 12 }}>
          {ROLES.map(r => (
            <button key={r.id} onClick={() => { setSelectedRole(r.id); setFormData({}); if (r.name) setEmployeeName(r.name); }}
              style={{
                padding: '10px 14px', borderRadius: 8, border: `1px solid ${selectedRole === r.id ? gold : '#334155'}`,
                background: selectedRole === r.id ? '#c9a96e22' : '#0f172a',
                color: selectedRole === r.id ? gold : '#94a3b8',
                cursor: 'pointer', fontSize: 13, fontWeight: selectedRole === r.id ? 700 : 400, textAlign: 'left',
              }}>
              {r.label}
            </button>
          ))}
        </div>

        {selectedRole && (
          <div>
            <span style={label}>Aapka Naam</span>
            <select value={employeeName} onChange={e => setEmployeeName(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 200 }}>
              <option value="">-- Select Name --</option>
              {EMPLOYEES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Step 2: Role-specific form */}
      {selectedRole && employeeName && (
        <div style={card}>
          {selectedRole === 'dispatcher'   && <DispatcherForm   data={formData} onChange={setFormData} />}
          {selectedRole === 'ops_manager'  && <OpsManagerForm   data={formData} onChange={setFormData} />}
          {selectedRole === 'social_media' && <SocialMediaForm  data={formData} onChange={setFormData} />}
          {selectedRole === 'wholesale'    && <WholesaleForm    data={formData} onChange={setFormData} />}
          {selectedRole === 'packing'      && <PackingForm      data={formData} onChange={setFormData} />}
          {selectedRole === 'inventory'    && <InventoryForm    data={formData} onChange={setFormData} />}
        </div>
      )}

      {selectedRole && employeeName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={handleSubmit} disabled={submitting} style={{ ...btn, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? 'Submitting...' : '✅ Submit Karo'}
          </button>
          {msg && <span style={{ color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</span>}
        </div>
      )}
    </div>
  );
}

// ── CEO Report View ────────────────────────────────────────────────────────

function CEOReport() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(thisMonth() + '-01');
  const [dateTo, setDateTo] = useState(today());
  const [roleFilter, setRoleFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ from: dateFrom, to: dateTo });
    if (roleFilter) params.set('role', roleFilter);
    fetch(`/api/hr/work-submit?${params}`)
      .then(r => r.json())
      .then(d => setSubmissions(d.submissions || []))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, roleFilter]);

  const roleLabels = {
    dispatcher: 'Dispatcher', ops_manager: 'Ops Manager',
    social_media: 'Social Media', wholesale: 'Wholesale',
    packing: 'Packing', inventory: 'Inventory',
  };

  const renderData = (role, data) => {
    const rows = [];
    for (const [k, v] of Object.entries(data || {})) {
      if (k === 'notes' || !v || v === '0' || v === 0) continue;
      rows.push(<div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 12 }}>
        <span style={{ color: '#94a3b8' }}>{k.replace(/_/g, ' ')}</span>
        <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{v}</span>
      </div>);
    }
    if (data?.notes) rows.push(<div key="notes" style={{ marginTop: 4, fontSize: 12, color: '#475569', fontStyle: 'italic' }}>{data.notes}</div>);
    return rows;
  };

  return (
    <div>
      <h3 style={{ color: gold, marginBottom: 16 }}>📊 Work Submissions Report</h3>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <span style={label}>From</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inp, width: 'auto' }} />
        </div>
        <div>
          <span style={label}>To</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inp, width: 'auto' }} />
        </div>
        <div>
          <span style={label}>Role</span>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={{ ...inp, width: 'auto' }}>
            <option value="">All Roles</option>
            {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 18 }}>{submissions.length} submissions</div>
      </div>

      {loading ? <div style={{ color: '#94a3b8' }}>Loading...</div> : submissions.length === 0 ? (
        <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>Koi submission nahi mili</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {submissions.map(s => (
            <div key={s.id} style={{ background: '#1e293b', borderRadius: 10, padding: 14, border: '1px solid #334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#e2e8f0' }}>{s.employee_name}</div>
                  <div style={{ fontSize: 11, color: gold }}>{roleLabels[s.role] || s.role}</div>
                </div>
                <div style={{ fontSize: 11, color: '#475569', textAlign: 'right' }}>
                  {new Date(s.submission_date).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })}
                  <br />
                  {new Date(s.created_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div style={{ borderTop: '1px solid #334155', paddingTop: 8 }}>
                {renderData(s.role, s.data)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────

export default function WorkSubmitPage() {
  const { can } = useUser();
  // ── Granular perm gate (May 2 2026) ──
  // Pehle isSuperAdmin tha. Ab work_submit.view_others (super_admin only by default).
  const canViewOthers = can('work_submit.view_others');

  const [view, setView] = useState('submit');

  return (
    <div style={{ padding: 24, minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: gold, margin: 0 }}>📋 Daily Work Submit</h1>
          <p style={{ color: '#475569', margin: '4px 0 0', fontSize: 13 }}>{new Date().toLocaleDateString('en-PK', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>
        {canViewOthers && (
          <div style={{ display: 'flex', gap: 8 }}>
            {['submit', 'report'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: view === v ? gold : '#1e293b', color: view === v ? '#0f172a' : '#94a3b8',
              }}>{v === 'submit' ? '📝 Submit' : '📊 Report'}</button>
            ))}
          </div>
        )}
      </div>

      {view === 'submit' ? <SubmitForm /> : <CEOReport />}
    </div>
  );
}
