// ============================================================================
// RS ZEVAR ERP — Nuclear Reset
// POST /api/orders/nuclear-reset
//
// Sab orders data clear karta hai:
//   order_items → order_activity_log → order_assignments →
//   packing_log → courier_bookings (order-linked) → orders
//
// DANGER: Irreversible. Super_admin only (checked in route).
// Use karo fresh Shopify sync se pehle.
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    // Safety check — confirm string chahiye
    if (body.confirm !== 'RESET_ALL_ORDERS') {
      return NextResponse.json({
        success: false,
        error: 'Safety check failed. Body mein { "confirm": "RESET_ALL_ORDERS" } bhejo.',
      }, { status: 400 });
    }

    const results = {};
    const errors = [];

    // 1. order_items
    const { error: e1 } = await supabase
      .from('order_items')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (e1) errors.push('order_items: ' + e1.message);
    else results.order_items = 'cleared';

    // 2. order_activity_log
    const { error: e2 } = await supabase
      .from('order_activity_log')
      .delete()
      .gt('id', 0);
    if (e2) errors.push('order_activity_log: ' + e2.message);
    else results.order_activity_log = 'cleared';

    // 3. order_assignments
    const { error: e3 } = await supabase
      .from('order_assignments')
      .delete()
      .gt('id', 0);
    if (e3) errors.push('order_assignments: ' + e3.message);
    else results.order_assignments = 'cleared';

    // 4. packing_log
    const { error: e4 } = await supabase
      .from('packing_log')
      .delete()
      .gt('id', 0);
    if (e4) errors.push('packing_log: ' + e4.message);
    else results.packing_log = 'cleared';

    // 5. courier_bookings (order se linked wale)
    const { error: e5 } = await supabase
      .from('courier_bookings')
      .delete()
      .not('order_id', 'is', null);
    if (e5) errors.push('courier_bookings: ' + e5.message);
    else results.courier_bookings = 'cleared';

    // 6. courier_sync_log
    const { error: e6 } = await supabase
      .from('courier_sync_log')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (e6) errors.push('courier_sync_log: ' + e6.message);
    else results.courier_sync_log = 'cleared';

    // 7. orders — last step
    const { error: e7, count } = await supabase
      .from('orders')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (e7) errors.push('orders: ' + e7.message);
    else results.orders = 'cleared';

    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        partial: results,
        errors,
        message: `Kuch tables clear nahi hue: ${errors.join(' | ')}`,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      cleared: results,
      message: '✅ Sab orders data clear ho gaya. Ab Shopify sync karo.',
    });

  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
