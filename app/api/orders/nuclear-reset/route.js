// ============================================================================
// RS ZEVAR ERP — Nuclear Reset (v2 — includes whatsapp_logs + resilient)
// POST /api/orders/nuclear-reset
//
// Clears all orders data:
//   whatsapp_logs → order_items → order_activity_log → order_assignments →
//   packing_log → courier_bookings (order-linked) → courier_sync_log → orders
//
// DANGER: Irreversible.
// Body: { "confirm": "RESET_ALL_ORDERS" }
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Helper: safely truncate a table, log result
async function clearTable(name, filterType = 'gt_zero') {
  try {
    let query = supabase.from(name).delete();
    if (filterType === 'gt_zero') {
      query = query.gt('id', 0);
    } else if (filterType === 'not_null_uuid') {
      query = query.neq('id', '00000000-0000-0000-0000-000000000000');
    } else if (filterType === 'order_id_not_null') {
      query = query.not('order_id', 'is', null);
    }
    const { error } = await query;
    if (error) return { name, status: 'error', message: error.message };
    return { name, status: 'cleared' };
  } catch (e) {
    return { name, status: 'error', message: e.message };
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    if (body.confirm !== 'RESET_ALL_ORDERS') {
      return NextResponse.json({
        success: false,
        error: 'Safety check failed. Body mein { "confirm": "RESET_ALL_ORDERS" } bhejo.',
      }, { status: 400 });
    }

    // Delete in FK-safe order — child tables first, parent last
    const steps = [];

    // 1. whatsapp_logs (has FK to orders.id) — MUST come before orders
    steps.push(await clearTable('whatsapp_logs', 'gt_zero'));

    // 2. order_items
    steps.push(await clearTable('order_items', 'not_null_uuid'));

    // 3. order_activity_log
    steps.push(await clearTable('order_activity_log', 'gt_zero'));

    // 4. order_assignments
    steps.push(await clearTable('order_assignments', 'gt_zero'));

    // 5. packing_log
    steps.push(await clearTable('packing_log', 'gt_zero'));

    // 6. courier_bookings (only order-linked)
    steps.push(await clearTable('courier_bookings', 'order_id_not_null'));

    // 7. courier_sync_log (history log, safe to clear)
    steps.push(await clearTable('courier_sync_log', 'not_null_uuid'));

    // 8. FINAL: orders
    steps.push(await clearTable('orders', 'not_null_uuid'));

    const errors = steps.filter(s => s.status === 'error');
    const cleared = steps.filter(s => s.status === 'cleared').map(s => s.name);

    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        cleared,
        errors,
        message: `Kuch tables clear nahi hue — neeche error list dekho`,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      cleared,
      message: '✅ Sab orders data clear ho gaya. Ab sync-unfulfilled chalao.',
    });

  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
