'use client';
import { useState, useEffect, useCallback } from 'react';

// ============================================================================
// RS ZEVAR ERP v2.0 — Live Shopify Connected
// ============================================================================

const MODULES = [
  { id: 'dashboard', label: 'Dashboard', icon: '◫' },
  { id: 'orders', label: 'Orders', icon: '📋' },
  { id: 'inventory', label: 'Inventory', icon: '📦', coming: true },
  { id: 'accounts', label: 'Accounts', icon: '💰', coming: true },
  { id: 'courier', label: 'Courier', icon: '🚚', coming: true },
  { id: 'customers', label: 'Customers', icon: '👥', coming: true },
  { id: 'vendors', label: 'Vendors', icon: '🏭', coming: true },
  { id: 'employees', label: 'Team', icon: '👤', coming: true },
  { id: 'analytics', label: 'Analytics', icon: '📊', coming: true },
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

// ============================================================================
// MAIN APP
// ============================================================================
export default function ERPApp() {
  const [activeModule, setActiveModule] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Sidebar */}
      <aside style={{
        width: sidebarOpen ? 220 : 60,
        background: 'var(--bg2)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease',
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 100,
      }}>
        {/* Logo */}
        <div style={{
          padding: sidebarOpen ? '20px 16px' : '20px 8px',
          borderBottom: '1px solid var(--border)',
          textAlign: 'center',
        }}>
          <div style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: sidebarOpen ? 20 : 14,
            fontWeight: 700,
            color: 'var(--gold)',
            letterSpacing: 3,
          }}>
            {sidebarOpen ? 'RS ZEVAR' : 'RS'}
          </div>
          {sidebarOpen && (
            <div style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: 2, marginTop: 2 }}>
              ERP SYSTEM
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
          {MODULES.map(mod => (
            <button
              key={mod.id}
              onClick={() => !mod.coming && setActiveModule(mod.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: sidebarOpen ? '10px 12px' : '10px 0',
                justifyContent: sidebarOpen ? 'flex-start' : 'center',
                background: activeModule === mod.id ? 'var(--gold-dim)' : 'transparent',
                border: 'none',
                borderRadius: 'var(--radius)',
                color: mod.coming ? 'var(--text3)' : activeModule === mod.id ? 'var(--gold)' : 'var(--text2)',
                fontSize: 13,
                fontFamily: 'inherit',
                cursor: mod.coming ? 'default' : 'pointer',
                transition: 'all 0.15s',
                marginBottom: 2,
                opacity: mod.coming ? 0.5 : 1,
              }}
            >
              <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>{mod.icon}</span>
              {sidebarOpen && <span>{mod.label}</span>}
              {sidebarOpen && mod.coming && (
                <span style={{
                  fontSize: 9,
                  background: 'var(--border)',
                  color: 'var(--text3)',
                  padding: '1px 6px',
                  borderRadius: 4,
                  marginLeft: 'auto',
                }}>Soon</span>
              )}
            </button>
          ))}
        </nav>

        {/* Toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{
            padding: 12,
            background: 'none',
            border: 'none',
            borderTop: '1px solid var(--border)',
            color: 'var(--text3)',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>
      </aside>

      {/* Main Content */}
      <main style={{
        flex: 1,
        marginLeft: sidebarOpen ? 220 : 60,
        transition: 'margin-left 0.2s ease',
      }}>
        {activeModule === 'dashboard' && <DashboardPage onNavigate={setActiveModule} />}
        {activeModule === 'orders' && <OrdersPage />}
      </main>
    </div>
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
      } catch (e) {
        console.error('Dashboard load error:', e);
      }
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
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 28,
          fontWeight: 600,
          color: 'var(--gold)',
          letterSpacing: 1,
        }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>
          RS ZEVAR — Live Shopify Data
          {syncStatus?.last_synced && (
            <span> · Last sync: {new Date(syncStatus.last_synced).toLocaleString()}</span>
          )}
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⟳</div>
          Loading dashboard...
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 28,
          }}>
            {cards.map(card => (
              <div key={card.label} style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: 18,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                      {card.label}
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: card.color }}>
                      {card.value}
                    </div>
                  </div>
                  <span style={{ fontSize: 22 }}>{card.icon}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
            marginBottom: 28,
          }}>
            <ActionButton
              icon="🔄"
              label="Sync Shopify Orders"
              desc="Pull latest orders"
              onClick={() => onNavigate('orders')}
              color="var(--gold)"
            />
            <ActionButton
              icon="📋"
              label="View All Orders"
              desc={`${s.total || 0} total orders`}
              onClick={() => onNavigate('orders')}
              color="var(--blue)"
            />
            <ActionButton
              icon="⏳"
              label="Pending Orders"
              desc={`${s.pending || 0} need confirmation`}
              onClick={() => onNavigate('orders')}
              color="var(--orange)"
            />
          </div>

          {/* Recent Orders */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: 20,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Recent Orders</h3>
              <button
                onClick={() => onNavigate('orders')}
                style={{
                  background: 'none', border: 'none', color: 'var(--gold)',
                  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >View All →</button>
            </div>
            {(stats?.orders || []).length === 0 ? (
              <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>
                No orders yet. Sync from Shopify to get started!
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Order', 'Customer', 'City', 'Amount', 'Status', 'Date'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--text3)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.orders.map(order => (
                      <tr key={order.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px', color: 'var(--gold)', fontWeight: 600 }}>{order.order_number}</td>
                        <td style={{ padding: '10px' }}>{order.customer_name}</td>
                        <td style={{ padding: '10px', color: 'var(--text2)' }}>{order.customer_city || '—'}</td>
                        <td style={{ padding: '10px', fontWeight: 600 }}>Rs {order.total_amount?.toLocaleString()}</td>
                        <td style={{ padding: '10px' }}>
                          <StatusBadge status={order.status} />
                        </td>
                        <td style={{ padding: '10px', color: 'var(--text3)', fontSize: 12 }}>
                          {new Date(order.created_at).toLocaleDateString()}
                        </td>
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
// ORDERS PAGE
// ============================================================================
function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ status: 'all', search: '', courier: 'all' });
  const [selectedOrder, setSelectedOrder] = useState(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '30',
      });
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      if (filters.courier !== 'all') params.set('courier', filters.courier);

      const res = await fetch(`/api/orders?${params}`);
      const data = await res.json();

      if (data.success) {
        setOrders(data.orders || []);
        setTotal(data.total || 0);
        setTotalPages(data.total_pages || 1);
        setStats(data.stats || {});
      }
    } catch (e) {
      console.error('Fetch orders error:', e);
    }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/shopify/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }),
      });
      const data = await res.json();
      setSyncResult(data);
      if (data.success) {
        await fetchOrders();
      }
    } catch (e) {
      setSyncResult({ success: false, error: e.message });
    }
    setSyncing(false);
  };

  const statusFilters = [
    { value: 'all', label: 'All', count: stats.total },
    { value: 'pending', label: 'Pending', count: stats.pending },
    { value: 'confirmed', label: 'Confirmed', count: stats.confirmed },
    { value: 'dispatched', label: 'Dispatched', count: stats.dispatched },
    { value: 'delivered', label: 'Delivered', count: stats.delivered },
    { value: 'returned', label: 'Returned', count: stats.returned },
    { value: 'cancelled', label: 'Cancelled', count: stats.cancelled },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 28,
            fontWeight: 600,
            color: 'var(--gold)',
            letterSpacing: 1,
          }}>Orders</h1>
          <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>
            {total} orders · Live from Shopify
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            background: syncing ? 'var(--border)' : 'var(--gold)',
            color: syncing ? 'var(--text3)' : '#080808',
            border: 'none',
            borderRadius: 'var(--radius)',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: syncing ? 'wait' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <span style={{ display: 'inline-block', animation: syncing ? 'spin 1s linear infinite' : 'none' }}>🔄</span>
          {syncing ? 'Syncing Shopify...' : 'Sync from Shopify'}
        </button>
      </div>

      {/* Sync Result Alert */}
      {syncResult && (
        <div style={{
          padding: '12px 16px',
          marginBottom: 16,
          borderRadius: 'var(--radius)',
          background: syncResult.success ? 'var(--green-dim)' : 'var(--red-dim)',
          border: `1px solid ${syncResult.success ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ color: syncResult.success ? 'var(--green)' : 'var(--red)' }}>
            {syncResult.success
              ? `✅ ${syncResult.message} (${syncResult.total_fetched} fetched, ${syncResult.synced} synced)`
              : `❌ Sync failed: ${syncResult.error}`
            }
          </span>
          <button onClick={() => setSyncResult(null)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* Status Filter Tabs */}
      <div style={{
        display: 'flex',
        gap: 4,
        marginBottom: 16,
        overflowX: 'auto',
        paddingBottom: 4,
      }}>
        {statusFilters.map(sf => (
          <button
            key={sf.value}
            onClick={() => { setFilters(f => ({ ...f, status: sf.value })); setPage(1); }}
            style={{
              padding: '7px 14px',
              background: filters.status === sf.value ? 'var(--gold-dim)' : 'transparent',
              border: `1px solid ${filters.status === sf.value ? 'var(--gold)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              color: filters.status === sf.value ? 'var(--gold)' : 'var(--text2)',
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
          >
            {sf.label}
            {sf.count !== undefined && (
              <span style={{
                marginLeft: 6,
                fontSize: 10,
                opacity: 0.7,
              }}>({sf.count || 0})</span>
            )}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search by order #, customer, phone, city, tracking..."
          value={filters.search}
          onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }}
          style={{
            width: '100%',
            maxWidth: 500,
            padding: '10px 14px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--text)',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
      </div>

      {/* Orders Table */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
            <div style={{ fontSize: 24, marginBottom: 8, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</div>
            <div>Loading orders...</div>
          </div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 15, marginBottom: 8 }}>No orders found</div>
            <div style={{ fontSize: 13 }}>
              {filters.search || filters.status !== 'all'
                ? 'Try different filters'
                : 'Click "Sync from Shopify" to pull your orders'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Order #', 'Customer', 'Phone', 'City', 'Items', 'Amount', 'Payment', 'Status', 'Courier', 'Date'].map(h => (
                    <th key={h} style={{
                      padding: '12px 10px',
                      textAlign: 'left',
                      color: 'var(--text3)',
                      fontWeight: 500,
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      whiteSpace: 'nowrap',
                      background: 'var(--bg2)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map(order => (
                  <tr
                    key={order.id}
                    onClick={() => setSelectedOrder(selectedOrder?.id === order.id ? null : order)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      background: selectedOrder?.id === order.id ? 'var(--gold-dim)' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (selectedOrder?.id !== order.id) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={e => { if (selectedOrder?.id !== order.id) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '12px 10px', color: 'var(--gold)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {order.order_number}
                    </td>
                    <td style={{ padding: '12px 10px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {order.customer_name || '—'}
                    </td>
                    <td style={{ padding: '12px 10px', color: 'var(--text2)', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {order.customer_phone || '—'}
                    </td>
                    <td style={{ padding: '12px 10px', color: 'var(--text2)' }}>
                      {order.customer_city || '—'}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                      {order.order_items?.length || 0}
                    </td>
                    <td style={{ padding: '12px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      Rs {order.total_amount?.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 10px' }}>
                      <span style={{
                        fontSize: 10,
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: order.payment_method === 'COD' ? 'var(--orange-dim)' : 'var(--green-dim)',
                        color: order.payment_method === 'COD' ? 'var(--orange)' : 'var(--green)',
                      }}>
                        {order.payment_method || 'COD'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 10px' }}>
                      <StatusBadge status={order.status} />
                    </td>
                    <td style={{ padding: '12px 10px', color: 'var(--text2)', fontSize: 12 }}>
                      {order.courier || '—'}
                    </td>
                    <td style={{ padding: '12px 10px', color: 'var(--text3)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(order.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text3)',
          }}>
            <span>Page {page} of {totalPages} · {total} orders</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <PagBtn disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</PagBtn>
              <PagBtn disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</PagBtn>
            </div>
          </div>
        )}
      </div>

      {/* Order Detail Panel */}
      {selectedOrder && <OrderDetailPanel order={selectedOrder} onClose={() => setSelectedOrder(null)} />}

      {/* Spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ============================================================================
// ORDER DETAIL PANEL
// ============================================================================
function OrderDetailPanel({ order, onClose }) {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      width: 420,
      background: 'var(--bg2)',
      borderLeft: '1px solid var(--border)',
      zIndex: 200,
      overflowY: 'auto',
      boxShadow: '-8px 0 30px rgba(0,0,0,0.5)',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        background: 'var(--bg2)',
        zIndex: 1,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--gold)', fontFamily: "'Cormorant Garamond', serif" }}>
            {order.order_number}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {new Date(order.created_at).toLocaleString()}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'var(--text3)',
          fontSize: 22, cursor: 'pointer', padding: 4,
        }}>×</button>
      </div>

      <div style={{ padding: 20 }}>
        {/* Status */}
        <div style={{ marginBottom: 20, display: 'flex', gap: 8, alignItems: 'center' }}>
          <StatusBadge status={order.status} />
          <span style={{
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 4,
            background: order.payment_method === 'COD' ? 'var(--orange-dim)' : 'var(--green-dim)',
            color: order.payment_method === 'COD' ? 'var(--orange)' : 'var(--green)',
          }}>
            {order.payment_method || 'COD'}
          </span>
        </div>

        {/* Customer */}
        <DetailSection title="Customer">
          <DetailRow label="Name" value={order.customer_name} />
          <DetailRow label="Phone" value={order.customer_phone} link={order.customer_phone ? `tel:${order.customer_phone}` : null} />
          <DetailRow label="City" value={order.customer_city} />
          <DetailRow label="Address" value={order.customer_address} />
        </DetailSection>

        {/* Items */}
        <DetailSection title="Items">
          {(order.order_items || []).length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 12 }}>No items data</div>
          ) : (
            order.order_items.map((item, i) => (
              <div key={i} style={{
                padding: '8px 0',
                borderBottom: i < order.order_items.length - 1 ? '1px solid var(--border)' : 'none',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 13,
              }}>
                <div>
                  <div>{item.title}</div>
                  {item.sku && <div style={{ fontSize: 11, color: 'var(--text3)' }}>SKU: {item.sku}</div>}
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 600 }}>Rs {item.total_price?.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>×{item.quantity}</div>
                </div>
              </div>
            ))
          )}
        </DetailSection>

        {/* Amounts */}
        <DetailSection title="Amounts">
          <DetailRow label="Subtotal" value={`Rs ${order.subtotal?.toLocaleString()}`} />
          {order.discount > 0 && <DetailRow label="Discount" value={`-Rs ${order.discount?.toLocaleString()}`} color="var(--red)" />}
          <DetailRow label="Shipping" value={`Rs ${order.shipping_fee?.toLocaleString()}`} />
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
            <DetailRow label="Total" value={`Rs ${order.total_amount?.toLocaleString()}`} bold />
          </div>
        </DetailSection>

        {/* Courier */}
        {(order.courier || order.tracking_number) && (
          <DetailSection title="Courier">
            <DetailRow label="Courier" value={order.courier} />
            <DetailRow label="Tracking #" value={order.tracking_number} />
            <DetailRow label="Courier Status" value={order.courier_status} />
          </DetailSection>
        )}

        {/* Shopify */}
        <DetailSection title="Shopify">
          <DetailRow label="Shopify ID" value={order.shopify_order_id} />
          <DetailRow label="Last Synced" value={order.shopify_synced_at ? new Date(order.shopify_synced_at).toLocaleString() : '—'} />
        </DetailSection>
      </div>
    </div>
  );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================
function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.pending;
  return (
    <span style={{
      fontSize: 11,
      padding: '3px 10px',
      borderRadius: 4,
      background: s.bg,
      color: s.color,
      fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

function PagBtn({ children, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 12px',
        background: disabled ? 'var(--border)' : 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        color: disabled ? 'var(--text3)' : 'var(--text2)',
        fontSize: 12,
        fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >{children}</button>
  );
}

function ActionButton({ icon, label, desc, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        width: '100%',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = color}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <span style={{ fontSize: 24 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{desc}</div>
      </div>
    </button>
  );
}

function DetailSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text3)',
        textTransform: 'uppercase',
        letterSpacing: 1.5,
        marginBottom: 10,
      }}>{title}</h4>
      {children}
    </div>
  );
}

function DetailRow({ label, value, bold, color, link }) {
  const val = value || '—';
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '4px 0',
      fontSize: 13,
    }}>
      <span style={{ color: 'var(--text3)' }}>{label}</span>
      {link ? (
        <a href={link} style={{ color: color || 'var(--gold)', fontWeight: bold ? 700 : 400, textDecoration: 'none' }}>{val}</a>
      ) : (
        <span style={{ color: color || 'var(--text)', fontWeight: bold ? 700 : 400 }}>{val}</span>
      )}
    </div>
  );
}
