// ============================================================================
// RS ZEVAR ERP — Order Cancel Route  (FIXED Apr 2026)
// ----------------------------------------------------------------------------
// Changes:
//   1. Blocks cancellation of dispatched/delivered/rto/returned/refunded
//      (previously single-route allowed ANY cancel; only bulk had the check)
//   2. Accepts `performed_by` and `performed_by_email` — activity log gets
//      proper audit attribution
//   3. `sync_shopify` flag (default: true, set false for ERP-only cancel)
//      This honours the CEO protocol note: "Cancel flow updates ERP only
//      (not Shopify) — intentional for high-value order safety" when caller
//      passes sync_shopify=false. Default stays current behavior for back-compat.
//   4. Uses canTransition as defence-in-depth
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { canTransition } from '@/lib/order-status';
import { cancelShopifyOrder, addShopifyOrderNote } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Post-dispatch statuses — cancellation here requires RTO/Returned flow, not direct cancel
const NO_CANCEL_FROM = new Set(['dispatched', 'delivered', 'rto', 'returned', 'refunded']);

export async function POST(request) {
  const supabase = createServerClient();
  try {
    const {
      order_id,
      reason,
      performed_by,
      performed_by_email,
      sync_shopify,  // optional — default true
    } = await request.json();

    if (!order_id) {
      return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });
    }

    const performer = performed_by || 'Staff';
    const shouldSyncShopify = sync_shopify !== false; // default: true

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, shopify_order_id, status, order_number')
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Hard block on post-dispatch cancellations — courier already has the parcel
    if (NO_CANCEL_FROM.has(order.status)) {
      return NextResponse.json(
        {
          success: false,
          error: `Order '${order.order_number}' ka status '${order.status}' hai — cancel nahi ho sakta. RTO/Returned flow use karo.`,
        },
        { status: 400 },
      );
    }
    if (order.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'Order pehle se cancelled hai' },
        { status: 400 },
      );
    }

    // Defence-in-depth: central guard
    const gate = canTransition(order.status, 'cancelled', 'manual');
    if (!gate.allowed) {
      return NextResponse.json(
        { success: false, error: `Cancel blocked: ${gate.reason}` },
        { status: 400 },
      );
    }

    const nowIso = new Date().toISOString();

    const { error: updateErr } = await supabase.from('orders').update({
      status: 'cancelled',
      cancelled_at: nowIso,
      cancel_reason: reason || '',
      updated_at: nowIso,
    }).eq('id', order_id);

    if (updateErr) throw updateErr;

    // ── Shopify cancel (optional) ──
    let shopifyCancelError = null;
    let shopifyCancelled = false;
    if (order.shopify_order_id && shouldSyncShopify) {
      try {
        await cancelShopifyOrder(order.shopify_order_id, 'other');
        shopifyCancelled = true;
        if (reason) {
          try {
            await addShopifyOrderNote(
              order.shopify_order_id,
              `ERP Cancelled by ${performer}: ${reason}`,
            );
          } catch (e) { console.error('[cancel] Shopify note:', e.message); }
        }
      } catch (e) {
        shopifyCancelError = e.message;
        console.error('[cancel] Shopify cancel error:', e.message);
      }
    }

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'cancelled',
      notes: [
        reason || 'No reason',
        shopifyCancelled ? '+ Shopify cancelled' : null,
        shopifyCancelError ? `Shopify error: ${shopifyCancelError}` : null,
        !shouldSyncShopify ? '(ERP only — Shopify sync skipped)' : null,
      ].filter(Boolean).join(' | '),
      performed_by: performer,
      performed_by_email: performed_by_email || null,
      performed_at: nowIso,
    });

    return NextResponse.json({
      success: true,
      from_status: order.status,
      shopify_cancelled: shopifyCancelled,
      warning: shopifyCancelError
        ? `ERP cancelled but Shopify cancel failed: ${shopifyCancelError}`
        : null,
    });
  } catch (e) {
    console.error('[cancel] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
