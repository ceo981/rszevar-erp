import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_STATUSES = ['pending', 'confirmed', 'on_packing', 'processing', 'packed', 'dispatched', 'delivered', 'cancelled', 'rto', 'attempted', 'hold'];

export async function POST(request) {
  try {
    const { order_id, status, notes, performed_by, performed_by_email } = await request.json();
    if (!order_id || !status) return NextResponse.json({ success: false, error: 'order_id and status required' }, { status: 400 });
    if (!VALID_STATUSES.includes(status)) return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });

    await supabase.from('orders').update({
      status,
      updated_at: new Date().toISOString(),
    }).eq('id', order_id);

    await supabase.from('order_activity_log').insert({
      order_id,
      action: `status_changed_to_${status}`,
      notes: notes || '',
      performed_by: performed_by || 'Staff',
      performed_by_email: performed_by_email || null,
      performed_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
