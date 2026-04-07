'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

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
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const supabase = createClient();

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error) setUsers(data || []);
    setLoading(false);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function updateRole(id, role) {
    setBusyId(id);
    const { error } = await supabase
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      showToast('Error: ' + error.message);
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
      showToast('Error: ' + error.message);
    } else {
      setUsers((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, is_active: newActive } : x))
      );
      showToast(newActive ? 'Activated' : 'Deactivated');
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
            background: 'var(--bg-card)',
            border: '1px solid var(--gold)',
            color: 'var(--text)',
            padding: '10px 16px',
            borderRadius: 'var(--radius)',
            fontSize: 12,
            zIndex: 1000,
            boxShadow: 'var(--shadow)',
          }}
        >
          {toast}
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
        Go to Supabase Dashboard → Authentication → Users → Add User. Create
        with email + password + Auto Confirm. The new user will appear here and
        you can assign their role below.
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
                <th style={{ ...thStyle, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  style={{ borderTop: '1px solid var(--border)' }}
                >
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: 'var(--gold-dim)',
                          border: '1px solid var(--gold)',
                          color: 'var(--gold)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {(u.full_name || '?').charAt(0).toUpperCase()}
                      </div>
                      <span>{u.full_name || '—'}</span>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text2)' }}>
                    {u.email || '—'}
                  </td>
                  <td style={tdStyle}>
                    <select
                      value={u.role}
                      onChange={(e) => updateRole(u.id, e.target.value)}
                      disabled={busyId === u.id}
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
                    <button
                      onClick={() => toggleActive(u)}
                      disabled={busyId === u.id}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border2)',
                        color: 'var(--text2)',
                        padding: '5px 12px',
                        borderRadius: 'var(--radius)',
                        fontSize: 11,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
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
