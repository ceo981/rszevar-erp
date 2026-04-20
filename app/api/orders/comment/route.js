// ============================================================================
// RS ZEVAR ERP — Staff Comments on Orders
// POST /api/orders/comment  { order_id, comment, staff_name }
// GET  /api/orders/comment?order_id=XXX  → all activity + comments
// ----------------------------------------------------------------------------
// Change (Apr 20 2026): ERP staff comment ab Shopify ke order note field mein
// bhi append hota hai — same pattern jaisa cancel/edit routes use karti hain.
// Format: [ERP Comment by {staff_name}]: {comment}
// Shopify call failure ERP save ko block nahi karegi (graceful degradation).
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { addShopifyOrderNote } from '@/lib/shopify';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { order_id, comment, staff_name, staff_email } = await request.json();
    if (!order_id || !comment?.trim()) {
      return NextResponse.json({ success: false, error: 'order_id aur comment zaroori hai' }, { status: 400 });
    }

    const trimmed = comment.trim();
    const performer = staff_name || staff_email || 'Staff';

    // 1. ERP save — ye pehle kara jaaye, Shopify fail bhi ho to ERP comment save ho
    const { error: dbErr } = await supabase.from('order_activity_log').insert({
      order_id,
      action: 'staff_comment',
      notes: trimmed,
      performed_by: performer,
      performed_by_email: staff_email || null,
      performed_at: new Date().toISOString(),
    });
    if (dbErr) throw dbErr;

    // 2. Shopify sync — best effort, failure ERP ko nahi rokegi
    let shopifyError = null;
    let shopifySynced = false;
    try {
      const { data: order } = await supabase
        .from('orders')
        .select('shopify_order_id')
        .eq('id', order_id)
        .single();

      if (order?.shopify_order_id) {
        await addShopifyOrderNote(
          order.shopify_order_id,
          `[ERP Comment by ${performer}]: ${trimmed}`,
        );
        shopifySynced = true;
      }
    } catch (e) {
      shopifyError = e.message;
      console.error('[comment] Shopify sync error:', e.message);
    }

    return NextResponse.json({
      success: true,
      shopify_synced: shopifySynced,
      warning: shopifyError,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const order_id = searchParams.get('order_id');
  if (!order_id) return NextResponse.json({ log: [] });

  const { data } = await supabase
    .from('order_activity_log')
    .select('*')
    .eq('order_id', order_id)
    .order('performed_at', { ascending: true });

  return NextResponse.json({ log: data || [] });
}
