import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const courier = searchParams.get('courier');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '30');
    const offset = (page - 1) * limit;

    let query = supabase
      .from('courier_bookings')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (courier) query = query.eq('courier_name', courier);
    if (status) query = query.eq('status', status);
    if (search) query = query.or(`order_name.ilike.%${search}%,tracking_number.ilike.%${search}%,customer_name.ilike.%${search}%`);

    const { data, count, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      success: true,
      bookings: data || [],
      total: count || 0,
      page,
      total_pages: Math.ceil((count || 0) / limit),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      order_name, order_id, courier_name, tracking_number,
      customer_name, customer_phone, city, address,
      cod_amount, weight, pieces, status = 'booked', note,
    } = body;

    if (!courier_name || !customer_name || !city) {
      return NextResponse.json({ success: false, error: 'courier_name, customer_name, city required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('courier_bookings')
      .insert([{
        order_name, order_id, courier_name, tracking_number,
        customer_name, customer_phone, city, address,
        cod_amount: parseFloat(cod_amount || 0),
        weight: parseFloat(weight || 0.5),
        pieces: parseInt(pieces || 1),
        status, note,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) throw error;

    // Update order status if order_id given
    if (order_id) {
      await supabase.from('orders').update({
        status: 'dispatched',
        courier_name,
        courier_tracking_number: tracking_number,
      }).eq('id', order_id);
    }

    return NextResponse.json({ success: true, booking: data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    const { data, error } = await supabase
      .from('courier_bookings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, booking: data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    const { error } = await supabase.from('courier_bookings').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
