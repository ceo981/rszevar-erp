import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_STATUSES = ['pending', 'confirmed', 'processing', 'packed', 'dispatched', 'delivered', 'cancelled', 'rto', 'attempted', 'hold'];

export async function POST(request) {
  try {
    const { order_id, status, notes } = await request.json();
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
      performed_at: new Date().toISOString(),
    });

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
