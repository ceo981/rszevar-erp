import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { cancelShopifyOrder, addShopifyOrderNote } from '@/lib/shopify';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { order_id, reason } = await request.json();
    if (!order_id) return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });

    // Get shopify_order_id
    const { data: order } = await supabase.from('orders').select('shopify_order_id').eq('id', order_id).single();

    await supabase.from('orders').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason || '',
      updated_at: new Date().toISOString(),
    }).eq('id', order_id);

    // ── Shopify: cancel order ──
    let shopifyCancelError = null;
    if (order?.shopify_order_id) {
      try {
        await cancelShopifyOrder(order.shopify_order_id, 'other');
      } catch (e) {
        shopifyCancelError = e.message;
        console.error('[cancel] Shopify cancel error:', e.message);
      }
    }

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'cancelled',
      notes: reason || '',
      performed_at: new Date().toISOString(),
    });

    return NextResponse.json({ 
      success: true,
      warning: shopifyCancelError ? `ERP cancelled but Shopify error: ${shopifyCancelError}` : null
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
