import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeStatusRevertSideEffects, applyStatusRevertSideEffects } from '@/lib/order-status';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function clearFulfillment(shopifyOrderId) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, order_number')
    .eq('shopify_order_id', String(shopifyOrderId))
    .maybeSingle();

  if (!order) return { found: false };

  // FIX Apr 2026 — Phase 1 flow refactor.
  // Pehle: sirf 'dispatched' → 'confirmed' revert hota tha.
  // Ab: Saare post-fulfillment states (on_packing/packed/dispatched/delivered/rto)
  //     → confirmed pe revert + assignment + packing_log credit bhi clear.
  // (Mirror of /api/orders/cancel-fulfillment route logic — keep both in sync.)
  const POST_FULFILL_STATUSES = ['on_packing', 'packed', 'dispatched', 'delivered', 'rto'];
  const newStatus = POST_FULFILL_STATUSES.includes(order.status) ? 'confirmed' : order.status;

  // Compute auxiliary reverts using shared helper
  const revert = computeStatusRevertSideEffects(order.status, newStatus);

  // Clear tracking + revert status
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
      console.error('[fulfillments-cancelled webhook] auxiliary revert failed:', e.message);
    }
  }

  const auxNotes = [];
  if (revertResult.rowsRemoved.assignments > 0) auxNotes.push('assignment removed');
  if (revertResult.rowsRemoved.packing_log > 0) auxNotes.push(`packing credit removed (${revertResult.rowsRemoved.packing_log} rows)`);

  await supabase.from('order_activity_log').insert({
    order_id: order.id,
    action: 'fulfillment_cancelled',
    notes: [
      'Shopify fulfillment cancel — tracking, courier, dispatch status clear',
      `Status: ${order.status} → ${newStatus}`,
      auxNotes.length > 0 ? `Side-effects: ${auxNotes.join(', ')}` : null,
    ].filter(Boolean).join(' | '),
    performed_by: 'Shopify Webhook',
    performed_at: new Date().toISOString(),
  });

  return { found: true, order_number: order.order_number };
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    const data = JSON.parse(rawBody);

    // Handle both fulfillments/cancelled and fulfillment_orders/cancelled
    const shopifyOrderId = data.order_id || data.fulfillment?.order_id;

    if (!shopifyOrderId) {
      return NextResponse.json({ success: false, error: 'No order_id found' });
    }

    const result = await clearFulfillment(shopifyOrderId);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error('Fulfillment cancel webhook error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
