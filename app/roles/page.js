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

export default function RolesPage() {
  const [modules, setModules] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [matrix, setMatrix] = useState({}); // { role: Set<perm_key> }
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState('manager');
  const [saving, setSaving] = useState(new Set());
  const [toast, setToast] = useState(null);

  const supabase = createClient();

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    setLoading(true);
    const [modRes, permRes, rpRes] = await Promise.all([
      supabase.from('modules').select('*').order('sort_order'),
      supabase.from('permissions').select('*').order('key'),
      supabase.from('role_permissions').select('*'),
    ]);

    setModules(modRes.data || []);
    setPermissions(permRes.data || []);

    const m = {};
    ALL_ROLES.forEach((r) => (m[r] = new Set()));
    (rpRes.data || []).forEach((rp) => {
      if (!m[rp.role]) m[rp.role] = new Set();
      m[rp.role].add(rp.permission_key);
    });
    setMatrix(m);
    setLoading(false);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  async function togglePermission(role, permKey) {
    if (role === 'super_admin') {
      showToast('Super Admin permissions cannot be changed');
      return;
    }

    const cellKey = `${role}:${permKey}`;
    const isOn = matrix[role].has(permKey);

    // Optimistic update
    setMatrix((prev) => {
      const next = { ...prev, [role]: new Set(prev[role]) };
      if (isOn) next[role].delete(permKey);
      else next[role].add(permKey);
      return next;
    });

    setSaving((prev) => new Set(prev).add(cellKey));

    try {
      if (isOn) {
        const { error } = await supabase
          .from('role_permissions')
          .delete()
          .eq('role', role)
          .eq('permission_key', permKey);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('role_permissions')
          .insert({ role, permission_key: permKey });
        if (error) throw error;
      }
      showToast((isOn ? 'Removed: ' : 'Granted: ') + permKey);
    } catch (e) {
      // Rollback
      setMatrix((prev) => {
        const next = { ...prev, [role]: new Set(prev[role]) };
        if (isOn) next[role].add(permKey);
        else next[role].delete(permKey);
        return next;
      });
      showToast('Error: ' + (e.message || 'Save failed'));
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(cellKey);
        return next;
      });
    }
  }

  // Group permissions by module
  const permsByModule = {};
  permissions.forEach((p) => {
    if (!permsByModule[p.module_key]) permsByModule[p.module_key] = [];
    permsByModule[p.module_key].push(p);
  });

  const activePerms = matrix[activeRole] || new Set();
  const isLocked = activeRole === 'super_admin';

  if (loading) {
    return (
      <div
        style={{
          padding: 60,
          textAlign: 'center',
          color: 'var(--text3)',
          fontSize: 13,
        }}
      >
        Loading permissions…
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
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
          Roles & Permissions
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>
          Toggle checkboxes to control what each role can access. Changes save
          instantly.
        </p>
      </div>

      {/* Role tabs */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 6,
          marginBottom: 20,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
        }}
      >
        {ALL_ROLES.map((r) => {
          const count = matrix[r]?.size || 0;
          const active = r === activeRole;
          return (
            <button
              key={r}
              onClick={() => setActiveRole(r)}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                border: 'none',
                fontFamily: 'inherit',
                background: active ? 'var(--gold)' : 'transparent',
                color: active ? '#000' : 'var(--text2)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.15s',
              }}
            >
              {ROLE_LABELS[r]}
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: active ? 'rgba(0,0,0,0.2)' : 'var(--border2)',
                  color: active ? '#000' : 'var(--text3)',
                  fontWeight: 600,
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Lock notice for super_admin */}
      {isLocked && (
        <div
          style={{
            background: 'var(--orange-dim)',
            border: '1px solid var(--orange)',
            borderRadius: 'var(--radius)',
            padding: 14,
            marginBottom: 20,
            fontSize: 12,
            color: 'var(--text2)',
          }}
        >
          <strong style={{ color: 'var(--orange)' }}>🔒 Super Admin is locked</strong>
          <div style={{ marginTop: 4 }}>
            Super Admin always has all permissions. This prevents accidental
            lockout.
          </div>
        </div>
      )}

      {/* Modules with permissions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {modules.map((m) => {
          const perms = permsByModule[m.key] || [];
          if (perms.length === 0) return null;

          const grantedCount = perms.filter((p) => activePerms.has(p.key)).length;
          const allGranted = grantedCount === perms.length;
          const noneGranted = grantedCount === 0;

          return (
            <div
              key={m.key}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '14px 18px',
                  background: 'var(--bg2)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text)',
                      fontWeight: 600,
                    }}
                  >
                    {m.label}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text3)',
                      marginTop: 2,
                    }}
                  >
                    {grantedCount} of {perms.length} granted
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 9,
                    padding: '3px 8px',
                    borderRadius: 4,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    background: allGranted
                      ? 'var(--green-dim)'
                      : noneGranted
                      ? 'var(--border)'
                      : 'var(--orange-dim)',
                    color: allGranted
                      ? 'var(--green)'
                      : noneGranted
                      ? 'var(--text3)'
                      : 'var(--orange)',
                    border: `1px solid ${
                      allGranted
                        ? 'var(--green)'
                        : noneGranted
                        ? 'var(--border2)'
                        : 'var(--orange)'
                    }`,
                  }}
                >
                  {allGranted ? 'Full' : noneGranted ? 'None' : 'Partial'}
                </span>
              </div>

              <div>
                {perms.map((p, idx) => {
                  const cellKey = `${activeRole}:${p.key}`;
                  const isOn = activePerms.has(p.key) || isLocked;
                  const isSaving = saving.has(cellKey);

                  return (
                    <button
                      key={p.key}
                      onClick={() => togglePermission(activeRole, p.key)}
                      disabled={isLocked || isSaving}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '12px 18px',
                        background: 'transparent',
                        border: 'none',
                        borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                        color: 'var(--text)',
                        fontFamily: 'inherit',
                        cursor: isLocked || isSaving ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        opacity: isLocked || isSaving ? 0.7 : 1,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isLocked && !isSaving)
                          e.currentTarget.style.background = 'var(--bg-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--text)' }}>
                          {p.label}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: 'var(--text3)',
                            fontFamily: 'monospace',
                            marginTop: 2,
                          }}
                        >
                          {p.key}
                        </div>
                      </div>

                      {/* Custom checkbox */}
                      <div
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 4,
                          border: `2px solid ${isOn ? 'var(--gold)' : 'var(--border2)'}`,
                          background: isOn ? 'var(--gold)' : 'var(--bg)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {isSaving ? (
                          <span style={{ fontSize: 10, color: '#000' }}>⟳</span>
                        ) : isOn ? (
                          <span
                            style={{
                              fontSize: 12,
                              color: '#000',
                              fontWeight: 900,
                            }}
                          >
                            ✓
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
