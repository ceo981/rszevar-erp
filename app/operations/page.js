'use client';
import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@/context/UserContext';

const EXPENSE_CATEGORIES = [
  'Lunch', 'Water', 'Accessories', 'Utilities', 'Other',
];

function fmt(n) {
  if (!n && n !== 0) return '—';
  return 'Rs. ' + parseFloat(n).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function today() { return new Date().toISOString().split('T')[0]; }
function thisMonth() { return new Date().toISOString().slice(0, 7); }

function isImageUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return /\.(jpg|jpeg|png|gif|webp|bmp|heic)(\?|$)/.test(lower);
}

const inputStyle = {
  width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a',
  borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};
const btnStyle = {
  background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8,
  padding: '8px 16px', color: '#c9a96e', fontSize: 13, cursor: 'pointer',
  fontFamily: 'inherit', fontWeight: 600, transition: 'all 0.15s',
};
const labelStyle = {
  display: 'block', fontSize: 11, color: '#555',
  marginBottom: 6, fontFamily: 'monospace', letterSpacing: 0.5,
};
const tdStyle = { padding: '12px 16px', fontSize: 13, color: '#888', verticalAlign: 'middle' };

// ─── MODAL WRAPPER ─────────────────────────────────────────────
function Modal({ title, onClose, children, maxWidth = 480 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 14, padding: 28, width: '100%', maxWidth, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#c9a96e' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── BILL PREVIEW COMPONENT ────────────────────────────────────
function BillPreview({ url, size = 36 }) {
  if (!url) return <span style={{ color: '#333', fontSize: 12 }}>—</span>;
  if (isImageUrl(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title="Full bill dekho"
        style={{ display: 'inline-block', lineHeight: 0 }}>
        <img src={url} alt="Bill"
          style={{
            width: size, height: size, objectFit: 'cover',
            borderRadius: 6, border: '1px solid #2a2a2a',
            cursor: 'pointer', background: '#1a1a1a',
          }} />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{ color: '#c9a96e', fontSize: 18, textDecoration: 'none' }} title="Bill dekho (PDF)">
      📎
    </a>
  );
}

// ─── EXPENSE FORM (used for both ADD and EDIT) ──────────────────
function ExpenseForm({ form, setForm, onSave, onCancel, saving, mode = 'add' }) {
  async function pickFile(file) {
    if (!file) return;
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setForm(f => ({ ...f, bill_file: file, bill_preview: preview }));
  }

  // Existing bill preview (edit mode) OR newly-picked file preview
  const existingUrl = form.bill_url && !form.bill_file;
  const newPreviewUrl = form.bill_preview;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={labelStyle}>Description *</label>
        <input placeholder="e.g. Khana order, Packaging bags..." value={form.description || ''}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>Amount (Rs.) *</label>
          <input type="number" placeholder="0" value={form.amount || ''}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Date</label>
          <input type="date" value={form.date || today()}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Category</label>
        <select value={form.category || 'Lunch'} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
          {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Notes (optional)</label>
        <input placeholder="Koi extra detail..." value={form.notes || ''}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>Bill / Receipt {existingUrl && '(already uploaded — replace karne ke liye click karo)'}</label>
        <div style={{ border: '1px dashed #2a2a2a', borderRadius: 8, padding: 14, textAlign: 'center', background: '#1a1a1a', cursor: 'pointer', position: 'relative' }}
          onClick={() => document.getElementById(`bill-upload-${mode}`).click()}>
          <input id={`bill-upload-${mode}`} type="file" accept="image/*,.pdf"
            style={{ display: 'none' }}
            onChange={e => pickFile(e.target.files[0])} />
          {newPreviewUrl ? (
            <div>
              <img src={newPreviewUrl} alt="Bill" style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 6, marginBottom: 8 }} />
              <div style={{ fontSize: 11, color: '#22c55e' }}>✅ New: {form.bill_file?.name}</div>
            </div>
          ) : form.bill_file ? (
            <div style={{ fontSize: 12, color: '#22c55e' }}>✅ {form.bill_file?.name}</div>
          ) : existingUrl && isImageUrl(form.bill_url) ? (
            <div>
              <img src={form.bill_url} alt="Existing" style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 6, marginBottom: 8 }} />
              <div style={{ fontSize: 11, color: '#666' }}>📎 Existing bill — naya upload karne ke liye click karo</div>
            </div>
          ) : existingUrl ? (
            <div>
              <div style={{ fontSize: 22, marginBottom: 4 }}>📎</div>
              <div style={{ fontSize: 12, color: '#666' }}>Existing bill attached — click to replace</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 22, marginBottom: 4 }}>📎</div>
              <div style={{ fontSize: 12, color: '#555' }}>Click karke bill upload karo</div>
              <div style={{ fontSize: 10, color: '#333', marginTop: 4 }}>Image ya PDF — optional</div>
            </div>
          )}
        </div>
        {(form.bill_file || form.bill_url) && (
          <button onClick={() => setForm(f => ({ ...f, bill_file: null, bill_preview: null, bill_url: null, _clear_bill: true }))}
            style={{ marginTop: 6, background: 'none', border: 'none', color: '#555', fontSize: 11, cursor: 'pointer' }}>
            ✕ Remove bill
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onSave} disabled={saving}
          style={{ ...btnStyle, flex: 1, background: mode === 'edit' ? '#1a2a2a' : '#2a1a1a', borderColor: mode === 'edit' ? '#06b6d444' : '#ef444444', color: mode === 'edit' ? '#06b6d4' : '#ef4444' }}>
          {saving ? 'Save ho raha hai...' : (mode === 'edit' ? '💾 Update karo' : 'Expense Save karo')}
        </button>
        <button onClick={onCancel} style={{ ...btnStyle, color: '#555' }}>Cancel</button>
      </div>
    </div>
  );
}

// ─── CASH & EXPENSES TAB ────────────────────────────────────────
function CashTab({ isManager, isCEO, currentUserName }) {
  const [data, setData] = useState({ balance: 0, total_in: 0, total_out: 0, pending_count: 0, logs: [] });
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState('');
  const [showCashModal, setShowCashModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [showHistoryFor, setShowHistoryFor] = useState(null);
  const [cashForm, setCashForm] = useState({ amount: '', notes: '' });
  const [expForm, setExpForm] = useState({ description: '', amount: '', category: 'Lunch', date: today(), notes: '', bill_file: null, bill_preview: null });
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = month ? `?month=${month}` : '';
      const r = await fetch(`/api/operations${params}`);
      const d = await r.json();
      if (d.success) setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  function showMsg(m) { setMsg(m); setTimeout(() => setMsg(''), 4000); }

  async function uploadBill(file) {
    if (!file) return null;
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/operations?action=upload_bill', {
      method: 'POST',
      body: formData,
    });
    const d = await res.json();
    if (!d.success) {
      showMsg('❌ Bill upload fail: ' + (d.error || ''));
      return null;
    }
    return d.url;
  }

  async function requestCash() {
    if (!cashForm.amount) return;
    setSaving(true);
    const r = await fetch('/api/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request_cash', ...cashForm, requested_by: currentUserName }),
    });
    const d = await r.json();
    setSaving(false);
    if (d.success) {
      showMsg('✅ Cash request bhej di CEO ko!');
      setShowCashModal(false);
      setCashForm({ amount: '', notes: '' });
      load();
    } else showMsg('❌ ' + d.error);
  }

  async function approveCash(id) {
    await fetch('/api/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve_cash', id, approved_by: currentUserName }),
    });
    showMsg('✅ Cash approve ho gaya!');
    load();
  }

  async function rejectCash(id) {
    if (!confirm('Reject karo?')) return;
    await fetch('/api/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject_cash', id }),
    });
    showMsg('❌ Request reject kar di');
    load();
  }

  async function addExpense() {
    if (!expForm.description || !expForm.amount) { showMsg('❌ Description aur amount required'); return; }
    setSaving(true);

    let bill_url = null;
    if (expForm.bill_file) {
      bill_url = await uploadBill(expForm.bill_file);
      if (!bill_url) { setSaving(false); return; } // upload failed, don't save
    }

    const r = await fetch('/api/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_expense',
        description: expForm.description,
        amount: expForm.amount,
        category: expForm.category,
        date: expForm.date,
        notes: expForm.notes,
        bill_url,
        added_by: currentUserName,
      }),
    });
    const d = await r.json();
    setSaving(false);
    if (d.success) {
      showMsg('✅ Expense add ho gaya!');
      setShowExpenseModal(false);
      setExpForm({ description: '', amount: '', category: 'Lunch', date: today(), notes: '', bill_file: null, bill_preview: null });
      load();
    } else showMsg('❌ ' + d.error);
  }

  function openEditModal(entry) {
    setEditingEntry(entry);
    setEditForm({
      description: entry.description || '',
      amount: entry.amount || '',
      category: entry.category || 'Lunch',
      date: entry.date || today(),
      notes: entry.notes || '',
      bill_url: entry.bill_url || null,
      bill_file: null,
      bill_preview: null,
      _clear_bill: false,
    });
  }

  async function saveEdit() {
    if (!editingEntry) return;
    if (!editForm.description || !editForm.amount) { showMsg('❌ Description aur amount required'); return; }
    setSaving(true);

    // Bill handling:
    // - Naya file picked → upload → use new url
    // - Clear button dabaya (_clear_bill) → null
    // - Warna existing bill_url rakho
    let bill_url = editForm.bill_url || null;
    if (editForm.bill_file) {
      const newUrl = await uploadBill(editForm.bill_file);
      if (!newUrl) { setSaving(false); return; }
      bill_url = newUrl;
    } else if (editForm._clear_bill) {
      bill_url = null;
    }

    const r = await fetch('/api/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_expense',
        id: editingEntry.id,
        edited_by: currentUserName,
        is_ceo: isCEO,
        description: editForm.description,
        amount: editForm.amount,
        category: editForm.category,
        date: editForm.date,
        notes: editForm.notes,
        bill_url,
      }),
    });
    const d = await r.json();
    setSaving(false);
    if (d.success) {
      showMsg('✅ Update ho gaya!');
      setEditingEntry(null);
      setEditForm({});
      load();
    } else showMsg('❌ ' + d.error);
  }

  async function deleteEntry(id) {
    if (!confirm('Delete karo?')) return;
    await fetch('/api/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    load();
  }

  const balanceColor = data.balance < 0 ? '#ef4444' : data.balance < 5000 ? '#f59e0b' : '#22c55e';
  const logs = data.logs || [];
  const pendingLogs = logs.filter(l => l.status === 'pending');
  const approvedLogs = logs.filter(l => l.status !== 'pending');

  const todayStr = today();
  const thisMonthStr = todayStr.substring(0, 7);
  const todayLogs = approvedLogs.filter(l => l.date === todayStr && l.type !== 'cash_in');
  const monthLogs = approvedLogs.filter(l => l.date?.startsWith(thisMonthStr) && l.type !== 'cash_in');
  const todayExpense = todayLogs.reduce((s, l) => s + parseFloat(l.amount || 0), 0);
  const monthExpense = monthLogs.reduce((s, l) => s + parseFloat(l.amount || 0), 0);

  const groupedByDate = {};
  approvedLogs.forEach(l => {
    const d = l.date || 'Unknown';
    if (!groupedByDate[d]) groupedByDate[d] = [];
    groupedByDate[d].push(l);
  });
  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  function canEdit(entry) {
    // CEO edits anything; others edit only entries they created
    if (isCEO) return true;
    if (entry.type === 'cash_in') return false; // cash_in only editable by CEO
    if (entry.type === 'advance') return false; // advances shouldn't be edited via expense modal
    return entry.requested_by === currentUserName;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Balance Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <div style={{ background: '#111', border: `1px solid ${balanceColor}33`, borderRadius: 12, padding: '20px 24px' }}>
          <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Cash Balance</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: balanceColor, letterSpacing: -0.5 }}>{fmt(data.balance)}</div>
        </div>
        <div style={{ background: '#111', border: '1px solid #1a2a1a', borderRadius: 12, padding: '20px 24px' }}>
          <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Total Cash In</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e' }}>{fmt(data.total_in)}</div>
        </div>
        <div style={{ background: '#111', border: '1px solid #2a1a1a', borderRadius: 12, padding: '20px 24px' }}>
          <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Total Out</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{fmt(data.total_out)}</div>
        </div>
        <div style={{ background: '#111', border: '1px solid #ef444433', borderRadius: 12, padding: '20px 24px' }}>
          <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>🗓 Aaj Ka Kharch</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: todayExpense > 0 ? '#ef4444' : '#333' }}>{fmt(todayExpense)}</div>
          <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>{todayLogs.length} transactions</div>
        </div>
        <div style={{ background: '#111', border: '1px solid #f59e0b33', borderRadius: 12, padding: '20px 24px' }}>
          <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>📅 Is Mahine Ka Kharch</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#f59e0b' }}>{fmt(monthExpense)}</div>
          <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>{monthLogs.length} transactions</div>
        </div>
        {data.pending_count > 0 && (
          <div style={{ background: '#111', border: '1px solid #c9a96e33', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Pending Approvals</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#c9a96e' }}>{data.pending_count}</div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {isManager && (
          <button onClick={() => setShowCashModal(true)} style={{ ...btnStyle, background: '#1a2a1a', borderColor: '#22c55e44', color: '#22c55e' }}>
            + Cash Request karo
          </button>
        )}
        <button onClick={() => setShowExpenseModal(true)} style={{ ...btnStyle, background: '#2a1a1a', borderColor: '#ef444444', color: '#ef4444' }}>
          + Expense Add karo
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#555' }}>Month:</span>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            style={{ ...inputStyle, width: 'auto', fontSize: 12, padding: '6px 10px' }} />
          {month && <button onClick={() => setMonth('')} style={{ ...btnStyle, padding: '6px 10px', fontSize: 11, color: '#666' }}>Clear</button>}
        </div>
      </div>

      {msg && <div style={{ padding: '10px 16px', borderRadius: 8, background: msg.startsWith('✅') ? '#1a2a1a' : '#2a1a1a', color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: 13 }}>{msg}</div>}

      {/* Pending Approvals — CEO only */}
      {isCEO && pendingLogs.length > 0 && (
        <div style={{ background: '#111', border: '1px solid #c9a96e44', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#c9a96e' }}>⏳ Pending Cash Requests</span>
            <span style={{ background: '#c9a96e22', color: '#c9a96e', borderRadius: 20, padding: '1px 8px', fontSize: 11 }}>{pendingLogs.length}</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                {['Date', 'Requested By', 'Amount', 'Notes', 'Action'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pendingLogs.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={tdStyle}>{fmtDate(l.date)}</td>
                  <td style={{ ...tdStyle, color: '#ccc' }}>{l.requested_by}</td>
                  <td style={{ ...tdStyle, color: '#22c55e', fontWeight: 700 }}>{fmt(l.amount)}</td>
                  <td style={{ ...tdStyle, color: '#666' }}>{l.notes || '—'}</td>
                  <td style={{ ...tdStyle }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => approveCash(l.id)} style={{ ...btnStyle, padding: '5px 12px', fontSize: 12, background: '#1a2a1a', borderColor: '#22c55e44', color: '#22c55e' }}>✅ Approve</button>
                      <button onClick={() => rejectCash(l.id)} style={{ ...btnStyle, padding: '5px 12px', fontSize: 12, background: '#2a1a1a', borderColor: '#ef444444', color: '#ef4444' }}>✗ Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Transaction Log — Day-wise */}
      <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#888' }}>Transaction History</span>
            <span style={{ marginLeft: 10, fontSize: 12, color: '#444' }}>{approvedLogs.length} entries</span>
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#444' }}>Loading...</div>
        ) : approvedLogs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#333' }}>Koi transaction nahi</div>
        ) : (
          <div>
            {sortedDates.map(date => {
              const dayLogs = groupedByDate[date];
              const dayOut = dayLogs.filter(l => l.type !== 'cash_in').reduce((s, l) => s + parseFloat(l.amount || 0), 0);
              const dayIn = dayLogs.filter(l => l.type === 'cash_in').reduce((s, l) => s + parseFloat(l.amount || 0), 0);
              const isToday = date === todayStr;
              return (
                <div key={date}>
                  <div style={{ padding: '10px 20px', background: '#0a0a0a', borderBottom: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: isToday ? '#c9a96e' : '#555' }}>
                        {isToday ? '📅 Aaj — ' : ''}{fmtDate(date)}
                      </span>
                      <span style={{ fontSize: 11, color: '#333' }}>{dayLogs.length} transactions</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                      {dayIn > 0 && <span style={{ color: '#22c55e' }}>+{fmt(dayIn)}</span>}
                      {dayOut > 0 && <span style={{ color: '#ef4444' }}>-{fmt(dayOut)}</span>}
                    </div>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {dayLogs.map(l => {
                        const isCashIn = l.type === 'cash_in';
                        const isAdvance = l.type === 'advance';
                        const typeColor = isCashIn ? '#22c55e' : isAdvance ? '#8b5cf6' : '#ef4444';
                        const typeLabel = isCashIn ? '💰 Cash In' : isAdvance ? '💸 Advance' : '🧾 Expense';
                        const editHistory = Array.isArray(l.edit_history) ? l.edit_history : [];
                        const lastEdit = editHistory[editHistory.length - 1];
                        return (
                          <tr key={l.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                            <td style={tdStyle}>{fmtDate(l.date)}</td>
                            <td style={{ ...tdStyle }}>
                              <span style={{ background: typeColor + '22', color: typeColor, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{typeLabel}</span>
                            </td>
                            <td style={{ ...tdStyle, color: '#ccc' }}>
                              <div>{l.description || '—'}</div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3 }}>
                                {l.requested_by && (
                                  <span style={{ fontSize: 10, color: '#555' }}>by {l.requested_by}</span>
                                )}
                                {editHistory.length > 0 && (
                                  <button onClick={() => setShowHistoryFor(l)}
                                    style={{
                                      background: '#1a1a2a', border: '1px solid #8b5cf644',
                                      color: '#8b5cf6', fontSize: 10, padding: '1px 6px',
                                      borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
                                    }}
                                    title={`${editHistory.length} edit(s) — last by ${lastEdit?.edited_by}`}>
                                    ✏️ Edited {editHistory.length}x
                                  </button>
                                )}
                              </div>
                            </td>
                            <td style={{ ...tdStyle }}>
                              {l.category ? <span style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#666' }}>{l.category}</span> : '—'}
                            </td>
                            <td style={{ ...tdStyle, color: isCashIn ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                              {isCashIn ? '+' : '-'}{fmt(l.amount)}
                            </td>
                            <td style={tdStyle}>
                              <BillPreview url={l.bill_url} />
                            </td>
                            <td style={tdStyle}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                {canEdit(l) && (
                                  <button onClick={() => openEditModal(l)}
                                    style={{ background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: 16 }}
                                    title="Edit karo">✏️</button>
                                )}
                                {isCEO && (
                                  <button onClick={() => deleteEntry(l.id)}
                                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16 }}
                                    title="Delete karo">🗑</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cash Request Modal */}
      {showCashModal && (
        <Modal title="💰 Cash Request" onClose={() => setShowCashModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Amount (Rs.) *</label>
              <input type="number" placeholder="5000" value={cashForm.amount}
                onChange={e => setCashForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Notes (optional)</label>
              <input placeholder="Kyun chahiye? (e.g. kal ka saman)" value={cashForm.notes}
                onChange={e => setCashForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 12, fontSize: 12, color: '#666' }}>
              ⚠️ Yeh request CEO ke paas jayegi — approve hone ke baad balance mein add hoga
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={requestCash} disabled={saving} style={{ ...btnStyle, flex: 1, background: '#1a2a1a', borderColor: '#22c55e44', color: '#22c55e', justifyContent: 'center' }}>
                {saving ? 'Bhej raha hoon...' : 'Request Bhejo'}
              </button>
              <button onClick={() => setShowCashModal(false)} style={{ ...btnStyle, color: '#555' }}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Expense Add Modal */}
      {showExpenseModal && (
        <Modal title="🧾 Expense Add karo" onClose={() => setShowExpenseModal(false)}>
          <ExpenseForm
            form={expForm}
            setForm={setExpForm}
            onSave={addExpense}
            onCancel={() => setShowExpenseModal(false)}
            saving={saving}
            mode="add"
          />
        </Modal>
      )}

      {/* Expense Edit Modal */}
      {editingEntry && (
        <Modal title={`✏️ Entry Edit karo — ${editingEntry.description}`} onClose={() => setEditingEntry(null)}>
          <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 10, fontSize: 11, color: '#666', marginBottom: 14 }}>
            ℹ️ Jo bhi change karoge, full history log mein save hogi — kab, kisne, kya badla. Kuch chupega nahi.
          </div>
          <ExpenseForm
            form={editForm}
            setForm={setEditForm}
            onSave={saveEdit}
            onCancel={() => setEditingEntry(null)}
            saving={saving}
            mode="edit"
          />
        </Modal>
      )}

      {/* Edit History Modal */}
      {showHistoryFor && (
        <Modal title={`📜 Edit History — ${showHistoryFor.description}`} onClose={() => setShowHistoryFor(null)} maxWidth={560}>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 16 }}>
            Original by <span style={{ color: '#888' }}>{showHistoryFor.requested_by || 'Unknown'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(showHistoryFor.edit_history || []).slice().reverse().map((h, idx) => (
              <div key={idx} style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: '#8b5cf6', fontWeight: 600 }}>✏️ {h.edited_by}</span>
                  <span style={{ fontSize: 11, color: '#444' }}>{fmtDateTime(h.edited_at)}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(h.changes || {}).map(([field, diff]) => (
                    <div key={field} style={{ fontSize: 12, background: '#111', borderRadius: 6, padding: '6px 10px' }}>
                      <div style={{ color: '#888', fontWeight: 600, marginBottom: 2, fontFamily: 'monospace', fontSize: 11 }}>{field}</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ color: '#ef4444', textDecoration: 'line-through', flex: 1 }}>{String(diff.from ?? '—')}</span>
                        <span style={{ color: '#555' }}>→</span>
                        <span style={{ color: '#22c55e', flex: 1 }}>{String(diff.to ?? '—')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── ADVANCES TAB ───────────────────────────────────────────────
function AdvancesTab({ isCEO, currentUserName }) {
  const [employees, setEmployees] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ employee_id: '', amount: '', deduct_month: thisMonth(), notes: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [advR, empR] = await Promise.all([
      fetch('/api/hr/advances'),
      fetch('/api/operations'),
    ]);
    const [advD, opsD] = await Promise.all([advR.json(), empR.json()]);
    setAdvances(advD.advances || []);
    setPendingTotal(advD.pending_total || 0);
    setEmployees(opsD.employees || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  function showMsg(m) { setMsg(m); setTimeout(() => setMsg(''), 4000); }

  async function giveAdvance() {
    if (!form.employee_id || !form.amount) { showMsg('❌ Employee aur amount required'); return; }
    setSaving(true);
    const r = await fetch('/api/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'give_advance', ...form, given_by: currentUserName }),
    });
    const d = await r.json();
    setSaving(false);
    if (d.success) {
      showMsg('✅ Advance de diya!');
      setShowModal(false);
      setForm({ employee_id: '', amount: '', deduct_month: thisMonth(), notes: '' });
      load();
    } else showMsg('❌ ' + d.error);
  }

  async function markDeducted(id) {
    await fetch('/api/hr/advances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_deducted', id }),
    });
    showMsg('✅ Advance deducted mark kar diya');
    load();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ background: '#111', border: '1px solid #2a1a1a', borderRadius: 12, padding: '18px 24px' }}>
          <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Total Outstanding</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{fmt(pendingTotal)}</div>
        </div>
        <button onClick={() => setShowModal(true)} style={{ ...btnStyle, background: '#1a1a2a', borderColor: '#8b5cf644', color: '#8b5cf6' }}>
          💸 Advance Do
        </button>
      </div>

      {msg && <div style={{ padding: '10px 16px', borderRadius: 8, background: msg.startsWith('✅') ? '#1a2a1a' : '#2a1a1a', color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: 13 }}>{msg}</div>}

      <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e1e' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#888' }}>Advances History</span>
          <span style={{ marginLeft: 10, fontSize: 12, color: '#444' }}>{advances.length} records</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
              {['Employee', 'Amount', 'Date', 'Deduct Month', 'Status', 'Notes', ''].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {advances.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#333' }}>Koi advance nahi</td></tr>
            ) : advances.map(a => (
              <tr key={a.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                <td style={{ ...tdStyle, color: '#ccc', fontWeight: 500 }}>{a.employees?.name || '—'}</td>
                <td style={{ ...tdStyle, color: '#ef4444', fontWeight: 700 }}>{fmt(a.amount)}</td>
                <td style={tdStyle}>{fmtDate(a.given_date)}</td>
                <td style={tdStyle}>{a.deduct_month || '—'}</td>
                <td style={tdStyle}>
                  <span style={{
                    background: a.status === 'pending' ? '#ef444422' : '#22c55e22',
                    color: a.status === 'pending' ? '#ef4444' : '#22c55e',
                    padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                  }}>
                    {a.status === 'pending' ? 'Outstanding' : 'Deducted'}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: '#555' }}>{a.notes || '—'}</td>
                <td style={tdStyle}>
                  {a.status === 'pending' && (
                    <button onClick={() => markDeducted(a.id)}
                      style={{ ...btnStyle, padding: '4px 10px', fontSize: 11 }}>
                      ✓ Deducted
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title="💸 Advance Do" onClose={() => setShowModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Employee *</label>
              <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} style={inputStyle}>
                <option value="">Select Employee</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Amount (Rs.) *</label>
                <input type="number" placeholder="0" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Deduct Month</label>
                <input type="month" value={form.deduct_month}
                  onChange={e => setForm(f => ({ ...f, deduct_month: e.target.value }))} style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Notes (optional)</label>
              <input placeholder="Wajah ya notes..." value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 12, fontSize: 12, color: '#666' }}>
              ⚠️ Yeh advance Operations wallet se bhi deduct hoga aur HR mein bhi record hoga
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={giveAdvance} disabled={saving}
                style={{ ...btnStyle, flex: 1, background: '#1a1a2a', borderColor: '#8b5cf644', color: '#8b5cf6' }}>
                {saving ? 'Processing...' : 'Advance Do'}
              </button>
              <button onClick={() => setShowModal(false)} style={{ ...btnStyle, color: '#555' }}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── MAIN PAGE ──────────────────────────────────────────────────
export default function OperationsPage() {
  const { profile, isSuperAdmin, userEmail, activeUser } = useUser();
  const [tab, setTab] = useState('cash');

  const role = profile?.role || '';
  const isCEO = isSuperAdmin || role === 'super_admin';
  const isManager = role === 'manager' || isCEO;
  // Shared-login aware: prefer the picked packer/staff name over the login's
  // generic name, so audit trails show who actually added the expense etc.
  const currentUserName = activeUser?.name || profile?.full_name || userEmail || 'Unknown';

  const TABS = [
    { id: 'cash', label: '💰 Cash & Expenses' },
  ];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, fontFamily: "'Söhne', 'Helvetica Neue', sans-serif" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#eee', letterSpacing: -0.5, marginBottom: 4 }}>Operations</div>
        <div style={{ fontSize: 13, color: '#555' }}>Cash wallet, daily expenses & staff advances</div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#111', borderRadius: 10, padding: 4, width: 'fit-content', border: '1px solid #1e1e1e' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: tab === t.id ? '#1e1e1e' : 'transparent',
            border: `1px solid ${tab === t.id ? '#2a2a2a' : 'transparent'}`,
            borderRadius: 8, padding: '7px 18px', cursor: 'pointer',
            fontSize: 13, color: tab === t.id ? '#c9a96e' : '#555',
            fontWeight: tab === t.id ? 600 : 400, fontFamily: 'inherit',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'cash' && <CashTab isManager={isManager} isCEO={isCEO} currentUserName={currentUserName} />}
    </div>
  );
}
