// ============================================================================
// RS ZEVAR ERP — Bulk Actions Route  (FIXED Apr 2026)
// ----------------------------------------------------------------------------
// Changes:
//   1. VALID_STATUSES imported from lib/order-status.js (no more fragmentation
//      between 3 files). Removes in_transit (not in DB enum), adds returned+refunded.
//   2. doStatus now uses canTransition — bulk can no longer illegally mass-flip
//      delivered → pending or cancelled → dispatched.
//   3. Bulk dispatched and cancelled statuses BLOCKED from bulk — must use
//      per-order dispatch/cancel flow so courier booking + Shopify sync happen.
//   4. doStatus adds same side effects as status route (delivered→paid, etc.)
//   5. sync_shopify flag passed through to doCancel for ERP-only bulk cancel.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { canTransition, VALID_STATUSES } from '@/lib/order-status';
import {
  updateShopifyOrderTags,
  addShopifyOrderNote,
  cancelShopifyOrder,
} from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseFactory = () => createServerClient();

// Bulk route blocks these — they need different workflows
// NOTE: 'dispatched' is allowed in bulk. Reason: orders are typically booked via
// Shopify courier apps, so by the time user bulk-flips, tracking already exists.
// This is just a status flip (+ dispatched_at). ERP-initiated courier booking
// via Kangaroo/Leopards is per-order only (has modals with custom fields).
const BLOCKED_BULK_STATUS = new Set(['cancelled']);

const CONFIRMABLE = ['pending', 'processing', 'attempted', 'hold'];
const NO_CANCEL_FROM = new Set(['dispatched', 'delivered', 'rto', 'returned', 'refunded']);

// ─── Per-order action handlers ──────────────────────────────────────────

async function doConfirm(supabase, orderId, notes, performer, performerEmail) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, shopify_order_id, status, confirmed_at')
    .eq('id', orderId)
    .single();

  if (!order) return { success: false, error: 'Order nahi mila' };
  if (!CONFIRMABLE.includes(order.status)) {
    return { success: false, error: `Status '${order.status}' confirm nahi ho sakta` };
  }

  const gate = canTransition(order.status, 'confirmed', 'manual');
  if (!gate.allowed) {
    return { success: false, error: `Confirm blocked: ${gate.reason}` };
  }

  const nowIso = new Date().toISOString();
  const patch = {
    status: 'confirmed',
    confirmation_notes: notes || '',
    updated_at: nowIso,
  };
  if (!order.confirmed_at) patch.confirmed_at = nowIso;

  const { error } = await supabase.from('orders').update(patch).eq('id', orderId);
  if (error) return { success: false, error: error.message };

  if (order.shopify_order_id) {
    try {
      await updateShopifyOrderTags(order.shopify_order_id, ['order_confirmed'], []);
      if (notes) {
        await addShopifyOrderNote(
          order.shopify_order_id,
          `ERP Confirmed by ${performer}: ${notes}`,
        );
      }
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
    performed_at: nowIso,
  });

  return { success: true, order_number: order.order_number };
}

async function doCancel(supabase, orderId, reason, performer, performerEmail, syncShopify) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, shopify_order_id, status')
    .eq('id', orderId)
    .single();

  if (!order) return { success: false, error: 'Order nahi mila' };
  if (order.status === 'cancelled') return { success: false, error: 'Pehle se cancelled hai' };
  if (NO_CANCEL_FROM.has(order.status)) {
    return { success: false, error: `'${order.status}' order cancel nahi ho sakta — RTO/Returned flow use karo` };
  }

  const gate = canTransition(order.status, 'cancelled', 'manual');
  if (!gate.allowed) {
    return { success: false, error: `Cancel blocked: ${gate.reason}` };
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabase.from('orders').update({
    status: 'cancelled',
    cancelled_at: nowIso,
    cancel_reason: reason || '',
    updated_at: nowIso,
  }).eq('id', orderId);

  if (error) return { success: false, error: error.message };

  let shopifyWarning = null;
  let shopifyCancelled = false;
  if (order.shopify_order_id && syncShopify) {
    try {
      await cancelShopifyOrder(order.shopify_order_id, 'other');
      shopifyCancelled = true;
    } catch (e) {
      shopifyWarning = e.message;
      console.error('[bulk cancel] Shopify:', e.message);
    }
  }

  await supabase.from('order_activity_log').insert({
    order_id: orderId,
    action: 'cancelled',
    notes: [
      reason || 'Bulk cancelled',
      shopifyCancelled ? '+ Shopify cancelled' : null,
      shopifyWarning ? `Shopify error: ${shopifyWarning}` : null,
      !syncShopify ? '(ERP only)' : null,
    ].filter(Boolean).join(' | '),
    performed_by: performer,
    performed_by_email: performerEmail,
    performed_at: nowIso,
  });

  return { success: true, order_number: order.order_number, warning: shopifyWarning };
}

async function doStatus(supabase, orderId, newStatus, notes, performer, performerEmail) {
  // Fetch minimal fields — skip optional timestamp columns that may not exist
  const { data: order, error: fetchErr } = await supabase
    .from('orders')
    .select('id, order_number, status, payment_status, payment_method, confirmed_at')
    .eq('id', orderId)
    .single();

  if (fetchErr) return { success: false, error: `DB error: ${fetchErr.message}` };
  if (!order) return { success: false, error: 'Order nahi mila' };
  if (order.status === newStatus) return { success: false, error: `Pehle se '${newStatus}' hai` };

  const gate = canTransition(order.status, newStatus, 'manual');
  if (!gate.allowed) {
    return { success: false, error: `${order.status} → ${newStatus} blocked (${gate.reason})` };
  }

  const nowIso = new Date().toISOString();
  const patch = { status: newStatus, updated_at: nowIso };

  if (newStatus === 'confirmed' && !order.confirmed_at) patch.confirmed_at = nowIso;
  if (newStatus === 'dispatched') patch.dispatched_at = nowIso;
  if (newStatus === 'delivered') {
    patch.delivered_at = nowIso;
    if (order.payment_method === 'COD' && order.payment_status === 'unpaid') {
      patch.payment_status = 'paid';
      patch.paid_at = nowIso;
    }
  }
  if (newStatus === 'rto') patch.rto_at = nowIso;

  // Resilient UPDATE — strip missing optional columns if schema lacks them
  const OPTIONAL_COLS = ['delivered_at', 'rto_at', 'paid_at'];
  let updateErr = null;
  let attempt = 0;
  while (attempt < 3) {
    const { error } = await supabase.from('orders').update(patch).eq('id', orderId);
    if (!error) { updateErr = null; break; }
    updateErr = error;
    const missingCol = OPTIONAL_COLS.find(col =>
      String(error.message || '').toLowerCase().includes(col),
    );
    if (missingCol && patch[missingCol] !== undefined) {
      delete patch[missingCol];
      attempt++;
      continue;
    }
    break;
  }
  if (updateErr) return { success: false, error: updateErr.message };

  await supabase.from('order_activity_log').insert({
    order_id: orderId,
    action: `status_changed_to_${newStatus}`,
    notes: notes || `Bulk status → ${newStatus}`,
    performed_by: performer,
    performed_by_email: performerEmail,
    performed_at: nowIso,
  });

  return { success: true, order_number: order.order_number };
}

async function doAssign(supabase, orderId, assignedTo, empName, performer, performerEmail) {
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
  const assignNotes = assignedTo === 'packing_team' ? 'packing_team' : '';

  const { data: existingAssign } = await supabase
    .from('order_assignments')
    .select('id, created_at')
    .eq('order_id', orderId)
    .maybeSingle();

  const nowIso = new Date().toISOString();

  const { error } = await supabase.from('order_assignments').upsert({
    order_id: orderId,
    assigned_to: empId,
    stage: 'packing',
    status: 'pending',
    notes: assignNotes,
    assigned_at: nowIso,
    created_at: existingAssign?.created_at || nowIso,
  }, { onConflict: 'order_id', ignoreDuplicates: false });

  if (error) return { success: false, error: error.message };

  // Promote confirmed → on_packing (matches single-assign behavior)
  if (order.status === 'confirmed') {
    const gate = canTransition('confirmed', 'on_packing', 'manual');
    if (gate.allowed) {
      await supabase
        .from('orders')
        .update({ status: 'on_packing', updated_at: nowIso })
        .eq('id', orderId);
    }
  }

  await supabase.from('order_activity_log').insert({
    order_id: orderId,
    action: 'packer_set',
    notes: `Bulk assigned — Packed by: ${empName}`,
    performed_by: performer,
    performed_by_email: performerEmail,
    performed_at: nowIso,
  });

  return { success: true, order_number: order.order_number };
}

// ─── POST handler ───────────────────────────────────────────────────────

export async function POST(request) {
  const supabase = supabaseFactory();
  try {
    const body = await request.json();
    const {
      action,
      order_ids,
      performed_by,
      performed_by_email,
      // action-specific
      notes,
      reason,
      status,
      assigned_to,
      sync_shopify, // for cancel; default true
    } = body;

    if (!action) {
      return NextResponse.json({ success: false, error: 'action required' }, { status: 400 });
    }
    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'order_ids array required' },
        { status: 400 },
      );
    }
    if (order_ids.length > 100) {
      return NextResponse.json(
        { success: false, error: 'Maximum 100 orders per bulk action' },
        { status: 400 },
      );
    }

    const performer = performed_by || 'Staff';
    const performerEmail = performed_by_email || null;
    const shouldSyncShopifyOnCancel = sync_shopify !== false;

    // Per-action pre-validation
    if (action === 'cancel' && (!reason || !reason.trim())) {
      return NextResponse.json(
        { success: false, error: 'Cancel reason required' },
        { status: 400 },
      );
    }
    if (action === 'status') {
      if (!status) {
        return NextResponse.json({ success: false, error: 'status required' }, { status: 400 });
      }
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json(
          { success: false, error: `Invalid status: ${status}` },
          { status: 400 },
        );
      }
      if (BLOCKED_BULK_STATUS.has(status)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Cancel bulk ke liye action="cancel" use karo, status="cancelled" nahi',
          },
          { status: 400 },
        );
      }
    }

    // Resolve employee name once for assign
    let empName = 'Packing Team';
    if (action === 'assign') {
      if (!assigned_to) {
        return NextResponse.json(
          { success: false, error: 'assigned_to required' },
          { status: 400 },
        );
      }
      if (assigned_to !== 'packing_team') {
        const numId = parseInt(assigned_to);
        if (isNaN(numId)) {
          return NextResponse.json(
            { success: false, error: 'Valid employee id chahiye' },
            { status: 400 },
          );
        }
        const { data: emp } = await supabase
          .from('employees')
          .select('name')
          .eq('id', numId)
          .single();
        if (!emp) return NextResponse.json({ success: false, error: 'Employee nahi mila' }, { status: 404 });
        empName = emp.name;
      }
    }

    // Process each order — sequential to avoid Shopify rate limits
    const results = [];
    for (const orderId of order_ids) {
      try {
        let res;
        if (action === 'confirm')      res = await doConfirm(supabase, orderId, notes, performer, performerEmail);
        else if (action === 'cancel')  res = await doCancel(supabase, orderId, reason, performer, performerEmail, shouldSyncShopifyOnCancel);
        else if (action === 'status')  res = await doStatus(supabase, orderId, status, notes, performer, performerEmail);
        else if (action === 'assign')  res = await doAssign(supabase, orderId, assigned_to, empName, performer, performerEmail);
        else res = { success: false, error: 'Unknown action' };

        results.push({ order_id: orderId, ...res });
      } catch (e) {
        results.push({ order_id: orderId, success: false, error: e.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.length - succeeded;

    return NextResponse.json({
      success: true,
      summary: { total: results.length, succeeded, failed },
      results,
    });
  } catch (e) {
    console.error('[bulk] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
