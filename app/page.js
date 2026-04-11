'use client';
import { UserContext, useUser } from '@/context/UserContext';
import { useState, useEffect, useCallback, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import AccountsPage from './accounts/page';
import CourierPage from './courier/page';
import CourierSyncPage from './courier/sync-page';
import OrdersPage from './orders/page';
import AnalyticsPage from './analytics/page';
import EmployeesPage from './employees/page';
import CustomersPage from './customers/page';
import ComplaintsPage from './complaints/page';
import HRPage from './hr/page';
import SettingsPage from './settings/page';
import ReportsPage from './reports/page';
import WholesalePage from './wholesale/page';
import UsersPage from './users/page';
import RolesPage from './roles/page';
import DeadStockPage from './dead-stock/page';
import AIAdvisorPage from './ai-advisor/page';
import AIAdvisorFloat from '../components/AIAdvisorFloat';
// ============================================================================
// RS ZEVAR ERP v2.0 — Live Shopify Connected
// ============================================================================

const MODULES = [
  { id: 'dashboard',    label: 'Dashboard',     icon: '◫',  perm: 'dashboard.view' },
  { id: 'orders',       label: 'Orders',         icon: '📋', perm: 'orders.view' },
  { id: 'inventory',    label: 'Inventory',      icon: '📦', perm: 'inventory.view' },
  { id: 'accounts',     label: 'Accounts',       icon: '💰', perm: 'financial.view' },
  { id: 'courier',      label: 'Courier',         icon: '🚚', perm: 'courier.view' },
  { id: 'courier-sync', label: 'Courier Sync',   icon: '⟳',  perm: 'courier.view' },
  { id: 'customers',    label: 'Customers',      icon: '👥', perm: 'customers.view' },
  { id: 'complaints',   label: 'Complaints',     icon: '📢', perm: 'customers.view' },
  { id: 'analytics',    label: 'Analytics',      icon: '📊', perm: 'analytics.view' },
  { id: 'dead-stock',   label: 'Dead Stock',     icon: '🪦', perm: 'deadstock.view' },
  { id: 'reports',      label: 'Reports',        icon: '📄', perm: 'reports.view' },
  { id: 'employees',    label: 'Team',           icon: '👤', perm: 'settings.edit' },
  { id: 'hr',           label: 'HR & Payroll',   icon: '👥', perm: 'hr.view' },
  { id: 'ai-advisor',   label: 'RS ZEVAR AI',    icon: '💎', perm: 'ai.use' },
  { id: 'settings',     label: 'Settings',       icon: '⚙️', perm: 'settings.view' },
  { id: 'users',        label: 'Users',          icon: '🧑‍💼', perm: 'settings.edit' },
  { id: 'roles',        label: 'Roles & Perms',  icon: '🔐', perm: 'settings.roles' },
];

const STATUS_MAP = {
  pending:    { label: 'Pending',    color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  confirmed:  { label: 'Confirmed',  color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  processing: { label: 'Processing', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  dispatched: { label: 'Dispatched', color: '#22d3ee', bg: 'rgba(34,211,238,0.12)' },
  delivered:  { label: 'Delivered',  color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  returned:   { label: 'Returned',   color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  cancelled:  { label: 'Cancelled',  color: '#8a8580', bg: 'rgba(138,133,128,0.12)' },
};

const ABC_COLORS = {
  A: { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)' },
  B: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.3)' },
  C: { color: '#8a8580', bg: 'rgba(138,133,128,0.12)', border: 'rgba(138,133,128,0.3)' },
  D: { color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)' },
};

// ============================================================================
// MAIN APP
// ============================================================================
export default function ERPApp() {
  const router = useRouter();
  const [activeModule, setActiveModule] = useState('dashboard');
  const [inventorySearchSku, setInventorySearchSku] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState(new Set());
  const [authLoading, setAuthLoading] = useState(true);

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

  const isSuperAdmin = profile?.role === 'super_admin';
  const canViewFinancial = isSuperAdmin;
  const can = useCallback((key) => isSuperAdmin || permissions.has(key), [isSuperAdmin, permissions]);
  const visibleModules = MODULES.filter((m) => !m.perm || can(m.perm));

  useEffect(() => {
    if (!authLoading && visibleModules.length > 0) {
      const stillVisible = visibleModules.some((m) => m.id === activeModule);
      if (!stillVisible) setActiveModule(visibleModules[0].id);
    }
  }, [authLoading, visibleModules, activeModule]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  if (authLoading) {
    return (<div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13, letterSpacing: 1 }}>Loading…</div>);
  }

  return (
    <UserContext.Provider value={{ profile, isSuperAdmin, canViewFinancial, userRole: profile?.role }}>
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <aside style={{ width: sidebarOpen ? 220 : 60, background: 'var(--bg2)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', transition: 'width 0.2s ease', position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100 }}>
        <div style={{ padding: sidebarOpen ? '20px 16px' : '20px 8px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
          {sidebarOpen ? (
            <img src="/rs_zevar_logo_transparent.png" alt="RS ZEVAR" style={{ height: 48, maxWidth: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 14, fontWeight: 700, color: 'var(--gold)', letterSpacing: 2 }}>RS</div>
          )}
        </div>
        <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
          {visibleModules.map(mod => (
            <button key={mod.id} onClick={() => !mod.coming && setActiveModule(mod.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: sidebarOpen ? '10px 12px' : '10px 0', justifyContent: sidebarOpen ? 'flex-start' : 'center', background: activeModule === mod.id ? 'var(--gold-dim)' : 'transparent', border: 'none', borderRadius: 'var(--radius)', color: mod.coming ? 'var(--text3)' : activeModule === mod.id ? 'var(--gold)' : 'var(--text2)', fontSize: 13, fontFamily: 'inherit', cursor: mod.coming ? 'default' : 'pointer', transition: 'all 0.15s', marginBottom: 2, opacity: mod.coming ? 0.5 : 1 }}>
              <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>{mod.icon}</span>
              {sidebarOpen && <span>{mod.label}</span>}
              {sidebarOpen && mod.coming && <span style={{ fontSize: 9, background: 'var(--border)', color: 'var(--text3)', padding: '1px 6px', borderRadius: 4, marginLeft: 'auto' }}>Soon</span>}
            </button>
          ))}
        </nav>
        {sidebarOpen && profile && (
          <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--gold-dim)', border: '1px solid var(--gold)', color: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{(profile.full_name || '?').charAt(0).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.full_name || 'User'}</div>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 }}>{(profile.role || '').replace(/_/g, ' ')}</div>
            </div>
            <button onClick={handleLogout} title="Sign out" style={{ background: 'transparent', border: '1px solid var(--border2)', color: 'var(--text3)', width: 28, height: 28, borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>⏻</button>
          </div>
        )}
        <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ padding: 12, background: 'none', border: 'none', borderTop: '1px solid var(--border)', color: 'var(--text3)', cursor: 'pointer', fontSize: 14 }}>{sidebarOpen ? '◀' : '▶'}</button>
      </aside>
      <main style={{ flex: 1, marginLeft: sidebarOpen ? 220 : 60, transition: 'margin-left 0.2s ease' }}>
        {activeModule === 'dashboard' && <DashboardPage onNavigate={setActiveModule} />}
        {activeModule === 'orders' && <OrdersPage />}
        {activeModule === 'inventory' && <InventoryPage initialSearch={inventorySearchSku} onSearchUsed={() => setInventorySearchSku('')} />}
        {activeModule === 'accounts' && <AccountsPage />}
        {activeModule === 'courier' && <CourierPage />}
        {activeModule === 'courier-sync' && <CourierSyncPage />}
        {activeModule === 'analytics' && <AnalyticsPage />}
        {activeModule === 'employees' && <EmployeesPage />}
        {activeModule === 'customers' && <CustomersPage />}
        {activeModule === 'settings' && <SettingsPage />}
        {activeModule === 'reports' && <ReportsPage />}
        {activeModule === 'wholesale' && <WholesalePage />}
        {activeModule === 'complaints' && <ComplaintsPage />}
        {activeModule === 'hr' && <HRPage />}
        {activeModule === 'users' && <UsersPage />}
        {activeModule === 'roles' && <RolesPage />}
        {activeModule === 'dead-stock' && <DeadStockPage />}
        {activeModule === 'ai-advisor' && <AIAdvisorPage />}
      </main>
        <AIAdvisorFloat />
    </div>
    </UserContext.Provider>
  );
}

// ============================================================================
// DASHBOARD PAGE
// ============================================================================
function DashboardPage({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [ordersRes, syncRes] = await Promise.all([
          fetch('/api/orders?limit=5').then(r => r.json()),
          fetch('/api/shopify/sync').then(r => r.json()),
        ]);
        setStats(ordersRes);
        setSyncStatus(syncRes);
      } catch (e) { console.error('Dashboard load error:', e); }
      setLoading(false);
    }
    load();
  }, []);

  const s = stats?.stats || {};
  const cards = [
    { label: 'Total Orders', value: s.total || 0, color: 'var(--gold)', icon: '📋' },
    { label: 'Pending', value: s.pending || 0, color: 'var(--orange)', icon: '⏳' },
    { label: 'Confirmed', value: s.confirmed || 0, color: 'var(--blue)', icon: '✓' },
    { label: 'Dispatched', value: s.dispatched || 0, color: 'var(--cyan)', icon: '🚚' },
    { label: 'Delivered', value: s.delivered || 0, color: 'var(--green)', icon: '✅' },
    { label: 'Returned', value: s.returned || 0, color: 'var(--red)', icon: '↩️' },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 600, color: 'var(--gold)', letterSpacing: 1 }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>
          RS ZEVAR — Live Shopify Data
          {syncStatus?.last_synced && <span> · Last sync: {new Date(syncStatus.last_synced).toLocaleString()}</span>}
        </p>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}><div style={{ fontSize: 24, marginBottom: 8 }}>⟳</div>Loading dashboard...</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
            {cards.map(card => (
              <div key={card.label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{card.label}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: card.color }}>{card.value}</div>
                  </div>
                  <span style={{ fontSize: 22 }}>{card.icon}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 28 }}>
            <ActionButton icon="🔄" label="Sync Shopify Orders" desc="Pull latest orders" onClick={() => onNavigate('orders')} color="var(--gold)" />
            <ActionButton icon="📋" label="View All Orders" desc={`${s.total || 0} total orders`} onClick={() => onNavigate('orders')} color="var(--blue)" />
            <ActionButton icon="⏳" label="Pending Orders" desc={`${s.pending || 0} need confirmation`} onClick={() => onNavigate('orders')} color="var(--orange)" />
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Recent Orders</h3>
              <button onClick={() => onNavigate('orders')} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>View All →</button>
            </div>
            {(stats?.orders || []).length === 0 ? (
              <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>No orders yet. Sync from Shopify to get started!</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>{['Order', 'Customer', 'City', 'Amount', 'Status', 'Date'].map(h => (<th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--text3)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>))}</tr></thead>
                  <tbody>
                    {stats.orders.map(order => (
                      <tr key={order.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px', color: 'var(--gold)', fontWeight: 600 }}>{order.order_number}</td>
                        <td style={{ padding: '10px' }}>{order.customer_name}</td>
                        <td style={{ padding: '10px', color: 'var(--text2)' }}>{order.customer_city || '—'}</td>
                        <td style={{ padding: '10px', fontWeight: 600 }}>Rs {order.total_amount?.toLocaleString()}</td>
                        <td style={{ padding: '10px' }}><StatusBadge status={order.status} /></td>
                        <td style={{ padding: '10px', color: 'var(--text3)', fontSize: 12 }}>{new Date(order.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// INVENTORY PAGE — with ABC Classification
// ============================================================================
function InventoryPage({ initialSearch = '', onSearchUsed }) {
  const { canViewFinancial } = useUser();
  const [products, setProducts] = useState([]);
  const [stats, setStats] = useState({});
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ search: initialSearch || '', category: 'all', collection: 'all', stock: 'all', active: 'all' });

  // Apply initialSearch when coming from order items click
  useEffect(() => {
    if (initialSearch) {
      setFilters(f => ({ ...f, search: initialSearch }));
      setPage(1);
      if (onSearchUsed) onSearchUsed();
    }
  }, [initialSearch]);
  const [collections, setCollections] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [sortConfig, setSortConfig] = useState({ sort: 'title', order: 'asc' });
  const [view, setView] = useState('grouped');
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  // ── ABC state ──
  const [abcFilter, setAbcFilter] = useState('all');
  const [abcWindow, setAbcWindow] = useState('90d');
  const [abcStats, setAbcStats] = useState(null);
  const [computing, setComputing] = useState(false);
  const [computeResult, setComputeResult] = useState(null);

  const abcCol = abcWindow === '180d' ? 'abc_180d' : 'abc_90d';
  const revCol = abcWindow === '180d' ? 'revenue_180d' : 'revenue_90d';
  const soldCol = abcWindow === '180d' ? 'units_sold_180d' : 'units_sold_90d';

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '40', sort: sortConfig.sort, order: sortConfig.order, view });
      if (filters.search) params.set('search', filters.search);
      if (filters.category !== 'all') params.set('category', filters.category);
      if (filters.stock !== 'all') params.set('stock', filters.stock);
      if (filters.active !== 'all') params.set('active', filters.active);
      if (abcFilter !== 'all') params.set('abc', abcFilter);
      params.set('abc_window', abcWindow);
      if (filters.collection !== 'all') params.set('collection', filters.collection);
      const res = await fetch(`/api/products?${params}`);
      const data = await res.json();
      if (data.success) {
        setProducts(data.products || []);
        setTotal(data.total || 0);
        setTotalPages(data.total_pages || 1);
        setStats(data.stats || {});
        setCategories(data.categories || []);
        if (data.collections) setCollections(data.collections);
      }
    } catch (e) { console.error('Fetch products error:', e); }
    setLoading(false);
  }, [page, filters, sortConfig, view, abcFilter, abcWindow]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Fetch ABC distribution stats
  useEffect(() => {
    async function loadAbcStats() {
      try {
        const res = await fetch(`/api/products/abc-stats?window=${abcWindow}`);
        const data = await res.json();
        if (data.success) setAbcStats(data);
      } catch (e) { /* silent */ }
    }
    loadAbcStats();
  }, [abcWindow, computeResult]);

  const handleSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch('/api/shopify/products', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      setSyncResult(data);
      if (data.success) await fetchProducts();
    } catch (e) { setSyncResult({ success: false, error: e.message }); }
    setSyncing(false);
  };

  const [syncingCollections, setSyncingCollections] = useState(false);
  const handleSyncCollections = async () => {
    setSyncingCollections(true); setSyncResult(null);
    try {
      const res = await fetch('/api/shopify/sync-collections', { method: 'POST' });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { success: false, error: text.slice(0, 200) }; }
      setSyncResult(data);
      if (data.success) await fetchProducts();
    } catch (e) { setSyncResult({ success: false, error: e.message }); }
    setSyncingCollections(false);
  };

  const handleComputeABC = async () => {
    setComputing(true); setComputeResult(null);
    try {
      const res = await fetch('/api/analytics/compute-abc', { method: 'POST' });
      const data = await res.json();
      setComputeResult(data);
      if (data.success) await fetchProducts();
    } catch (e) { setComputeResult({ success: false, error: e.message }); }
    setComputing(false);
  };

  const handleSort = (field) => { setSortConfig(prev => ({ sort: field, order: prev.sort === field && prev.order === 'asc' ? 'desc' : 'asc' })); setPage(1); };
  const handleAbcFilter = (cls) => { setAbcFilter(cls); setPage(1); };
  const handleSmartPreset = (preset) => {
    if (preset === 'top_low') { setAbcFilter('A'); setFilters(f => ({ ...f, stock: 'low' })); }
    else if (preset === 'top_out') { setAbcFilter('A'); setFilters(f => ({ ...f, stock: 'out' })); }
    else if (preset === 'dead') { setAbcFilter('D'); setFilters(f => ({ ...f, stock: 'all' })); }
    setPage(1);
  };
  const clearPresets = () => { setAbcFilter('all'); setFilters(f => ({ ...f, stock: 'all', collection: 'all' })); setPage(1); };

  const SortIcon = ({ field }) => {
    if (sortConfig.sort !== field) return <span style={{ opacity: 0.3 }}>↕</span>;
    return <span style={{ color: 'var(--gold)' }}>{sortConfig.order === 'asc' ? '↑' : '↓'}</span>;
  };

  const getStockColor = (qty) => { if (qty === 0) return 'var(--red)'; if (qty <= 3) return 'var(--orange)'; if (qty <= 10) return '#fbbf24'; return 'var(--green)'; };
  const getStockBg = (qty) => { if (qty === 0) return 'var(--red-dim)'; if (qty <= 3) return 'var(--orange-dim)'; if (qty <= 10) return 'rgba(251,191,36,0.12)'; return 'var(--green-dim)'; };
  const getAbcColor = (cls) => ABC_COLORS[cls] || ABC_COLORS.D;

  // ── Render ABC badge ──
  const AbcBadge = ({ value }) => {
    const cls = value || 'D';
    const c = getAbcColor(cls);
    return <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700, background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>{cls}</span>;
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 600, color: 'var(--gold)', letterSpacing: 1 }}>Inventory</h1>
          <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>{total} products · Synced from Shopify</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleComputeABC} disabled={computing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: computing ? 'var(--border)' : 'transparent', color: computing ? 'var(--text3)' : 'var(--gold)', border: `1px solid ${computing ? 'var(--border)' : 'var(--gold)'}`, borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: computing ? 'wait' : 'pointer' }}>
            <span style={{ display: 'inline-block', animation: computing ? 'spin 1s linear infinite' : 'none' }}>📊</span>
            {computing ? 'Computing...' : 'Compute ABC'}
          </button>
          <button onClick={handleSyncCollections} disabled={syncingCollections} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: syncingCollections ? 'var(--border)' : 'transparent', color: syncingCollections ? 'var(--text3)' : 'var(--cyan)', border: `1px solid ${syncingCollections ? 'var(--border)' : 'var(--cyan)'}`, borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: syncingCollections ? 'wait' : 'pointer' }}>
            <span style={{ display: 'inline-block', animation: syncingCollections ? 'spin 1s linear infinite' : 'none' }}>🏷️</span>
            {syncingCollections ? 'Syncing...' : 'Sync Collections'}
          </button>
          <button onClick={handleSync} disabled={syncing} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: syncing ? 'var(--border)' : 'var(--gold)', color: syncing ? 'var(--text3)' : '#080808', border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: syncing ? 'wait' : 'pointer' }}>
            <span style={{ display: 'inline-block', animation: syncing ? 'spin 1s linear infinite' : 'none' }}>🔄</span>
            {syncing ? 'Syncing...' : 'Sync from Shopify'}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {syncResult && (
        <div style={{ padding: '12px 16px', marginBottom: 12, borderRadius: 'var(--radius)', background: syncResult.success ? 'var(--green-dim)' : 'var(--red-dim)', border: `1px solid ${syncResult.success ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: syncResult.success ? 'var(--green)' : 'var(--red)' }}>{syncResult.success ? `✅ ${syncResult.message}` : `❌ ${syncResult.error}`}</span>
          <button onClick={() => setSyncResult(null)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}
      {computeResult && (
        <div style={{ padding: '12px 16px', marginBottom: 12, borderRadius: 'var(--radius)', background: computeResult.success ? 'var(--green-dim)' : 'var(--red-dim)', border: `1px solid ${computeResult.success ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: computeResult.success ? 'var(--green)' : 'var(--red)' }}>
            {computeResult.success ? `✅ ABC computed — ${computeResult.orders_processed} orders, ${computeResult.unique_skus_with_sales} SKUs (${computeResult.duration_ms}ms)` : `❌ ${computeResult.error}`}
          </span>
          <button onClick={() => setComputeResult(null)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Total Products', value: stats.total_products ?? stats.total ?? 0, icon: '📦', color: 'var(--gold)' },
          { label: 'Total Variants', value: stats.total_variants ?? stats.total ?? 0, icon: '🎨', color: 'var(--cyan)' },
          { label: 'Total Units', value: stats.total_units || 0, icon: '🔢', color: 'var(--blue)' },
          ...(canViewFinancial ? [{ label: 'Stock Value', value: `Rs ${((stats.total_stock_value || 0) / 1000).toFixed(0)}K`, icon: '💰', color: 'var(--green)' }] : []),
          { label: 'Low Stock', value: stats.low_stock || 0, icon: '⚠️', color: 'var(--orange)' },
          { label: 'Out of Stock', value: stats.out_of_stock || 0, icon: '🚫', color: 'var(--red)' },
          { label: 'Active', value: stats.active || 0, icon: '✅', color: 'var(--cyan)' },
        ].map(card => (
          <div key={card.label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>{card.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: card.color }}>{card.value}</div>
              </div>
              <span style={{ fontSize: 20 }}>{card.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── ABC Classification Bar ── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginRight: 4 }}>ABC</span>
            <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 2 }}>
              {['90d', '180d'].map(w => (
                <button key={w} onClick={() => { setAbcWindow(w); setPage(1); }}
                  style={{ padding: '4px 10px', background: abcWindow === w ? 'var(--gold-dim)' : 'transparent', border: 'none', borderRadius: 'var(--radius)', color: abcWindow === w ? 'var(--gold)' : 'var(--text3)', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>{w}</button>
              ))}
            </div>
            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
            {[{ v: 'all', l: 'All', i: '' }, { v: 'A', l: 'A', i: '🔥' }, { v: 'B', l: 'B', i: '📈' }, { v: 'C', l: 'C', i: '📉' }, { v: 'D', l: 'D', i: '💀' }].map(cls => {
              const active = abcFilter === cls.v;
              const clr = cls.v !== 'all' ? getAbcColor(cls.v) : null;
              const count = abcStats && cls.v !== 'all' ? (abcStats[`class_${cls.v.toLowerCase()}`] || 0) : null;
              return (
                <button key={cls.v} onClick={() => handleAbcFilter(cls.v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', background: active ? (clr?.bg || 'var(--gold-dim)') : 'transparent', border: `1px solid ${active ? (clr?.border || 'var(--gold)') : 'var(--border)'}`, borderRadius: 'var(--radius)', color: active ? (clr?.color || 'var(--gold)') : 'var(--text2)', fontSize: 12, fontWeight: active ? 600 : 400, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {cls.i && <span style={{ fontSize: 11 }}>{cls.i}</span>}
                  <span>{cls.v === 'all' ? 'All' : `Class ${cls.l}`}</span>
                  {count !== null && <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>({count})</span>}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => handleSmartPreset('top_low')} style={{ padding: '5px 10px', background: (abcFilter === 'A' && filters.stock === 'low') ? 'var(--orange-dim)' : 'transparent', border: `1px solid ${(abcFilter === 'A' && filters.stock === 'low') ? 'var(--orange)' : 'var(--border)'}`, borderRadius: 'var(--radius)', color: (abcFilter === 'A' && filters.stock === 'low') ? 'var(--orange)' : 'var(--text3)', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>🔥 Top sellers low</button>
            <button onClick={() => handleSmartPreset('top_out')} style={{ padding: '5px 10px', background: (abcFilter === 'A' && filters.stock === 'out') ? 'var(--red-dim)' : 'transparent', border: `1px solid ${(abcFilter === 'A' && filters.stock === 'out') ? 'var(--red)' : 'var(--border)'}`, borderRadius: 'var(--radius)', color: (abcFilter === 'A' && filters.stock === 'out') ? 'var(--red)' : 'var(--text3)', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>🚨 Top sellers OUT</button>
            <button onClick={() => handleSmartPreset('dead')} style={{ padding: '5px 10px', background: abcFilter === 'D' ? 'rgba(248,113,113,0.12)' : 'transparent', border: `1px solid ${abcFilter === 'D' ? 'rgba(248,113,113,0.3)' : 'var(--border)'}`, borderRadius: 'var(--radius)', color: abcFilter === 'D' ? 'var(--red)' : 'var(--text3)', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>💀 Dead stock</button>
            {(abcFilter !== 'all' || filters.stock !== 'all') && (
              <button onClick={clearPresets} style={{ padding: '5px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text3)', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>✕ Clear</button>
            )}
          </div>
        </div>
        {abcStats && (abcStats.class_a + abcStats.class_b + abcStats.class_c + abcStats.class_d) > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--bg)' }}>
              {[{ k: 'class_a', c: '#f59e0b' }, { k: 'class_b', c: '#60a5fa' }, { k: 'class_c', c: '#6b7280' }, { k: 'class_d', c: '#f87171' }].map(seg => {
                const t = (abcStats.class_a||0) + (abcStats.class_b||0) + (abcStats.class_c||0) + (abcStats.class_d||0);
                const pct = t > 0 ? ((abcStats[seg.k]||0) / t * 100) : 0;
                return pct > 0 ? <div key={seg.k} style={{ width: `${pct}%`, background: seg.c, transition: 'width 0.3s' }} /> : null;
              })}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>
              <span><span style={{ color: '#f59e0b', fontWeight: 600 }}>A</span> {abcStats.class_a||0}</span>
              <span><span style={{ color: '#60a5fa', fontWeight: 600 }}>B</span> {abcStats.class_b||0}</span>
              <span><span style={{ color: '#6b7280', fontWeight: 600 }}>C</span> {abcStats.class_c||0}</span>
              <span><span style={{ color: '#f87171', fontWeight: 600 }}>D</span> {abcStats.class_d||0}</span>
              <span style={{ marginLeft: 'auto' }}>Window: {abcWindow}</span>
            </div>
          </div>
        )}
      </div>

      {/* Filters Row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="text" placeholder="Search by name, SKU, category..." value={filters.search}
          onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }}
          style={{ flex: '1 1 250px', maxWidth: 350, padding: '9px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
        <select value={filters.collection} onChange={e => { setFilters(f => ({ ...f, collection: e.target.value })); setPage(1); }}
          style={{ padding: '9px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}>
          <option value="all">All Collections</option>
          {collections.map(c => <option key={c.handle} value={c.handle}>{c.title}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {[{ value: 'grouped', label: '📦 Grouped' }, { value: 'flat', label: '≡ Flat' }].map(v => (
            <button key={v.value} onClick={() => { setView(v.value); setPage(1); setExpandedGroups(new Set()); }}
              style={{ padding: '7px 14px', background: view === v.value ? 'var(--gold-dim)' : 'transparent', border: `1px solid ${view === v.value ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 'var(--radius)', color: view === v.value ? 'var(--gold)' : 'var(--text2)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>{v.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[{ value: 'all', label: 'All Products' }, { value: 'low', label: 'Low Stock (≤3)' }, { value: 'out', label: 'Out of Stock' }].map(sf => (
            <button key={sf.value} onClick={() => { setFilters(f => ({ ...f, stock: sf.value })); setPage(1); }}
              style={{ padding: '7px 14px', background: filters.stock === sf.value ? 'var(--gold-dim)' : 'transparent', border: `1px solid ${filters.stock === sf.value ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 'var(--radius)', color: filters.stock === sf.value ? 'var(--gold)' : 'var(--text2)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>{sf.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[{ value: 'all', label: 'All' }, { value: 'active', label: '✓ Active' }, { value: 'draft', label: '○ Draft' }].map(af => (
            <button key={af.value} onClick={() => { setFilters(f => ({ ...f, active: af.value })); setPage(1); }}
              style={{ padding: '7px 14px', background: filters.active === af.value ? 'var(--green-dim)' : 'transparent', border: `1px solid ${filters.active === af.value ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius)', color: filters.active === af.value ? 'var(--green)' : 'var(--text2)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>{af.label}</button>
          ))}
        </div>
      </div>

      {/* Products Table */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
            <div style={{ fontSize: 24, marginBottom: 8, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</div>
            <div>Loading products...</div>
          </div>
        ) : products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
            <div style={{ fontSize: 15, marginBottom: 8 }}>No products found</div>
            <div style={{ fontSize: 13 }}>{filters.search || filters.stock !== 'all' || filters.collection !== 'all' || abcFilter !== 'all' ? 'Try different filters' : 'Click "Sync from Shopify" to pull your products'}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {[
                    { key: 'image', label: '', sortable: false, width: 50 },
                    { key: 'title', label: 'Product', sortable: true },
                    { key: 'sku', label: 'SKU', sortable: true },
                    ...(canViewFinancial ? [{ key: 'selling_price', label: 'Price', sortable: true }] : []),
                    { key: 'stock_quantity', label: 'Stock', sortable: true },
                    { key: 'abc', label: 'ABC', sortable: false, width: 50 },
                    ...(canViewFinancial ? [{ key: revCol, label: `Rev (${abcWindow})`, sortable: true }] : []),
                    { key: soldCol, label: `Sold`, sortable: true, width: 60 },
                    { key: 'status', label: 'Status', sortable: false },
                  ].map(col => (
                    <th key={col.key} onClick={() => col.sortable && handleSort(col.key)}
                      style={{ padding: '12px 10px', textAlign: 'left', color: 'var(--text3)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', background: 'var(--bg2)', cursor: col.sortable ? 'pointer' : 'default', width: col.width || 'auto' }}>
                      {col.label} {col.sortable && <SortIcon field={col.key} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view === 'grouped' ? products.map(group => {
                  const isExpanded = expandedGroups.has(group.group_key);
                  const toggleExpand = () => setExpandedGroups(prev => { const next = new Set(prev); if (next.has(group.group_key)) next.delete(group.group_key); else next.add(group.group_key); return next; });
                  return (
                    <Fragment key={group.group_key}>
                      <tr onClick={toggleExpand} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isExpanded ? 'var(--gold-dim)' : 'transparent', transition: 'background 0.1s' }}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}>
                        <td style={{ padding: '8px 10px' }}>
                          {group.image_url ? <img src={group.image_url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />
                            : <div style={{ width: 36, height: 36, borderRadius: 4, background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--text3)' }}>📷</div>}
                        </td>
                        <td style={{ padding: '10px', maxWidth: 250, overflow: 'hidden' }}>
                          <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <span style={{ color: 'var(--gold)', fontSize: 10, width: 10, flexShrink: 0 }}>{isExpanded ? '▼' : '▶'}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.parent_title}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1, marginLeft: 16 }}>{group.vendor ? `${group.vendor} · ` : ''}{group.variant_count} variant{group.variant_count !== 1 ? 's' : ''}</div>
                        </td>
                        <td style={{ padding: '10px', color: 'var(--text3)', fontSize: 11, fontStyle: 'italic' }}>{group.variant_count} SKUs</td>
                        {canViewFinancial && <td style={{ padding: '10px', fontWeight: 600, whiteSpace: 'nowrap' }}>Rs {group.selling_price?.toLocaleString() || '—'}</td>}
                        <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                          <span style={{ padding: '3px 10px', borderRadius: 4, background: getStockBg(group.total_stock), color: getStockColor(group.total_stock), fontWeight: 600, fontSize: 12 }}>{group.total_stock}</span>
                          {group.has_out_of_stock && <span title="Some variants out of stock" style={{ marginLeft: 6, fontSize: 10, color: 'var(--red)' }}>⚠</span>}
                        </td>
                        <td style={{ padding: '10px', color: 'var(--text3)' }}>—</td>
                        <td style={{ padding: '10px', color: 'var(--text3)', fontSize: 11 }}>—</td>
                        <td style={{ padding: '10px', color: 'var(--text3)', fontSize: 11 }}>—</td>
                        <td style={{ padding: '10px' }}>
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: group.is_active ? 'var(--green-dim)' : 'rgba(138,133,128,0.12)', color: group.is_active ? 'var(--green)' : 'var(--text3)' }}>{group.is_active ? 'Active' : 'Draft'}</span>
                        </td>
                      </tr>
                      {isExpanded && group.variants.map(v => {
                        const variantLabel = v.title && v.parent_title && v.title.startsWith(v.parent_title + ' - ') ? v.title.slice((v.parent_title + ' - ').length) : (v.title?.split(' - ').slice(1).join(' - ') || 'Default');
                        return (
                          <tr key={v.id} onClick={(e) => { e.stopPropagation(); setSelectedProduct(selectedProduct?.id === v.id ? null : v); }}
                            style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selectedProduct?.id === v.id ? 'var(--gold-dim)' : 'var(--bg2)' }}>
                            <td></td>
                            <td style={{ padding: '6px 10px 6px 30px', fontSize: 12, color: 'var(--text2)', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <span style={{ color: 'var(--text3)' }}>└ </span>{variantLabel}
                            </td>
                            <td style={{ padding: '6px 10px', color: 'var(--text2)', fontSize: 11, fontFamily: 'monospace' }}>{v.sku || '—'}</td>
                            {canViewFinancial && <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>Rs {v.selling_price?.toLocaleString()}</td>}
                            <td style={{ padding: '6px 10px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 4, background: getStockBg(v.stock_quantity || 0), color: getStockColor(v.stock_quantity || 0), fontWeight: 600, fontSize: 11 }}>{v.stock_quantity ?? 0}</span>
                            </td>
                            <td style={{ padding: '6px 10px' }}><AbcBadge value={v[abcCol]} /></td>
                            {canViewFinancial && <td style={{ padding: '6px 10px', color: 'var(--text2)', fontSize: 11, whiteSpace: 'nowrap' }}>{v[revCol] ? `Rs ${Number(v[revCol]).toLocaleString()}` : '—'}</td>}
                            <td style={{ padding: '6px 10px', color: 'var(--text3)', fontSize: 11 }}>{v[soldCol] || 0}</td>
                            <td></td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                }) : products.map(product => (
                  <tr key={product.id} onClick={() => setSelectedProduct(selectedProduct?.id === product.id ? null : product)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selectedProduct?.id === product.id ? 'var(--gold-dim)' : 'transparent', transition: 'background 0.1s' }}
                    onMouseEnter={e => { if (selectedProduct?.id !== product.id) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={e => { if (selectedProduct?.id !== product.id) e.currentTarget.style.background = 'transparent'; }}>
                    <td style={{ padding: '8px 10px' }}>
                      {product.image_url ? <img src={product.image_url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />
                        : <div style={{ width: 36, height: 36, borderRadius: 4, background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--text3)' }}>📷</div>}
                    </td>
                    <td style={{ padding: '10px', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 500 }}>{product.title}</div>
                      {product.vendor && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{product.vendor}</div>}
                    </td>
                    <td style={{ padding: '10px', color: 'var(--text2)', fontSize: 12, fontFamily: 'monospace' }}>{product.sku || '—'}</td>
                    {canViewFinancial && <td style={{ padding: '10px', fontWeight: 600, whiteSpace: 'nowrap' }}>Rs {product.selling_price?.toLocaleString()}</td>}
                    <td style={{ padding: '10px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: 4, background: getStockBg(product.stock_quantity || 0), color: getStockColor(product.stock_quantity || 0), fontWeight: 600, fontSize: 12 }}>{product.stock_quantity ?? 0}</span>
                    </td>
                    <td style={{ padding: '10px' }}><AbcBadge value={product[abcCol]} /></td>
                    {canViewFinancial && <td style={{ padding: '10px', color: 'var(--text2)', fontSize: 11, whiteSpace: 'nowrap' }}>{product[revCol] ? `Rs ${Number(product[revCol]).toLocaleString()}` : '—'}</td>}
                    <td style={{ padding: '10px', color: 'var(--text3)', fontSize: 11 }}>{product[soldCol] || 0}</td>
                    <td style={{ padding: '10px' }}>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: product.is_active ? 'var(--green-dim)' : 'rgba(138,133,128,0.12)', color: product.is_active ? 'var(--green)' : 'var(--text3)' }}>{product.is_active ? 'Active' : 'Draft'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text3)' }}>
            <span>Page {page} of {totalPages} · {total} products</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <PagBtn disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</PagBtn>
              <PagBtn disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</PagBtn>
            </div>
          </div>
        )}
      </div>

      {/* Detail Sidebar */}
      {selectedProduct && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 400, background: 'var(--bg2)', borderLeft: '1px solid var(--border)', zIndex: 200, overflowY: 'auto', boxShadow: '-8px 0 30px rgba(0,0,0,0.5)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 1 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--gold)', fontFamily: "'Cormorant Garamond', serif" }}>Product Details</h3>
            <button onClick={() => setSelectedProduct(null)} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 22, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ padding: 20 }}>
            {selectedProduct.image_url && <img src={selectedProduct.image_url} alt="" style={{ width: '100%', maxHeight: 250, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 16, background: '#fff' }} />}
            <h4 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>{selectedProduct.title}</h4>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>{selectedProduct.vendor && <span>{selectedProduct.vendor} · </span>}{selectedProduct.category || 'No category'}</div>
            <DetailSection title="Stock Info">
              <DetailRow label="Current Stock" value={<span style={{ color: getStockColor(selectedProduct.stock_quantity || 0), fontWeight: 700 }}>{selectedProduct.stock_quantity ?? 0} units</span>} />
              <DetailRow label="Min Stock Level" value={selectedProduct.min_stock_level || '—'} />
              <DetailRow label="Reserved" value={selectedProduct.reserved_quantity || 0} />
              <DetailRow label="Available" value={(selectedProduct.stock_quantity || 0) - (selectedProduct.reserved_quantity || 0)} />
            </DetailSection>
            <DetailSection title="Pricing">
              {canViewFinancial && <DetailRow label="Selling Price" value={`Rs ${selectedProduct.selling_price?.toLocaleString()}`} bold />}
              {canViewFinancial && <DetailRow label="Cost Price" value={selectedProduct.cost_price ? `Rs ${selectedProduct.cost_price.toLocaleString()}` : '—'} />}
              {canViewFinancial && selectedProduct.cost_price > 0 && selectedProduct.selling_price > 0 && <DetailRow label="Margin" value={`${((1 - selectedProduct.cost_price / selectedProduct.selling_price) * 100).toFixed(0)}%`} color="var(--green)" />}
              {canViewFinancial && <DetailRow label="Stock Value" value={`Rs ${((selectedProduct.stock_quantity || 0) * (selectedProduct.selling_price || 0)).toLocaleString()}`} />}
            </DetailSection>
            <DetailSection title={`ABC Analytics (${abcWindow})`}>
              {(() => { const cls = selectedProduct[abcCol] || 'D'; const clr = getAbcColor(cls); return (<>
                <DetailRow label="ABC Class" value={<span style={{ padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700, background: clr.bg, color: clr.color, border: `1px solid ${clr.border}` }}>Class {cls}</span>} />
                <DetailRow label={`Revenue (${abcWindow})`} value={selectedProduct[revCol] ? `Rs ${Number(selectedProduct[revCol]).toLocaleString()}` : 'Rs 0'} color={clr.color} />
                <DetailRow label={`Units Sold (${abcWindow})`} value={selectedProduct[soldCol] || 0} />
                <DetailRow label="Last Sold" value={selectedProduct.last_sold_at ? new Date(selectedProduct.last_sold_at).toLocaleDateString() : 'Never'} />
              </>); })()}
            </DetailSection>
            <DetailSection title="Identifiers">
              <DetailRow label="SKU" value={selectedProduct.sku || '—'} />
              <DetailRow label="Barcode" value={selectedProduct.barcode || '—'} />
              <DetailRow label="Shopify ID" value={selectedProduct.shopify_product_id || '—'} />
            </DetailSection>
          </div>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================
function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.pending;
  return <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, background: s.bg, color: s.color, fontWeight: 500, whiteSpace: 'nowrap' }}>{s.label}</span>;
}

function PagBtn({ children, disabled, onClick }) {
  return <button onClick={onClick} disabled={disabled} style={{ padding: '6px 12px', background: disabled ? 'var(--border)' : 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: disabled ? 'var(--text3)' : 'var(--text2)', fontSize: 12, fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer' }}>{children}</button>;
}

function ActionButton({ icon, label, desc, onClick, color }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%', transition: 'border-color 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = color}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
      <span style={{ fontSize: 24 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{desc}</div>
      </div>
    </button>
  );
}

function DetailSection({ title, children }) {
  return (<div style={{ marginBottom: 20 }}><h4 style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 }}>{title}</h4>{children}</div>);
}

function DetailRow({ label, value, bold, color, link }) {
  const val = value || '—';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--text3)' }}>{label}</span>
      {link ? <a href={link} style={{ color: color || 'var(--gold)', fontWeight: bold ? 700 : 400, textDecoration: 'none' }}>{val}</a>
        : <span style={{ color: color || 'var(--text)', fontWeight: bold ? 700 : 400 }}>{val}</span>}
    </div>
  );
}
