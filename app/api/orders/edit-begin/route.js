// ============================================================================
// RS ZEVAR ERP — Begin Order Edit
// POST /api/orders/edit-begin  { order_id }
// ----------------------------------------------------------------------------
// Creates a Shopify calculatedOrder (draft). Nothing is persisted in Shopify
// until /api/orders/edit-commit is called later. Returns the draft state
// (items, totals, shipping) for the UI to render.
//
// Guards:
//   - order must exist with a shopify_order_id
//   - order status must be in ALLOWED_STATUSES (no editing of dispatched+)
//   - caller role must be in ALLOWED_ROLES
//
// Permission check is best-effort via profile lookup. For stricter auth,
// the UI also gates the button by role.
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { beginOrderEdit } from '@/lib/shopify-order-edit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ALLOWED_STATUSES = new Set(['pending', 'confirmed', 'on_packing', 'packed', 'hold']);
const ALLOWED_ROLES    = new Set(['super_admin', 'admin', 'manager', 'customer_support']);

async function checkRole(email) {
  if (!email) return null;
  const { data } = await supabase.from('profiles').select('role').eq('email', email).single();
  return data?.role || null;
}

export async function POST(request) {
  try {
    const { order_id, performed_by_email } = await request.json();
    if (!order_id) {
      return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });
    }

    // Permission check (best-effort; UI also gates this)
    if (performed_by_email) {
      const role = await checkRole(performed_by_email);
      if (role && !ALLOWED_ROLES.has(role)) {
        return NextResponse.json(
          { success: false, error: `Role '${role}' ko order edit ki permission nahi hai` },
          { status: 403 },
        );
      }
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, status, shopify_order_id, payment_status')
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    if (!order.shopify_order_id) {
      return NextResponse.json(
        { success: false, error: 'Manual order (no Shopify link) — line items edit nahi ho sakta' },
        { status: 400 },
      );
    }

    if (!ALLOWED_STATUSES.has(order.status)) {
      return NextResponse.json(
        { success: false, error: `Status '${order.status}' ke order edit nahi ho sakte. Sirf pending/confirmed/on_packing/packed/hold edit kar sakte ho.` },
        { status: 400 },
      );
    }

    // Refunded orders — safer to block
    if (order.payment_status === 'refunded') {
      return NextResponse.json(
        { success: false, error: 'Refunded order edit nahi ho sakta' },
        { status: 400 },
      );
    }

    // Call Shopify — creates calculatedOrder (draft)
    const calculatedOrder = await beginOrderEdit(order.shopify_order_id);

    return NextResponse.json({
      success: true,
      order_number: order.order_number,
      original_status: order.status,
      original_payment_status: order.payment_status,
      ...calculatedOrder,
    });
  } catch (e) {
    console.error('[edit-begin] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
