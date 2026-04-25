// ============================================================================
// RS ZEVAR ERP — Order Assign Route  (FIXED Apr 2026)
// ----------------------------------------------------------------------------
// Changes:
//   1. Default action fallback — if caller omits `action` but sends `assigned_to`,
//      treat as `set_packer`. This fixes the drawer "Assign Packer" button which
//      was silently failing with "Unknown action".
//   2. set_packer now promotes status 'confirmed' → 'on_packing' (was leaving it
//      at confirmed, causing UI flicker after optimistic updates)
//   3. packed action guards with canTransition (must be on_packing to go packed)
//   4. Upsert no longer resets created_at on update (preserves history)
//   5. Unassign reverts on_packing → confirmed via canTransition guard
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { canTransition } from '@/lib/order-status';
import { updateShopifyOrderTags, isActiveLineItem, getEffectiveQuantity } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS — used by set_packer (scan-time credit) + action:'packed' (safety net)
// ═════════════════════════════════════════════════════════════════════════════

// Compute items_packed + items_amount with 3-tier fallback:
//   1) order_items table (primary)
//   2) shopify_raw.line_items (for orders without backfill)
//   3) orders.total_amount (always-populated from Shopify sync)
async function computePackingCredits(supabase, order_id) {
  const { data: orderItems } = await supabase
    .from('order_items')
    .select('quantity, total_price, unit_price')
    .eq('order_id', order_id);

  let totalItems = (orderItems || []).reduce(
    (s, i) => s + (parseInt(i.quantity) || 1),
    0,
  );

  let totalAmount = (orderItems || []).reduce((s, i) => {
    const tp = parseFloat(i.total_price);
    if (!isNaN(tp) && tp > 0) return s + tp;
    const up = parseFloat(i.unit_price) || 0;
    const qty = parseInt(i.quantity) || 1;
    return s + up * qty;
  }, 0);

  // Tier 2: shopify_raw fallback
  // FIX Apr 2026 — Filter out items removed via Shopify Order Edit
  // (current_quantity === 0). Bina filter ke removed items bhi packing
  // credit mein count ho jate thay, packer ko zyada Rs credit milta tha.
  // Use getEffectiveQuantity for partial reductions (qty 3 → 2).
  if (totalItems === 0 || totalAmount === 0) {
    const { data: ordRaw } = await supabase
      .from('orders')
      .select('shopify_raw')
      .eq('id', order_id)
      .maybeSingle();
    const rawItems = (ordRaw?.shopify_raw?.line_items || []).filter(isActiveLineItem);
    if (totalItems === 0) {
      totalItems = rawItems.reduce((s, i) => s + getEffectiveQuantity(i), 0);
    }
    if (totalAmount === 0) {
      totalAmount = rawItems.reduce((s, i) => {
        const price = parseFloat(i.price) || 0;
        const qty = getEffectiveQuantity(i);
        return s + price * qty;
      }, 0);
    }
  }

  // Tier 3: orders.total_amount final fallback
  if (totalAmount === 0) {
    const { data: ordTotal } = await supabase
      .from('orders')
      .select('total_amount')
      .eq('id', order_id)
      .maybeSingle();
    totalAmount = parseFloat(ordTotal?.total_amount) || 0;
  }

  if (totalItems === 0) totalItems = 1;
  totalAmount = Math.round(totalAmount * 100) / 100;

  return { totalItems, totalAmount };
}

// Write packing_log row(s). Handles solo AND team packs.
// Returns: { rowsInserted, totalItems, totalAmount }
async function writePackingLogRows(supabase, { order_id, isPackingTeam, solo_employee_id, completed_at, notes }) {
  const { totalItems, totalAmount } = await computePackingCredits(supabase, order_id);

  if (isPackingTeam) {
    const { data: team } = await supabase
      .from('employees')
      .select('id, name')
      .eq('status', 'active')
      .eq('role', 'Packing Team');

    const teamCount = (team || []).length || 1;
    const amountPerPerson = Math.round((totalAmount / teamCount) * 100) / 100;

    const logs = (team || []).map(emp => ({
      order_id,
      employee_id: emp.id,
      items_packed: totalItems, // full credit per member
      items_amount: amountPerPerson,
      completed_at,
      notes: notes || 'Packing Team (shared)',
    }));

    if (logs.length > 0) {
      await supabase.from('packing_log').insert(logs);
    }
    return { rowsInserted: logs.length, totalItems, totalAmount };
  }

  await supabase.from('packing_log').insert({
    order_id,
    employee_id: solo_employee_id,
    items_packed: totalItems,
    items_amount: totalAmount,
    completed_at,
    notes: notes || '',
  });
  return { rowsInserted: 1, totalItems, totalAmount };
}

// ═════════════════════════════════════════════════════════════════════════════

// ─── GET — packing staff list OR current assignment for order ─────────────
export async function GET(request) {
  const supabase = createServerClient();
  try {
    const { searchParams } = new URL(request.url);
    const order_id = searchParams.get('order_id');

    if (order_id) {
      const { data } = await supabase
        .from('order_assignments')
        .select('*, employee:assigned_to(id, name, role)')
        .eq('order_id', order_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return NextResponse.json({ success: true, assignment: data || null });
    }

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
  const supabase = createServerClient();
  try {
    const body = await request.json();
    const {
      order_id,
      assigned_to,
      performed_by,
      performed_by_email,
    } = body;

    // Default action resolution — if caller forgot `action` but included
    // `assigned_to`, they meant set_packer. This preserves old drawer call sites.
    const action = body.action || (assigned_to != null ? 'set_packer' : null);
    const performer = performed_by || 'Staff';
    const performerEmail = performed_by_email || null;

    if (!order_id) {
      return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });
    }
    if (!action) {
      return NextResponse.json(
        { success: false, error: 'action ya assigned_to required (unassign | set_packer | packed)' },
        { status: 400 },
      );
    }

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

        // Only revert status if currently on_packing — use canTransition as safety
        if (ord.status === 'on_packing') {
          const gate = canTransition('on_packing', 'confirmed', 'manual');
          if (gate.allowed) {
            updatePayload.status = 'confirmed';
            // Pack is being undone — remove scan-time packing_log credit too.
            // (If already at packed/dispatched/delivered, credit is earned — leave it.)
            await supabase.from('packing_log').delete().eq('order_id', order_id);
          }
        }
        await supabase.from('orders').update(updatePayload).eq('id', order_id);

        // Strip packing:* tag from Shopify too
        if (ord.shopify_order_id) {
          const packingTags = Array.isArray(ord.tags)
            ? ord.tags.filter(t => String(t).toLowerCase().startsWith('packing:'))
            : [];
          if (packingTags.length > 0) {
            try {
              await updateShopifyOrderTags(ord.shopify_order_id, [], packingTags);
            } catch (e) { console.error('[unassign] Shopify:', e.message); }
          }
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

    // ── Set Packer ─────────────────────────────────────────────
    if (action === 'set_packer') {
      const { data: ord } = await supabase
        .from('orders')
        .select('id, order_number, status')
        .eq('id', order_id)
        .single();

      if (!ord) return NextResponse.json({ success: false, error: 'Order nahi mila' }, { status: 404 });
      if (!['on_packing', 'confirmed'].includes(ord.status)) {
        return NextResponse.json(
          { success: false, error: `Order status '${ord.status}' pe packer set nahi ho sakta` },
          { status: 400 },
        );
      }

      let empName = 'Packing Team';
      let empId = null;

      if (assigned_to === 'packing_team') {
        empName = 'Packing Team';
        empId = null;
      } else {
        const numId = parseInt(assigned_to);
        if (isNaN(numId)) {
          return NextResponse.json(
            { success: false, error: 'Valid employee select karo' },
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
        empId = numId;
      }

      // Check if an assignment already exists — to preserve created_at on update
      const { data: existingAssign } = await supabase
        .from('order_assignments')
        .select('id, created_at')
        .eq('order_id', order_id)
        .maybeSingle();

      const nowIso = new Date().toISOString();
      const assignPayload = {
        order_id,
        assigned_to: empId,
        stage: 'packing',
        status: 'pending',
        notes: assigned_to === 'packing_team' ? 'packing_team' : '',
        assigned_at: nowIso,
        // Only set created_at for NEW rows; preserve on update
        created_at: existingAssign?.created_at || nowIso,
      };

      await supabase.from('order_assignments').upsert(assignPayload, {
        onConflict: 'order_id',
        ignoreDuplicates: false,
      });

      // ── Write packing_log (credit at scan time, not wait for Mark Packed) ──
      // Re-assignment safety: delete previous rows for this order before insert.
      // This ensures only the CURRENT packer gets credit (handles A→B reassignment).
      await supabase.from('packing_log').delete().eq('order_id', order_id);

      const packingLogWritten = await writePackingLogRows(supabase, {
        order_id,
        isPackingTeam: assigned_to === 'packing_team',
        solo_employee_id: empId,
        completed_at: nowIso,
        notes: assigned_to === 'packing_team' ? 'Packing Team (shared) [scan-credit]' : '[scan-credit]',
      });

      // ── Promote confirmed → on_packing (was missing before) ──
      let statusPromoted = false;
      if (ord.status === 'confirmed') {
        const gate = canTransition('confirmed', 'on_packing', 'manual');
        if (gate.allowed) {
          await supabase
            .from('orders')
            .update({ status: 'on_packing', updated_at: nowIso })
            .eq('id', order_id);
          statusPromoted = true;
        }
      }

      await supabase.from('order_activity_log').insert({
        order_id,
        action: 'packer_set',
        notes: statusPromoted
          ? `Packed by: ${empName} (status → on_packing, ${packingLogWritten.rowsInserted} log row(s), Rs ${packingLogWritten.totalAmount.toLocaleString()})`
          : `Packed by: ${empName} (${packingLogWritten.rowsInserted} log row(s), Rs ${packingLogWritten.totalAmount.toLocaleString()})`,
        performed_by: performer,
        performed_by_email: performerEmail,
        performed_at: nowIso,
      });

      return NextResponse.json({
        success: true,
        packed_by: empName,
        status_promoted: statusPromoted,
        packing_log_rows: packingLogWritten.rowsInserted,
        items_amount: packingLogWritten.totalAmount,
      });
    }

    // ── Mark as Packed (Dispatcher) ────────────────────────────
    if (action === 'packed') {
      const { data: ord } = await supabase
        .from('orders')
        .select('id, status')
        .eq('id', order_id)
        .single();

      if (!ord) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });

      // Central guard — on_packing → packed allowed, others blocked
      const gate = canTransition(ord.status, 'packed', 'manual');
      if (!gate.allowed) {
        return NextResponse.json(
          {
            success: false,
            error: `Mark Packed blocked: order status '${ord.status}' se packed nahi ho sakta (${gate.reason})`,
          },
          { status: 400 },
        );
      }

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
      const nowIso = new Date().toISOString();

      // ── Dedup check: if set_packer already wrote packing_log, skip re-insert ──
      // (set_packer writes at scan time; this is the safety-net path for edge cases)
      const { count: existingLogCount } = await supabase
        .from('packing_log')
        .select('*', { count: 'exact', head: true })
        .eq('order_id', order_id);

      let totalItems = 0;
      let totalAmount = 0;
      let logsInserted = 0;

      if ((existingLogCount || 0) > 0) {
        // packing_log already has row(s) — credit is preserved. Compute totals for response only.
        const { data: existingRows } = await supabase
          .from('packing_log')
          .select('items_packed, items_amount')
          .eq('order_id', order_id);
        // For solo: 1 row = full totals. For team: rows share, so aggregate and de-divide.
        if (isPackingTeam && (existingRows || []).length > 1) {
          totalItems = existingRows[0].items_packed || 0; // full credit per member
          totalAmount = (existingRows || []).reduce((s, r) => s + (parseFloat(r.items_amount) || 0), 0);
        } else {
          totalItems = (existingRows || []).reduce((s, r) => s + (parseInt(r.items_packed) || 0), 0);
          totalAmount = (existingRows || []).reduce((s, r) => s + (parseFloat(r.items_amount) || 0), 0);
        }
        totalAmount = Math.round(totalAmount * 100) / 100;
      } else {
        // No packing_log rows — this is a legacy path (set_packer didn't write). Write now.
        const written = await writePackingLogRows(supabase, {
          order_id,
          isPackingTeam,
          solo_employee_id: assignment.assigned_to,
          completed_at: nowIso,
          notes: isPackingTeam ? 'Packing Team (shared)' : '',
        });
        totalItems = written.totalItems;
        totalAmount = written.totalAmount;
        logsInserted = written.rowsInserted;
      }

      // Status updates (always run regardless of dedup)
      await supabase
        .from('orders')
        .update({ status: 'packed', updated_at: nowIso })
        .eq('id', order_id);

      await supabase
        .from('order_assignments')
        .update({ status: 'packed', completed_at: nowIso })
        .eq('id', assignment.id);

      const { data: empData } = assignment.assigned_to
        ? await supabase.from('employees').select('name').eq('id', assignment.assigned_to).single()
        : { data: null };

      const logNote = (existingLogCount || 0) > 0
        ? `Packed — ${totalItems} items (Rs. ${totalAmount.toLocaleString()}) by ${isPackingTeam ? 'Packing Team' : empData?.name || 'Unknown'} [credit from scan]`
        : `Packed — ${totalItems} items (Rs. ${totalAmount.toLocaleString()}) by ${isPackingTeam ? 'Packing Team' : empData?.name || 'Unknown'} [credit written here — legacy path]`;

      await supabase.from('order_activity_log').insert({
        order_id,
        action: 'packed',
        notes: logNote,
        performed_by: performer,
        performed_by_email: performerEmail,
        performed_at: nowIso,
      });

      return NextResponse.json({
        success: true,
        items_packed: totalItems,
        items_amount: totalAmount,
        is_team: isPackingTeam,
        credit_from_scan: (existingLogCount || 0) > 0,
        logs_inserted: logsInserted,
      });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: '${action}'` },
      { status: 400 },
    );
  } catch (e) {
    console.error('[assign] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
