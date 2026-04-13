import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { updateShopifyOrderTags, addShopifyOrderNote } from '@/lib/shopify';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { order_id, notes } = await request.json();
    if (!order_id) return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });

    // Get shopify_order_id
    const { data: order } = await supabase.from('orders').select('shopify_order_id').eq('id', order_id).single();

    const { error } = await supabase
      .from('orders')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmation_notes: notes || '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', order_id);

    if (error) throw error;

    // ── Shopify: add order_confirmed tag ──
    if (order?.shopify_order_id) {
      try {
        await updateShopifyOrderTags(order.shopify_order_id, ['order_confirmed'], []);
        if (notes) await addShopifyOrderNote(order.shopify_order_id, `ERP Confirmed: ${notes}`);
      } catch (e) {
        console.error('[confirm] Shopify tag error:', e.message);
      }
    }

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'confirmed',
      notes: notes || '',
      performed_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
