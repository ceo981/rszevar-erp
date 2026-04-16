import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { updateShopifyOrderTags, addShopifyOrderNote } from '@/lib/shopify';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { order_id, notes, performed_by, performed_by_email } = await request.json();
    if (!order_id) return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });

    const performer = performed_by || 'Staff';

    // Get order info
    const { data: order } = await supabase
      .from('orders')
      .select('shopify_order_id, status')
      .eq('id', order_id)
      .single();

    if (!order) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });

    // Only confirm if pending/processing
    const confirmable = ['pending', 'processing', 'attempted', 'hold'];
    if (!confirmable.includes(order.status)) {
      return NextResponse.json({ success: false, error: `Order status '${order.status}' confirm nahi ho sakta` }, { status: 400 });
    }

    // Update order status to confirmed — simple, no assignment
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

    // Shopify: add order_confirmed tag + note
    if (order.shopify_order_id) {
      try {
        await updateShopifyOrderTags(order.shopify_order_id, ['order_confirmed'], []);
        if (notes) await addShopifyOrderNote(order.shopify_order_id, `ERP Confirmed by ${performer}: ${notes}`);
      } catch (e) {
        console.error('[confirm] Shopify tag error:', e.message);
      }
    }

    // Activity log
    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'confirmed',
      notes: notes || '',
      performed_by: performer,
      performed_by_email: performed_by_email || null,
      performed_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
