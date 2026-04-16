import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { updateShopifyOrderTags } from '@/lib/shopify';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const order_id = searchParams.get('order_id');

    if (order_id) {
      // Get assignment for specific order
      const { data, error } = await supabase
        .from('order_assignments')
        .select('*, employee:assigned_to(id, name, role)')
        .eq('order_id', order_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      return NextResponse.json({ success: true, assignment: data || null });
    }

    // Get all packing staff for dropdown — DB se live, hardcoded nahi
    const { data: employees } = await supabase
      .from('employees')
      .select('id, name, role, designation')
      .eq('status', 'active')
      .in('role', ['Packing Team', 'Operations Manager', 'Dispatcher', 'Other'])
      .order('role')
      .order('name');

    return NextResponse.json({ success: true, employees: employees || [] });

  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { order_id, assigned_to, assigned_by, notes, action, performed_by, performed_by_email } = await request.json();
    const performer = performed_by || 'Staff';
    const performerEmail = performed_by_email || null;

    // ── Unassign packer ──
    if (action === 'unassign') {
      // Delete assignment from order_assignments
      await supabase
        .from('order_assignments')
        .delete()
        .eq('order_id', order_id);

      // Remove packing:* tag from orders.tags JSONB
      const { data: ord } = await supabase
        .from('orders')
        .select('id, status, tags, shopify_order_id')
        .eq('id', order_id)
        .single();

      if (ord) {
        // Remove packing:* tags from JSONB array
        const cleanedTags = Array.isArray(ord.tags)
          ? ord.tags.filter(t => !String(t).toLowerCase().startsWith('packing:'))
          : [];

        const updatePayload = {
          tags: cleanedTags,
          updated_at: new Date().toISOString(),
        };

        // If status was on_packing, revert to confirmed
        if (ord.status === 'on_packing') {
          updatePayload.status = 'confirmed';
        }

        await supabase.from('orders').update(updatePayload).eq('id', order_id);

        // Remove packing tag from Shopify too (best effort)
        if (ord.shopify_order_id) {
          try {
            const { updateShopifyOrderTags } = await import('@/lib/shopify');
            const packingTagsToRemove = Array.isArray(ord.tags)
              ? ord.tags.filter(t => String(t).toLowerCase().startsWith('packing:'))
              : [];
            if (packingTagsToRemove.length > 0) {
              await updateShopifyOrderTags(ord.shopify_order_id, [], packingTagsToRemove);
            }
          } catch (e) {
            console.error('[unassign] Shopify tag remove error:', e.message);
          }
        }
      }

      await supabase.from('order_activity_log').insert({
        order_id,
        action: 'unassigned',
        notes: 'Packer assignment hata di — status confirmed par wapas',
        performed_by: performer,
        performed_by_email: performerEmail,
        performed_at: new Date().toISOString(),
      });

      return NextResponse.json({ success: true });
    }

    // ── Mark as Packed ──
    if (action === 'packed') {
      const { data: assignment } = await supabase
        .from('order_assignments')
        .select('id, assigned_to')
        .eq('order_id', order_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Get actual item count from order_items table
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('quantity')
        .eq('order_id', order_id);

      // Fallback: shopify_raw se bhi try karo agar order_items empty ho
      let itemCount = (orderItems || []).reduce((s, i) => s + (parseInt(i.quantity) || 1), 0);
      if (itemCount === 0) {
        const { data: orderRaw } = await supabase
          .from('orders')
          .select('shopify_raw')
          .eq('id', order_id)
          .single();
        const lineItems = orderRaw?.shopify_raw?.line_items || [];
        itemCount = lineItems.reduce((s, i) => s + (parseInt(i.quantity) || 1), 0);
      }
      if (itemCount === 0) itemCount = 1; // minimum 1

      // Update assignment status
      if (assignment) {
        await supabase
          .from('order_assignments')
          .update({ status: 'packed', completed_at: new Date().toISOString() })
          .eq('id', assignment.id);

        // Add packing log entry
        await supabase.from('packing_log').insert({
          order_id,
          employee_id: assignment.assigned_to,
          items_packed: itemCount || 1,
          completed_at: new Date().toISOString(),
          notes: notes || '',
        });
      }

      // Update order status to packed
      await supabase
        .from('orders')
        .update({ status: 'packed', updated_at: new Date().toISOString() })
        .eq('id', order_id);

      await supabase.from('order_activity_log').insert({
        order_id,
        action: 'packed',
        notes: `Packed — ${itemCount} item(s)`,
        performed_by: performer,
        performed_by_email: performerEmail,
        performed_at: new Date().toISOString(),
      });

      return NextResponse.json({ success: true, items_packed: itemCount });
    }

    // ── Assign to packer ──
    if (!order_id || !assigned_to) {
      return NextResponse.json({ success: false, error: 'order_id and assigned_to required' }, { status: 400 });
    }

    // Insert or update assignment
    const { error } = await supabase
      .from('order_assignments')
      .upsert({
        order_id,
        assigned_to,
        assigned_by: assigned_by || null,
        stage: 'packing',
        status: 'pending',
        notes: notes || '',
        assigned_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }, { onConflict: 'order_id', ignoreDuplicates: false });

    if (error) throw error;

    // Order status → on_packing
    await supabase
      .from('orders')
      .update({ status: 'on_packing', updated_at: new Date().toISOString() })
      .eq('id', order_id)
      .in('status', ['confirmed', 'pending', 'processing']);

    // Log it
    const { data: emp } = await supabase
      .from('employees')
      .select('name')
      .eq('id', assigned_to)
      .single();

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'assigned',
      notes: `Assigned to ${emp?.name || 'Unknown'}`,
      performed_by: performer,
      performed_by_email: performerEmail,
      performed_at: new Date().toISOString(),
    });

    // ── Shopify: packer ka tag lagao ──
    const { data: ord } = await supabase.from('orders').select('shopify_order_id').eq('id', order_id).single();
    if (ord?.shopify_order_id && emp?.name) {
      try {
        await updateShopifyOrderTags(ord.shopify_order_id, [`packing:${emp.name}`], []);
      } catch (e) {
        console.error('[assign] Shopify tag error:', e.message);
      }
    }

    return NextResponse.json({ success: true });

  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
