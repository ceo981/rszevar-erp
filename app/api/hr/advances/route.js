import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const employee_id = searchParams.get('employee_id');

  let query = supabase.from('employee_advances')
    .select('*, employees(name, role, advance_limit)')
    .order('given_date', { ascending: false });

  if (employee_id) query = query.eq('employee_id', employee_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message });

  // Calculate outstanding balance per employee
  const advances = data || [];
  const pendingTotal = advances.filter(a => a.status === 'pending').reduce((s, a) => s + Number(a.amount), 0);

  return NextResponse.json({ success: true, advances, pending_total: pendingTotal });
}

export async function POST(request) {
  const body = await request.json();
  const { action } = body;

  if (action === 'add') {
    const { employee_id, amount, given_by, deduct_month, notes } = body;

    // Check advance limit
    const { data: emp } = await supabase.from('employees').select('advance_limit, name').eq('id', employee_id).single();
    const { data: existing } = await supabase.from('employee_advances')
      .select('amount')
      .eq('employee_id', employee_id)
      .eq('status', 'pending');

    const outstanding = (existing || []).reduce((s, a) => s + Number(a.amount), 0);
    const limit = Number(emp?.advance_limit || 0);

    if (limit > 0 && (outstanding + Number(amount)) > limit) {
      return NextResponse.json({
        success: false,
        error: `Advance limit exceeded! Outstanding: Rs. ${outstanding.toLocaleString()} | Limit: Rs. ${limit.toLocaleString()}`
      });
    }

    const { data, error } = await supabase.from('employee_advances').insert({
      employee_id,
      amount: parseFloat(amount),
      given_date: body.given_date || new Date().toISOString().split('T')[0],
      given_by: given_by || '',
      deduct_month: deduct_month || null,
      status: 'pending',
      notes: notes || '',
    }).select().single();

    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, advance: data });
  }

  if (action === 'mark_deducted') {
    const { error } = await supabase.from('employee_advances').update({
      status: 'deducted',
      updated_at: new Date().toISOString(),
    }).eq('id', body.id);
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true });
  }

  if (action === 'delete') {
    await supabase.from('employee_advances').delete().eq('id', body.id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' });
}
