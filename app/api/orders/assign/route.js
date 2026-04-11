import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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

    // Get all packing staff for dropdown
    const { data: employees } = await supabase
      .from('employees')
      .select('id, name, role')
      .eq('status', 'active')
      .in('role', ['Packing Team', 'Operations Manager', 'Dispatcher'])
      .order('name');

    return NextResponse.json({ success: true, employees: employees || [] });

  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { order_id, assigned_to, assigned_by, notes, action } = await request.json();

    // ── Mark as Packed ──
    if (action === 'packed') {
      const { data: assignment } = await supabase
        .from('order_assignments')
        .select('id, assigned_to')
        .eq('order_id', order_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Get order items count
      const { data: orderData } = await supabase
        .from('orders')
        .select('line_items')
        .eq('id', order_id)
        .single();

      const lineItems = orderData?.line_items || [];
      const itemCount = Array.isArray(lineItems)
        ? lineItems.reduce((s, i) => s + (parseInt(i.quantity) || 1), 0)
        : 0;

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
        performed_at: new Date().toISOString(),
      });

      return NextResponse.json({ success: true, items_packed: itemCount });
    }

    // ── Assign to packer ──
    if (!order_id || !assigned_to) {
      return NextResponse.json({ success: false, error: 'order_id and assigned_to required' }, { status: 400 });
    }

    // Upsert assignment
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
      }, { onConflict: 'order_id' });

    if (error) throw error;

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
      performed_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });

  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
