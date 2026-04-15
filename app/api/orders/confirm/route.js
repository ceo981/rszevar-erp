import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { updateShopifyOrderTags, addShopifyOrderNote } from '@/lib/shopify';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { order_id, notes, assigned_to, performed_by, performed_by_email } = await request.json();
    if (!order_id) return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });

    const performer = performed_by || 'Staff';
    const performerEmail = performed_by_email || null;

    // Get order info
    const { data: order } = await supabase
      .from('orders')
      .select('shopify_order_id')
      .eq('id', order_id)
      .single();

    // 1. Update order status
    const { error } = await supabase
      .from('orders')
      .update({
        status: assigned_to ? 'on_packing' : 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmation_notes: notes || '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', order_id);

    if (error) throw error;

    // 2. Assign packer (agar selected ho) - same call mein
    let assignedEmpName = null;
    if (assigned_to) {
      const { data: emp } = await supabase
        .from('employees')
        .select('name')
        .eq('id', assigned_to)
        .single();

      assignedEmpName = emp?.name || null;

      await supabase.from('order_assignments').upsert({
        order_id,
        assigned_to,
        stage: 'packing',
        status: 'pending',
        notes: '',
        assigned_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }, { onConflict: 'order_id', ignoreDuplicates: false });

      await supabase.from('order_activity_log').insert({
        order_id,
        action: 'assigned',
        notes: `${assignedEmpName} ko assign kiya gaya`,
        performed_by: performer,
        performed_by_email: performerEmail,
        performed_at: new Date().toISOString(),
      });
    }

    // 3. Shopify tags
    if (order?.shopify_order_id) {
      try {
        const tagsToAdd = ['order_confirmed'];
        if (assignedEmpName) tagsToAdd.push(`packing:${assignedEmpName}`);
        await updateShopifyOrderTags(order.shopify_order_id, tagsToAdd, []);
        if (notes) await addShopifyOrderNote(order.shopify_order_id, `ERP Confirmed by ${performer}: ${notes}`);
      } catch (e) {
        console.error('[confirm] Shopify tag error:', e.message);
      }
    }

    // 4. Activity log
    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'confirmed',
      notes: notes || (assignedEmpName ? `Packer: ${assignedEmpName}` : ''),
      performed_by: performer,
      performed_by_email: performerEmail,
      performed_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, assigned_name: assignedEmpName });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
