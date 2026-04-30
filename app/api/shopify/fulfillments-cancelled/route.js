import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyShopifyWebhook } from '@/lib/shopify-webhook';
import { computeStatusRevertSideEffects, applyStatusRevertSideEffects } from '@/lib/order-status';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const rawBody = await request.text();
    const hmac = request.headers.get('x-shopify-hmac-sha256');
    if (!verifyShopifyWebhook(rawBody, hmac)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const fulfillment = JSON.parse(rawBody);
    const shopifyOrderId = String(fulfillment.order_id);

    // Find order in ERP
    const { data: order } = await supabase
      .from('orders')
      .select('id, status, order_number')
      .eq('shopify_order_id', shopifyOrderId)
      .maybeSingle();

    if (!order) {
      return NextResponse.json({ success: true, message: 'Order not found in ERP' });
    }

    // FIX Apr 2026 — Phase 1 flow refactor.
    // Pehle: sirf 'dispatched' → 'confirmed' revert hota tha. Ab post-fulfillment
    // states (on_packing/packed/dispatched/delivered/rto) sab confirmed pe revert
    // honge, with assignment + packing_log credit cleanup.
    // (Mirror of /api/orders/cancel-fulfillment + /api/shopify/webhooks/fulfillments-cancelled
    // logic — keep all three in sync.)
    const POST_FULFILL_STATUSES = ['on_packing', 'packed', 'dispatched', 'delivered', 'rto'];
    if (!POST_FULFILL_STATUSES.includes(order.status)) {
      // Already pre-fulfillment (confirmed/pending/cancelled etc.) — nothing to revert.
      return NextResponse.json({ success: true, message: `No revert needed (status: ${order.status})` });
    }

    const newStatus = 'confirmed';
    const revert = computeStatusRevertSideEffects(order.status, newStatus);

    await supabase.from('orders').update({
      status: newStatus,
      tracking_number: null,
      dispatched_courier: null,
      dispatched_at: null,
      shopify_fulfillment_id: null,
      shopify_fulfilled_at: null,
      courier_tracking_url: null,
      courier_status_raw: null,
      updated_at: new Date().toISOString(),
    }).eq('id', order.id);

    // Apply auxiliary table reverts (best-effort)
    let revertResult = { revertedFields: [], rowsRemoved: { assignments: 0, packing_log: 0 } };
    if (revert.deleteAssignments || revert.deletePackingLog) {
      try {
        revertResult = await applyStatusRevertSideEffects(supabase, order.id, revert);
      } catch (e) {
        console.error('[shopify/fulfillments-cancelled legacy] auxiliary revert failed:', e.message);
      }
    }

    const auxNotes = [];
    if (revertResult.rowsRemoved.assignments > 0) auxNotes.push('assignment removed');
    if (revertResult.rowsRemoved.packing_log > 0) auxNotes.push(`packing credit removed (${revertResult.rowsRemoved.packing_log} rows)`);

    await supabase.from('order_activity_log').insert({
      order_id: order.id,
      action: 'fulfillment_cancelled',
      notes: [
        `Shopify fulfillment cancelled — status reverted to confirmed`,
        `Status: ${order.status} → ${newStatus}`,
        auxNotes.length > 0 ? `Side-effects: ${auxNotes.join(', ')}` : null,
      ].filter(Boolean).join(' | '),
      performed_by: 'Shopify Webhook (legacy)',
      performed_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Fulfillment cancel webhook error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
