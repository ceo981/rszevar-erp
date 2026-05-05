// ============================================================================
// RS ZEVAR ERP — Customer Credits — Import Order to Khaata
// GET    /api/credits/import-order?q=...&exclude_phone=...   (search)
// POST   /api/credits/import-order                            (import)
// DELETE /api/credits/import-order?order_id=...               (un-import)
// May 5 2026
// ----------------------------------------------------------------------------
// PURPOSE:
//   Lets CEO manually attach any credit order to any khaata.
//   Use case: same person with 2 phone numbers — consolidate into one khaata.
//
// AUTH (POST + DELETE):
//   super_admin OR has 'credits.import_order' permission
//   GET (search) is open to anyone with credit access (read-only).
//
// SEARCH (GET):
//   ?q=string                — searches order_number OR customer_name (LIKE)
//   ?exclude_phone=phone     — excludes orders already in this khaata (so they
//                              don't appear in the picker)
//   Returns up to 20 most recent matches.
//
// IMPORT (POST):
//   Body: { order_id, target_phone }
//   - Sets credit_khaata_phone = target_phone on the order
//   - Stamps credit_imported_at + credit_imported_by + credit_imported_by_name
//   - Auto-sets is_credit_order = true (in case order was not yet credit)
//   - If order's customer_phone === target_phone, just clears any override
//     (it's "natural" in this khaata, no override needed)
//
// REMOVE (DELETE):
//   ?order_id=...
//   - Clears credit_khaata_phone + audit fields
//   - Order goes back to its natural khaata (based on customer_phone)
//   - is_credit_order remains true (don't auto-revert; user can flip on
//     order page if needed)
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase';
import { getCurrentUser } from '../../../../lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ──────────────────────────────────────────────────────────────────────────
// Auth gate — super_admin OR 'credits.import_order' perm
// ──────────────────────────────────────────────────────────────────────────
async function requireImportPerm() {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  }
  const isSuperAdmin = user.profile.role === 'super_admin';
  const hasPerm = user.permissions.has('credits.import_order');
  if (!isSuperAdmin && !hasPerm) {
    return { error: NextResponse.json({ success: false, error: 'Forbidden — only super admin can import orders to khaata' }, { status: 403 }) };
  }
  return { user };
}

// ──────────────────────────────────────────────────────────────────────────
// GET — search importable credit orders
// ──────────────────────────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const excludePhone = (searchParams.get('exclude_phone') || '').trim();

    // Build base query — credit orders only, ordered by recent
    let query = supabase
      .from('orders')
      .select('id, order_number, customer_name, customer_phone, credit_khaata_phone, total_amount, paid_amount, payment_status, status, created_at')
      .eq('is_credit_order', true)
      .order('created_at', { ascending: false })
      .limit(20);

    if (q) {
      // Sanitize for ilike — escape % and _ to literal
      const safe = q.replace(/[%_]/g, '\\$&');
      // Search across order_number AND customer_name
      query = query.or(`order_number.ilike.%${safe}%,customer_name.ilike.%${safe}%,customer_phone.ilike.%${safe}%`);
    }

    const { data: orders, error } = await query;
    if (error) throw error;

    // Filter out orders already in the excluded khaata
    let filtered = orders || [];
    if (excludePhone) {
      filtered = filtered.filter(o => {
        const naturalPhone = (o.customer_phone || '').trim();
        const overridePhone = (o.credit_khaata_phone || '').trim();
        const currentKhaata = overridePhone || naturalPhone;
        return currentKhaata !== excludePhone;
      });
    }

    // Shape the response
    const results = filtered.map(o => {
      const naturalPhone = (o.customer_phone || '').trim();
      const overridePhone = (o.credit_khaata_phone || '').trim();
      const currentKhaata = overridePhone || naturalPhone;
      const balance = Math.max(0, (o.total_amount || 0) - (o.paid_amount || 0));
      return {
        id: o.id,
        order_number: o.order_number,
        customer_name: o.customer_name,
        customer_phone: naturalPhone,
        current_khaata_phone: currentKhaata,
        is_imported_elsewhere: !!overridePhone,
        total_amount: o.total_amount || 0,
        paid_amount: o.paid_amount || 0,
        balance,
        status: o.status,
        payment_status: o.payment_status,
        created_at: o.created_at,
      };
    });

    return NextResponse.json({ success: true, results });
  } catch (e) {
    console.error('[GET /api/credits/import-order] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST — import order to khaata
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const auth = await requireImportPerm();
    if (auth.error) return auth.error;
    const { user } = auth;

    const supabase = createServerClient();
    const body = await request.json();
    const orderId = (body.order_id || '').trim();
    const targetPhone = (body.target_phone || '').trim();

    if (!orderId || !targetPhone) {
      return NextResponse.json(
        { success: false, error: 'order_id and target_phone are required' },
        { status: 400 },
      );
    }

    // Fetch the order
    const { data: order, error: ordErr } = await supabase
      .from('orders')
      .select('id, order_number, customer_phone, credit_khaata_phone, is_credit_order, status, payment_status')
      .eq('id', orderId)
      .maybeSingle();

    if (ordErr) throw ordErr;
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 },
      );
    }

    // Build update payload
    const naturalPhone = (order.customer_phone || '').trim();
    const userName = user.profile.full_name
                  || user.profile.name
                  || user.email
                  || 'Unknown';

    let updatePayload;
    if (naturalPhone === targetPhone) {
      // Natural khaata — clear any override; ensure is_credit_order
      updatePayload = {
        credit_khaata_phone: null,
        credit_imported_at: null,
        credit_imported_by: null,
        credit_imported_by_name: null,
        is_credit_order: true,
      };
    } else {
      // Override — manual import
      updatePayload = {
        credit_khaata_phone: targetPhone,
        credit_imported_at: new Date().toISOString(),
        credit_imported_by: user.id,
        credit_imported_by_name: userName,
        is_credit_order: true,
      };
    }

    const { data: updated, error: updErr } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId)
      .select('id, order_number, customer_phone, credit_khaata_phone')
      .single();

    if (updErr) throw updErr;

    return NextResponse.json({
      success: true,
      order: updated,
      moved_from: naturalPhone === targetPhone ? null : naturalPhone,
      moved_to: targetPhone,
      was_natural: naturalPhone === targetPhone,
    });
  } catch (e) {
    console.error('[POST /api/credits/import-order] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// DELETE — remove order from khaata (un-import, back to natural khaata)
// ──────────────────────────────────────────────────────────────────────────
export async function DELETE(request) {
  try {
    const auth = await requireImportPerm();
    if (auth.error) return auth.error;

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const orderId = (searchParams.get('order_id') || '').trim();

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'order_id required' },
        { status: 400 },
      );
    }

    const { data: updated, error } = await supabase
      .from('orders')
      .update({
        credit_khaata_phone: null,
        credit_imported_at: null,
        credit_imported_by: null,
        credit_imported_by_name: null,
      })
      .eq('id', orderId)
      .select('id, order_number, customer_phone')
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      order: updated,
      message: 'Order removed from khaata. Now belongs to its natural khaata.',
    });
  } catch (e) {
    console.error('[DELETE /api/credits/import-order] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
