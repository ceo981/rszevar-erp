// ============================================================================
// RS ZEVAR ERP — Protocol Audit Verify (May 2 2026)
// POST /api/orders/protocol-verify
// ----------------------------------------------------------------------------
// PURPOSE: CEO ya delegated admin order ko "Protocol OK" mark kar sakta —
//   ye order Protocol Audit tab se gayab ho jata. Use case: violation
//   intentional thi (CEO ne khud handle kiya, ya manager ne approve kiya).
//
// REQUEST BODY:
//   {
//     order_id: number,
//     performed_by: string,        // who is verifying
//     performed_by_email: string,
//     note?: string,                // optional reason
//   }
//
// RESPONSE:
//   { success, order_id, protocol_verified_at }
//
// PERMISSION: Only callers with `orders.protocol_verify` should hit this.
//   (UI-side gate via can(). Backend RLS enforces row-level access.)
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const supabase = createServerClient();

  try {
    const body = await request.json();
    const { order_id, performed_by, performed_by_email, note } = body;

    if (!order_id) {
      return NextResponse.json(
        { success: false, error: 'order_id required' },
        { status: 400 }
      );
    }

    // ── Verify order exists ──
    const { data: existing, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, status, protocol_verified_at')
      .eq('id', order_id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { success: false, error: 'Order nahi mila' },
        { status: 404 }
      );
    }

    if (existing.protocol_verified_at) {
      return NextResponse.json(
        { success: false, error: 'Already verified at ' + existing.protocol_verified_at },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const verifierName = performed_by || performed_by_email || 'unknown';

    // ── Update order ──
    const { error: updateErr } = await supabase
      .from('orders')
      .update({
        protocol_verified_by: verifierName,
        protocol_verified_at: nowIso,
        protocol_verified_note: note?.trim() || null,
      })
      .eq('id', order_id);

    if (updateErr) {
      return NextResponse.json(
        { success: false, error: 'Update fail: ' + updateErr.message },
        { status: 500 }
      );
    }

    // ── Activity log ──
    await supabase.from('activity_log').insert({
      order_id,
      action: 'protocol_verified',
      performed_by: verifierName,
      performed_by_email: performed_by_email || null,
      details: {
        order_number: existing.order_number,
        order_status: existing.status,
        note: note?.trim() || null,
      },
    });

    return NextResponse.json({
      success: true,
      order_id,
      order_number: existing.order_number,
      protocol_verified_at: nowIso,
      protocol_verified_by: verifierName,
    });
  } catch (e) {
    console.error('[protocol-verify] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
