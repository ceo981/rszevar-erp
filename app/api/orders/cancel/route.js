import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { order_id, reason } = await request.json();
    if (!order_id) return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });

    await supabase.from('orders').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason || '',
      updated_at: new Date().toISOString(),
    }).eq('id', order_id);

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'cancelled',
      notes: reason || '',
      performed_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
