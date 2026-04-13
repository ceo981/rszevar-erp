'use client';
import { useState, useEffect, useCallback } from 'react';

const TABS = [
  { id: 'attendance',  label: '📅 Attendance',  },
  { id: 'advances',    label: '💸 Advances',    },
  { id: 'leaves',      label: '🌴 Leaves',       },
  { id: 'overtime',    label: '⏰ Overtime',      },
  { id: 'salary',      label: '💰 Salary',        },
  { id: 'leaderboard', label: '🏆 Leaderboard',  },
  { id: 'policy',      label: '⚙️ HR Policy',    },
];

function fmt(n) { return Number(n || 0).toLocaleString(); }
function today() { return new Date().toISOString().split('T')[0]; }
function thisMonth() { return new Date().toISOString().slice(0, 7); }

// ─────────────────────────────────────────────
// ATTENDANCE TAB
// ─────────────────────────────────────────────
function AttendanceTab({ employees }) {
  const [month, setMonth] = useState(thisMonth());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ employee_id: '', date: today(), status: 'present', time_in: '09:00', time_out: '18:00', notes: '' });
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/hr/attendance?month=${month}`);
    const d = await r.json();
    setRecords(d.attendance || []);
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    const r = await fetch('/api/hr/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', ...form }) });
    const d = await r.json();
    if (d.success) { setMsg('✅ Saved!'); load(); } else setMsg('❌ ' + d.error);
    setTimeout(() => setMsg(''), 3000);
  }

  async function handleDelete(id) {
    await fetch('/api/hr/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) });
    load();
  }

  const statusColor = { present: '#22c55e', absent: '#ef4444', late: '#f59e0b', half_day: '#8b5cf6' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={inputStyle} />
        <span style={{ color: '#94a3b8', fontSize: 14 }}>{records.length} records</span>
      </div>

      <div style={{ background: '#1e293b', borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <h3 style={{ color: '#c9a96e', marginBottom: 16, fontSize: 16 }}>Add Attendance</h3>
        <form onSubmit={handleAdd} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} style={inputStyle} required>
            <option value="">Select Employee</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} required />
          <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={inputStyle}>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="late">Late</option>
            <option value="half_day">Half Day</option>
          </select>
          <input type="time" value={form.time_in} onChange={e => setForm(f => ({ ...f, time_in: e.target.value }))} style={inputStyle} placeholder="Time In" />
          <input type="time" value={form.time_out} onChange={e => setForm(f => ({ ...f, time_out: e.target.value }))} style={inputStyle} placeholder="Time Out" />
          <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} placeholder="Notes (optional)" />
          <button type="submit" style={btnStyle}>Save</button>
        </form>
        {msg && <div style={{ marginTop: 10, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}
      </div>

      {loading ? <div style={{ color: '#94a3b8' }}>Loading...</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Employee', 'Date', 'Status', 'Time In', 'Time Out', 'Late Mins', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#94a3b8' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '8px 12px', color: '#e2e8f0' }}>{r.employees?.name}</td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{r.date}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ background: statusColor[r.status] + '22', color: statusColor[r.status], padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{r.time_in || '-'}</td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{r.time_out || '-'}</td>
                  <td style={{ padding: '8px 12px', color: r.late_minutes > 0 ? '#f59e0b' : '#94a3b8' }}>{r.late_minutes || 0} min</td>
                  <td style={{ padding: '8px 12px' }}>
                    <button onClick={() => handleDelete(r.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>🗑️</button>
                  </td>
                </tr>
              ))}
              {records.length === 0 && <tr><td colSpan={7} style={{ padding: 20, color: '#475569', textAlign: 'center' }}>No records for this month</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ADVANCES TAB
// ─────────────────────────────────────────────
function AdvancesTab({ employees }) {
  const [advances, setAdvances] = useState([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [form, setForm] = useState({ employee_id: '', amount: '', given_by: '', deduct_month: thisMonth(), notes: '' });
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/hr/advances');
    const d = await r.json();
    setAdvances(d.advances || []);
    setPendingTotal(d.pending_total || 0);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    const r = await fetch('/api/hr/advances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', ...form }) });
    const d = await r.json();
    if (d.success) { setMsg('✅ Advance added!'); setForm(f => ({ ...f, amount: '', notes: '' })); load(); }
    else setMsg('❌ ' + d.error);
    setTimeout(() => setMsg(''), 4000);
  }

  async function markDeducted(id) {
    await fetch('/api/hr/advances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark_deducted', id }) });
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <div style={{ background: '#1e293b', borderRadius: 8, padding: '12px 20px' }}>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>Total Outstanding</div>
          <div style={{ color: '#ef4444', fontSize: 20, fontWeight: 700 }}>Rs. {fmt(pendingTotal)}</div>
        </div>
      </div>

      <div style={{ background: '#1e293b', borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <h3 style={{ color: '#c9a96e', marginBottom: 16, fontSize: 16 }}>Give Advance</h3>
        <form onSubmit={handleAdd} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} style={inputStyle} required>
            <option value="">Select Employee</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} placeholder="Amount (Rs.)" required />
          <input value={form.given_by} onChange={e => setForm(f => ({ ...f, given_by: e.target.value }))} style={inputStyle} placeholder="Given by" />
          <input type="month" value={form.deduct_month} onChange={e => setForm(f => ({ ...f, deduct_month: e.target.value }))} style={inputStyle} />
          <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} placeholder="Notes" />
          <button type="submit" style={btnStyle}>Add Advance</button>
        </form>
        {msg && <div style={{ marginTop: 10, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #334155' }}>
              {['Employee', 'Amount', 'Given Date', 'Deduct Month', 'Status', 'Notes', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#94a3b8' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {advances.map(a => (
              <tr key={a.id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px 12px', color: '#e2e8f0' }}>{a.employees?.name}</td>
                <td style={{ padding: '8px 12px', color: '#ef4444', fontWeight: 600 }}>Rs. {fmt(a.amount)}</td>
                <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{a.given_date}</td>
                <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{a.deduct_month || '-'}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ background: a.status === 'pending' ? '#ef444422' : '#22c55e22', color: a.status === 'pending' ? '#ef4444' : '#22c55e', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                    {a.status}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{a.notes || '-'}</td>
                <td style={{ padding: '8px 12px' }}>
                  {a.status === 'pending' && (
                    <button onClick={() => markDeducted(a.id)} style={{ ...btnStyle, fontSize: 11, padding: '4px 8px' }}>Mark Deducted</button>
                  )}
                </td>
              </tr>
            ))}
            {advances.length === 0 && <tr><td colSpan={7} style={{ padding: 20, color: '#475569', textAlign: 'center' }}>No advances</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LEAVES TAB
// ─────────────────────────────────────────────
function LeavesTab({ employees }) {
  const [leaves, setLeaves] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [view, setView] = useState('leaves'); // leaves / holidays
  const [form, setForm] = useState({ employee_id: '', leave_type: 'casual', start_date: today(), end_date: today(), days: 1, reason: '' });
  const [holidayForm, setHolidayForm] = useState({ title: '', date: today(), type: 'public' });
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [lr, hr] = await Promise.all([fetch('/api/hr/leaves'), fetch('/api/hr/leaves?action=holidays')]);
    const [ld, hd] = await Promise.all([lr.json(), hr.json()]);
    setLeaves(ld.leaves || []);
    setHolidays(hd.holidays || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAddLeave(e) {
    e.preventDefault();
    const r = await fetch('/api/hr/leaves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_leave', ...form }) });
    const d = await r.json();
    if (d.success) { setMsg('✅ Leave added!'); load(); } else setMsg('❌ ' + d.error);
    setTimeout(() => setMsg(''), 3000);
  }

  async function handleAddHoliday(e) {
    e.preventDefault();
    await fetch('/api/hr/leaves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_holiday', ...holidayForm }) });
    setMsg('✅ Holiday added!');
    load();
    setTimeout(() => setMsg(''), 3000);
  }

  const leaveTypeColor = { casual: '#3b82f6', sick: '#f59e0b', unpaid: '#ef4444' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['leaves', 'holidays'].map(v => (
          <button key={v} onClick={() => setView(v)} style={{ ...btnStyle, background: view === v ? '#c9a96e' : '#1e293b', color: view === v ? '#0f172a' : '#94a3b8' }}>
            {v === 'leaves' ? '🌴 Leaves' : '📅 Holidays'}
          </button>
        ))}
      </div>

      {view === 'leaves' && (
        <>
          <div style={{ background: '#1e293b', borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <h3 style={{ color: '#c9a96e', marginBottom: 16, fontSize: 16 }}>Add Leave</h3>
            <form onSubmit={handleAddLeave} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} style={inputStyle} required>
                <option value="">Select Employee</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <select value={form.leave_type} onChange={e => setForm(f => ({ ...f, leave_type: e.target.value }))} style={inputStyle}>
                <option value="casual">Casual</option>
                <option value="sick">Sick</option>
                <option value="unpaid">Unpaid</option>
              </select>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} style={inputStyle} required />
              <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} style={inputStyle} required />
              <input type="number" value={form.days} onChange={e => setForm(f => ({ ...f, days: e.target.value }))} style={inputStyle} placeholder="Days" min={1} required />
              <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} style={inputStyle} placeholder="Reason" />
              <button type="submit" style={btnStyle}>Add Leave</button>
            </form>
            {msg && <div style={{ marginTop: 10, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Employee', 'Type', 'From', 'To', 'Days', 'Reason', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#94a3b8' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leaves.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '8px 12px', color: '#e2e8f0' }}>{l.employees?.name}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ background: (leaveTypeColor[l.leave_type] || '#94a3b8') + '22', color: leaveTypeColor[l.leave_type] || '#94a3b8', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                      {l.leave_type}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{l.start_date}</td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{l.end_date}</td>
                  <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 600 }}>{l.days}</td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{l.reason || '-'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <button onClick={async () => { await fetch('/api/hr/leaves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_leave', id: l.id }) }); load(); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>🗑️</button>
                  </td>
                </tr>
              ))}
              {leaves.length === 0 && <tr><td colSpan={7} style={{ padding: 20, color: '#475569', textAlign: 'center' }}>No leaves recorded</td></tr>}
            </tbody>
          </table>
        </>
      )}

      {view === 'holidays' && (
        <>
          <div style={{ background: '#1e293b', borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <h3 style={{ color: '#c9a96e', marginBottom: 16, fontSize: 16 }}>Add Holiday</h3>
            <form onSubmit={handleAddHoliday} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <input value={holidayForm.title} onChange={e => setHolidayForm(f => ({ ...f, title: e.target.value }))} style={inputStyle} placeholder="Holiday name" required />
              <input type="date" value={holidayForm.date} onChange={e => setHolidayForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} required />
              <select value={holidayForm.type} onChange={e => setHolidayForm(f => ({ ...f, type: e.target.value }))} style={inputStyle}>
                <option value="public">Public</option>
                <option value="company">Company</option>
              </select>
              <button type="submit" style={btnStyle}>Add</button>
            </form>
            {msg && <div style={{ marginTop: 10, color: '#22c55e' }}>{msg}</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {holidays.map(h => (
              <div key={h.id} style={{ background: '#1e293b', borderRadius: 8, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{h.title}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>{h.date} · {h.type}</div>
                </div>
                <button onClick={async () => { await fetch('/api/hr/leaves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_holiday', id: h.id }) }); load(); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>🗑️</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// OVERTIME TAB
// ─────────────────────────────────────────────
function OvertimeTab({ employees }) {
  const [month, setMonth] = useState(thisMonth());
  const [records, setRecords] = useState([]);
  const [totalHours, setTotalHours] = useState(0);
  const [form, setForm] = useState({ employee_id: '', date: today(), hours: '', reason: '' });
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/hr/overtime?month=${month}`);
    const d = await r.json();
    setRecords(d.overtime || []);
    setTotalHours(d.total_hours || 0);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    const r = await fetch('/api/hr/overtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', ...form }) });
    const d = await r.json();
    if (d.success) { setMsg('✅ Saved!'); setForm(f => ({ ...f, hours: '', reason: '' })); load(); } else setMsg('❌ ' + d.error);
    setTimeout(() => setMsg(''), 3000);
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={inputStyle} />
        <div style={{ background: '#1e293b', borderRadius: 8, padding: '8px 16px' }}>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>Total Hours: </span>
          <span style={{ color: '#c9a96e', fontWeight: 700 }}>{totalHours} hrs</span>
        </div>
      </div>

      <div style={{ background: '#1e293b', borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <h3 style={{ color: '#c9a96e', marginBottom: 16, fontSize: 16 }}>Log Overtime</h3>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} style={inputStyle} required>
            <option value="">Select Employee</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} required />
          <input type="number" step="0.5" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} style={{ ...inputStyle, width: 100 }} placeholder="Hours" required />
          <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} style={inputStyle} placeholder="Reason" />
          <button type="submit" style={btnStyle}>Log</button>
        </form>
        {msg && <div style={{ marginTop: 10, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #334155' }}>
            {['Employee', 'Date', 'Hours', 'Reason', ''].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#94a3b8' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid #1e293b' }}>
              <td style={{ padding: '8px 12px', color: '#e2e8f0' }}>{r.employees?.name}</td>
              <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{r.date}</td>
              <td style={{ padding: '8px 12px', color: '#c9a96e', fontWeight: 600 }}>{r.hours} hrs</td>
              <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{r.reason || '-'}</td>
              <td style={{ padding: '8px 12px' }}>
                <button onClick={async () => { await fetch('/api/hr/overtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: r.id }) }); load(); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>🗑️</button>
              </td>
            </tr>
          ))}
          {records.length === 0 && <tr><td colSpan={5} style={{ padding: 20, color: '#475569', textAlign: 'center' }}>No overtime this month</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────
// SALARY TAB
// ─────────────────────────────────────────────
function SalaryTab({ employees }) {
  const [month, setMonth] = useState(thisMonth());
  const [records, setSalaryRecords] = useState([]);
  const [calculating, setCalculating] = useState(null);
  const [preview, setPreview] = useState(null);
  const [bonus, setBonus] = useState(0);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/hr/salary?month=${month}`);
    const d = await r.json();
    setSalaryRecords(d.records || []);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  async function calculate(emp) {
    setCalculating(emp.id);
    setPreview(null);
    const r = await fetch('/api/hr/salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'calculate', employee_id: emp.id, month, bonus }) });
    const d = await r.json();
    if (d.success) setPreview({ ...d, emp });
    else setMsg('❌ ' + d.error);
    setCalculating(null);
  }

  async function saveSalary() {
    if (!preview) return;
    const r = await fetch('/api/hr/salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', calculation: preview.calculation, advance_ids: preview.advance_ids }) });
    const d = await r.json();
    if (d.success) { setMsg('✅ Salary saved!'); setPreview(null); load(); }
    else setMsg('❌ ' + d.error);
    setTimeout(() => setMsg(''), 3000);
  }

  async function markPaid(id) {
    await fetch('/api/hr/salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark_paid', id }) });
    load();
  }

  function printSlip(rec) {
    const emp = employees.find(e => e.id === rec.employee_id) || {};
    const w = window.open('', '_blank');
    w.document.write(`
      <html><head><title>Salary Slip - ${emp.name}</title>
      <style>body{font-family:Arial,sans-serif;padding:20px;max-width:600px;margin:0 auto}
      h1{color:#333;border-bottom:2px solid #c9a96e;padding-bottom:8px}
      .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee}
      .total{font-weight:bold;font-size:18px;color:#c9a96e}
      .section{margin:16px 0;padding:12px;background:#f9f9f9;border-radius:6px}
      </style></head><body>
      <h1>💍 RS ZEVAR — Salary Slip</h1>
      <div class="section">
        <div class="row"><span>Employee:</span><span><b>${emp.name || rec.employee_id}</b></span></div>
        <div class="row"><span>Designation:</span><span>${emp.designation || emp.role || '-'}</span></div>
        <div class="row"><span>Month:</span><span>${rec.month}</span></div>
      </div>
      <div class="section">
        <b>Attendance</b>
        <div class="row"><span>Working Days:</span><span>${rec.working_days}</span></div>
        <div class="row"><span>Present Days:</span><span>${rec.present_days}</span></div>
        <div class="row"><span>Absent Days:</span><span>${rec.absent_days}</span></div>
        <div class="row"><span>Late Days:</span><span>${rec.late_days}</span></div>
      </div>
      <div class="section">
        <b>Earnings</b>
        <div class="row"><span>Base Salary:</span><span>Rs. ${fmt(rec.base_salary)}</span></div>
        <div class="row"><span>Overtime Pay:</span><span>Rs. ${fmt(rec.overtime_pay)}</span></div>
        <div class="row"><span>Bonus:</span><span>Rs. ${fmt(rec.bonus)}</span></div>
      </div>
      <div class="section">
        <b>Deductions</b>
        <div class="row"><span>Late Deduction:</span><span>- Rs. ${fmt(rec.late_deduction)}</span></div>
        <div class="row"><span>Absent Deduction:</span><span>- Rs. ${fmt(rec.absent_deduction)}</span></div>
        <div class="row"><span>Advance Deduction:</span><span>- Rs. ${fmt(rec.advance_deduction)}</span></div>
        <div class="row"><span>Unpaid Leave:</span><span>- Rs. ${fmt(rec.unpaid_leave_deduction)}</span></div>
      </div>
      <div class="section">
        <div class="row total"><span>NET SALARY:</span><span>Rs. ${fmt(rec.net_salary)}</span></div>
      </div>
      <div style="margin-top:40px;display:flex;justify-content:space-between">
        <div>Employee Signature: _______________</div>
        <div>Authorized By: _______________</div>
      </div>
      </body></html>`);
    w.document.close();
    w.print();
  }

  const statusColor = { draft: '#94a3b8', finalized: '#3b82f6', paid: '#22c55e' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={inputStyle} />
        <input type="number" value={bonus} onChange={e => setBonus(e.target.value)} style={{ ...inputStyle, width: 140 }} placeholder="Bonus (Rs.)" />
        <span style={{ color: '#94a3b8', fontSize: 13 }}>Click Calculate per employee below</span>
      </div>

      {msg && <div style={{ marginBottom: 12, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}

      {/* Preview panel */}
      {preview && (
        <div style={{ background: '#1e293b', borderRadius: 10, padding: 20, marginBottom: 20, border: '1px solid #c9a96e' }}>
          <h3 style={{ color: '#c9a96e', marginBottom: 12 }}>📊 Salary Preview — {preview.emp?.name}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {[
              ['Base Salary', `Rs. ${fmt(preview.calculation.base_salary)}`],
              ['Present Days', preview.calculation.present_days],
              ['Absent Days', preview.calculation.absent_days],
              ['Late Days', preview.calculation.late_days],
              ['Overtime Pay', `Rs. ${fmt(preview.calculation.overtime_pay)}`],
              ['Bonus', `Rs. ${fmt(preview.calculation.bonus)}`],
              ['Late Deduction', `- Rs. ${fmt(preview.calculation.late_deduction)}`],
              ['Absent Deduction', `- Rs. ${fmt(preview.calculation.absent_deduction)}`],
              ['Advance Deduction', `- Rs. ${fmt(preview.calculation.advance_deduction)}`],
            ].map(([k, v]) => (
              <div key={k} style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>{k}</div>
                <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, padding: '12px 16px', background: '#0f172a', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#94a3b8' }}>NET SALARY</span>
            <span style={{ color: '#22c55e', fontSize: 22, fontWeight: 700 }}>Rs. {fmt(preview.calculation.net_salary)}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button onClick={saveSalary} style={btnStyle}>💾 Save Salary</button>
            <button onClick={() => setPreview(null)} style={{ ...btnStyle, background: '#334155' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Employees list with calculate buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
        {employees.filter(e => e.status === 'active').map(emp => {
          const saved = records.find(r => r.employee_id === emp.id);
          return (
            <div key={emp.id} style={{ background: '#1e293b', borderRadius: 8, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{emp.name}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>{emp.role}</div>
                </div>
                {saved && (
                  <span style={{ background: (statusColor[saved.status] || '#94a3b8') + '22', color: statusColor[saved.status] || '#94a3b8', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                    {saved.status}
                  </span>
                )}
              </div>
              {saved ? (
                <div>
                  <div style={{ color: '#22c55e', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Rs. {fmt(saved.net_salary)}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => printSlip(saved)} style={{ ...btnStyle, fontSize: 11, padding: '4px 10px', background: '#1e3a5f' }}>🖨️ Print Slip</button>
                    {saved.status !== 'paid' && <button onClick={() => markPaid(saved.id)} style={{ ...btnStyle, fontSize: 11, padding: '4px 10px', background: '#166534' }}>✅ Mark Paid</button>}
                    <button onClick={() => calculate(emp)} style={{ ...btnStyle, fontSize: 11, padding: '4px 10px', background: '#334155' }}>🔄 Recalculate</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => calculate(emp)} disabled={calculating === emp.id} style={btnStyle}>
                  {calculating === emp.id ? 'Calculating...' : '📊 Calculate'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────
// LEADERBOARD TAB
// ─────────────────────────────────────────────
function LeaderboardTab() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/hr/leaderboard?month=${month}`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .finally(() => setLoading(false));
  }, [month]);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={inputStyle} />
        {data && <span style={{ color: '#94a3b8', fontSize: 14 }}>Leaderboard Bonus: <strong style={{ color: '#c9a96e' }}>Rs. {Number(data.bonus_amount).toLocaleString()}</strong></span>}
      </div>

      {loading ? <div style={{ color: '#94a3b8' }}>Loading...</div> : !data?.leaderboard?.length ? (
        <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>Is month mein koi packing log nahi hai</div>
      ) : (
        <div>
          {/* Winner card */}
          {data.winner && (
            <div style={{ background: 'linear-gradient(135deg, #c9a96e22, #1e293b)', border: '1px solid #c9a96e44', borderRadius: 12, padding: 20, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 48 }}>🏆</div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>Is Month Ka Winner</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#c9a96e' }}>{data.winner.name}</div>
                <div style={{ color: '#94a3b8', fontSize: 14 }}>{data.winner.total_items} items packed · {data.winner.total_orders} orders</div>
                <div style={{ marginTop: 6, color: '#22c55e', fontWeight: 600 }}>+ Rs. {Number(data.bonus_amount).toLocaleString()} Bonus (salary mein auto-add)</div>
              </div>
            </div>
          )}

          {/* Full leaderboard */}
          <div style={{ background: '#1e293b', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  {['Rank', 'Employee', 'Items Packed', 'Orders', 'Bonus'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((row, i) => (
                  <tr key={row.employee_id} style={{ borderBottom: '1px solid #1e293b', background: i === 0 ? '#c9a96e11' : 'transparent' }}>
                    <td style={{ padding: '12px 16px', fontSize: 18 }}>{medals[i] || `#${i + 1}`}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: i === 0 ? '#c9a96e' : '#e2e8f0' }}>{row.name}</div>
                      <div style={{ fontSize: 11, color: '#475569' }}>{row.role}</div>
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: '#22c55e', fontSize: 16 }}>{row.total_items}</td>
                    <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{row.total_orders}</td>
                    <td style={{ padding: '12px 16px', color: i === 0 ? '#22c55e' : '#475569', fontWeight: i === 0 ? 700 : 400 }}>
                      {i === 0 ? `Rs. ${Number(data.bonus_amount).toLocaleString()} 🏆` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: '#475569', fontSize: 12, marginTop: 12 }}>* Winner ka bonus salary calculate karte waqt automatically add ho jayega</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// HR POLICY TAB
// ─────────────────────────────────────────────
function PolicyTab() {
  const [policy, setPolicy] = useState({
    office_start_time: '11:00',
    grace_minutes: '30',
    max_lates_allowed: '6',
    max_half_days_allowed: '3',
    leaderboard_bonus: '3000',
    overtime_rate_multiplier: '1.5',
  });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/hr/policy')
      .then(r => r.json())
      .then(d => { if (d.success) setPolicy(d.policy); })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    const r = await fetch('/api/hr/policy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(policy) });
    const d = await r.json();
    setMsg(d.success ? '✅ Policy save ho gayi!' : '❌ ' + d.error);
    setTimeout(() => setMsg(''), 3000);
  }

  const Field = ({ label, k, suffix = '', type = 'number', help = '' }) => (
    <div style={{ background: '#0f172a', borderRadius: 8, padding: 14 }}>
      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type={type}
          value={policy[k] || ''}
          onChange={e => setPolicy(p => ({ ...p, [k]: e.target.value }))}
          style={{ ...inputStyle, width: 100, textAlign: 'center', fontSize: 16, fontWeight: 700 }}
        />
        {suffix && <span style={{ color: '#475569', fontSize: 13 }}>{suffix}</span>}
      </div>
      {help && <div style={{ color: '#334155', fontSize: 11, marginTop: 4 }}>{help}</div>}
    </div>
  );

  if (loading) return <div style={{ color: '#94a3b8' }}>Loading...</div>;

  return (
    <div>
      <h3 style={{ color: '#c9a96e', marginBottom: 20 }}>Office Timing & Late Policy</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Field label="Office Start Time" k="office_start_time" type="time" help="Yeh time ke baad late count hoga" />
        <Field label="Grace Period" k="grace_minutes" suffix="minutes" help="Kitne minutes baad aana late count hoga" />
        <Field label="Max Lates Allowed" k="max_lates_allowed" suffix="per month" help="Is se zyada late = time bonus nahi milega" />
        <Field label="Max Half Days Allowed" k="max_half_days_allowed" suffix="per month" />
      </div>

      <h3 style={{ color: '#c9a96e', marginBottom: 20 }}>Bonuses</h3>
      <p style={{ color: '#475569', fontSize: 13, marginBottom: 12 }}>* Time Bonus har employee ka alag alag hai — Team section mein employee edit karke set karo.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Field label="Leaderboard Bonus" k="leaderboard_bonus" suffix="Rs" help="Month ka top packer ko milega" />
      </div>

      <h3 style={{ color: '#c9a96e', marginBottom: 20 }}>Overtime</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Field label="Overtime Multiplier" k="overtime_rate_multiplier" suffix="x" help="1.5 = 1.5x per hour rate" />
      </div>

      <div style={{ background: '#1e293b', borderRadius: 8, padding: 14, marginBottom: 20, fontSize: 13, color: '#94a3b8' }}>
        <strong style={{ color: '#c9a96e' }}>Late ka Rule:</strong> Agar employee office start se {policy.grace_minutes} min baad aaye to late count hoga. {policy.max_lates_allowed} late + {policy.max_half_days_allowed} half day free hain. Baad wale ka salary cut hoga (hours × per hour rate). Deduction = Salary ÷ 30 days ÷ 10 hours.
      </div>

      {msg && <div style={{ marginBottom: 12, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}
      <button onClick={save} style={btnStyle}>💾 Save Policy</button>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN HR PAGE
// ─────────────────────────────────────────────
export default function HRPage() {
  const [activeTab, setActiveTab] = useState('attendance');
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    fetch('/api/employees').then(r => r.json()).then(d => setEmployees(d.employees || []));
  }, []);

  return (
    <div style={{ padding: '24px', minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#c9a96e', margin: 0 }}>👥 HR & Payroll</h1>
        <p style={{ color: '#475569', margin: '4px 0 0', fontSize: 14 }}>Attendance, Leaves, Advances, Overtime & Salary</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500,
            background: activeTab === tab.id ? '#c9a96e' : '#1e293b',
            color: activeTab === tab.id ? '#0f172a' : '#94a3b8',
            transition: 'all 0.2s',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ background: '#0f172a' }}>
        {activeTab === 'attendance' && <AttendanceTab employees={employees} />}
        {activeTab === 'advances'   && <AdvancesTab   employees={employees} />}
        {activeTab === 'leaves'     && <LeavesTab     employees={employees} />}
        {activeTab === 'overtime'   && <OvertimeTab   employees={employees} />}
        {activeTab === 'salary'      && <SalaryTab     employees={employees} />}
        {activeTab === 'leaderboard' && <LeaderboardTab />}
        {activeTab === 'policy'      && <PolicyTab />}
      </div>
    </div>
  );
}

// ─── Shared styles ────────────────────────────
const inputStyle = {
  background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
  color: '#e2e8f0', padding: '8px 12px', fontSize: 14, outline: 'none',
};

const btnStyle = {
  background: '#c9a96e', color: '#0f172a', border: 'none', borderRadius: 6,
  padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
};
