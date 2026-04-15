// ============================================================================
// RS ZEVAR ERP — Staff Comments on Orders
// POST /api/orders/comment  { order_id, comment, staff_name }
// GET  /api/orders/comment?order_id=XXX  → all activity + comments
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
    .order('performed_at', { ascending: true });

  return NextResponse.json({ log: data || [] });
}
