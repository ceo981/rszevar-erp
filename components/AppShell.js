'use client';

// ============================================================================
// RS ZEVAR ERP — AppShell
// ----------------------------------------------------------------------------
// Client-side shell that wraps every page with sidebar + auth + UserContext.
// Uses Next.js <Link> + usePathname so each tab has a real URL:
//   /dashboard, /orders, /inventory, /courier, /courier/sync, etc.
// Login page (/login) ka sidebar skip hota hai.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { UserContext } from '@/context/UserContext';
import { createClient } from '@/lib/supabase/client';
import AIAdvisorFloat from './AIAdvisorFloat';

// ── Module registry ─────────────────────────────────────────────────────────
// Har module ka `href` hi uska URL hai. Sidebar is `href` pe Link render karta hai.
const MODULES = [
  { id: 'dashboard',    href: '/dashboard',    label: 'Dashboard',     icon: '◫',  perm: 'dashboard.view' },
  { id: 'orders',       href: '/orders',       label: 'Orders',        icon: '📋', perm: 'orders.view' },
  { id: 'inventory',    href: '/inventory',    label: 'Inventory',     icon: '📦', perm: 'inventory.view' },
  { id: 'accounts',     href: '/accounts',     label: 'Accounts',      icon: '💰', perm: 'financial.view' },
  { id: 'courier',      href: '/courier',      label: 'Courier',       icon: '🚚', perm: 'courier.view' },
  { id: 'courier-sync', href: '/courier/sync', label: 'Courier Sync',  icon: '⟳',  perm: 'courier.view' },
  { id: 'customers',    href: '/customers',    label: 'Customers',     icon: '👥', perm: 'customers.view' },
  { id: 'messages',     href: '/messages',     label: 'Messages',      icon: '💬', perm: 'customers.view' },
  { id: 'complaints',   href: '/complaints',   label: 'Complaints',    icon: '📢', perm: 'customers.view' },
  { id: 'analytics',    href: '/analytics',    label: 'Analytics',     icon: '📊', perm: 'analytics.view' },
  { id: 'dead-stock',   href: '/dead-stock',   label: 'Dead Stock',    icon: '🪦', perm: 'deadstock.view' },
  { id: 'reports',      href: '/reports',      label: 'Reports',       icon: '📄', perm: 'reports.view' },
  { id: 'employees',    href: '/employees',    label: 'Team',          icon: '👤', perm: 'settings.edit' },
  { id: 'hr',           href: '/hr',           label: 'HR & Payroll',  icon: '👥', perm: 'hr.view' },
  { id: 'operations',   href: '/operations',   label: 'Operations',    icon: '🏭', perm: 'operations.view' },
  { id: 'ai-advisor',   href: '/ai-advisor',   label: 'RS ZEVAR AI',   icon: '💎', perm: 'ai.use' },
  { id: 'work-submit',  href: '/work-submit',  label: 'Submit Work',   icon: '📋', perm: 'dashboard.view' },
  { id: 'settings',     href: '/settings',     label: 'Settings',      icon: '⚙️', perm: 'settings.view' },
  { id: 'users',        href: '/users',        label: 'Users',         icon: '🧑‍💼', perm: 'settings.edit' },
  { id: 'roles',        href: '/roles',        label: 'Roles & Perms', icon: '🔐', perm: 'settings.roles' },
];

// Routes jahan sidebar NAHI chahiye (login aur koi bhi public route)
const NO_SHELL_PREFIXES = ['/login'];

// Determine active module by longest matching href prefix
// /courier/sync → wins over /courier (longer prefix match)
function getActiveModuleId(pathname) {
  if (!pathname) return null;
  let bestId = null;
  let bestLen = -1;
  for (const m of MODULES) {
    const isMatch = pathname === m.href || pathname.startsWith(m.href + '/');
    if (isMatch && m.href.length > bestLen) {
      bestId = m.id;
      bestLen = m.href.length;
    }
  }
  return bestId;
}

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();

  // Login/public routes ke liye shell skip — raw children render karo
  if (NO_SHELL_PREFIXES.some(prefix => pathname?.startsWith(prefix))) {
    return <>{children}</>;
  }

  return <AuthenticatedShell pathname={pathname} router={router}>{children}</AuthenticatedShell>;
}

function AuthenticatedShell({ pathname, router, children }) {
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileNameInput, setProfileNameInput] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState(new Set());
  const [authLoading, setAuthLoading] = useState(true);

  // ── Mobile detection ──
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setSidebarOpen(false);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── Load user + profile + permissions ──
  useEffect(() => {
    async function loadUser() {
      const supabase = createClient();
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }
      setUser(u);
      const { data: p } = await supabase.from('profiles').select('*').eq('id', u.id).single();
      setProfile(p);
      const { data: perms } = await supabase.from('my_permissions').select('permission_key');
      setPermissions(new Set((perms || []).map(x => x.permission_key)));
      setAuthLoading(false);
    }
    loadUser();
  }, [router]);

  // ── Permissions ──
  const isSuperAdmin = profile?.role === 'super_admin';
  const canViewFinancial = isSuperAdmin;
  const can = useCallback((key) => isSuperAdmin || permissions.has(key), [isSuperAdmin, permissions]);
  const visibleModules = MODULES.filter((m) => !m.perm || can(m.perm));

  // ── Unread WhatsApp badge polling (every 15s) ──
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const fetchUnread = async () => {
      try {
        const r = await fetch('/api/whatsapp/inbox/conversations?limit=1');
        const d = await r.json();
        if (!cancelled && d.success) setUnreadTotal(d.unread_total || 0);
      } catch {}
    };
    fetchUnread();
    const t = setInterval(fetchUnread, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [authLoading, pathname]);

  // ── Legacy event listener for inventory SKU nav (from order item click) ──
  // Previously: window.dispatchEvent(new CustomEvent('openInventorySku', { detail: sku }))
  // Now: route to /inventory?search=<sku>
  useEffect(() => {
    const handler = (e) => {
      const sku = e.detail || '';
      router.push(`/inventory?search=${encodeURIComponent(sku)}`);
    };
    window.addEventListener('openInventorySku', handler);
    return () => window.removeEventListener('openInventorySku', handler);
  }, [router]);

  // ── Redirect unauthorized users away from pages they can't see ──
  useEffect(() => {
    if (authLoading) return;
    const activeId = getActiveModuleId(pathname);
    if (!activeId) return; // unknown route — let Next.js 404 handle it
    const mod = MODULES.find(m => m.id === activeId);
    if (mod && mod.perm && !can(mod.perm)) {
      // User doesn't have permission for this route — bounce to first allowed
      const first = visibleModules[0];
      if (first) router.push(first.href);
    }
  }, [pathname, authLoading, can, visibleModules, router]);

  async function saveProfileName() {
    if (!profileNameInput.trim()) return;
    setProfileSaving(true);
    const supabase = createClient();
    await supabase.from('profiles').update({ full_name: profileNameInput.trim() }).eq('id', user.id);
    setProfile(p => ({ ...p, full_name: profileNameInput.trim() }));
    setShowProfileModal(false);
    setProfileSaving(false);
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  if (authLoading) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--bg)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        color: 'var(--text3)', fontSize: 13, letterSpacing: 1,
      }}>Loading…</div>
    );
  }

  const activeId = getActiveModuleId(pathname);
  const activeMod = MODULES.find(m => m.id === activeId);

  return (
    <UserContext.Provider value={{
      profile, isSuperAdmin, canViewFinancial,
      userRole: profile?.role, userEmail: user?.email,
    }}>
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

        {/* ── Mobile Top Bar ── */}
        {isMobile && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, height: 52,
            background: 'rgba(13,22,38,0.97)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', padding: '0 14px', gap: 12,
            zIndex: 200, backdropFilter: 'blur(10px)',
          }}>
            <button onClick={() => setSidebarOpen(true)} style={{
              background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer',
              fontSize: 20, display: 'flex', alignItems: 'center', padding: '4px',
            }}>☰</button>
            <img src="/rs_zevar_logo_transparent.png" alt="RS ZEVAR" style={{ height: 30, objectFit: 'contain' }} />
            <div style={{ flex: 1 }} />
            <div style={{
              fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: 1,
              background: 'var(--sapphire-dim)', border: '1px solid rgba(74,130,216,0.2)',
              padding: '3px 10px', borderRadius: 20,
            }}>{activeMod?.label || 'ERP'}</div>
          </div>
        )}

        {/* ── Sidebar Backdrop (mobile) ── */}
        {isMobile && sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)',
            zIndex: 149, backdropFilter: 'blur(2px)',
          }} />
        )}

        {/* ── Sidebar ── */}
        <aside style={{
          width: isMobile ? 260 : (sidebarOpen ? 224 : 60),
          background: 'linear-gradient(180deg, #0d1626 0%, #091220 100%)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          transition: isMobile ? 'transform 0.25s ease' : 'width 0.2s ease',
          position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 150,
          transform: isMobile && !sidebarOpen ? 'translateX(-270px)' : 'translateX(0)',
          boxShadow: sidebarOpen && isMobile ? '4px 0 32px rgba(0,0,0,0.7)' : 'none',
        }}>
          {/* Logo */}
          <div style={{
            padding: (sidebarOpen || isMobile) ? '18px 16px' : '18px 8px',
            borderBottom: '1px solid var(--border)',
            textAlign: 'center',
            background: 'rgba(74,130,216,0.04)',
            position: 'relative',
          }}>
            {(sidebarOpen || isMobile) ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src="/rs_zevar_logo_transparent.png" alt="RS ZEVAR" style={{ height: 42, objectFit: 'contain', flex: 1 }} />
                {isMobile && (
                  <button onClick={() => setSidebarOpen(false)} style={{
                    background: 'none', border: 'none', color: 'var(--text3)',
                    cursor: 'pointer', fontSize: 18, padding: 4,
                  }}>✕</button>
                )}
              </div>
            ) : (
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, fontWeight: 700, color: 'var(--gold)', letterSpacing: 2 }}>RS</div>
            )}
            <div style={{ position: 'absolute', bottom: 0, left: '20%', right: '20%', height: 1, background: 'linear-gradient(90deg, transparent, var(--gold), transparent)' }} />
          </div>

          {/* Nav Items — Next.js <Link> with active state from pathname */}
          <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
            {visibleModules.map(mod => {
              const isActive = activeId === mod.id;
              return (
                <Link key={mod.id} href={mod.href}
                  onClick={() => { if (isMobile) setSidebarOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: (sidebarOpen || isMobile) ? '10px 12px' : '10px 0',
                    justifyContent: (sidebarOpen || isMobile) ? 'flex-start' : 'center',
                    background: isActive
                      ? 'linear-gradient(90deg, rgba(201,169,110,0.14), rgba(74,130,216,0.08))'
                      : 'transparent',
                    border: 'none',
                    borderLeft: isActive ? '2px solid var(--gold)' : '2px solid transparent',
                    borderRadius: isActive ? '0 var(--radius) var(--radius) 0' : 'var(--radius)',
                    color: isActive ? 'var(--gold)' : 'var(--text2)',
                    fontSize: 13, fontFamily: 'inherit', textDecoration: 'none',
                    cursor: 'pointer', transition: 'all 0.15s',
                    marginBottom: 2, position: 'relative',
                    boxSizing: 'border-box',
                  }}>
                  <span style={{ fontSize: 15, width: 22, textAlign: 'center', flexShrink: 0 }}>{mod.icon}</span>
                  {(sidebarOpen || isMobile) && <span style={{ fontWeight: isActive ? 600 : 400 }}>{mod.label}</span>}
                  {(sidebarOpen || isMobile) && mod.id === 'messages' && unreadTotal > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      background: '#22c55e', color: '#000',
                      padding: '2px 7px', borderRadius: 10,
                      minWidth: 18, textAlign: 'center',
                      marginLeft: 'auto',
                    }}>{unreadTotal > 99 ? '99+' : unreadTotal}</span>
                  )}
                  {!(sidebarOpen || isMobile) && mod.id === 'messages' && unreadTotal > 0 && (
                    <span style={{
                      position: 'absolute',
                      top: 6, right: 6,
                      width: 8, height: 8, borderRadius: '50%',
                      background: '#22c55e',
                      boxShadow: '0 0 0 2px var(--bg)',
                    }} />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* User Footer */}
          {(sidebarOpen || isMobile) && profile && (
            <>
              {showProfileModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 12, padding: 24, width: 320 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#c9a96e', marginBottom: 16 }}>✏️ Profile Update</div>
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>Email (change nahi hoga)</div>
                    <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 7, padding: '8px 12px', fontSize: 13, color: '#555', marginBottom: 12 }}>{user?.email}</div>
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>Display Name</div>
                    <input
                      value={profileNameInput}
                      onChange={e => setProfileNameInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveProfileName()}
                      placeholder="Apna naam likhein..."
                      autoFocus
                      style={{ width: '100%', background: '#1a1a1a', border: '1px solid #c9a96e', borderRadius: 7, padding: '9px 12px', fontSize: 13, color: '#fff', boxSizing: 'border-box', outline: 'none', marginBottom: 14 }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={saveProfileName} disabled={profileSaving || !profileNameInput.trim()}
                        style={{ flex: 1, background: '#c9a96e', color: '#000', border: 'none', borderRadius: 7, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                        {profileSaving ? 'Saving...' : '💾 Save'}
                      </button>
                      <button onClick={() => setShowProfileModal(false)}
                        style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#555', borderRadius: 7, padding: '9px 14px', fontSize: 13, cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div style={{
                padding: '12px 14px', borderTop: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'rgba(74,130,216,0.04)',
              }}>
                <div onClick={() => { setProfileNameInput(profile.full_name || ''); setShowProfileModal(true); }}
                  title="Profile edit karo"
                  style={{
                    width: 34, height: 34, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--gold-dim), var(--sapphire-dim))',
                    border: '1px solid var(--gold)', color: 'var(--gold)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, flexShrink: 0, cursor: 'pointer',
                  }}>{(profile.full_name || '?').charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => { setProfileNameInput(profile.full_name || ''); setShowProfileModal(true); }} title="Profile edit karo">
                  <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>{profile.full_name || <span style={{ color: '#555', fontStyle: 'italic' }}>Name set karo</span>}</div>
                  <div style={{ fontSize: 9, color: 'var(--sapphire)', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 }}>{(profile.role || '').replace(/_/g, ' ')}</div>
                </div>
                <button onClick={handleLogout} title="Sign out" style={{
                  background: 'transparent', border: '1px solid var(--border2)',
                  color: 'var(--text3)', width: 28, height: 28,
                  borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12,
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'all 0.15s',
                }}>⏻</button>
              </div>
            </>
          )}

          {/* Collapse Toggle (desktop only) */}
          {!isMobile && (
            <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{
              padding: 12, background: 'none', border: 'none',
              borderTop: '1px solid var(--border)', color: 'var(--text3)',
              cursor: 'pointer', fontSize: 12, transition: 'color 0.15s',
            }}>{sidebarOpen ? '◀' : '▶'}</button>
          )}
        </aside>

        {/* ── Main Content ── */}
        <main style={{
          flex: 1,
          marginLeft: isMobile ? 0 : (sidebarOpen ? 224 : 60),
          paddingTop: isMobile ? 52 : 0,
          transition: 'margin-left 0.2s ease',
          minWidth: 0,
        }}>
          {children}
        </main>
        <AIAdvisorFloat />
      </div>
    </UserContext.Provider>
  );
}
