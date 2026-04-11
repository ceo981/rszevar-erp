import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const employee_id = searchParams.get('employee_id');
  const month = searchParams.get('month'); // YYYY-MM

  let query = supabase.from('employee_attendance').select('*, employees(name, role)').order('date', { ascending: false });

  if (employee_id) query = query.eq('employee_id', employee_id);
  if (month) {
    const start = `${month}-01`;
    const end = `${month}-31`;
    query = query.gte('date', start).lte('date', end);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message });
  return NextResponse.json({ success: true, attendance: data || [] });
}

export async function POST(request) {
  const body = await request.json();
  const { action } = body;

  // Manual single entry
  if (action === 'add') {
    const { employee_id, date, status, time_in, time_out, notes } = body;

    // Calculate late minutes
    let late_minutes = 0;
    if (status === 'present' || status === 'late') {
      const { data: emp } = await supabase.from('employees').select('office_start, late_tolerance').eq('id', employee_id).single();
      if (emp && time_in) {
        const [sh, sm] = (emp.office_start || '09:00').split(':').map(Number);
        const [th, tm] = time_in.split(':').map(Number);
        const scheduledMins = sh * 60 + sm + (emp.late_tolerance || 15);
        const actualMins = th * 60 + tm;
        late_minutes = Math.max(0, actualMins - scheduledMins);
      }
    }

    const { data, error } = await supabase.from('employee_attendance').upsert({
      employee_id,
      date,
      status,
      time_in: time_in || null,
      time_out: time_out || null,
      late_minutes,
      notes: notes || '',
      source: 'manual',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,date' }).select().single();

    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, record: data });
  }

  // Bulk manual entry for a day
  if (action === 'bulk_add') {
    const { records } = body; // array of {employee_id, date, status, time_in, time_out}
    const toInsert = records.map(r => ({
      employee_id: r.employee_id,
      date: r.date,
      status: r.status || 'present',
      time_in: r.time_in || null,
      time_out: r.time_out || null,
      late_minutes: 0,
      source: 'manual',
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase.from('employee_attendance').upsert(toInsert, { onConflict: 'employee_id,date' });
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true });
  }

  // Monthly summary for salary calculation
  if (action === 'monthly_summary') {
    const { employee_id, month } = body;
    const start = `${month}-01`;
    const end = `${month}-31`;

    const { data: records } = await supabase.from('employee_attendance')
      .select('status, late_minutes')
      .eq('employee_id', employee_id)
      .gte('date', start)
      .lte('date', end);

    const summary = {
      present: 0, absent: 0, late: 0, half_day: 0,
      total_late_minutes: 0,
    };

    (records || []).forEach(r => {
      if (r.status === 'present') summary.present++;
      else if (r.status === 'absent') summary.absent++;
      else if (r.status === 'late') { summary.late++; summary.present++; }
      else if (r.status === 'half_day') summary.half_day++;
      summary.total_late_minutes += (r.late_minutes || 0);
    });

    return NextResponse.json({ success: true, summary });
  }

  if (action === 'delete') {
    await supabase.from('employee_attendance').delete().eq('id', body.id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' });
}
