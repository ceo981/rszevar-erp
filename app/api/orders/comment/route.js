// ============================================================================
// RS ZEVAR ERP — Staff Comments on Orders
// POST   /api/orders/comment            — add comment
// GET    /api/orders/comment?order_id=X — fetch timeline
// PATCH  /api/orders/comment            — edit own comment (Apr 2026)
// DELETE /api/orders/comment            — delete own comment (Apr 2026)
// ----------------------------------------------------------------------------
// Staff comments sirf ERP timeline mein save hote hain (order_activity_log).
// Shopify sync nahi hota — Shopify ka timeline-comment API public nahi hai,
// aur Notes card mein clutter se bachne ke liye ERP-only rakha hai.
// Sirf asli business events (cancel, address edit, fulfill) Shopify pe jaate
// hain — wo respective routes (cancel, edit) se handle hota hai.
//
// Apr 2026 — Edit/Delete added with strict ownership rule:
//   - Staff sirf APNE comments edit/delete kar sakte hain
//   - Match: performed_by_email === requester's email
//   - Non-comment actions (auto-confirm, dispatched, etc.) protected — kabhi
//     edit/delete nahi ho sakte
//   - Edit pe `edited_at` timestamp set hota hai → UI mein "(edited)" badge
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { order_id, comment, staff_name, staff_email } = await request.json();
    if (!order_id || !comment?.trim()) {
      return NextResponse.json({ success: false, error: 'order_id aur comment zaroori hai' }, { status: 400 });
    }

    const { error } = await supabase.from('order_activity_log').insert({
      order_id,
      action: 'staff_comment',
      notes: comment.trim(),
      performed_by: staff_name || staff_email || 'Staff',
      performed_by_email: staff_email || null,
      performed_at: new Date().toISOString(),
    });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const order_id = searchParams.get('order_id');
  if (!order_id) return NextResponse.json({ log: [] });

  const { data } = await supabase
    .from('order_activity_log')
    .select('*')
    .eq('order_id', order_id)
    .order('performed_at', { ascending: false });

  return NextResponse.json({ log: data || [] });
}

// Apr 2026 — Edit own comment.
// Body: { id, comment, staff_email }
// Verify: row exists, is a staff_comment, requester is the owner (by email).
export async function PATCH(request) {
  try {
    const { id, comment, staff_email } = await request.json();
    if (!id) {
      return NextResponse.json({ success: false, error: 'id zaroori hai' }, { status: 400 });
    }
    if (!comment?.trim()) {
      return NextResponse.json({ success: false, error: 'Comment khali nahi ho sakti' }, { status: 400 });
    }
    if (!staff_email) {
      return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
    }

    // Ownership check
    const { data: existing, error: fetchErr } = await supabase
      .from('order_activity_log')
      .select('id, action, performed_by_email')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Comment nahi mili' }, { status: 404 });
    }
    if (existing.action !== 'staff_comment') {
      return NextResponse.json({ success: false, error: 'Yeh staff comment nahi hai — edit nahi ho sakti' }, { status: 403 });
    }
    if (!existing.performed_by_email || existing.performed_by_email !== staff_email) {
      return NextResponse.json({ success: false, error: 'Sirf apne comments edit kar sakte ho' }, { status: 403 });
    }

    const { error: updateErr } = await supabase
      .from('order_activity_log')
      .update({
        notes: comment.trim(),
        edited_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// Apr 2026 — Delete own comment.
// Body: { id, staff_email }
export async function DELETE(request) {
  try {
    const { id, staff_email } = await request.json();
    if (!id) {
      return NextResponse.json({ success: false, error: 'id zaroori hai' }, { status: 400 });
    }
    if (!staff_email) {
      return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
    }

    // Ownership check
    const { data: existing, error: fetchErr } = await supabase
      .from('order_activity_log')
      .select('id, action, performed_by_email')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Comment nahi mili' }, { status: 404 });
    }
    if (existing.action !== 'staff_comment') {
      return NextResponse.json({ success: false, error: 'Yeh staff comment nahi hai — delete nahi ho sakti' }, { status: 403 });
    }
    if (!existing.performed_by_email || existing.performed_by_email !== staff_email) {
      return NextResponse.json({ success: false, error: 'Sirf apne comments delete kar sakte ho' }, { status: 403 });
    }

    const { error: delErr } = await supabase
      .from('order_activity_log')
      .delete()
      .eq('id', id);

    if (delErr) throw delErr;

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
