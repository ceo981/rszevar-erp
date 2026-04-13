import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const employee_id = searchParams.get('employee_id');
  const month = searchParams.get('month');

  let query = supabase.from('employee_overtime')
    .select('*, employees(name, role, base_salary)')
    .order('date', { ascending: false });

  if (employee_id) query = query.eq('employee_id', employee_id);
  if (month) {
    const [_y2, _m2] = month.split('-').map(Number); const _last2 = new Date(_y2, _m2, 0).getDate(); query = query.gte('date', `${month}-01`).lte('date', `${month}-${String(_last2).padStart(2,'0')}`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message });

  const total_hours = (data || []).reduce((s, r) => s + Number(r.hours), 0);
  return NextResponse.json({ success: true, overtime: data || [], total_hours });
}

export async function POST(request) {
  const body = await request.json();
  const { action } = body;

  if (action === 'add') {
    const { employee_id, date, hours, reason, approved_by } = body;
    const { data, error } = await supabase.from('employee_overtime').insert({
      employee_id,
      date,
      hours: parseFloat(hours),
      reason: reason || '',
      approved_by: approved_by || '',
    }).select().single();

    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, record: data });
  }

  if (action === 'delete') {
    await supabase.from('employee_overtime').delete().eq('id', body.id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' });
}
