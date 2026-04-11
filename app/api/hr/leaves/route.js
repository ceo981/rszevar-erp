import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const employee_id = searchParams.get('employee_id');
  const action = searchParams.get('action');

  // Get holidays
  if (action === 'holidays') {
    const { data } = await supabase.from('holiday_calendar').select('*').order('date');
    return NextResponse.json({ success: true, holidays: data || [] });
  }

  // Get leave balance
  if (action === 'balance') {
    let query = supabase.from('employee_leave_balance').select('*, employees(name)');
    if (employee_id) query = query.eq('employee_id', employee_id);
    const { data } = await query;
    return NextResponse.json({ success: true, balances: data || [] });
  }

  // Get leaves list
  let query = supabase.from('employee_leaves')
    .select('*, employees(name, role)')
    .order('start_date', { ascending: false });
  if (employee_id) query = query.eq('employee_id', employee_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message });
  return NextResponse.json({ success: true, leaves: data || [] });
}

export async function POST(request) {
  const body = await request.json();
  const { action } = body;

  if (action === 'add_leave') {
    const { employee_id, leave_type, start_date, end_date, days, reason, approved_by } = body;

    // Insert leave record
    const { data, error } = await supabase.from('employee_leaves').insert({
      employee_id,
      leave_type,
      start_date,
      end_date,
      days: parseInt(days) || 1,
      reason: reason || '',
      status: 'approved',
      approved_by: approved_by || '',
    }).select().single();

    if (error) return NextResponse.json({ success: false, error: error.message });

    // Update leave balance
    if (leave_type === 'casual' || leave_type === 'sick') {
      const col = leave_type === 'casual' ? 'casual_used' : 'sick_used';

      // Upsert balance record
      const { data: existing } = await supabase.from('employee_leave_balance')
        .select('id, casual_used, sick_used')
        .eq('employee_id', employee_id)
        .single();

      if (existing) {
        await supabase.from('employee_leave_balance').update({
          [col]: (existing[col] || 0) + parseInt(days),
          updated_at: new Date().toISOString(),
        }).eq('employee_id', employee_id);
      } else {
        await supabase.from('employee_leave_balance').insert({
          employee_id,
          casual_used: leave_type === 'casual' ? parseInt(days) : 0,
          sick_used: leave_type === 'sick' ? parseInt(days) : 0,
        });
      }
    }

    return NextResponse.json({ success: true, leave: data });
  }

  if (action === 'add_holiday') {
    const { title, date, type } = body;
    const { error } = await supabase.from('holiday_calendar').upsert({ title, date, type: type || 'public' }, { onConflict: 'date' });
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true });
  }

  if (action === 'delete_leave') {
    await supabase.from('employee_leaves').delete().eq('id', body.id);
    return NextResponse.json({ success: true });
  }

  if (action === 'delete_holiday') {
    await supabase.from('holiday_calendar').delete().eq('id', body.id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' });
}
