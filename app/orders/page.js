'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/context/UserContext';

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Operations Manager',
  inventory_manager: 'Inventory Manager',
  dispatcher: 'Dispatcher',
  customer_support: 'Customer Support',
  wholesale_manager: 'Wholesale Manager',
  packing_staff: 'Packing Staff',
};

const ALL_ROLES = Object.keys(ROLE_LABELS);

export default function UsersPage() {
  const { profile: me, isSuperAdmin } = useUser();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  // Edit Name modal state
  const [editingUser, setEditingUser] = useState(null);
  const [editNameInput, setEditNameInput] = useState('');

  // Delete confirm state
  const [deletingUser, setDeletingUser] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  // Shared login config modal state
  const [sharingUser, setSharingUser] = useState(null);
  const [sharedFlag, setSharedFlag] = useState(false);
  const [sharedIds, setSharedIds] = useState([]);
  const [employeesList, setEmployeesList] = useState([]);

  const supabase = createClient();

  useEffect(() => {
    loadUsers();
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadEmployees() {
    const { data } = await supabase
      .from('employees')
      .select('id, name, role, status')
      .order('name', { ascending: true });
    setEmployeesList(data || []);
  }

  async function loadUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error) setUsers(data || []);
    setLoading(false);
  }

  function showToast(msg, kind = 'info') {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  }

  async function updateRole(id, role) {
    setBusyId(id);
    const { error } = await supabase
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      showToast('Error: ' + error.message, 'error');
    } else {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
      showToast('Role updated');
    }
    setBusyId(null);
  }

  async function toggleActive(u) {
    setBusyId(u.id);
    const newActive = !u.is_active;
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: newActive, updated_at: new Date().toISOString() })
      .eq('id', u.id);

    if (error) {
      showToast('Error: ' + error.message, 'error');
    } else {
      setUsers((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, is_active: newActive } : x))
      );
      showToast(newActive ? 'Activated' : 'Deactivated');
    }
    setBusyId(null);
  }

  // ─── Edit Name ─────────────────────────────────────────────────
  function openEditName(u) {
    setEditingUser(u);
    setEditNameInput(u.full_name || '');
  }

  async function saveEditName() {
    if (!editingUser || !editNameInput.trim()) return;
    setBusyId(editingUser.id);
    try {
      const r = await fetch('/api/users/update-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: editingUser.id, full_name: editNameInput.trim() }),
      });
      const d = await r.json();
      if (d.success) {
        setUsers((prev) => prev.map((x) => (x.id === editingUser.id ? { ...x, full_name: d.full_name } : x)));
        showToast('Naam update ho gaya');
        setEditingUser(null);
        setEditNameInput('');
      } else {
        showToast('Error: ' + (d.error || 'Update failed'), 'error');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
    setBusyId(null);
  }

  // ─── Delete User ───────────────────────────────────────────────
  function openDelete(u) {
    setDeletingUser(u);
    setDeleteConfirm('');
  }

  async function confirmDelete() {
    if (!deletingUser) return;
    const requiredName = deletingUser.full_name || deletingUser.email || '';
    if (deleteConfirm.trim() !== requiredName.trim()) {
      showToast('Confirmation text match nahi hua', 'error');
      return;
    }
    setBusyId(deletingUser.id);
    try {
      const r = await fetch('/api/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: deletingUser.id }),
      });
      const d = await r.json();
      if (d.success) {
        setUsers((prev) => prev.filter((x) => x.id !== deletingUser.id));
        showToast(`${requiredName} delete ho gaya`);
        setDeletingUser(null);
        setDeleteConfirm('');
      } else {
        showToast('Error: ' + (d.error || 'Delete failed'), 'error');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
    setBusyId(null);
  }

  // ─── Shared Login Config ──────────────────────────────────────
  function openSharingConfig(u) {
    setSharingUser(u);
    setSharedFlag(!!u.is_shared_login);
    setSharedIds(Array.isArray(u.shared_staff_ids) ? u.shared_staff_ids : []);
  }

  function toggleSharedEmployeeId(empId) {
    setSharedIds(prev => prev.includes(empId) ? prev.filter(x => x !== empId) : [...prev, empId]);
  }

  async function saveSharingConfig() {
    if (!sharingUser) return;
    setBusyId(sharingUser.id);
    try {
      const r = await fetch('/api/users/update-shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: sharingUser.id,
          is_shared_login: sharedFlag,
          shared_staff_ids: sharedFlag ? sharedIds : [],
        }),
      });
      const d = await r.json();
      if (d.success) {
        setUsers(prev => prev.map(x => x.id === sharingUser.id
          ? { ...x, is_shared_login: sharedFlag, shared_staff_ids: sharedFlag ? sharedIds : [] }
          : x));
        showToast('Sharing config saved');
        setSharingUser(null);
      } else {
        showToast('Error: ' + (d.error || 'Save failed'), 'error');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
    setBusyId(null);
  }

  return (
    <div style={{ padding: 24 }}>
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 24,
            right: 24,
            background: toast.kind === 'error' ? 'var(--red-dim)' : 'var(--bg-card)',
            border: `1px solid ${toast.kind === 'error' ? 'var(--red)' : 'var(--gold)'}`,
            color: toast.kind === 'error' ? 'var(--red)' : 'var(--text)',
            padding: '10px 16px',
            borderRadius: 'var(--radius)',
            fontSize: 12,
            zIndex: 10000,
            boxShadow: 'var(--shadow)',
          }}
        >
          {toast.msg}
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 28,
            fontWeight: 600,
            color: 'var(--gold)',
            letterSpacing: 1,
          }}
        >
          Users
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>
          Manage team members and their roles. {users.length} total.
        </p>
      </div>

      <div
        style={{
          background: 'var(--blue-dim)',
          border: '1px solid var(--blue)',
          borderRadius: 'var(--radius)',
          padding: 14,
          marginBottom: 20,
          fontSize: 12,
          color: 'var(--text2)',
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: 'var(--blue)' }}>How to add a new user:</strong>
        <br />
        Go to Supabase Dashboard → Authentication → Users → Add User. Create with email + password + Auto Confirm.
        The new user will appear here, phir role assign karke unka naam bhi set karlo — warna logs mein email hi dikhega.
      </div>

      {loading ? (
        <div
          style={{
            textAlign: 'center',
            padding: 60,
            color: 'var(--text3)',
            fontSize: 13,
          }}
        >
          Loading users…
        </div>
      ) : (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg2)' }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = me?.id === u.id;
                const nameMissing = !u.full_name;
                return (
                  <tr
                    key={u.id}
                    style={{ borderTop: '1px solid var(--border)' }}
                  >
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: nameMissing ? 'var(--red-dim)' : 'var(--gold-dim)',
                            border: `1px solid ${nameMissing ? 'var(--red)' : 'var(--gold)'}`,
                            color: nameMissing ? 'var(--red)' : 'var(--gold)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, fontWeight: 600, flexShrink: 0,
                          }}
                        >
                          {(u.full_name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ color: nameMissing ? 'var(--red)' : 'var(--text)' }}>
                            {u.full_name || <em style={{ color: 'var(--red)' }}>⚠ Name set nahi hai</em>}
                          </div>
                          {isSelf && (
                            <div style={{ fontSize: 9, color: 'var(--sapphire)', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              · You
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--text2)' }}>
                      {u.email || '—'}
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={u.role}
                        onChange={(e) => updateRole(u.id, e.target.value)}
                        disabled={busyId === u.id || (isSelf && u.role === 'super_admin')}
                        title={isSelf && u.role === 'super_admin' ? 'Apna super_admin role change nahi kar sakte' : ''}
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--border2)',
                          color: 'var(--text)',
                          padding: '6px 10px',
                          borderRadius: 'var(--radius)',
                          fontSize: 12,
                          fontFamily: 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        {ALL_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '3px 8px',
                          borderRadius: 4,
                          letterSpacing: 0.5,
                          textTransform: 'uppercase',
                          fontWeight: 600,
                          background: u.is_active ? 'var(--green-dim)' : 'var(--red-dim)',
                          color: u.is_active ? 'var(--green)' : 'var(--red)',
                          border: `1px solid ${u.is_active ? 'var(--green)' : 'var(--red)'}`,
                        }}
                      >
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {/* Edit Name (super admin) */}
                        {isSuperAdmin && (
                          <button
                            onClick={() => openEditName(u)}
                            disabled={busyId === u.id}
                            title="Naam edit karo"
                            style={{
                              background: nameMissing ? 'var(--red-dim)' : 'transparent',
                              border: `1px solid ${nameMissing ? 'var(--red)' : 'var(--border2)'}`,
                              color: nameMissing ? 'var(--red)' : 'var(--text2)',
                              padding: '5px 10px',
                              borderRadius: 'var(--radius)',
                              fontSize: 11,
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                              fontWeight: nameMissing ? 700 : 400,
                            }}
                          >
                            ✏ Name
                          </button>
                        )}
                        {/* Shared Login config (super admin) */}
                        {isSuperAdmin && (
                          <button
                            onClick={() => openSharingConfig(u)}
                            disabled={busyId === u.id}
                            title="Shared login configure karo"
                            style={{
                              background: u.is_shared_login ? 'var(--gold-dim)' : 'transparent',
                              border: `1px solid ${u.is_shared_login ? 'var(--gold)' : 'var(--border2)'}`,
                              color: u.is_shared_login ? 'var(--gold)' : 'var(--text2)',
                              padding: '5px 10px',
                              borderRadius: 'var(--radius)',
                              fontSize: 11,
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                              fontWeight: u.is_shared_login ? 700 : 400,
                            }}
                          >
                            👥 {u.is_shared_login ? `Shared (${(u.shared_staff_ids || []).length})` : 'Shared'}
                          </button>
                        )}
                        {/* Activate / Deactivate */}
                        <button
                          onClick={() => toggleActive(u)}
                          disabled={busyId === u.id || isSelf}
                          title={isSelf ? 'Apne aap ko deactivate nahi kar sakte' : ''}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border2)',
                            color: 'var(--text2)',
                            padding: '5px 12px',
                            borderRadius: 'var(--radius)',
                            fontSize: 11,
                            cursor: isSelf ? 'not-allowed' : 'pointer',
                            fontFamily: 'inherit',
                            opacity: isSelf ? 0.4 : 1,
                          }}
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        {/* Delete (super admin, not self) */}
                        {isSuperAdmin && !isSelf && (
                          <button
                            onClick={() => openDelete(u)}
                            disabled={busyId === u.id}
                            style={{
                              background: 'var(--red-dim)',
                              border: '1px solid var(--red)',
                              color: 'var(--red)',
                              padding: '5px 10px',
                              borderRadius: 'var(--radius)',
                              fontSize: 11,
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                              fontWeight: 600,
                            }}
                          >
                            🗑 Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {users.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: 48,
                color: 'var(--text3)',
                fontSize: 13,
              }}
            >
              No users yet.
            </div>
          )}
        </div>
      )}

      {/* ── Edit Name Modal ────────────────────────────────────── */}
      {editingUser && (
        <ModalOverlay onClose={() => setEditingUser(null)}>
          <h2 style={{ fontSize: 16, color: 'var(--gold)', marginBottom: 6 }}>✏ Edit Name</h2>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 16 }}>
            {editingUser.email}
          </div>
          <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 6 }}>
            Full Name
          </label>
          <input
            autoFocus
            value={editNameInput}
            onChange={(e) => setEditNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveEditName()}
            placeholder="e.g. Sharjeel Ahmed"
            style={{
              width: '100%',
              background: 'var(--bg)',
              border: '1px solid var(--gold)',
              color: 'var(--text)',
              padding: '9px 12px',
              borderRadius: 'var(--radius)',
              fontSize: 13,
              outline: 'none',
              marginBottom: 14,
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={saveEditName}
              disabled={!editNameInput.trim() || busyId === editingUser.id}
              style={{
                flex: 1,
                background: 'var(--gold)',
                color: '#000',
                border: 'none',
                borderRadius: 'var(--radius)',
                padding: '9px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {busyId === editingUser.id ? 'Saving…' : '💾 Save'}
            </button>
            <button
              onClick={() => setEditingUser(null)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border2)',
                color: 'var(--text3)',
                borderRadius: 'var(--radius)',
                padding: '9px 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Delete Confirm Modal ──────────────────────────────── */}
      {deletingUser && (
        <ModalOverlay onClose={() => setDeletingUser(null)}>
          <h2 style={{ fontSize: 16, color: 'var(--red)', marginBottom: 6 }}>🗑 Delete User</h2>
          <div style={{
            background: 'var(--red-dim)',
            border: '1px solid var(--red)',
            padding: 12, borderRadius: 'var(--radius)', marginBottom: 14,
            fontSize: 12, color: 'var(--text2)', lineHeight: 1.6,
          }}>
            <strong style={{ color: 'var(--red)' }}>⚠ Ye permanent delete hoga.</strong><br />
            <strong>{deletingUser.full_name || deletingUser.email}</strong> ke auth/login aur profile row dono remove ho jayenge.
            Purani activity logs mein naam preserved rahega.
          </div>
          <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 6 }}>
            Confirmation: poora naam/email type karo → <code style={{ color: 'var(--gold)' }}>{deletingUser.full_name || deletingUser.email}</code>
          </label>
          <input
            autoFocus
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={deletingUser.full_name || deletingUser.email}
            style={{
              width: '100%',
              background: 'var(--bg)',
              border: '1px solid var(--red)',
              color: 'var(--text)',
              padding: '9px 12px',
              borderRadius: 'var(--radius)',
              fontSize: 13,
              outline: 'none',
              marginBottom: 14,
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={confirmDelete}
              disabled={
                busyId === deletingUser.id ||
                deleteConfirm.trim() !== (deletingUser.full_name || deletingUser.email || '').trim()
              }
              style={{
                flex: 1,
                background: 'var(--red)',
                color: '#000',
                border: 'none',
                borderRadius: 'var(--radius)',
                padding: '9px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                opacity: (deleteConfirm.trim() !== (deletingUser.full_name || deletingUser.email || '').trim()) ? 0.4 : 1,
              }}
            >
              {busyId === deletingUser.id ? 'Deleting…' : '🗑 Delete Forever'}
            </button>
            <button
              onClick={() => setDeletingUser(null)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border2)',
                color: 'var(--text3)',
                borderRadius: 'var(--radius)',
                padding: '9px 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Shared Login Config Modal ──────────────────────────── */}
      {sharingUser && (
        <ModalOverlay onClose={() => setSharingUser(null)}>
          <h2 style={{ fontSize: 16, color: 'var(--gold)', marginBottom: 6 }}>👥 Shared Login Config</h2>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>
            {sharingUser.full_name || sharingUser.email}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 14, padding: 10, background: 'var(--bg)', border: `1px solid ${sharedFlag ? 'var(--gold)' : 'var(--border2)'}`, borderRadius: 'var(--radius)' }}>
            <input
              type="checkbox"
              checked={sharedFlag}
              onChange={e => setSharedFlag(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>Shared login enable karo</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                Multiple bande ek phone se use karenge — login pe "Kaun hai abhi?" picker dikhega.
              </div>
            </div>
          </label>

          {sharedFlag && (
            <>
              <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 6 }}>
                Kon konse employees link hain? ({sharedIds.length} selected)
              </label>
              <div style={{
                maxHeight: 260, overflowY: 'auto',
                background: 'var(--bg)', border: '1px solid var(--border2)',
                borderRadius: 'var(--radius)', padding: 8, marginBottom: 14,
              }}>
                {employeesList.length === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                    Koi employee nahi mila — HR page se add karo pehle.
                  </div>
                )}
                {employeesList.map(emp => {
                  const checked = sharedIds.includes(emp.id);
                  return (
                    <label
                      key={emp.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 10px', borderRadius: 5,
                        cursor: 'pointer',
                        background: checked ? 'var(--gold-dim)' : 'transparent',
                        marginBottom: 2,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSharedEmployeeId(emp.id)}
                        style={{ width: 14, height: 14, cursor: 'pointer' }}
                      />
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{emp.name}</span>
                      {emp.role && (
                        <span style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          {emp.role}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={saveSharingConfig}
              disabled={busyId === sharingUser.id || (sharedFlag && sharedIds.length === 0)}
              style={{
                flex: 1, background: 'var(--gold)', color: '#000',
                border: 'none', borderRadius: 'var(--radius)', padding: '9px',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                opacity: (sharedFlag && sharedIds.length === 0) ? 0.4 : 1,
              }}
            >
              {busyId === sharingUser.id ? 'Saving…' : '💾 Save'}
            </button>
            <button
              onClick={() => setSharingUser(null)}
              style={{
                background: 'transparent', border: '1px solid var(--border2)',
                color: 'var(--text3)', borderRadius: 'var(--radius)',
                padding: '9px 14px', fontSize: 13, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ─── Modal overlay helper ──────────────────────────────────────
function ModalOverlay({ children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          width: '100%',
          maxWidth: 380,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

const thStyle = {
  textAlign: 'left',
  padding: '12px 16px',
  fontSize: 10,
  color: 'var(--text3)',
  fontWeight: 600,
  letterSpacing: 1,
  textTransform: 'uppercase',
};

const tdStyle = {
  padding: '12px 16px',
  fontSize: 13,
  color: 'var(--text)',
};
