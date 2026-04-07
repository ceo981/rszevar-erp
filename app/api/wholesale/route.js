import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'buyers';

  if (type === 'buyers') {
    const { data } = await supabase.from('wholesale_buyers').select('*').order('created_at', { ascending: false });
    return NextResponse.json({ success: true, buyers: data || [] });
  }

  if (type === 'orders') {
    const { data } = await supabase.from('wholesale_orders').select('*, wholesale_buyers(name, city, phone)').order('created_at', { ascending: false });
    return NextResponse.json({ success: true, orders: data || [] });
  }

  if (type === 'stats') {
    const { data: orders } = await supabase.from('wholesale_orders').select('total_amount, status, paid_amount');
    const all = orders || [];
    return NextResponse.json({
      success: true,
      stats: {
        total_orders: all.length,
        total_value: all.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0),
        total_paid: all.reduce((s, o) => s + parseFloat(o.paid_amount || 0), 0),
        pending_payment: all.reduce((s, o) => s + (parseFloat(o.total_amount || 0) - parseFloat(o.paid_amount || 0)), 0),
        delivered: all.filter(o => o.status === 'delivered').length,
        pending: all.filter(o => o.status === 'pending').length,
      }
    });
  }

  return NextResponse.json({ success: false, error: 'Unknown type' });
}

export async function POST(request) {
  const body = await request.json();
  const { action } = body;

  if (action === 'add_buyer') {
    const { data, error } = await supabase.from('wholesale_buyers').insert({
      name: body.name,
      business_name: body.business_name || '',
      phone: body.phone || '',
      city: body.city || '',
      discount_pct: parseFloat(body.discount_pct || 0),
      credit_limit: parseFloat(body.credit_limit || 0),
      notes: body.notes || '',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select().single();
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, buyer: data });
  }

  if (action === 'update_buyer') {
    const { error } = await supabase.from('wholesale_buyers').update({
      name: body.name,
      business_name: body.business_name,
      phone: body.phone,
      city: body.city,
      discount_pct: parseFloat(body.discount_pct || 0),
      credit_limit: parseFloat(body.credit_limit || 0),
      notes: body.notes,
      status: body.status,
      updated_at: new Date().toISOString(),
    }).eq('id', body.id);
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true });
  }

  if (action === 'delete_buyer') {
    await supabase.from('wholesale_buyers').delete().eq('id', body.id);
    return NextResponse.json({ success: true });
  }

  if (action === 'add_order') {
    const { data, error } = await supabase.from('wholesale_orders').insert({
      buyer_id: body.buyer_id,
      items: JSON.stringify(body.items || []),
      total_amount: parseFloat(body.total_amount || 0),
      paid_amount: parseFloat(body.paid_amount || 0),
      discount_pct: parseFloat(body.discount_pct || 0),
      status: 'pending',
      notes: body.notes || '',
      order_date: body.order_date || new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select().single();
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, order: data });
  }

  if (action === 'update_order') {
    const { error } = await supabase.from('wholesale_orders').update({
      status: body.status,
      paid_amount: parseFloat(body.paid_amount || 0),
      notes: body.notes,
      updated_at: new Date().toISOString(),
    }).eq('id', body.id);
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true });
  }

  if (action === 'delete_order') {
    await supabase.from('wholesale_orders').delete().eq('id', body.id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' });
}
