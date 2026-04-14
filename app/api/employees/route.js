import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, employees: data || [] });
}

export async function POST(request) {
  const body = await request.json();
  const { action, ...fields } = body;

  if (action === 'add') {
    const sal = parseFloat(fields.salary || fields.base_salary || 0);
    const maxAdv = Math.round(sal * 0.3);
    const reqAdv = parseFloat(fields.advance_limit || maxAdv);
    if (reqAdv > maxAdv) {
      return NextResponse.json({ success: false, error: `Advance limit salary ki 30% se zyada nahi ho sakti. Max: Rs ${maxAdv}` }, { status: 400 });
    }
    const { data, error } = await supabase.from('employees').insert({
      name: fields.name,
      role: fields.role,
      phone: fields.phone || '',
      salary: sal,
      base_salary: sal,
      advance_limit: parseFloat(fields.advance_limit || Math.round(sal * 0.3)),
      designation: fields.designation || '',
      cnic: fields.cnic || '',
      office_start: fields.office_start || '11:00:00',
      office_end: fields.office_end || '21:00:00',
      time_bonus_amount: parseInt(fields.time_bonus_amount || 0),
      yearly_leaves_allowed: parseInt(fields.yearly_leaves_allowed || 14),
      leaves_opening_used: parseInt(fields.leaves_opening_used || 0),
      join_date: fields.join_date || new Date().toISOString().split('T')[0],
      status: 'active',
      notes: fields.notes || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select().single();
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, employee: data });
  }

  if (action === 'update') {
    const sal = parseFloat(fields.salary || fields.base_salary || 0);
    const { error } = await supabase.from('employees').update({
      name: fields.name,
      role: fields.role,
      phone: fields.phone,
      salary: sal,
      base_salary: sal,
      advance_limit: parseFloat(fields.advance_limit || Math.round(sal * 0.3)),
      designation: fields.designation || '',
      cnic: fields.cnic || '',
      office_start: fields.office_start || '11:00:00',
      office_end: fields.office_end || '21:00:00',
      time_bonus_amount: parseInt(fields.time_bonus_amount || 0),
      yearly_leaves_allowed: parseInt(fields.yearly_leaves_allowed || 14),
      leaves_opening_used: parseInt(fields.leaves_opening_used || 0),
      status: fields.status,
      notes: fields.notes,
      updated_at: new Date().toISOString(),
    }).eq('id', fields.id);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === 'delete') {
    const { error } = await supabase.from('employees').delete().eq('id', fields.id);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === 'add_salary') {
    const { error } = await supabase.from('salary_payments').insert({
      employee_id: fields.employee_id,
      amount: parseFloat(fields.amount),
      month: fields.month,
      payment_date: fields.payment_date || new Date().toISOString().split('T')[0],
      notes: fields.notes || '',
      created_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === 'get_salary') {
    const { data } = await supabase.from('salary_payments')
      .select('*')
      .eq('employee_id', fields.employee_id)
      .order('payment_date', { ascending: false });
    return NextResponse.json({ success: true, payments: data || [] });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
}
