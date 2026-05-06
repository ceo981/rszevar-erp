// ============================================================================
// RS ZEVAR ERP — Scan Dispatch Route (May 6 2026)
// POST /api/orders/scan-dispatch
//   { tracking_number, performed_by?, performed_by_email? }
// ----------------------------------------------------------------------------
// Workflow: dispatcher /orders/dispatch-scan page pe airway bill scan karta
// hai (USB scanner ya phone camera). Ye route us tracking number ko orders
// table mein dhoondta hai aur order ka status `dispatched` mark kar deta hai.
//
// Status guard:
//   - Allowed source statuses: `packed`, `on_packing`
//     (on_packing allowed taa ke agar packer "Mark as Packed" press karna
//      bhool gaya ho to bhi scan kaam kare — handover ke time dispatcher ke
//      hath mein parcel hai = effectively packed)
//   - Already `dispatched` orders: re-scan detect karke 200 + flag return
//     karte hain (UI "already scanned" message dikha sake)
//
// Response shape includes order summary jo UI live list mein add karta hai.
// ============================================================================
//
// EDIT (May 6 2026 PATCH):
//   - Order lookup also matches against shopify_order_name (e.g. "ZEVAR-119098")
//     so dispatcher can scan/type the human order number too — useful when
//     airway bill is missing but order name is on the packing slip.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { canTransition } from '@/lib/order-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Statuses jin se scan-dispatch allowed hai
const ALLOWED_FROM_STATUSES = ['packed', 'on_packing'];

export async function POST(request) {
  const supabase = createServerClient();

  try {
    const body = await request.json();
    const tracking_input = String(body.tracking_number || '').trim();
    const performed_by = body.performed_by || 'Dispatcher';
    const performed_by_email = body.performed_by_email || null;

    if (!tracking_input) {
      return NextResponse.json(
        { success: false, error: 'Tracking number / order number daalein' },
        { status: 400 },
      );
    }

    // ── Lookup order ──────────────────────────────────────────────────────
    // Try multiple matches in priority order:
    //   1. tracking_number exact match (most common — airway bill scan)
    //   2. order_number exact match (e.g. "ZEVAR-119098" typed manually)
    //
    // Both lookups limit to 1 — duplicate tracking_number shouldn't happen
    // but if it does, we take the most recently updated row.
    let order = null;
    let lookupMethod = null;

    {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, tracking_number, dispatched_courier, customer_name, customer_city, total_amount, payment_method, payment_status, shopify_order_id, shopify_fulfillment_id, loadsheet_pending')
        .eq('tracking_number', tracking_input)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        order = data;
        lookupMethod = 'tracking_number';
      }
    }

    if (!order) {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, tracking_number, dispatched_courier, customer_name, customer_city, total_amount, payment_method, payment_status, shopify_order_id, shopify_fulfillment_id, loadsheet_pending')
        .eq('order_number', tracking_input)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        order = data;
        lookupMethod = 'order_number';
      }
    }

    if (!order) {
      return NextResponse.json(
        {
          success: false,
          error: `"${tracking_input}" ke saath koi order nahi mila`,
          not_found: true,
        },
        { status: 404 },
      );
    }

    // ── Re-scan detection ─────────────────────────────────────────────────
    // Order pehle se dispatched / delivered hai. May 6 2026 update:
    //   - Agar order kisi loadsheet mein PEHLE SE hai → error, kuch nahi karte
    //   - Agar nahi hai (dispatched via Shopify auto, etc.) → loadsheet_pending
    //     flag TRUE set kar do taake current session mein dikhe.
    if (order.status === 'dispatched' || order.status === 'delivered') {
      // Check if already in any loadsheet
      const { data: linkedRows } = await supabase
        .from('loadsheet_orders')
        .select('loadsheet_id')
        .eq('order_id', order.id)
        .limit(1);
      const alreadyInLoadsheet = (linkedRows || []).length > 0;

      if (alreadyInLoadsheet) {
        return NextResponse.json({
          success: false,
          already_in_loadsheet: true,
          error: `${order.order_number} pehle hi kisi loadsheet mein hai`,
          order: buildOrderSummary(order),
        }, { status: 200 });
      }

      // Not in any loadsheet — add to current session by setting flag
      if (!order.loadsheet_pending) {
        await supabase
          .from('orders')
          .update({ loadsheet_pending: true, updated_at: new Date().toISOString() })
          .eq('id', order.id);
      }

      return NextResponse.json({
        success: true,
        already_dispatched: true,
        added_to_session: true,
        message: `${order.order_number} pehle se ${order.status} thi — loadsheet session mein add kar di`,
        order: buildOrderSummary({ ...order, loadsheet_pending: true }),
      }, { status: 200 });
    }

    // ── Status guard ──────────────────────────────────────────────────────
    if (!ALLOWED_FROM_STATUSES.includes(order.status)) {
      return NextResponse.json(
        {
          success: false,
          error: `${order.order_number} status '${order.status}' pe hai — pehle pack karein`,
          wrong_status: true,
          order: buildOrderSummary(order),
        },
        { status: 400 },
      );
    }

    // canTransition validation (defense in depth)
    const gate = canTransition(order.status, 'dispatched', 'manual');
    if (!gate.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Transition blocked: ${order.status} → dispatched (${gate.reason})`,
        },
        { status: 400 },
      );
    }

    // ── Tracking missing fallback ─────────────────────────────────────────
    // Agar lookup order_number se hua aur tracking_number column khaali hai,
    // to scanned input ko tracking_number ki tarah save kar do — taake
    // loadsheet pe correct CN# print ho.
    const nowIso = new Date().toISOString();
    const updatePayload = {
      status: 'dispatched',
      dispatched_at: nowIso,
      updated_at: nowIso,
      loadsheet_pending: true,   // May 6 2026 — flag for current scan session
    };
    if (lookupMethod === 'tracking_number' && !order.tracking_number) {
      updatePayload.tracking_number = tracking_input;
    }

    const { error: updErr } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', order.id);

    if (updErr) throw updErr;

    // ── Activity log ──────────────────────────────────────────────────────
    await supabase.from('order_activity_log').insert({
      order_id: order.id,
      action: 'status_changed_to_dispatched',
      notes: `Scan-dispatch (${order.status} → dispatched) via ${lookupMethod}: ${tracking_input}`,
      performed_by,
      performed_by_email,
      performed_at: nowIso,
    });

    // ── Return updated order summary ──────────────────────────────────────
    const updatedOrder = {
      ...order,
      status: 'dispatched',
      tracking_number: updatePayload.tracking_number || order.tracking_number,
      scanned_at: nowIso,
    };

    return NextResponse.json({
      success: true,
      lookup_method: lookupMethod,
      from_status: order.status,
      order: buildOrderSummary(updatedOrder),
    });

  } catch (e) {
    console.error('[scan-dispatch] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}

// ── Helper: shape order data for UI live list ────────────────────────────
function buildOrderSummary(order) {
  return {
    id: order.id,
    order_number: order.order_number,
    tracking_number: order.tracking_number || null,
    courier: order.dispatched_courier || null,
    customer_name: order.customer_name || '',
    customer_city: order.customer_city || '',
    cod_amount: order.payment_method === 'COD' && order.payment_status !== 'paid'
      ? Number(order.total_amount || 0)
      : 0,
    total_amount: Number(order.total_amount || 0),
    payment_status: order.payment_status,
    scanned_at: order.scanned_at || new Date().toISOString(),
  };
}
