'use client';
import { useState, useEffect } from 'react';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';
const fmt = n => `Rs ${Number(n || 0).toLocaleString()}`;

const ROLES = [
  'CEO / Super Admin',
  'Operations Manager',
  'Stock & Inventory Manager',
  'Dispatcher',
  'Customer Support & Social Media',
  'Wholesale & Product Content',
  'Packing Team',
  'Other',
];

const ROLE_COLORS = {
  'CEO / Super Admin': '#c9a96e',
  'Operations Manager': '#3b82f6',
  'Stock & Inventory Manager': '#a855f7',
  'Dispatcher': '#22d3ee',
  'Customer Support & Social Media': '#22c55e',
  'Wholesale & Product Content': '#f97316',
  'Packing Team': '#888',
  'Other': '#555',
};

// Pre-load your team
const DEFAULT_TEAM = [
  { name: 'Abdul Rehman', role: 'CEO / Super Admin', phone: '', salary: 0 },
  { name: 'Sharjeel', role: 'Operations Manager', phone: '', salary: 0 },
  { name: 'Abrar', role: 'Stock & Inventory Manager', phone: '', salary: 0 },
  { name: 'Adil', role: 'Dispatcher', phone: '', salary: 0 },
  { name: 'Salman', role: 'Customer Support & Social Media', phone: '', salary: 0 },
  { name: 'Farhan', role: 'Wholesale & Product Content', phone: '', salary: 0 },
  { name: 'Hassan', role: 'Packing Team', phone: '', salary: 0 },
  { name: 'Umer', role: 'Packing Team', phone: '', salary: 0 },
  { name: 'Ahmed', role: 'Packing Team', phone: '', salary: 0 },
  { name: 'Zeeshan', role: 'Packing Team', phone: '', salary: 0 },
  { name: 'Anis', role: 'Packing Team', phone: '', salary: 0 },
  { name: 'Mustafa', role: 'Packing Team', phone: '', salary: 0 },
  { name: 'Fahad', role: 'Packing Team', phone: '', salary: 0 },
];

function Avatar({ name, role }) {
  const initials = name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const color = ROLE_COLORS[role] || '#555';
  return (
    <div style={{ width: 40, height: 40, borderRadius: '50%', background: color + '22', border: `2px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color, flexShrink: 0 }}>
      {initials}
    </div>
  );
}

function RoleBadge({ role }) {
  const color = ROLE_COLORS[role] || '#555';
  return (
    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: color + '22', color, fontWeight: 500 }}>
      {role}
    </span>
  );
}

// ── Add/Edit Modal ────────────────────────────────────────────
function EmployeeModal({ emp, onClose, onSave }) {
  const [form, setForm] = useState(emp || { name: '', role: ROLES[6], phone: '', salary: '', notes: '', join_date: new Date().toISOString().split('T')[0], status: 'active' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async () => {
    if (!form.name || !form.role) { setMsg('Name aur role zaroori hai'); return; }
    setSaving(true);
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: emp?.id ? 'update' : 'add', ...form }),
    });
    const d = await res.json();
    if (d.success) { onSave(); onClose(); }
    else setMsg('Error: ' + d.error);
    setSaving(false);
  };

  const inp = (label, key, type = 'text', opts = {}) => (
    <div>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>{label}</div>
      {opts.select ? (
        <select value={form[key]} onChange={e => setForm(f => ({...f, [key]: e.target.value}))}
          style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit' }}>
          {opts.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={form[key] || ''} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} placeholder={opts.placeholder || ''}
          style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
      )}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 12, padding: 28, width: 420, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: gold }}>{emp?.id ? 'Edit Employee' : 'Add Employee'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {inp('Full Name', 'name', 'text', { placeholder: 'Employee name' })}
          {inp('Role', 'role', 'text', { select: true, options: ROLES })}
          {inp('Phone', 'phone', 'tel', { placeholder: '03XX-XXXXXXX' })}
          {inp('Monthly Salary (Rs)', 'salary', 'number', { placeholder: '0' })}
          {inp('Join Date', 'join_date', 'date')}
          {emp?.id && inp('Status', 'status', 'text', { select: true, options: ['active', 'inactive', 'on_leave'] })}
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Notes</div>
            <textarea value={form.notes || ''} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} placeholder="Optional..."
              style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
          </div>
          {msg && <div style={{ color: '#ef4444', fontSize: 12 }}>{msg}</div>}
          <button onClick={save} disabled={saving} style={{ background: gold, color: '#000', border: 'none', borderRadius: 8, padding: '11px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            {saving ? 'Saving...' : emp?.id ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Salary Panel ──────────────────────────────────────────────
function SalaryPanel({ emp, onClose }) {
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState({ amount: emp.salary || '', month: new Date().toISOString().slice(0, 7), payment_date: new Date().toISOString().split('T')[0], notes: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const r = await fetch('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_salary', employee_id: emp.id }) });
    const d = await r.json();
    setPayments(d.payments || []);
  };

  useEffect(() => { load(); }, []);

  const pay = async () => {
    if (!form.amount) return;
    setSaving(true);
    const r = await fetch('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_salary', employee_id: emp.id, ...form }) });
    const d = await r.json();
    if (d.success) { setMsg('✅ Payment recorded'); load(); }
    else setMsg('❌ ' + d.error);
    setSaving(false);
  };

  const totalPaid = payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 12, padding: 28, width: 440, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: gold }}>{emp.name} — Salary</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>Monthly: {fmt(emp.salary)} · Total paid: {fmt(totalPaid)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Add payment */}
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Record Payment</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Amount (Rs)</div>
              <input type="number" value={form.amount} onChange={e => setForm(f => ({...f, amount: e.target.value}))}
                style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Month</div>
              <input type="month" value={form.month} onChange={e => setForm(f => ({...f, month: e.target.value}))}
                style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>
          <input type="text" placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))}
            style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', marginBottom: 10 }} />
          <button onClick={pay} disabled={saving} style={{ background: gold, color: '#000', border: 'none', borderRadius: 7, padding: '9px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer', width: '100%' }}>
            {saving ? 'Saving...' : '+ Record Payment'}
          </button>
          {msg && <div style={{ marginTop: 8, fontSize: 12, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}
        </div>

        {/* Payment history */}
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: '#888' }}>Payment History</div>
        {payments.length === 0 ? (
          <div style={{ color: '#444', fontSize: 12, textAlign: 'center', padding: 20 }}>No payments recorded yet</div>
        ) : payments.map((p, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid #1a1a1a`, fontSize: 13 }}>
            <div>
              <div style={{ color: '#ccc' }}>{p.month}</div>
              {p.notes && <div style={{ fontSize: 11, color: '#555' }}>{p.notes}</div>}
            </div>
            <div style={{ color: '#22c55e', fontWeight: 600 }}>{fmt(p.amount)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Employees Page ───────────────────────────────────────
export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editEmp, setEditEmp] = useState(null);
  const [salaryEmp, setSalaryEmp] = useState(null);
  const [search, setSearch] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const r = await fetch('/api/employees');
    const d = await r.json();
    setEmployees(d.employees || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const seedTeam = async () => {
    for (const emp of DEFAULT_TEAM) {
      await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', ...emp, join_date: '2025-01-01' }),
      });
    }
    setMsg('✅ Team loaded!');
    load();
  };

  const deleteEmp = async (id) => {
    if (!confirm('Delete this employee?')) return;
    await fetch('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) });
    load();
  };

  const filtered = employees.filter(e =>
    e.name?.toLowerCase().includes(search.toLowerCase()) ||
    e.role?.toLowerCase().includes(search.toLowerCase())
  );

  const totalSalary = employees.filter(e => e.status === 'active').reduce((s, e) => s + parseFloat(e.salary || 0), 0);
  const active = employees.filter(e => e.status === 'active').length;

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff', padding: 24 }}>
      {showModal && <EmployeeModal emp={editEmp} onClose={() => { setShowModal(false); setEditEmp(null); }} onSave={load} />}
      {salaryEmp && <SalaryPanel emp={salaryEmp} onClose={() => setSalaryEmp(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Team</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>{active} active · {fmt(totalSalary)}/month total payroll</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {employees.length === 0 && (
            <button onClick={seedTeam} style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>
              📥 Load My Team
            </button>
          )}
          <button onClick={() => { setEditEmp(null); setShowModal(true); }}
            style={{ background: gold, color: '#000', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Add Employee
          </button>
        </div>
      </div>

      {msg && <div style={{ marginBottom: 14, padding: '10px 16px', background: '#001a0a', border: '1px solid #003300', borderRadius: 8, fontSize: 12, color: '#22c55e' }}>{msg}</div>}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Staff', value: employees.length, color: '#fff' },
          { label: 'Active', value: active, color: '#22c55e' },
          { label: 'On Leave', value: employees.filter(e => e.status === 'on_leave').length, color: '#f97316' },
          { label: 'Monthly Payroll', value: fmt(totalSalary), color: gold },
        ].map(s => (
          <div key={s.label} style={{ background: card, border: `1px solid ${border}`, borderRadius: 9, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or role..."
        style={{ width: '100%', maxWidth: 360, background: card, border: `1px solid ${border}`, color: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13, marginBottom: 16, boxSizing: 'border-box' }} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>Loading team...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>
          {employees.length === 0 ? (
            <div>
              <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
              <div style={{ marginBottom: 8 }}>No team members yet</div>
              <button onClick={seedTeam} style={{ background: gold, color: '#000', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                📥 Load My Team (13 members)
              </button>
            </div>
          ) : 'No results'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {filtered.map(emp => (
            <div key={emp.id} style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <Avatar name={emp.name} role={emp.role} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#fff', marginBottom: 3 }}>{emp.name}</div>
                  <RoleBadge role={emp.role} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {emp.status !== 'active' && (
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#33220022', color: '#f97316' }}>
                      {emp.status === 'on_leave' ? 'On Leave' : 'Inactive'}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12, fontSize: 12 }}>
                <div>
                  <div style={{ color: '#555', marginBottom: 2 }}>Phone</div>
                  <div style={{ color: '#888' }}>{emp.phone || '—'}</div>
                </div>
                <div>
                  <div style={{ color: '#555', marginBottom: 2 }}>Salary</div>
                  <div style={{ color: gold, fontWeight: 600 }}>{emp.salary ? fmt(emp.salary) : '—'}</div>
                </div>
                <div>
                  <div style={{ color: '#555', marginBottom: 2 }}>Joined</div>
                  <div style={{ color: '#888' }}>{emp.join_date || '—'}</div>
                </div>
              </div>

              {emp.notes && <div style={{ fontSize: 11, color: '#555', marginBottom: 12, padding: '6px 10px', background: '#1a1a1a', borderRadius: 6 }}>{emp.notes}</div>}

              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { setEditEmp(emp); setShowModal(true); }}
                  style={{ flex: 1, background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✏️ Edit
                </button>
                <button onClick={() => setSalaryEmp(emp)}
                  style={{ flex: 1, background: '#001a0a', border: '1px solid #003300', color: '#22c55e', borderRadius: 7, padding: '7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  💰 Salary
                </button>
                {emp.name !== 'Abdul Rehman' && (
                  <button onClick={() => deleteEmp(emp.id)}
                    style={{ background: '#1a0000', border: '1px solid #330000', color: '#ef4444', borderRadius: 7, padding: '7px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    🗑
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
