'use client';

// ============================================================================
// RS ZEVAR ERP — AppShell
// ----------------------------------------------------------------------------
// Client-side shell that wraps every page with sidebar + auth + UserContext.
// Uses Next.js <Link> + usePathname so each tab has a real URL:
//   /dashboard, /orders, /inventory, /courier, /courier/sync, etc.
// Login page (/login) ka sidebar skip hota hai.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { UserContext } from '@/context/UserContext';
import { createClient } from '@/lib/supabase/client';
import AIAdvisorFloat from './AIAdvisorFloat';

// ── Module registry ─────────────────────────────────────────────────────────
// Har module ka `href` hi uska URL hai. Sidebar is `href` pe Link render karta hai.
//
// May 2 2026 — Permission keys updated to match new granular DB schema.
// Each sidebar button now has its OWN view-level permission (e.g., credits.view,
// messages.view, employees.view) instead of borrowing from parent modules.
// CEO can hide any sidebar button from any role via /roles page.
const MODULES = [
  { id: 'dashboard',    href: '/dashboard',    label: 'Dashboard',     icon: '◫',  perm: 'dashboard.view' },
  { id: 'orders',       href: '/orders',       label: 'Orders',        icon: '📋', perm: 'orders.view' },
  { id: 'credits',      href: '/credits',      label: 'Customer Credits', icon: '📒', perm: 'credits.view' },
  { id: 'inventory',    href: '/inventory',    label: 'Inventory',     icon: '📦', perm: 'inventory.view' },
  { id: 'accounts',     href: '/accounts',     label: 'Accounts',      icon: '💰', perm: 'accounts.view' },
  { id: 'courier',      href: '/courier',      label: 'Courier',       icon: '🚚', perm: 'courier.view' },
  { id: 'courier-sync', href: '/courier/sync', label: 'Courier Sync',  icon: '⟳',  perm: 'courier_sync.view' },
  { id: 'customers',    href: '/customers',    label: 'Customers',     icon: '👥', perm: 'customers.view' },
  { id: 'messages',     href: '/messages',     label: 'Messages',      icon: '💬', perm: 'messages.view' },
  { id: 'complaints',   href: '/complaints',   label: 'Complaints',    icon: '📢', perm: 'complaints.view' },
  { id: 'analytics',    href: '/analytics',    label: 'Analytics',     icon: '📊', perm: 'analytics.view' },
  { id: 'dead-stock',   href: '/dead-stock',   label: 'Dead Stock',    icon: '🪦', perm: 'deadstock.view' },
  { id: 'reports',      href: '/reports',      label: 'Reports',       icon: '📄', perm: 'reports.view' },
  { id: 'employees',    href: '/employees',    label: 'Team',          icon: '👤', perm: 'employees.view' },
  { id: 'hr',           href: '/hr',           label: 'HR & Payroll',  icon: '👥', perm: 'hr.view' },
  { id: 'operations',   href: '/operations',   label: 'Operations',    icon: '🏭', perm: 'operations.view' },
  { id: 'ai-advisor',   href: '/ai-advisor',   label: 'RS ZEVAR AI',   icon: '💎', perm: 'ai.use' },
  { id: 'picking',      href: '/picking',      label: 'Pick Order',    icon: '🏷️', perm: 'picking.view' },
  { id: 'packing',      href: '/packing',      label: 'Packing',       icon: '🎁', perm: 'packing.view' },
  { id: 'work-submit',  href: '/work-submit',  label: 'Submit Work',   icon: '📋', perm: 'work_submit.view' },
  { id: 'settings',     href: '/settings',     label: 'Settings',      icon: '⚙️', perm: 'settings.view' },
  { id: 'users',        href: '/users',        label: 'Users',         icon: '🧑‍💼', perm: 'users.view' },
  { id: 'roles',        href: '/roles',        label: 'Roles & Perms', icon: '🔐', perm: 'settings.roles_edit' },
];

// Routes jahan sidebar NAHI chahiye (login aur koi bhi public route)
const NO_SHELL_PREFIXES = ['/login'];

// Routes jo path ke BEECH mein /print/ contain karti hain — ye self-contained
// print pages hain jinhe sidebar / bottom nav / mobile top bar ki zaroorat nahi.
// Example: /orders/[id]/print/packing-slip, /orders/[id]/print/invoice
function isShellSkippedRoute(pathname) {
  if (!pathname) return false;
  if (NO_SHELL_PREFIXES.some(prefix => pathname.startsWith(prefix))) return true;
  if (pathname.includes('/print/')) return true;
  return false;
}

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

  // Login/public/print routes ke liye shell skip — raw children render karo.
  // Print pages (/orders/[id]/print/...) ko clean render karna hai taake
  // print preview / PDF mein sidebar/nav na aaye.
  if (isShellSkippedRoute(pathname)) {
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

  // ── Browser notifications state ──
  const [notifPermission, setNotifPermission] = useState('default');
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const prevUnreadRef = useRef(0);
  const firstUnreadLoadRef = useRef(true);

  // Initialize permission state + decide whether to show banner
  useEffect(() => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    const perm = Notification.permission;
    setNotifPermission(perm);
    const dismissed = window.localStorage?.getItem('rszevar_notif_asked');
    if (perm === 'default' && !dismissed) setShowNotifBanner(true);
  }, []);

  // Helper — soft ding sound via Web Audio API (no asset file needed)
  const playDing = useCallback(() => {
    try {
      if (typeof window === 'undefined') return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
      setTimeout(() => { try { ctx.close(); } catch {} }, 500);
    } catch (e) {
      // silent fail — sound is best-effort
    }
  }, []);

  // Helper — fire desktop notification (only if permission granted)
  const fireNotification = useCallback(({ title, body, tag, onClick }) => {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;
      const n = new Notification(title, {
        body,
        icon: '/rs_zevar_logo_transparent.png',
        tag: tag || 'rs-zevar-whatsapp',
        renotify: true,
        silent: true, // we play our own ding
      });
      n.onclick = () => {
        try { window.focus(); } catch {}
        if (onClick) onClick();
        n.close();
      };
      setTimeout(() => { try { n.close(); } catch {} }, 8000);
    } catch (e) {
      // silent fail
    }
  }, []);

  // Enable handler — triggered by user clicking banner button
  const enableNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setShowNotifBanner(false);
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
      try { window.localStorage?.setItem('rszevar_notif_asked', 'yes'); } catch {}
      setShowNotifBanner(false);
      // Tiny confirmation ding so user knows sound works
      if (result === 'granted') playDing();
    } catch {
      setShowNotifBanner(false);
    }
  }, [playDing]);

  const dismissNotifBanner = useCallback(() => {
    try { window.localStorage?.setItem('rszevar_notif_asked', 'dismissed'); } catch {}
    setShowNotifBanner(false);
  }, []);

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

      // FORCE name setup: if user has no full_name, auto-open the modal.
      // The modal will hide its Cancel button in this mode so user must save.
      if (p && (!p.full_name || !p.full_name.trim())) {
        setProfileNameInput('');
        setShowProfileModal(true);
      }
    }
    loadUser();
  }, [router]);

  // ── Permissions ──
  const isSuperAdmin = profile?.role === 'super_admin';
  const canViewFinancial = isSuperAdmin;
  const can = useCallback((key) => isSuperAdmin || permissions.has(key), [isSuperAdmin, permissions]);
  const visibleModules = MODULES.filter((m) => !m.perm || can(m.perm));

  // ── Unread WhatsApp badge polling (every 15s) ──
  // Also fires browser notifications + ding when unread_total increases,
  // user has granted permission, and is NOT currently on /messages.
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const fetchUnread = async () => {
      try {
        const r = await fetch('/api/whatsapp/inbox/conversations?limit=1');
        const d = await r.json();
        if (cancelled || !d.success) return;

        const newTotal = d.unread_total || 0;
        const prevTotal = prevUnreadRef.current;
        const onMessagesPage = pathname === '/messages' || pathname?.startsWith('/messages/');

        // Fire notification on INCREASE only (ignore first load + on-messages page)
        if (!firstUnreadLoadRef.current && newTotal > prevTotal && !onMessagesPage) {
          const delta = newTotal - prevTotal;
          const latest = d.conversations?.[0];
          const sender = latest?.customer_name
            || latest?.customer_wa_name
            || latest?.customer_phone
            || 'Customer';
          const preview = latest?.last_message_text
            ? String(latest.last_message_text).slice(0, 120)
            : '';
          const title = delta > 1
            ? `📩 ${delta} new WhatsApp messages`
            : `📩 ${sender}`;
          const body = delta > 1
            ? (preview ? `Latest from ${sender}: ${preview}` : `From ${sender}`)
            : (preview || 'New message');

          fireNotification({
            title,
            body,
            tag: 'rs-zevar-whatsapp',
            onClick: () => router.push('/messages'),
          });
          playDing();
        }

        firstUnreadLoadRef.current = false;
        prevUnreadRef.current = newTotal;
        setUnreadTotal(newTotal);
      } catch {}
    };
    fetchUnread();
    const t = setInterval(fetchUnread, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [authLoading, pathname, router, fireNotification, playDing]);

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
    const name = profileNameInput.trim();
    if (!name) return;
    setProfileSaving(true);
    try {
      // Use the new server API so we don't silently fail on RLS.
      const r = await fetch('/api/users/update-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, full_name: name }),
      });
      const d = await r.json();
      if (d.success) {
        setProfile(p => ({ ...p, full_name: d.full_name }));
        setShowProfileModal(false);
      } else {
        // Fallback to client-side update (if API route not yet deployed)
        const supabase = createClient();
        const { error } = await supabase.from('profiles').update({ full_name: name }).eq('id', user.id);
        if (!error) {
          setProfile(p => ({ ...p, full_name: name }));
          setShowProfileModal(false);
        } else {
          alert('Naam save nahi hua: ' + (d.error || error.message));
        }
      }
    } catch (e) {
      alert('Naam save nahi hua: ' + e.message);
    }
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

  // ── BOTTOM NAV FOR MOBILE ────────────────────────────────────────────
  // Mobile app jaisi feel ke liye top 4 most-used modules bottom bar pe.
  // User ke role-permissions ke hisab se filter karke top 4 pick karo.
  // Packing staff ke liye: Packing, Submit Work, Messages, More.
  // Baaki staff/CEO ke liye: Dashboard, Orders, Inventory, Messages, More.
  const BOTTOM_NAV_CANDIDATES = [
    { id: 'dashboard', href: '/dashboard', label: 'Home',    icon: '🏠', perm: 'dashboard.view' },
    { id: 'orders',    href: '/orders',    label: 'Orders',  icon: '📋', perm: 'orders.view' },
    { id: 'picking',   href: '/picking',   label: 'Pick',    icon: '🏷️', perm: 'picking.view' },
    { id: 'packing',   href: '/packing',   label: 'Packing', icon: '🎁', perm: 'packing.view' },
    { id: 'work-submit', href: '/work-submit', label: 'Work', icon: '📝', perm: 'work_submit.view' },
    { id: 'inventory', href: '/inventory', label: 'Stock',   icon: '📦', perm: 'inventory.view' },
    { id: 'messages',  href: '/messages',  label: 'Chat',    icon: '💬', perm: 'messages.view' },
    { id: 'hr',        href: '/hr',        label: 'HR',      icon: '👥', perm: 'hr.view' },
  ];
  // Pick top 4 that user has permission for
  const bottomNavItems = BOTTOM_NAV_CANDIDATES
    .filter(m => !m.perm || can(m.perm))
    .slice(0, 4);

  // Single source of truth for "who performed this action"
  // (activeUser is kept here as null for backwards-compatibility with other
  // pages that read it via useUser(); they all fall back to profile.full_name)
  const activeUser = null;
  const setActiveUser = () => {};
  const performer = profile?.full_name || user?.email || 'Staff';

  return (
    <UserContext.Provider value={{
      profile, isSuperAdmin, canViewFinancial,
      userRole: profile?.role, userEmail: user?.email,
      activeUser, setActiveUser, performer,
      // ── Granular permissions (May 2 2026) ──
      // Expose the full Set + can() helper so any component can do:
      //   const { can } = useUser();
      //   {can('orders.cancel') && <CancelButton />}
      permissions, can,
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
            zIndex: 249, backdropFilter: 'blur(2px)',
          }} />
        )}

        {/* ── Sidebar ── */}
        {/* Z-INDEX FIX: Mobile pe sidebar ka z-index 250 (bottom nav=180, top bar=200 se upar),
            taake sidebar jab khule to top bar aur bottom nav ko PURA cover kare. Warna
            sidebar ka logo top bar ke peeche chhup jata aur logout button bottom nav ke
            peeche chhup jata. Desktop pe z-index 150 hi theek hai (modals ~1000). */}
        <aside style={{
          width: isMobile ? 260 : (sidebarOpen ? 224 : 60),
          background: 'linear-gradient(180deg, #0d1626 0%, #091220 100%)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          transition: isMobile ? 'transform 0.25s ease' : 'width 0.2s ease',
          position: 'fixed', top: 0, left: 0, bottom: 0,
          zIndex: isMobile ? 250 : 150,
          transform: isMobile && !sidebarOpen ? 'translateX(-270px)' : 'translateX(0)',
          boxShadow: sidebarOpen && isMobile ? '4px 0 32px rgba(0,0,0,0.7)' : 'none',
        }}>
          {/* Logo — Mobile pe iPhone notch ke liye extra top padding */}
          <div style={{
            padding: (sidebarOpen || isMobile)
              ? (isMobile ? 'calc(18px + env(safe-area-inset-top, 0px)) 16px 18px' : '18px 16px')
              : '18px 8px',
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

          {/* User Footer — Mobile pe safe-area-bottom (iPhone home indicator space)
              + bigger logout button touch target */}
          {(sidebarOpen || isMobile) && profile && (
            <>
              <div style={{
                padding: isMobile
                  ? '12px 14px calc(12px + env(safe-area-inset-bottom, 0px))'
                  : '12px 14px',
                borderTop: '1px solid var(--border)',
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
                  <div style={{ fontSize: 9, color: 'var(--sapphire)', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 }}>
                    {(profile.role || '').replace(/_/g, ' ')}
                  </div>
                </div>
                <button onClick={handleLogout} title="Sign out" style={{
                  background: 'rgba(248,113,113,0.1)',
                  border: '1px solid rgba(248,113,113,0.4)',
                  color: '#f87171',
                  width: isMobile ? 40 : 28,
                  height: isMobile ? 40 : 28,
                  borderRadius: 'var(--radius)', cursor: 'pointer',
                  fontSize: isMobile ? 16 : 12,
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'all 0.15s',
                }}>⏻</button>
              </div>
            </>
          )}

          {/* Profile Modal — rendered at top level of sidebar so it ALWAYS shows
              when showProfileModal is true (including collapsed sidebar + forced
              first-login name setup). */}
          {profile && showProfileModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 12, padding: 24, width: 340 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#c9a96e', marginBottom: 6 }}>
                  {!profile?.full_name ? '👋 Welcome — Naam set karo' : '✏️ Profile Update'}
                </div>
                {!profile?.full_name && (
                  <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.4)', padding: 10, borderRadius: 7, fontSize: 11, color: '#f87171', lineHeight: 1.5, marginBottom: 12 }}>
                    ⚠ Naam set karna zaroori hai. Isi se har activity log, order entry, aur packing credit
                    mein tumhara naam save hoga. Ye kaam kiye bagair ERP use nahi kar sakte.
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#555', marginBottom: 6, marginTop: profile?.full_name ? 10 : 0 }}>Email (change nahi hoga)</div>
                <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 7, padding: '8px 12px', fontSize: 13, color: '#555', marginBottom: 12 }}>{user?.email}</div>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>Full Name</div>
                <input
                  value={profileNameInput}
                  onChange={e => setProfileNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveProfileName()}
                  placeholder="e.g. Sharjeel Ahmed"
                  autoFocus
                  maxLength={80}
                  style={{ width: '100%', background: '#1a1a1a', border: '1px solid #c9a96e', borderRadius: 7, padding: '9px 12px', fontSize: 13, color: '#fff', boxSizing: 'border-box', outline: 'none', marginBottom: 14 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={saveProfileName} disabled={profileSaving || !profileNameInput.trim()}
                    style={{ flex: 1, background: '#c9a96e', color: '#000', border: 'none', borderRadius: 7, padding: '9px', fontSize: 13, fontWeight: 700, cursor: profileNameInput.trim() ? 'pointer' : 'not-allowed', opacity: profileNameInput.trim() ? 1 : 0.4 }}>
                    {profileSaving ? 'Saving...' : '💾 Save'}
                  </button>
                  {/* Cancel is only shown if user already has a name (i.e., they're just editing) */}
                  {profile?.full_name && (
                    <button onClick={() => setShowProfileModal(false)}
                      style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#555', borderRadius: 7, padding: '9px 14px', fontSize: 13, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
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
          {showNotifBanner && (
            <div style={{
              padding: '10px 18px',
              background: 'rgba(34,197,94,0.08)',
              borderBottom: '1px solid rgba(34,197,94,0.3)',
              color: '#22c55e',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 16 }}>🔔</span>
              <span style={{ flex: 1, minWidth: 200 }}>
                WhatsApp messages ke liye notifications enable karo — ERP tab background mein ho tab bhi alert mil jayega.
              </span>
              <button
                onClick={enableNotifications}
                style={{
                  background: '#22c55e',
                  border: 'none',
                  color: '#000',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                Enable
              </button>
              <button
                onClick={dismissNotifBanner}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(34,197,94,0.35)',
                  color: '#22c55e',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                Not now
              </button>
            </div>
          )}
          {children}
        </main>
        {/* ═════════════════════════════════════════════════════════════
            MOBILE BOTTOM NAV — sirf mobile pe dikhega (CSS controls visibility).
            Mobile app jaisi feel — 4 most-used modules tap-reach mein.
            "More" button sidebar khol deta hai sab modules ke liye.
            ═════════════════════════════════════════════════════════════ */}
        {isMobile && bottomNavItems.length > 0 && (
          <nav className="mobile-bottom-nav">
            {bottomNavItems.map(item => {
              const isActive = activeId === item.id;
              const showBadge = item.id === 'messages' && unreadTotal > 0;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`mobile-bottom-nav-item${isActive ? ' active' : ''}`}
                >
                  <span className="mbn-icon">{item.icon}</span>
                  <span className="mbn-label">{item.label}</span>
                  {showBadge && (
                    <span className="mbn-badge">
                      {unreadTotal > 99 ? '99+' : unreadTotal}
                    </span>
                  )}
                </Link>
              );
            })}
            {/* "More" button opens sidebar for full module list */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="mobile-bottom-nav-item"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <span className="mbn-icon">☰</span>
              <span className="mbn-label">More</span>
            </button>
          </nav>
        )}
        {/* Hide AI advisor float on /messages — it overlaps the chat send/voice buttons.
            On mobile, also hide by default to avoid overlap with bottom nav. */}
        {!(pathname === '/messages' || pathname?.startsWith('/messages/')) && !isMobile && <AIAdvisorFloat />}
      </div>
    </UserContext.Provider>
  );
}
