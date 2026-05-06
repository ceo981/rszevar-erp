// ============================================================================
// RS ZEVAR ERP — Loadsheet Generate Route (May 6 2026)
// POST /api/loadsheets/generate
//   { order_ids: [uuid, uuid, ...], notes?, performed_by?, performed_by_email? }
// ----------------------------------------------------------------------------
// Closes a dispatch scan session by creating a permanent loadsheet record.
// Workflow:
//   1. Dispatcher /orders/dispatch-scan page pe parcels scan karta hai
//   2. Har scan: order ka status `dispatched` ho jata hai (immediate)
//   3. Saari scans complete hone par "Generate Loadsheet" press
//   4. UI saare scanned order_ids ko is route pe POST karta hai
//   5. Ye route 1 loadsheet header + N junction rows insert karta hai
//   6. Loadsheet ID return → UI redirect to print page
//
// IMPORTANT: ye route orders ka status update NAHI karta. Wo scan-dispatch
// route already kar chuka hai. Ye route sirf record-keeping hai.
//
// Snapshot strategy: customer/courier/COD values loadsheet_orders mein freeze
// karte hain. Order baad mein edit ho jaye to bhi loadsheet ka data accurate.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Loadsheet number format: LS-YYYYMMDD-HHMMSS-MS
// Millisecond suffix prevents race conditions in concurrent generates.
function generateLoadsheetNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `LS-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${ms}`;
}

export async function POST(request) {
  const supabase = createServerClient();

  try {
    const body = await request.json();
    const order_ids = Array.isArray(body.order_ids) ? body.order_ids : [];
    const notes = body.notes ? String(body.notes).trim() : null;
    const performed_by = body.performed_by || 'Dispatcher';
    const performed_by_email = body.performed_by_email || null;

    if (order_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Kam az kam 1 order zaroori hai' },
        { status: 400 },
      );
    }

    // ── Fetch orders for snapshot ─────────────────────────────────────────
    const { data: orders, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, status, tracking_number, dispatched_courier, customer_name, customer_city, total_amount, payment_method, payment_status, dispatched_at')
      .in('id', order_ids);

    if (fetchErr) throw fetchErr;

    if (!orders || orders.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Koi order nahi mila — IDs invalid hain' },
        { status: 404 },
      );
    }

    // Verify all requested IDs were found
    const foundIds = new Set(orders.map(o => o.id));
    const missingIds = order_ids.filter(id => !foundIds.has(id));
    if (missingIds.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `${missingIds.length} order(s) nahi mile`,
          missing_ids: missingIds,
        },
        { status: 404 },
      );
    }

    // Preserve scan order — sort orders array by order_ids input order
    const orderById = new Map(orders.map(o => [o.id, o]));
    const orderedOrders = order_ids.map(id => orderById.get(id)).filter(Boolean);

    // ── Build snapshot rows + totals ──────────────────────────────────────
    const nowIso = new Date().toISOString();
    let totalCod = 0;
    const couriersSummary = {};

    const snapshotRows = orderedOrders.map((o, idx) => {
      const codAmount = (o.payment_method === 'COD' && o.payment_status !== 'paid')
        ? Number(o.total_amount || 0)
        : 0;
      totalCod += codAmount;

      const courier = o.dispatched_courier || 'Other';
      if (!couriersSummary[courier]) {
        couriersSummary[courier] = { count: 0, cod: 0 };
      }
      couriersSummary[courier].count += 1;
      couriersSummary[courier].cod += codAmount;

      return {
        // loadsheet_id filled in after parent insert
        order_id: o.id,
        position: idx + 1,
        order_number: o.order_number,
        tracking_number: o.tracking_number || '—',
        courier: o.dispatched_courier || null,
        customer_name: o.customer_name || '',
        customer_city: o.customer_city || '',
        cod_amount: codAmount,
        scanned_at: o.dispatched_at || nowIso,
      };
    });

    // ── Insert loadsheet header ───────────────────────────────────────────
    const loadsheetNumber = generateLoadsheetNumber();
    const { data: loadsheet, error: insErr } = await supabase
      .from('loadsheets')
      .insert({
        loadsheet_number:   loadsheetNumber,
        generated_at:       nowIso,
        generated_by:       performed_by,
        generated_by_email: performed_by_email,
        total_parcels:      orderedOrders.length,
        total_cod:          totalCod,
        couriers_summary:   couriersSummary,
        notes:              notes,
      })
      .select('id, loadsheet_number')
      .single();

    if (insErr) {
      console.error('[loadsheet:generate] header insert failed:', insErr.message);
      throw insErr;
    }

    // ── Insert junction rows ──────────────────────────────────────────────
    const junctionRows = snapshotRows.map(r => ({
      ...r,
      loadsheet_id: loadsheet.id,
    }));

    const { error: junctionErr } = await supabase
      .from('loadsheet_orders')
      .insert(junctionRows);

    if (junctionErr) {
      // Rollback the header (best-effort) so we don't leave orphan loadsheets
      console.error('[loadsheet:generate] junction insert failed:', junctionErr.message);
      await supabase.from('loadsheets').delete().eq('id', loadsheet.id);
      throw junctionErr;
    }

    // ── Activity log entries (one per order) ──────────────────────────────
    const activityRows = orderedOrders.map(o => ({
      order_id: o.id,
      action: 'loadsheet_generated',
      notes: `Loadsheet ${loadsheet.loadsheet_number} mein add hua`,
      performed_by,
      performed_by_email,
      performed_at: nowIso,
    }));

    await supabase.from('order_activity_log').insert(activityRows);
    // Failure here is non-fatal — loadsheet already committed.

    return NextResponse.json({
      success: true,
      loadsheet_id: loadsheet.id,
      loadsheet_number: loadsheet.loadsheet_number,
      total_parcels: orderedOrders.length,
      total_cod: totalCod,
      couriers_summary: couriersSummary,
    });

  } catch (e) {
    console.error('[loadsheet:generate] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
