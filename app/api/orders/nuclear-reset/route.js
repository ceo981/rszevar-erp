// ============================================================================
// RS ZEVAR ERP — Nuclear Reset (v3 — all FK tables + UUID-safe)
// POST /api/orders/nuclear-reset
//
// Clears ALL tables that reference orders.id:
//   whatsapp_logs, order_items, order_timeline, shipments,
//   cod_reconciliation, order_activity_log, order_assignments,
//   packing_log, courier_bookings (order-linked), courier_sync_log,
//   orders (last)
//
// Filter: `.not('id', 'is', null)` — works for both UUID and integer PKs
//
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

// Type-agnostic clear — works for UUID or integer PKs.
// `.not('id', 'is', null)` = WHERE id IS NOT NULL = always true for PK.
async function clearAll(name) {
  try {
    const { error } = await supabase.from(name).delete().not('id', 'is', null);
    if (error) {
      // Table might not exist — silently skip that case
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        return { name, status: 'skipped', message: 'table does not exist' };
      }
      return { name, status: 'error', message: error.message };
    }
    return { name, status: 'cleared' };
  } catch (e) {
    return { name, status: 'error', message: e.message };
  }
}

// Clear only rows where order_id is set (for tables like courier_bookings
// that can have non-order entries too)
async function clearOrderLinked(name) {
  try {
    const { error } = await supabase.from(name).delete().not('order_id', 'is', null);
    if (error) {
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        return { name, status: 'skipped', message: 'table does not exist' };
      }
      return { name, status: 'error', message: error.message };
    }
    return { name, status: 'cleared (order-linked only)' };
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

    // ── All tables that reference orders.id (from FK query) ──
    steps.push(await clearAll('whatsapp_logs'));
    steps.push(await clearAll('order_items'));
    steps.push(await clearAll('order_timeline'));
    steps.push(await clearAll('shipments'));
    steps.push(await clearAll('cod_reconciliation'));
    steps.push(await clearAll('order_activity_log'));
    steps.push(await clearAll('order_assignments'));
    steps.push(await clearAll('packing_log'));

    // ── Courier bookings: only rows with order_id set ──
    // (standalone bookings from /courier page have order_id = null, preserve them)
    steps.push(await clearOrderLinked('courier_bookings'));

    // ── History log (safe to nuke entirely) ──
    steps.push(await clearAll('courier_sync_log'));

    // ── FINAL: orders table ──
    steps.push(await clearAll('orders'));

    const errors = steps.filter(s => s.status === 'error');
    const cleared = steps.filter(s => s.status === 'cleared' || s.status === 'cleared (order-linked only)').map(s => s.name);
    const skipped = steps.filter(s => s.status === 'skipped').map(s => s.name);

    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        cleared,
        skipped,
        errors,
        message: `Kuch tables clear nahi hue — error list dekho`,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      cleared,
      skipped,
      total_cleared: cleared.length,
      message: '✅ Sab orders data clear ho gaya. Ab sync-unfulfilled chalao.',
    });

  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
