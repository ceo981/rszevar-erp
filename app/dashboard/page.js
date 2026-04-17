'use client';

// ============================================================================
// RS ZEVAR ERP — Dashboard Page
// Route: /dashboard
// ============================================================================

import { useState, useEffect } from 'react';
import Link from 'next/link';

const STATUS_MAP = {
  pending:    { label: 'Pending',    color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  confirmed:  { label: 'Confirmed',  color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  processing: { label: 'Processing', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  dispatched: { label: 'Dispatched', color: '#22d3ee', bg: 'rgba(34,211,238,0.12)' },
  delivered:  { label: 'Delivered',  color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  returned:   { label: 'Returned',   color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  cancelled:  { label: 'Cancelled',  color: '#8a8580', bg: 'rgba(138,133,128,0.12)' },
};

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.pending;
  return <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, background: s.bg, color: s.color, fontWeight: 500, whiteSpace: 'nowrap' }}>{s.label}</span>;
}

function ActionButton({ icon, label, desc, href, color }) {
  return (
    <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%', textDecoration: 'none', transition: 'border-color 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = color}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
      <span style={{ fontSize: 24 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{desc}</div>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
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
    <div style={{ padding: '24px 20px' }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
            {cards.map(card => (
              <div key={card.label} style={{
                background: 'linear-gradient(135deg, var(--bg-card) 0%, #0f1e38 100%)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: '16px 18px',
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${card.color}44, ${card.color}22)` }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{card.label}</div>
                    <div style={{ fontSize: 26, fontWeight: 700, color: card.color }}>{card.value}</div>
                  </div>
                  <span style={{ fontSize: 20, opacity: 0.7 }}>{card.icon}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 28 }}>
            <ActionButton icon="🔄" label="Sync Shopify Orders" desc="Pull latest orders" href="/orders" color="var(--gold)" />
            <ActionButton icon="📋" label="View All Orders" desc={`${s.total || 0} total orders`} href="/orders" color="var(--blue)" />
            <ActionButton icon="⏳" label="Pending Orders" desc={`${s.pending || 0} need confirmation`} href="/orders" color="var(--orange)" />
          </div>
          <div style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, #0f1e38 100%)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Recent Orders</h3>
              <Link href="/orders" style={{ background: 'none', border: 'none', color: 'var(--gold)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' }}>View All →</Link>
            </div>
            {(stats?.orders || []).length === 0 ? (
              <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>No orders yet. Sync from Shopify to get started!</p>
            ) : (
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 480 }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>{['Order', 'Customer', 'City', 'Amount', 'Status', 'Date'].map(h => (<th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--sapphire)', fontWeight: 500, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>{h}</th>))}</tr></thead>
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
