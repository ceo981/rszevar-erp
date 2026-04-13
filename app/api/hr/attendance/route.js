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

  let query = supabase.from('employee_attendance').select('*').order('date', { ascending: false });

  if (employee_id) query = query.eq('employee_id', employee_id);
  if (month) {
    const start = `${month}-01`;
    const end = `${month}-31`;
    query = query.gte('date', start).lte('date', end);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[attendance GET] error:', error.message);
    return NextResponse.json({ success: false, error: error.message });
  }
  return NextResponse.json({ success: true, attendance: data || [], count: (data||[]).length });
}

export async function POST(request) {
  const body = await request.json();
  const { action } = body;

  // Manual single entry
  if (action === 'add') {
    const { employee_id, date, status, time_in, time_out, notes } = body;

    // Get employee details (office timings + yearly leaves)
    const { data: emp } = await supabase.from('employees')
      .select('office_start, yearly_leaves_allowed')
      .eq('id', employee_id).single();

    // Get HR policy grace period
    const { data: policyRows } = await supabase.from('hr_settings').select('key, value');
    const getPol = (k, d) => { const r = (policyRows||[]).find(x=>x.key===k); return r ? parseFloat(r.value) : d; };
    const graceMinutes = getPol('grace_minutes', 30);
    const officeStart = emp?.office_start || '11:00';

    // Auto-detect late from time_in (system does this, HR doesn't manually set "Late")
    let late_minutes = 0;
    let final_status = status;
    if (status === 'present' && time_in) {
      const [sh, sm] = officeStart.split(':').map(Number);
      const [th, tm] = time_in.split(':').map(Number);
      const deadlineMins = sh * 60 + sm + graceMinutes;
      const actualMins   = th * 60 + tm;
      late_minutes = Math.max(0, actualMins - deadlineMins);
      // System auto-marks as 'late' internally if late_minutes > 0
      if (late_minutes > 0) final_status = 'late';
    }

    // 'leave' status = annual leave (planned)
    if (status === 'leave') {
      final_status = 'absent';
    }

    // Yearly leaves logic for absent/leave
    let leave_type = null;
    let yearly_leaves_info = null;
    if (status === 'absent' || status === 'leave') {
      const yearStart = date.slice(0, 4) + '-01-01';
      const yearEnd   = date.slice(0, 4) + '-12-31';
      const { count: usedLeaves } = await supabase
        .from('employee_attendance')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', employee_id)
        .eq('leave_type', 'annual_leave')
        .gte('date', yearStart)
        .lte('date', yearEnd);

      const allowed = emp?.yearly_leaves_allowed || 14;
      const used    = usedLeaves || 0;
      const remaining = allowed - used;

      if (remaining > 0) {
        leave_type = 'annual_leave'; // free — no salary cut
      } else {
        leave_type = 'unpaid';       // salary cut hogi
      }
      yearly_leaves_info = { allowed, used, remaining: Math.max(0, remaining - 1) };
    }

    const { data, error } = await supabase.from('employee_attendance').upsert({
      employee_id,
      date,
      status: final_status,
      time_in: time_in || null,
      time_out: time_out || null,
      late_minutes,
      leave_type,
      notes: notes || '',
      source: 'manual',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,date' }).select().single();

    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, record: data, yearly_leaves_info });
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

  if (action === 'update') {
    const { id, status, time_in, time_out, notes } = body;

    // Get employee for recalculating late_minutes
    const { data: rec } = await supabase.from('employee_attendance').select('employee_id').eq('id', id).single();
    const { data: emp } = rec ? await supabase.from('employees').select('office_start').eq('id', rec.employee_id).single() : { data: null };
    const { data: policyRows } = await supabase.from('hr_settings').select('key, value');
    const getPol = (k, d) => { const r = (policyRows||[]).find(x=>x.key===k); return r ? parseFloat(r.value) : d; };
    const graceMinutes = getPol('grace_minutes', 30);
    const officeStart = emp?.office_start || '11:00';

    let late_minutes = 0;
    let final_status = status;
    if (status === 'present' && time_in) {
      const [sh, sm] = officeStart.split(':').map(Number);
      const [th, tm] = time_in.split(':').map(Number);
      const deadlineMins = sh * 60 + sm + graceMinutes;
      const actualMins = th * 60 + tm;
      late_minutes = Math.max(0, actualMins - deadlineMins);
      if (late_minutes > 0) final_status = 'late';
    }

    const { error } = await supabase.from('employee_attendance').update({
      status: final_status,
      time_in: time_in || null,
      time_out: time_out || null,
      late_minutes,
      notes: notes || '',
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true });
  }

  if (action === 'delete') {
    await supabase.from('employee_attendance').delete().eq('id', body.id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' });
}
