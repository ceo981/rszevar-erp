// ============================================================================
// RS ZEVAR ERP — Order Confirm Route  (FIXED Apr 2026)
// ----------------------------------------------------------------------------
// Changes:
//   1. Uses canTransition() guard instead of hardcoded confirmable list — keeps
//      rules in one place (lib/order-status.js)
//   2. Preserves existing confirmed_at on re-confirmation (doesn't stomp history)
//   3. Added performer attribution to any Shopify note for audit trail
//   4. Returns from_status in response for UI optimism
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { canTransition } from '@/lib/order-status';
import { updateShopifyOrderTags, addShopifyOrderNote } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const supabase = createServerClient();
  try {
    const { order_id, notes, performed_by, performed_by_email } = await request.json();
    if (!order_id) {
      return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });
    }

    const performer = performed_by || 'Staff';

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, shopify_order_id, status, confirmed_at')
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Central transition guard — allows pending/processing/attempted/hold → confirmed,
    // blocks illegal jumps like delivered → confirmed
    const gate = canTransition(order.status, 'confirmed', 'manual');
    if (!gate.allowed) {
      return NextResponse.json(
        { success: false, error: `Confirm nahi ho sakta: '${order.status}' se (${gate.reason})` },
        { status: 400 },
      );
    }

    const nowIso = new Date().toISOString();
    const patch = {
      status: 'confirmed',
      confirmation_notes: notes || '',
      updated_at: nowIso,
    };
    // Preserve confirmed_at if already set (re-confirmation after hold/attempted)
    if (!order.confirmed_at) patch.confirmed_at = nowIso;

    const { error: updateErr } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', order_id);

    if (updateErr) throw updateErr;

    // Shopify sync — best-effort, never blocks
    if (order.shopify_order_id) {
      try {
        await updateShopifyOrderTags(order.shopify_order_id, ['order_confirmed'], []);
        if (notes) {
          await addShopifyOrderNote(order.shopify_order_id, `ERP Confirmed by ${performer}: ${notes}`);
        }
      } catch (e) {
        console.error('[confirm] Shopify tag/note error:', e.message);
      }
    }

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'confirmed',
      notes: notes || '',
      performed_by: performer,
      performed_by_email: performed_by_email || null,
      performed_at: nowIso,
    });

    return NextResponse.json({ success: true, from_status: order.status });
  } catch (e) {
    console.error('[confirm] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
