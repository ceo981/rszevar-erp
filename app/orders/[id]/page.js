'use client';

// ============================================================================
// RS ZEVAR ERP — Single Order Page
// Route:  /orders/[id]
// Usage:  Opened from orders list via Ctrl+click / middle-click / ↗ button.
//         Renders the OrderDrawer in full-page mode — same functionality,
//         different layout. All Drawer actions (confirm/dispatch/cancel/edit/
//         assign/comment/status) work identically because the underlying
//         component is the exact same one used in the list-page drawer.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/context/UserContext';
import OrderDrawer, { gold, border } from '../_components/OrderDrawer';

export default function SingleOrderPage() {
  const params = useParams();
  const router = useRouter();
  const { profile, userEmail } = useUser();
  const performer = profile?.full_name || profile?.email || 'Staff';

  const id = params?.id;
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadOrder = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/orders/${id}`);
      const d = await r.json();
      if (d.success) {
        setOrder(d.order);
      } else {
        setError(d.error || 'Order load failed');
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { loadOrder(); }, [loadOrder]);

  // ── Tab title ──
  useEffect(() => {
    if (order?.order_number) {
      document.title = `${order.order_number} — RS ZEVAR ERP`;
    } else if (loading) {
      document.title = 'Loading… — RS ZEVAR ERP';
    }
  }, [order, loading]);

  // ── Loading / error / not-found states ──
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 14 }}>
        ⟳ Loading order…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
        <div style={{ color: '#ef4444', fontSize: 14 }}>✗ {error}</div>
        <a href="/orders" style={{ background: gold, color: '#000', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          ← Back to Orders
        </a>
      </div>
    );
  }

  if (!order) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
        <div style={{ color: '#555', fontSize: 14 }}>Order not found</div>
        <a href="/orders" style={{ background: gold, color: '#000', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          ← Back to Orders
        </a>
      </div>
    );
  }

  return (
    <OrderDrawer
      order={order}
      onClose={() => router.push('/orders')}
      onRefresh={loadOrder}
      performer={performer}
      variant="page"
    />
  );
}
