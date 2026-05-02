'use client';
import { useState, useEffect } from 'react';
import { useUser } from '@/context/UserContext';

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
  const [form, setForm] = useState(emp || {
    name: '', role: ROLES[6], phone: '', salary: '', base_salary: '',
    advance_limit: '', designation: '', cnic: '',
    office_start: '11:00', office_end: '21:00',
    time_bonus_amount: '', yearly_leaves_allowed: '14',
    notes: '', join_date: new Date().toISOString().split('T')[0], status: 'active'
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Auto set advance_limit = 30% of salary when salary changes
  const handleSalaryChange = (val) => {
    const sal = parseFloat(val) || 0;
    const advLimit = Math.round(sal * 0.3);
    setForm(f => ({ ...f, salary: val, base_salary: val, advance_limit: advLimit }));
  };

  // Advance limit cannot exceed 30%
  const handleAdvanceChange = (val) => {
    const sal = parseFloat(form.salary || 0);
    const maxAdv = Math.round(sal * 0.3);
    const entered = parseFloat(val) || 0;
    if (sal > 0 && entered > maxAdv) {
      setMsg(`⚠️ Advance limit ${sal} ki 30% se zyada nahi ho sakti (Max: Rs ${maxAdv.toLocaleString()})`);
      return;
    }
    setMsg('');
    setForm(f => ({ ...f, advance_limit: val }));
  };

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
        <select value={form[key] || ''} onChange={e => setForm(f => ({...f, [key]: e.target.value}))}
          style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit' }}>
          {opts.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={form[key] || ''} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} placeholder={opts.placeholder || ''}
          style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
      )}
    </div>
  );

  const sectionTitle = (title) => (
    <div style={{ fontSize: 11, color: gold, fontWeight: 700, letterSpacing: 1, marginTop: 8, paddingBottom: 6, borderBottom: `1px solid #222` }}>
      {title}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: `1px solid ${border}`, borderRadius: 12, padding: 28, width: 460, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: gold }}>{emp?.id ? 'Edit Employee' : 'Add Employee'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {sectionTitle('BASIC INFO')}
          {inp('Full Name *', 'name', 'text', { placeholder: 'Employee name' })}
          {inp('Designation', 'designation', 'text', { placeholder: 'e.g. Senior Packer' })}
          {inp('Role *', 'role', 'text', { select: true, options: ROLES })}
          {inp('Phone', 'phone', 'tel', { placeholder: '03XX-XXXXXXX' })}
          {inp('CNIC', 'cnic', 'text', { placeholder: 'XXXXX-XXXXXXX-X' })}
          {inp('Join Date', 'join_date', 'date')}
          {emp?.id && inp('Status', 'status', 'text', { select: true, options: ['active', 'inactive', 'on_leave'] })}

          {sectionTitle('SALARY & ADVANCE')}
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Monthly Salary (Rs) *</div>
            <input
              type="number"
              value={form.salary || ''}
              onChange={e => handleSalaryChange(e.target.value)}
              placeholder="e.g. 25000"
              style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>
              Advance Limit (Rs)
              <span style={{ color: '#444', marginLeft: 6 }}>— auto 30% of salary</span>
            </div>
            <input
              type="number"
              value={form.advance_limit || ''}
              onChange={e => handleAdvanceChange(e.target.value)}
              placeholder="Auto calculated"
              style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#c9a96e', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>

          {sectionTitle('OFFICE TIMINGS')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Start Time</div>
              <input type="time" value={form.office_start || '11:00'} onChange={e => setForm(f => ({...f, office_start: e.target.value}))}
                style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 10px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>End Time</div>
              <input type="time" value={form.office_end || '21:00'} onChange={e => setForm(f => ({...f, office_end: e.target.value}))}
                style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 10px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Time Bonus (Rs)
                <span style={{ color: '#444', marginLeft: 6 }}>— agar month mein allowed late limit ke andar raha</span>
              </div>
              <input type="number" value={form.time_bonus_amount || ''} onChange={e => setForm(f => ({...f, time_bonus_amount: e.target.value}))}
                placeholder="e.g. 500"
                style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#c9a96e', borderRadius: 7, padding: '9px 10px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Yearly Leaves Allowed
                <span style={{ color: '#444', marginLeft: 6 }}>— free leaves, baad mein salary cut</span>
              </div>
              <input type="number" value={form.yearly_leaves_allowed || '14'} onChange={e => setForm(f => ({...f, yearly_leaves_allowed: e.target.value}))}
                placeholder="e.g. 14"
                style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 10px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 5 }}>Leaves Already Used This Year (ERP se pehle)
              <span style={{ color: '#444', marginLeft: 6 }}>— Oct se ab tak kitni leaves le chuka hai ERP track karne se pehle</span>
            </div>
            <input type="number" value={form.leaves_opening_used || '0'} onChange={e => setForm(f => ({...f, leaves_opening_used: e.target.value}))}
              placeholder="0"
              style={{ width: '100%', background: '#1a1a1a', border: `1px solid #ef444444`, color: '#ef4444', borderRadius: 7, padding: '9px 10px', fontSize: 13, boxSizing: 'border-box' }} />
          </div>

          {sectionTitle('NOTES')}
          <div>
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

// ── Termination Modal (May 2 2026) ────────────────────────────
// Permanent exit flow — captures last working day, reason, final settlement.
// Stricter than soft-delete: requires reason + amount, status='inactive' set.
function TerminationModal({ emp, onClose, onSaved }) {
  const today = new Date().toISOString().split('T')[0];
  const [terminationDate, setTerminationDate] = useState(today);
  const [reason, setReason]       = useState('resigned');
  const [amount, setAmount]       = useState('');
  const [notes, setNotes]         = useState('');
  const [paidNow, setPaidNow]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState('');

  // Auto-suggest dues = current monthly salary (pro-rata if mid-month).
  // Manager can override — exact calculation HR/Salary tab pe karte.
  useEffect(() => {
    if (!emp) return;
    const monthlySalary = parseFloat(emp.base_salary || emp.salary || 0);
    if (monthlySalary > 0) {
      const d = new Date(terminationDate);
      const dayOfMonth = d.getDate();
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const proRata = Math.round((monthlySalary * dayOfMonth) / daysInMonth);
      setAmount(String(proRata));
    }
  }, [emp, terminationDate]);

  const submit = async () => {
    if (!terminationDate) { setErr('Last working day required'); return; }
    if (!reason)          { setErr('Reason select karo'); return; }
    setSaving(true); setErr('');
    try {
      const r = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'terminate',
          id: emp.id,
          termination_date: terminationDate,
          termination_reason: reason,
          final_settlement_amount: amount,
          termination_notes: notes,
          mark_settled_now: paidNow,
        }),
      });
      const d = await r.json();
      if (!d.success) { setErr(d.error || 'Save failed'); setSaving(false); return; }
      onSaved();
      onClose();
    } catch (e) { setErr(e.message); setSaving(false); }
  };

  if (!emp) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: card, border: '1px solid #663300', borderRadius: 12, padding: 24, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f97316', marginBottom: 4 }}>👋 Employee Exit</div>
            <div style={{ fontSize: 13, color: '#888' }}>{emp.name} · {emp.role}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: 22, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ background: '#1a1a1a', border: `1px solid ${border}`, borderRadius: 8, padding: 12, fontSize: 11, color: '#888', marginBottom: 18, lineHeight: 1.6 }}>
          ⚠️ <strong>Permanent exit record.</strong> Status inactive ho jayega, assign list se gayab. Past records (packing log, attendance, salary) safe rahenge — ek "Ex-Employees" section mein dikhega.
        </div>

        {/* Last working day */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontWeight: 600 }}>Last Working Day *</label>
          <input type="date" value={terminationDate} max={today}
            onChange={e => setTerminationDate(e.target.value)}
            style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>

        {/* Reason */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontWeight: 600 }}>Reason *</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { value: 'resigned',   label: '📝 Resigned',    color: '#3b82f6' },
              { value: 'terminated', label: '🚫 Terminated',  color: '#ef4444' },
              { value: 'mutual',     label: '🤝 Mutual',      color: '#22c55e' },
              { value: 'abandoned',  label: '👻 Abandoned',   color: '#f97316' },
              { value: 'retired',    label: '🌅 Retired',     color: '#a78bfa' },
              { value: 'other',      label: '❓ Other',        color: '#888' },
            ].map(r => (
              <button key={r.value} onClick={() => setReason(r.value)}
                style={{
                  background: reason === r.value ? r.color + '22' : 'transparent',
                  border: `1px solid ${reason === r.value ? r.color + '88' : border}`,
                  color: reason === r.value ? r.color : '#888',
                  borderRadius: 6, padding: '6px 12px', fontSize: 12,
                  fontWeight: reason === r.value ? 600 : 400,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>{r.label}</button>
            ))}
          </div>
        </div>

        {/* Final settlement */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontWeight: 600 }}>Final Settlement Amount (Rs)</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 15000"
            style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>
            💡 Auto-calculated as pro-rata salary based on last working day. Manually override karo agar advances/dues adjust karne hain.
          </div>
        </div>

        {/* Mark settled now */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={paidNow} onChange={e => setPaidNow(e.target.checked)} style={{ cursor: 'pointer' }} />
          <span style={{ fontSize: 13, color: '#ccc' }}>Final settlement abhi cash mein de raha hoon</span>
        </label>

        {/* Notes */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontWeight: 600 }}>Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Mutual agreement, notice period, performance issues..."
            rows={3}
            style={{ width: '100%', background: '#0a0a0a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
        </div>

        {err && (
          <div style={{ padding: '8px 12px', background: '#2a0000', border: '1px solid #660000', borderRadius: 6, color: '#ef4444', fontSize: 12, marginBottom: 12 }}>
            ❌ {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={saving}
            style={{ flex: 1, background: 'transparent', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '10px', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            style={{ flex: 2, background: '#f97316', color: '#000', border: 'none', borderRadius: 7, padding: '10px', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving...' : '👋 Confirm Exit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Employees Page ───────────────────────────────────────
export default function EmployeesPage() {
  const { can } = useUser();
  const canCreate     = can('employees.create');
  const canEdit       = can('employees.edit');
  const canDelete     = can('employees.delete');
  const canViewSalary = can('employees.view_salary');
  const canTerminate  = can('employees.terminate');

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editEmp, setEditEmp] = useState(null);
  const [salaryEmp, setSalaryEmp] = useState(null);
  // ── Termination modal state (May 2 2026) ──
  const [terminateEmp, setTerminateEmp] = useState(null);
  const markSettled = async (id, name) => {
    if (!confirm(`${name} ka final settlement paid mark karna hai?\n(Confirm: paisa de diya gaya hai)`)) return;
    const r = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_settled', id }),
    });
    const d = await r.json();
    if (!d.success) { alert(`❌ ${d.error}`); return; }
    load();
  };
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

  const deleteEmp = async (id, name) => {
    // ── SOFT DELETE (May 2 2026) ──
    // Hard delete dangerous tha (packing_log + attendance + salary FK refs).
    // Ab confirmed message se clear karte ke "Deactivate" ho raha — historical
    // data preserved rahe.
    if (!confirm(
      `${name || 'Is employee'} ko Deactivate karna hai?\n\n` +
      `• Assign list (/packing) se gayab ho jayega\n` +
      `• Past packing_log, attendance, salary records SAFE rahenge\n` +
      `• Wapas active karne ke liye "Reactivate" use karna\n\n` +
      `Continue?`
    )) return;
    const r = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    const d = await r.json();
    if (!d.success) {
      alert(`❌ Deactivate fail: ${d.error}`);
      return;
    }
    load();
  };

  const reactivateEmp = async (id, name) => {
    if (!confirm(`${name} ko wapas Active karna hai?`)) return;
    const r = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reactivate', id }),
    });
    const d = await r.json();
    if (!d.success) {
      alert(`❌ Reactivate fail: ${d.error}`);
      return;
    }
    load();
  };

  // Show inactive employees toggle (default off — clean view)
  const [showInactive, setShowInactive] = useState(false);

  const filtered = employees.filter(e => {
    // Hide inactive unless toggle is on
    if (!showInactive && e.status === 'inactive') return false;
    return (
      e.name?.toLowerCase().includes(search.toLowerCase()) ||
      e.role?.toLowerCase().includes(search.toLowerCase())
    );
  });

  const totalSalary = employees.filter(e => e.status === 'active').reduce((s, e) => s + parseFloat(e.salary || 0), 0);
  const active = employees.filter(e => e.status === 'active').length;

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff', padding: 24 }}>
      {showModal && <EmployeeModal emp={editEmp} onClose={() => { setShowModal(false); setEditEmp(null); }} onSave={load} />}
      {salaryEmp && <SalaryPanel emp={salaryEmp} onClose={() => setSalaryEmp(null)} />}
      {terminateEmp && (
        <TerminationModal
          emp={terminateEmp}
          onClose={() => setTerminateEmp(null)}
          onSaved={load}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Team</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>{active} active{canViewSalary && ` · ${fmt(totalSalary)}/month total payroll`}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canCreate && employees.length === 0 && (
            <button onClick={seedTeam} style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>
              📥 Load My Team
            </button>
          )}
          {canCreate && (
          <button onClick={() => { setEditEmp(null); setShowModal(true); }}
            style={{ background: gold, color: '#000', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Add Employee
          </button>
          )}
        </div>
      </div>

      {msg && <div style={{ marginBottom: 14, padding: '10px 16px', background: '#001a0a', border: '1px solid #003300', borderRadius: 8, fontSize: 12, color: '#22c55e' }}>{msg}</div>}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          // Total now means active+on-leave (excludes ex-employees) — meaningful current strength
          { label: 'Total Staff', value: employees.filter(e => e.status !== 'inactive').length, color: '#fff' },
          { label: 'Active', value: active, color: '#22c55e' },
          { label: 'On Leave', value: employees.filter(e => e.status === 'on_leave').length, color: '#f97316' },
          { label: 'Monthly Payroll', value: canViewSalary ? fmt(totalSalary) : '••••', color: gold },
          // ── Ex-Employees: terminated count + pending settlement alert ──
          ...(employees.filter(e => e.termination_date).length > 0 ? [{
            label: 'Ex-Employees',
            value: employees.filter(e => e.termination_date).length,
            color: '#f97316',
            sub: employees.filter(e => e.termination_date && !e.final_settlement_paid_at).length > 0
              ? `${employees.filter(e => e.termination_date && !e.final_settlement_paid_at).length} settlement pending`
              : 'all settled',
          }] : []),
        ].map(s => (
          <div key={s.label} style={{ background: card, border: `1px solid ${border}`, borderRadius: 9, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            {s.sub && <div style={{ fontSize: 10, color: s.color === '#f97316' && employees.filter(e => e.termination_date && !e.final_settlement_paid_at).length > 0 ? '#ef4444' : '#666', marginTop: 3 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* Search + Inactive toggle */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or role..."
          style={{ flex: 1, maxWidth: 360, background: card, border: `1px solid ${border}`, color: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13, boxSizing: 'border-box' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Show inactive {employees.filter(e => e.status === 'inactive').length > 0 && (
            <span style={{ background: '#1a1a1a', color: '#888', borderRadius: 10, padding: '1px 8px', fontSize: 10 }}>
              {employees.filter(e => e.status === 'inactive').length}
            </span>
          )}
        </label>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>Loading team...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>
          {employees.length === 0 ? (
            <div>
              <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
              <div style={{ marginBottom: 8 }}>No team members yet</div>
              {canCreate && (
              <button onClick={seedTeam} style={{ background: gold, color: '#000', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                📥 Load My Team (13 members)
              </button>
              )}
            </div>
          ) : 'No results'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {filtered.map(emp => (
            <div key={emp.id} style={{
              background: card,
              border: `1px solid ${emp.status === 'inactive' ? '#330000' : border}`,
              borderRadius: 10,
              padding: '16px 18px',
              opacity: emp.status === 'inactive' ? 0.55 : 1,
              transition: 'opacity 0.2s',
            }}>
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
                  <div style={{ color: '#555', marginBottom: 2 }}>Monthly Salary</div>
                  <div style={{ color: gold, fontWeight: 600 }}>{!canViewSalary ? '••••' : (emp.base_salary || emp.salary ? fmt(emp.base_salary || emp.salary) : '—')}</div>
                </div>
                <div>
                  <div style={{ color: '#555', marginBottom: 2 }}>Advance Limit</div>
                  <div style={{ color: '#f97316' }}>{!canViewSalary ? '••••' : (emp.advance_limit ? fmt(emp.advance_limit) : '—')}</div>
                </div>
                <div>
                  <div style={{ color: '#555', marginBottom: 2 }}>Joined</div>
                  <div style={{ color: '#888' }}>{emp.join_date || '—'}</div>
                </div>
                {emp.office_start && (
                  <div>
                    <div style={{ color: '#555', marginBottom: 2 }}>Timing</div>
                    <div style={{ color: '#888' }}>{emp.office_start?.slice(0,5)} – {emp.office_end?.slice(0,5)}</div>
                  </div>
                )}
              </div>

              {emp.notes && <div style={{ fontSize: 11, color: '#555', marginBottom: 12, padding: '6px 10px', background: '#1a1a1a', borderRadius: 6 }}>{emp.notes}</div>}

              {/* Termination info — shown for ex-employees (May 2 2026) */}
              {emp.termination_date && (
                <div style={{
                  marginBottom: 12, padding: '10px 12px',
                  background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.25)',
                  borderRadius: 8, fontSize: 11,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f97316', fontWeight: 700, marginBottom: 4 }}>
                    👋 Left on {new Date(emp.termination_date).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                  {emp.termination_reason && (
                    <div style={{ color: '#888', marginBottom: 3 }}>
                      Reason: <span style={{ color: '#ccc', textTransform: 'capitalize' }}>{emp.termination_reason}</span>
                    </div>
                  )}
                  {emp.final_settlement_amount != null && (
                    <div style={{ color: '#888' }}>
                      Final settlement: <span style={{ color: gold, fontWeight: 600 }}>{fmt(emp.final_settlement_amount)}</span>
                      {emp.final_settlement_paid_at ? (
                        <span style={{ color: '#22c55e', marginLeft: 6, fontWeight: 600 }}>✅ Settled</span>
                      ) : (
                        <span style={{ color: '#ef4444', marginLeft: 6, fontWeight: 600 }}>⏳ Pending</span>
                      )}
                    </div>
                  )}
                  {emp.termination_notes && (
                    <div style={{ color: '#666', marginTop: 4, fontStyle: 'italic' }}>"{emp.termination_notes}"</div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {canEdit && (
                <button onClick={() => { setEditEmp(emp); setShowModal(true); }}
                  style={{ flex: 1, minWidth: 70, background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 7, padding: '7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✏️ Edit
                </button>
                )}
                {canViewSalary && (
                <button onClick={() => setSalaryEmp(emp)}
                  style={{ flex: 1, minWidth: 70, background: '#001a0a', border: '1px solid #003300', color: '#22c55e', borderRadius: 7, padding: '7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  💰 Salary
                </button>
                )}
                {/* Termination button — sirf active employees ke liye */}
                {canTerminate && emp.name !== 'Abdul Rehman' && emp.status !== 'inactive' && (
                  <button onClick={() => setTerminateEmp(emp)}
                    title="Permanent exit — resignation/termination record"
                    style={{ background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.4)', color: '#f97316', borderRadius: 7, padding: '7px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                    👋 Mark as Left
                  </button>
                )}
                {/* Mark Settled — for terminated employees with pending settlement */}
                {canTerminate && emp.termination_date && !emp.final_settlement_paid_at && (
                  <button onClick={() => markSettled(emp.id, emp.name)}
                    title="Final settlement paid — mark as cleared"
                    style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', color: '#22c55e', borderRadius: 7, padding: '7px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                    💰 Mark Settled
                  </button>
                )}
                {/* Quick Deactivate — for non-permanent inactive (e.g. on long leave) */}
                {canDelete && emp.name !== 'Abdul Rehman' && emp.status !== 'inactive' && !emp.termination_date && (
                  <button onClick={() => deleteEmp(emp.id, emp.name)}
                    title="Temporary deactivate — long leave / hold ke liye. Permanent exit ke liye 'Mark as Left' use karo"
                    style={{ background: '#1a0000', border: '1px solid #330000', color: '#ef4444', borderRadius: 7, padding: '7px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    🚫 Deactivate
                  </button>
                )}
                {canDelete && emp.status === 'inactive' && !emp.termination_date && (
                  <button onClick={() => reactivateEmp(emp.id, emp.name)}
                    title="Wapas active karo"
                    style={{ background: '#001a0a', border: '1px solid #003300', color: '#22c55e', borderRadius: 7, padding: '7px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ✅ Reactivate
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
