import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  updateShopifyOrderTags,
  addShopifyOrderNote,
  cancelShopifyOrder,
} from '../../../../lib/shopify';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_STATUSES = [
  'pending', 'confirmed', 'on_packing', 'processing', 'packed',
  'dispatched', 'delivered', 'cancelled', 'rto', 'attempted', 'hold',
];

const CONFIRMABLE = ['pending', 'processing', 'attempted', 'hold'];

// ─── Per-order action handlers ──────────────────────────────────────────

async function doConfirm(orderId, notes, performer, performerEmail) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, shopify_order_id, status')
    .eq('id', orderId)
    .single();

  if (!order) return { success: false, error: 'Order nahi mila' };
  if (!CONFIRMABLE.includes(order.status)) {
    return { success: false, error: `Status '${order.status}' confirm nahi ho sakta` };
  }

  const { error } = await supabase.from('orders').update({
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
    confirmation_notes: notes || '',
    updated_at: new Date().toISOString(),
  }).eq('id', orderId);

  if (error) return { success: false, error: error.message };

  // Shopify tag + note — best effort, fail nahi karega order
  if (order.shopify_order_id) {
    try {
      await updateShopifyOrderTags(order.shopify_order_id, ['order_confirmed'], []);
      if (notes) await addShopifyOrderNote(order.shopify_order_id, `ERP Confirmed by ${performer}: ${notes}`);
    } catch (e) {
      console.error('[bulk confirm] Shopify:', e.message);
    }
  }

  await supabase.from('order_activity_log').insert({
    order_id: orderId,
    action: 'confirmed',
    notes: notes || 'Bulk confirmed',
    performed_by: performer,
    performed_by_email: performerEmail,
    performed_at: new Date().toISOString(),
  });

  return { success: true, order_number: order.order_number };
}

async function doCancel(orderId, reason, performer, performerEmail) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, shopify_order_id, status')
    .eq('id', orderId)
    .single();

  if (!order) return { success: false, error: 'Order nahi mila' };
  if (order.status === 'cancelled') return { success: false, error: 'Pehle se cancelled hai' };
  if (['dispatched', 'delivered'].includes(order.status)) {
    return { success: false, error: `'${order.status}' order cancel nahi ho sakta` };
  }

  const { error } = await supabase.from('orders').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancel_reason: reason || '',
    updated_at: new Date().toISOString(),
  }).eq('id', orderId);

  if (error) return { success: false, error: error.message };

  let shopifyWarning = null;
  if (order.shopify_order_id) {
    try {
      await cancelShopifyOrder(order.shopify_order_id, 'other');
    } catch (e) {
      shopifyWarning = e.message;
      console.error('[bulk cancel] Shopify:', e.message);
    }
  }

  await supabase.from('order_activity_log').insert({
    order_id: orderId,
    action: 'cancelled',
    notes: reason || 'Bulk cancelled',
    performed_by: performer,
    performed_by_email: performerEmail,
    performed_at: new Date().toISOString(),
  });

  return { success: true, order_number: order.order_number, warning: shopifyWarning };
}

async function doStatus(orderId, newStatus, notes, performer, performerEmail) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, status')
    .eq('id', orderId)
    .single();

  if (!order) return { success: false, error: 'Order nahi mila' };
  if (order.status === newStatus) return { success: false, error: `Pehle se '${newStatus}' hai` };

  const { error } = await supabase.from('orders').update({
    status: newStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', orderId);

  if (error) return { success: false, error: error.message };

  await supabase.from('order_activity_log').insert({
    order_id: orderId,
    action: `status_changed_to_${newStatus}`,
    notes: notes || `Bulk status → ${newStatus}`,
    performed_by: performer,
    performed_by_email: performerEmail,
    performed_at: new Date().toISOString(),
  });

  return { success: true, order_number: order.order_number };
}

async function doAssign(orderId, assignedTo, empName, performer, performerEmail) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, status')
    .eq('id', orderId)
    .single();

  if (!order) return { success: false, error: 'Order nahi mila' };
  if (!['on_packing', 'confirmed'].includes(order.status)) {
    return { success: false, error: `Status '${order.status}' pe packer set nahi ho sakta` };
  }

  const empId = assignedTo === 'packing_team' ? null : parseInt(assignedTo);
  const notes = assignedTo === 'packing_team' ? 'packing_team' : '';

  const { error } = await supabase.from('order_assignments').upsert({
    order_id: orderId,
    assigned_to: empId,
    stage: 'packing',
    status: 'pending',
    notes,
    assigned_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }, { onConflict: 'order_id', ignoreDuplicates: false });

  if (error) return { success: false, error: error.message };

  await supabase.from('order_activity_log').insert({
    order_id: orderId,
    action: 'packer_set',
    notes: `Bulk assigned — Packed by: ${empName}`,
    performed_by: performer,
    performed_by_email: performerEmail,
    performed_at: new Date().toISOString(),
  });

  return { success: true, order_number: order.order_number };
}

// ─── POST handler ───────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      action,
      order_ids,
      performed_by,
      performed_by_email,
      // action-specific params
      notes,
      reason,
      status,
      assigned_to,
    } = body;

    if (!action) return NextResponse.json({ success: false, error: 'action required' }, { status: 400 });
    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return NextResponse.json({ success: false, error: 'order_ids array required' }, { status: 400 });
    }
    if (order_ids.length > 100) {
      return NextResponse.json({ success: false, error: 'Maximum 100 orders per bulk action' }, { status: 400 });
    }

    const performer = performed_by || 'Staff';
    const performerEmail = performed_by_email || null;

    // Pre-validate action-specific params
    if (action === 'cancel' && (!reason || !reason.trim())) {
      return NextResponse.json({ success: false, error: 'Cancel reason required' }, { status: 400 });
    }
    if (action === 'status') {
      if (!status) return NextResponse.json({ success: false, error: 'status required' }, { status: 400 });
      if (!VALID_STATUSES.includes(status)) return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    }

    // For assign, resolve employee name once
    let empName = 'Packing Team';
    if (action === 'assign') {
      if (!assigned_to) return NextResponse.json({ success: false, error: 'assigned_to required' }, { status: 400 });
      if (assigned_to !== 'packing_team') {
        const numId = parseInt(assigned_to);
        if (isNaN(numId)) return NextResponse.json({ success: false, error: 'Valid employee id chahiye' }, { status: 400 });
        const { data: emp } = await supabase.from('employees').select('name').eq('id', numId).single();
        if (!emp) return NextResponse.json({ success: false, error: 'Employee nahi mila' }, { status: 404 });
        empName = emp.name;
      }
    }

    // Process each order — sequential to avoid Shopify rate limits
    const results = [];
    for (const orderId of order_ids) {
      try {
        let res;
        if (action === 'confirm')     res = await doConfirm(orderId, notes, performer, performerEmail);
        else if (action === 'cancel') res = await doCancel(orderId, reason, performer, performerEmail);
        else if (action === 'status') res = await doStatus(orderId, status, notes, performer, performerEmail);
        else if (action === 'assign') res = await doAssign(orderId, assigned_to, empName, performer, performerEmail);
        else res = { success: false, error: 'Unknown action' };

        results.push({ order_id: orderId, ...res });
      } catch (e) {
        results.push({ order_id: orderId, success: false, error: e.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed    = results.length - succeeded;

    return NextResponse.json({
      success: true,
      summary: { total: results.length, succeeded, failed },
      results,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
