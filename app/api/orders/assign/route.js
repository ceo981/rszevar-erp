import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET — packing staff list + current assignment
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const order_id = searchParams.get('order_id');

    if (order_id) {
      const { data, error } = await supabase
        .from('order_assignments')
        .select('*, employee:assigned_to(id, name, role)')
        .eq('order_id', order_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return NextResponse.json({ success: true, assignment: data || null });
    }

    // Packing team employees
    const { data: employees } = await supabase
      .from('employees')
      .select('id, name, role, designation')
      .eq('status', 'active')
      .eq('role', 'Packing Team')
      .order('name');

    return NextResponse.json({ success: true, employees: employees || [] });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { order_id, action, performed_by, performed_by_email } = body;
    const performer = performed_by || 'Staff';
    const performerEmail = performed_by_email || null;

    // ── Unassign ──────────────────────────────────────────────
    if (action === 'unassign') {
      await supabase.from('order_assignments').delete().eq('order_id', order_id);

      const { data: ord } = await supabase
        .from('orders')
        .select('id, status, tags, shopify_order_id')
        .eq('id', order_id)
        .single();

      if (ord) {
        const cleanedTags = Array.isArray(ord.tags)
          ? ord.tags.filter(t => !String(t).toLowerCase().startsWith('packing:'))
          : [];
        const updatePayload = { tags: cleanedTags, updated_at: new Date().toISOString() };
        if (ord.status === 'on_packing') updatePayload.status = 'confirmed';
        await supabase.from('orders').update(updatePayload).eq('id', order_id);

        if (ord.shopify_order_id) {
          try {
            const { updateShopifyOrderTags } = await import('@/lib/shopify');
            const packingTags = Array.isArray(ord.tags)
              ? ord.tags.filter(t => String(t).toLowerCase().startsWith('packing:'))
              : [];
            if (packingTags.length > 0) {
              await updateShopifyOrderTags(ord.shopify_order_id, [], packingTags);
            }
          } catch (e) { console.error('[unassign] Shopify:', e.message); }
        }
      }

      await supabase.from('order_activity_log').insert({
        order_id,
        action: 'unassigned',
        notes: 'Packer hata diya',
        performed_by: performer,
        performed_by_email: performerEmail,
        performed_at: new Date().toISOString(),
      });

      return NextResponse.json({ success: true });
    }

    // ── Set Packer (from mobile packing screen) ───────────────
    // Packing staff khud apna naam dalte hain
    if (action === 'set_packer') {
      const { assigned_to } = body; // employee id (number) OR 'packing_team' (string)
      if (!order_id) return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });

      // Get order
      const { data: ord } = await supabase
        .from('orders')
        .select('id, order_number, status')
        .eq('id', order_id)
        .single();

      if (!ord) return NextResponse.json({ success: false, error: 'Order nahi mila' }, { status: 404 });
      if (!['on_packing', 'confirmed'].includes(ord.status)) {
        return NextResponse.json({ success: false, error: `Order status '${ord.status}' pe packer set nahi ho sakta` }, { status: 400 });
      }

      let empName = 'Packing Team';
      let empId = null;

      if (assigned_to === 'packing_team') {
        empName = 'Packing Team';
        empId = null;
      } else {
        const numId = parseInt(assigned_to);
        if (isNaN(numId)) return NextResponse.json({ success: false, error: 'Valid employee select karo' }, { status: 400 });
        const { data: emp } = await supabase.from('employees').select('name').eq('id', numId).single();
        if (!emp) return NextResponse.json({ success: false, error: 'Employee nahi mila' }, { status: 404 });
        empName = emp.name;
        empId = numId;
      }

      // Upsert assignment
      await supabase.from('order_assignments').upsert({
        order_id,
        assigned_to: empId,
        stage: 'packing',
        status: 'pending',
        notes: assigned_to === 'packing_team' ? 'packing_team' : '',
        assigned_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }, { onConflict: 'order_id', ignoreDuplicates: false });

      await supabase.from('order_activity_log').insert({
        order_id,
        action: 'packer_set',
        notes: `Packed by: ${empName}`,
        performed_by: performer,
        performed_by_email: performerEmail,
        performed_at: new Date().toISOString(),
      });

      return NextResponse.json({ success: true, packed_by: empName });
    }

    // ── Mark as Packed (dispatcher karta hai) ─────────────────
    if (action === 'packed') {
      if (!order_id) return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });

      // Check packed_by exists
      const { data: assignment } = await supabase
        .from('order_assignments')
        .select('id, assigned_to, notes')
        .eq('order_id', order_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!assignment) {
        return NextResponse.json({
          success: false,
          error: '⚠️ Packed By set nahi hai — pehle mobile screen se packer add karo',
          packed_by_missing: true,
        }, { status: 400 });
      }

      const isPackingTeam = assignment.notes === 'packing_team' || !assignment.assigned_to;

      // ── Get order items: quantity + total_price (for leaderboard amount priority) ──
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('quantity, total_price, unit_price')
        .eq('order_id', order_id);

      let totalItems = (orderItems || []).reduce((s, i) => s + (parseInt(i.quantity) || 1), 0);
      if (totalItems === 0) totalItems = 1;

      // Sum total_price — fallback to unit_price × quantity if total_price missing
      let totalAmount = (orderItems || []).reduce((s, i) => {
        const tp = parseFloat(i.total_price);
        if (!isNaN(tp) && tp > 0) return s + tp;
        const up = parseFloat(i.unit_price) || 0;
        const qty = parseInt(i.quantity) || 1;
        return s + (up * qty);
      }, 0);
      totalAmount = Math.round(totalAmount * 100) / 100; // 2 decimals

      // Update order status → packed
      await supabase
        .from('orders')
        .update({ status: 'packed', updated_at: new Date().toISOString() })
        .eq('id', order_id);

      // Mark assignment as packed
      await supabase
        .from('order_assignments')
        .update({ status: 'packed', completed_at: new Date().toISOString() })
        .eq('id', assignment.id);

      // ── Leaderboard: packing_log entries (items + amount dono) ──
      if (isPackingTeam) {
        // Get all active packing team members
        const { data: team } = await supabase
          .from('employees')
          .select('id, name')
          .eq('status', 'active')
          .eq('role', 'Packing Team');

        const teamCount = (team || []).length || 1;
        // ITEMS = participation count (not share). Full credit to every team
        // member who helped pack. Rounding/dividing items causes small orders
        // (1-3 items) to credit 0 per person when team is large (e.g. 7).
        // AMOUNT = bonus share, correctly divided by team size.
        const itemsPerPerson  = totalItems;
        const amountPerPerson = Math.round((totalAmount / teamCount) * 100) / 100;

        // Create one packing_log entry per team member
        const logs = (team || []).map(emp => ({
          order_id,
          employee_id: emp.id,
          items_packed: itemsPerPerson,
          items_amount: amountPerPerson,
          completed_at: new Date().toISOString(),
          notes: 'Packing Team (shared)',
        }));

        if (logs.length > 0) {
          await supabase.from('packing_log').insert(logs);
        }
      } else {
        // Individual packer — full credit
        await supabase.from('packing_log').insert({
          order_id,
          employee_id: assignment.assigned_to,
          items_packed: totalItems,
          items_amount: totalAmount,
          completed_at: new Date().toISOString(),
          notes: '',
        });
      }

      // Activity log
      const { data: empData } = assignment.assigned_to
        ? await supabase.from('employees').select('name').eq('id', assignment.assigned_to).single()
        : { data: null };

      await supabase.from('order_activity_log').insert({
        order_id,
        action: 'packed',
        notes: `Packed — ${totalItems} items (Rs. ${totalAmount.toLocaleString()}) by ${isPackingTeam ? 'Packing Team' : empData?.name || 'Unknown'}`,
        performed_by: performer,
        performed_by_email: performerEmail,
        performed_at: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        items_packed: totalItems,
        items_amount: totalAmount,
        is_team: isPackingTeam,
      });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
