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
  const empMap = Object.fromEntries((employees || []).map(e => [String(e.id), e.name]));
  const [month, setMonth] = useState(thisMonth());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ employee_id: '', date: today(), status: 'present', time_in: '11:00', time_out: '21:00', notes: '' });
  const [msg, setMsg] = useState('');
  const [editRecord, setEditRecord] = useState(null);
  const formRef = useCallback(node => { if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/hr/attendance?month=${month}`);
      const d = await r.json();
      setRecords(d.attendance || []);
    } catch(e) { console.error('Attendance load error:', e); }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.employee_id) { setMsg('❌ Employee select karo'); return; }
    const exists = records.find(r => String(r.employee_id) === String(form.employee_id) && r.date === form.date);
    if (exists) {
      setMsg(`⚠️ ${empMap[String(form.employee_id)] || 'Is employee'} ki ${form.date} ki entry pehle se hai — cell pe click kar ke edit karo`);
      setTimeout(() => setMsg(''), 4000);
      return;
    }
    const r = await fetch('/api/hr/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', ...form }) });
    const d = await r.json();
    if (d.success) { setMsg('✅ Saved!'); load(); } else setMsg('❌ ' + (d.error || 'Error'));
    setTimeout(() => setMsg(''), 4000);
  }

  async function handleEdit(e) {
    e.preventDefault();
    const r = await fetch('/api/hr/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', ...editRecord }) });
    const d = await r.json();
    if (d.success) { setMsg('✅ Updated!'); setEditRecord(null); load(); } else setMsg('❌ ' + (d.error || 'Error'));
    setTimeout(() => setMsg(''), 4000);
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete karo?')) return;
    await fetch('/api/hr/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) });
    load();
  }

  // ── Calendar data ─────────────────────────────────────────
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const todayStr = today();
  const todayDay = todayStr.startsWith(month) ? parseInt(todayStr.split('-')[2]) : null;

  // Map: employee_id → day_number → record
  const empDayMap = {};
  records.forEach(r => {
    const day = parseInt(r.date?.split('-')[2]);
    if (!empDayMap[r.employee_id]) empDayMap[r.employee_id] = {};
    empDayMap[r.employee_id][day] = r;
  });

  const STATUS = {
    present:  { label: 'P',  color: '#22c55e', bg: '#22c55e28' },
    absent:   { label: 'A',  color: '#ef4444', bg: '#ef444428' },
    leave:    { label: 'L',  color: '#a78bfa', bg: '#a78bfa28' },
    late:     { label: 'Lt', color: '#f59e0b', bg: '#f59e0b28' },
    half_day: { label: 'H',  color: '#6366f1', bg: '#6366f128' },
  };

  const getSummary = (empId) => {
    const recs = Object.values(empDayMap[empId] || {});
    return {
      p: recs.filter(r => r.status === 'present').length,
      a: recs.filter(r => r.status === 'absent').length,
      l: recs.filter(r => r.status === 'leave').length,
      lt: recs.filter(r => r.status === 'late').length,
    };
  };

  const handleCellClick = (emp, day) => {
    const rec = empDayMap[emp.id]?.[day];
    if (rec) {
      setEditRecord({ ...rec });
    } else {
      const dateStr = `${month}-${String(day).padStart(2, '0')}`;
      setForm(f => ({ ...f, employee_id: String(emp.id), date: dateStr }));
    }
  };

  // Day of week abbreviations for header
  const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={inputStyle} />
        <span style={{ color: '#94a3b8', fontSize: 14 }}>{records.length} records</span>
      </div>

      {/* Add form */}
      <div ref={formRef} style={{ background: '#1e293b', borderRadius: 10, padding: 20, marginBottom: 20 }}>
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
            <option value="leave">Leave</option>
            <option value="late">Late</option>
            <option value="half_day">Half Day</option>
          </select>
          <input type="time" value={form.time_in} onChange={e => setForm(f => ({ ...f, time_in: e.target.value }))} style={inputStyle} placeholder="Time In" />
          <input type="time" value={form.time_out} onChange={e => setForm(f => ({ ...f, time_out: e.target.value }))} style={inputStyle} placeholder="Time Out" />
          <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} placeholder="Notes (optional)" />
          <button type="submit" style={btnStyle}>Save</button>
        </form>
        {msg && <div style={{ marginTop: 10, color: msg.startsWith('✅') ? '#22c55e' : msg.startsWith('⚠️') ? '#f59e0b' : '#ef4444' }}>{msg}</div>}
      </div>

      {/* Edit Modal */}
      {editRecord && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, width: 480, border: '1px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ color: '#c9a96e', margin: 0 }}>Edit Attendance</h3>
              <button onClick={() => setEditRecord(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <form onSubmit={handleEdit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Employee</div>
                <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{empMap[String(editRecord.employee_id)] || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Date</div>
                <div style={{ color: '#e2e8f0' }}>{editRecord.date}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Status</div>
                <select value={editRecord.status} onChange={e => setEditRecord(r => ({...r, status: e.target.value}))} style={inputStyle}>
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="leave">Leave</option>
                  <option value="late">Late</option>
                  <option value="half_day">Half Day</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Time In</div>
                <input type="time" value={editRecord.time_in?.slice(0,5) || ''} onChange={e => setEditRecord(r => ({...r, time_in: e.target.value}))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Time Out</div>
                <input type="time" value={editRecord.time_out?.slice(0,5) || ''} onChange={e => setEditRecord(r => ({...r, time_out: e.target.value}))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Notes</div>
                <input value={editRecord.notes || ''} onChange={e => setEditRecord(r => ({...r, notes: e.target.value}))} style={inputStyle} placeholder="Optional" />
              </div>
              <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8 }}>
                <button type="submit" style={{ ...btnStyle, flex: 1 }}>💾 Save Changes</button>
                <button type="button" onClick={() => handleDelete(editRecord.id)} style={{ background: '#1a0000', border: '1px solid #330000', color: '#ef4444', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>🗑 Delete</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Calendar Grid */}
      {loading ? (
        <div style={{ color: '#94a3b8', padding: 20 }}>Loading...</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #1e293b' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 'max-content', width: '100%' }}>
            <thead>
              {/* Day-of-week row */}
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <th style={{ position: 'sticky', left: 0, zIndex: 2, background: '#0d1117', width: 130, minWidth: 130, padding: '6px 14px', textAlign: 'left', color: '#475569', fontSize: 11, fontWeight: 500 }}>
                  EMPLOYEE
                </th>
                {days.map(d => {
                  const dow = new Date(year, mon - 1, d).getDay();
                  const isToday = d === todayDay;
                  const isSun = dow === 0;
                  return (
                    <th key={d} style={{ width: 36, minWidth: 36, padding: '5px 2px', textAlign: 'center', color: isToday ? '#c9a96e' : isSun ? '#475569' : '#334155', fontSize: 10, fontWeight: 500, background: isToday ? '#c9a96e11' : '#0d1117', borderLeft: '1px solid #1a1a2e' }}>
                      {DOW[dow]}
                    </th>
                  );
                })}
                <th style={{ width: 36, minWidth: 36, padding: '5px 4px', textAlign: 'center', color: '#22c55e', fontSize: 10, background: '#0d1117', borderLeft: '1px solid #1e293b' }}>P</th>
                <th style={{ width: 36, minWidth: 36, padding: '5px 4px', textAlign: 'center', color: '#ef4444', fontSize: 10, background: '#0d1117', borderLeft: '1px solid #1e293b' }}>A</th>
                <th style={{ width: 36, minWidth: 36, padding: '5px 4px', textAlign: 'center', color: '#f59e0b', fontSize: 10, background: '#0d1117', borderLeft: '1px solid #1e293b' }}>L/Lt</th>
              </tr>
              {/* Date number row */}
              <tr style={{ borderBottom: '2px solid #334155' }}>
                <th style={{ position: 'sticky', left: 0, zIndex: 2, background: '#0d1117', padding: '6px 14px', textAlign: 'left', color: '#64748b', fontSize: 11 }}>
                  {month}
                </th>
                {days.map(d => {
                  const isToday = d === todayDay;
                  const dow = new Date(year, mon - 1, d).getDay();
                  const isSun = dow === 0;
                  return (
                    <th key={d} style={{ width: 36, padding: '4px 2px', textAlign: 'center', fontWeight: isToday ? 700 : 500, color: isToday ? '#c9a96e' : isSun ? '#334155' : '#475569', fontSize: 12, background: isToday ? '#c9a96e11' : '#0d1117', borderLeft: '1px solid #1a1a2e' }}>
                      {d}
                    </th>
                  );
                })}
                <th colSpan={3} style={{ background: '#0d1117', borderLeft: '1px solid #1e293b' }} />
              </tr>
            </thead>
            <tbody>
              {employees.map((emp, ei) => {
                const sum = getSummary(emp.id);
                return (
                  <tr key={emp.id} style={{ borderBottom: '1px solid #1e293b', background: ei % 2 === 0 ? '#0f172a' : '#0d1117' }}>
                    {/* Sticky employee name */}
                    <td style={{ position: 'sticky', left: 0, zIndex: 1, background: ei % 2 === 0 ? '#0f172a' : '#0d1117', padding: '6px 14px', color: '#e2e8f0', fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', borderRight: '1px solid #1e293b' }}>
                      {emp.name}
                    </td>
                    {/* Day cells */}
                    {days.map(d => {
                      const rec = empDayMap[emp.id]?.[d];
                      const cfg = rec ? STATUS[rec.status] : null;
                      const dow = new Date(year, mon - 1, d).getDay();
                      const isToday = d === todayDay;
                      const isSun = dow === 0;
                      const tooltip = rec
                        ? `${empMap[rec.employee_id] || ''} • ${rec.date}\n${rec.time_in || ''} – ${rec.time_out || ''}${rec.late_minutes > 0 ? `\nLate: ${rec.late_minutes} min` : ''}${rec.notes ? `\n${rec.notes}` : ''}`
                        : `Click to add: ${emp.name} • ${month}-${String(d).padStart(2,'0')}`;
                      return (
                        <td key={d}
                          onClick={() => handleCellClick(emp, d)}
                          title={tooltip}
                          style={{
                            width: 36, padding: '5px 2px', textAlign: 'center', cursor: 'pointer',
                            background: cfg ? cfg.bg : isToday ? '#c9a96e08' : isSun ? '#ffffff04' : 'transparent',
                            borderLeft: '1px solid #1a1a2e',
                            transition: 'filter 0.1s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.5)'}
                          onMouseLeave={e => e.currentTarget.style.filter = ''}
                        >
                          {cfg ? (
                            <span style={{ color: cfg.color, fontSize: 11, fontWeight: 700, letterSpacing: -0.5 }}>{cfg.label}</span>
                          ) : (
                            <span style={{ color: '#1e293b', fontSize: 14, lineHeight: 1 }}>·</span>
                          )}
                        </td>
                      );
                    })}
                    {/* Summary */}
                    <td style={{ padding: '5px 4px', textAlign: 'center', color: '#22c55e', fontSize: 12, fontWeight: 600, borderLeft: '1px solid #1e293b' }}>{sum.p || '—'}</td>
                    <td style={{ padding: '5px 4px', textAlign: 'center', color: sum.a > 0 ? '#ef4444' : '#334155', fontSize: 12, fontWeight: sum.a > 0 ? 700 : 400, borderLeft: '1px solid #1e293b' }}>{sum.a || '—'}</td>
                    <td style={{ padding: '5px 4px', textAlign: 'center', color: (sum.l + sum.lt) > 0 ? '#f59e0b' : '#334155', fontSize: 12, fontWeight: (sum.l + sum.lt) > 0 ? 600 : 400, borderLeft: '1px solid #1e293b' }}>{(sum.l + sum.lt) || '—'}</td>
                  </tr>
                );
              })}
              {employees.length === 0 && (
                <tr><td colSpan={daysInMonth + 4} style={{ padding: 20, color: '#475569', textAlign: 'center' }}>No employees found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
        {Object.entries(STATUS).map(([k, v]) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#64748b' }}>
            <span style={{ display: 'inline-block', width: 22, height: 18, borderRadius: 3, background: v.bg, color: v.color, fontSize: 11, fontWeight: 700, textAlign: 'center', lineHeight: '18px' }}>{v.label}</span>
            {k.replace('_', ' ')}
          </span>
        ))}
        <span style={{ fontSize: 12, color: '#334155' }}>· = no record (click to add)</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ADVANCES TAB
// ─────────────────────────────────────────────
function AdvancesTab({ employees }) {
  const [advances, setAdvances] = useState([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [form, setForm] = useState({ employee_id: '', amount: '', given_by: '', given_date: today(), deduct_month: thisMonth(), notes: '' });
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

  async function markPending(id) {
    await fetch('/api/hr/advances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark_pending', id }) });
    load();
  }

  async function deleteAdvance(id) {
    if (!window.confirm('Yeh advance delete karna chahte ho?')) return;
    await fetch('/api/hr/advances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) });
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
          <input type="date" value={form.given_date} onChange={e => setForm(f => ({ ...f, given_date: e.target.value }))} style={inputStyle} />
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
                <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{a.given_date ? new Date(a.given_date).toLocaleDateString('en-PK', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{a.deduct_month || '-'}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ background: a.status === 'pending' ? '#ef444422' : '#22c55e22', color: a.status === 'pending' ? '#ef4444' : '#22c55e', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                    {a.status}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{a.notes || '-'}</td>
                <td style={{ padding: '8px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {a.status === 'pending' && (
                    <button onClick={() => markDeducted(a.id)} style={{ ...btnStyle, fontSize: 11, padding: '4px 8px' }}>Mark Deducted</button>
                  )}
                  {a.status === 'deducted' && (
                    <button onClick={() => markPending(a.id)} style={{ fontSize: 11, padding: '4px 8px', background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>↩ Revert</button>
                  )}
                  <button onClick={() => deleteAdvance(a.id)} style={{ fontSize: 11, padding: '4px 8px', background: '#ef444422', color: '#ef4444', border: '1px solid #ef444444', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>🗑</button>
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
        ${(() => {
          const b = rec.bonus_breakdown || {};
          const rows = [];
          if (b.leaderboard > 0) {
            const rank = b.leaderboard_rank === '1st' ? '🏆 1st Place' : b.leaderboard_rank === '2nd' ? '🥈 2nd Place' : '';
            rows.push(`<div class="row"><span>Leaderboard Bonus (${rank}):</span><span>Rs. ${fmt(b.leaderboard)}</span></div>`);
          }
          if (b.time_bonus > 0) {
            rows.push(`<div class="row"><span>Time Bonus (good attendance):</span><span>Rs. ${fmt(b.time_bonus)}</span></div>`);
          }
          if (b.manual > 0) {
            rows.push(`<div class="row"><span>Manual Bonus:</span><span>Rs. ${fmt(b.manual)}</span></div>`);
          }
          if (rows.length === 0) {
            rows.push(`<div class="row"><span>Bonus:</span><span>Rs. ${fmt(rec.bonus)}</span></div>`);
          }
          return rows.join('');
        })()}
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
              ['Bonus (total)', `Rs. ${fmt(preview.calculation.bonus)}`],
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

          {/* Bonus breakdown — dikhaye ki bonus kahan se banaa */}
          {preview.calculation.bonus_breakdown && (
            (preview.calculation.bonus_breakdown.leaderboard > 0 ||
             preview.calculation.bonus_breakdown.time_bonus > 0 ||
             preview.calculation.bonus_breakdown.manual > 0) && (
              <div style={{ marginTop: 14, padding: 12, background: '#0f172a', border: '1px solid #c9a96e33', borderRadius: 8 }}>
                <div style={{ color: '#c9a96e', fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Bonus Breakdown</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  {preview.calculation.bonus_breakdown.leaderboard > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0' }}>
                      <span>
                        {preview.calculation.bonus_breakdown.leaderboard_rank === '1st' ? '🏆' : '🥈'} Leaderboard Bonus ({preview.calculation.bonus_breakdown.leaderboard_rank} Place)
                      </span>
                      <strong style={{ color: '#22c55e' }}>Rs. {fmt(preview.calculation.bonus_breakdown.leaderboard)}</strong>
                    </div>
                  )}
                  {preview.calculation.bonus_breakdown.time_bonus > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0' }}>
                      <span>⏰ Time Bonus (good attendance)</span>
                      <strong style={{ color: '#22c55e' }}>Rs. {fmt(preview.calculation.bonus_breakdown.time_bonus)}</strong>
                    </div>
                  )}
                  {preview.calculation.bonus_breakdown.manual > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0' }}>
                      <span>✋ Manual Bonus</span>
                      <strong style={{ color: '#22c55e' }}>Rs. {fmt(preview.calculation.bonus_breakdown.manual)}</strong>
                    </div>
                  )}
                  {!preview.calculation.bonus_breakdown.time_bonus_eligible && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#fca5a5' }}>
                      ⚠️ Time Bonus nahi mila — lates / half days rule tooti hai
                    </div>
                  )}
                </div>
              </div>
            )
          )}

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
// LEADERBOARD TAB — Amount-Priority Ranking
// ─────────────────────────────────────────────
// Primary metric: total amount (Rs) of items packed
// Secondary: total items count (shown for context)
// Top 2 earn bonuses: 1st = leaderboard_bonus_1st, 2nd = leaderboard_bonus_2nd
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

  const bonus1st = data?.bonus_amount_1st ?? data?.bonus_amount ?? 2000;
  const bonus2nd = data?.bonus_amount_2nd ?? 1000;

  const bonusForRank = (i) => i === 0 ? bonus1st : i === 1 ? bonus2nd : 0;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={inputStyle} />
        {data && (
          <span style={{ color: '#94a3b8', fontSize: 14 }}>
            Bonuses: <strong style={{ color: '#c9a96e' }}>1st Rs. {Number(bonus1st).toLocaleString()}</strong>
            <span style={{ color: '#475569', margin: '0 6px' }}>·</span>
            <strong style={{ color: '#94a3b8' }}>2nd Rs. {Number(bonus2nd).toLocaleString()}</strong>
          </span>
        )}
      </div>

      {loading ? <div style={{ color: '#94a3b8' }}>Loading...</div> : !data?.leaderboard?.length ? (
        <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>Is month mein koi packing log nahi hai</div>
      ) : (
        <div>
          {/* Winner + Runner-up cards */}
          <div style={{ display: 'grid', gridTemplateColumns: data.runner_up ? '1fr 1fr' : '1fr', gap: 14, marginBottom: 20 }}>
            {data.winner && (
              <div style={{ background: 'linear-gradient(135deg, #c9a96e22, #1e293b)', border: '1px solid #c9a96e66', borderRadius: 12, padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontSize: 44 }}>🏆</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>1st — Winner</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#c9a96e', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.winner.name}</div>
                  <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>
                    <strong style={{ color: '#22c55e' }}>Rs. {Number(data.winner.total_amount || 0).toLocaleString()}</strong>
                    <span style={{ color: '#475569' }}> · {data.winner.total_items} items · {data.winner.total_orders} orders</span>
                  </div>
                  <div style={{ marginTop: 6, color: '#22c55e', fontWeight: 600, fontSize: 13 }}>+ Rs. {Number(bonus1st).toLocaleString()} Bonus (salary mein auto-add)</div>
                </div>
              </div>
            )}
            {data.runner_up && (
              <div style={{ background: 'linear-gradient(135deg, #94a3b822, #1e293b)', border: '1px solid #94a3b855', borderRadius: 12, padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontSize: 44 }}>🥈</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>2nd — Runner-up</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.runner_up.name}</div>
                  <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>
                    <strong style={{ color: '#22c55e' }}>Rs. {Number(data.runner_up.total_amount || 0).toLocaleString()}</strong>
                    <span style={{ color: '#475569' }}> · {data.runner_up.total_items} items · {data.runner_up.total_orders} orders</span>
                  </div>
                  <div style={{ marginTop: 6, color: '#22c55e', fontWeight: 600, fontSize: 13 }}>+ Rs. {Number(bonus2nd).toLocaleString()} Bonus (salary mein auto-add)</div>
                </div>
              </div>
            )}
          </div>

          {/* Full leaderboard */}
          <div style={{ background: '#1e293b', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  {['Rank', 'Employee', 'Amount (Rs)', 'Items', 'Orders', 'Bonus'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((row, i) => {
                  const bonus = bonusForRank(i);
                  const rowBg = i === 0 ? '#c9a96e11' : i === 1 ? '#94a3b80f' : 'transparent';
                  const nameColor = i === 0 ? '#c9a96e' : i === 1 ? '#cbd5e1' : '#e2e8f0';
                  return (
                    <tr key={row.employee_id} style={{ borderBottom: '1px solid #1e293b', background: rowBg }}>
                      <td style={{ padding: '12px 16px', fontSize: 18 }}>{medals[i] || `#${i + 1}`}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, color: nameColor }}>{row.name}</div>
                        <div style={{ fontSize: 11, color: '#475569' }}>{row.role}</div>
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: '#22c55e', fontSize: 16 }}>
                        Rs. {Number(row.total_amount || 0).toLocaleString()}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 14 }}>{row.total_items}</td>
                      <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{row.total_orders}</td>
                      <td style={{ padding: '12px 16px', color: bonus > 0 ? '#22c55e' : '#475569', fontWeight: bonus > 0 ? 700 : 400 }}>
                        {bonus > 0 ? `Rs. ${Number(bonus).toLocaleString()} ${i === 0 ? '🏆' : '🥈'}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ color: '#475569', fontSize: 12, marginTop: 12 }}>* Top 2 ka bonus salary calculate karte waqt automatically add ho jayega (bonus_breakdown mein "leaderboard" line aayegi)</p>
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
    late_deduction_amount: '100',
    leaderboard_bonus_1st: '2000',
    leaderboard_bonus_2nd: '1000',
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
      <p style={{ color: '#475569', fontSize: 13, marginBottom: 12 }}>* Time Bonus har employee ka alag alag hai — Team section mein employee edit karke set karo. Leaderboard ranking <strong style={{ color: '#c9a96e' }}>amount ke hisaab se</strong> hoti hai (items ki count tiebreaker hai).</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Field label="🏆 1st Place Bonus" k="leaderboard_bonus_1st" suffix="Rs" help="Top packer ko (highest amount packed)" />
        <Field label="🥈 2nd Place Bonus" k="leaderboard_bonus_2nd" suffix="Rs" help="Runner-up packer ko" />
      </div>

      <h3 style={{ color: '#c9a96e', marginBottom: 20 }}>Overtime</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Field label="Overtime Multiplier" k="overtime_rate_multiplier" suffix="x" help="1.5 = 1.5x per hour rate" />
      </div>

      <div style={{ background: '#1e293b', borderRadius: 8, padding: 14, marginBottom: 20, fontSize: 13, color: '#94a3b8' }}>
        <strong style={{ color: '#c9a96e' }}>Late ka Rule:</strong> Agar employee office start se {policy.grace_minutes} min baad aaye to late count hoga. {policy.max_lates_allowed} late + {policy.max_half_days_allowed} half day free hain. Baad wale ka salary cut hoga (hours × per hour rate). Deduction = Salary ÷ 30 days ÷ 10 hours.
      </div>

      {msg && <div style={{ marginBottom: 12, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={save} style={btnStyle}>💾 Save Policy</button>
        <button
          onClick={() => window.open('/api/hr/print-report?upto=2026-03-31', '_blank')}
          style={{ ...btnStyle, background: '#1e293b', color: '#c9a96e', border: '1px solid #c9a96e44' }}
        >
          📄 Print HR Rules + Leave Report
        </button>
      </div>
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
