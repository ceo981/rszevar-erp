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

  let query = supabase.from('salary_records')
    .select('*, employees(name, role, designation)')
    .order('month', { ascending: false });

  if (employee_id) query = query.eq('employee_id', employee_id);
  if (month) query = query.eq('month', month);

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message });
  return NextResponse.json({ success: true, records: data || [] });
}

export async function POST(request) {
  const body = await request.json();
  const { action } = body;

  // ── Calculate salary for one employee for a month ──
  if (action === 'calculate') {
    const { employee_id, month } = body;

    // 1. Get employee
    const { data: emp } = await supabase.from('employees').select('*').eq('id', employee_id).single();
    if (!emp) return NextResponse.json({ success: false, error: 'Employee not found' });

    // 2. Get HR policy settings
    const { data: settings } = await supabase.from('hr_settings').select('*');
    const getSetting = (key, def) => { const s = (settings||[]).find(s=>s.key===key); return s ? parseFloat(s.value) : def; };
    const graceMinutes         = getSetting('grace_minutes', 30);
    const maxLatesAllowed      = getSetting('max_lates_allowed', 6);
    const maxHalfDaysAllowed   = getSetting('max_half_days_allowed', 3);
    const leaderboardBonus     = getSetting('leaderboard_bonus', 3000);
    // time_bonus_amount is now PER EMPLOYEE (from employees table)
    const timeBonusAmount      = emp.time_bonus_amount || 0;

    // 3. Salary base (always 30 days, 10 hours/day)
    const baseSalary  = Number(emp.base_salary || emp.salary || 0);
    const perDay      = baseSalary / 30;
    const perHour     = perDay / 10;

    // 4. Get all attendance records for month
    const start = `${month}-01`;
    const [_y, _m] = month.split('-').map(Number); const _lastDay = new Date(_y, _m, 0).getDate(); const end = `${month}-${String(_lastDay).padStart(2, '0')}`;
    const { data: attRecords } = await supabase
      .from('employee_attendance')
      .select('status, late_minutes, leave_type, date')
      .eq('employee_id', employee_id)
      .gte('date', start).lte('date', end)
      .order('date', { ascending: true });

    const att = attRecords || [];

    // Categorize
    const lateRecords    = att.filter(a => a.status === 'late');
    const halfDayRecords = att.filter(a => a.status === 'half_day');
    const unpaidAbsents  = att.filter(a => a.status === 'absent' && a.leave_type === 'unpaid');
    const annualLeaves   = att.filter(a => a.status === 'absent' && a.leave_type === 'annual_leave');

    const present   = att.filter(a => a.status === 'present' || a.status === 'late').length;
    const late      = lateRecords.length;
    const halfDay   = halfDayRecords.length;
    const absent    = att.filter(a => a.status === 'absent').length;

    // 5. Late deduction — free passes apply to lates + half_days combined
    // Sort late records by late_minutes DESC (worst offenses first for deduction)
    const allLateOccasions = [
      ...lateRecords.map(r => ({ type: 'late', minutes: r.late_minutes || 0 })),
      ...halfDayRecords.map(r => ({ type: 'half_day', minutes: 0 })),
    ].sort((a, b) => b.minutes - a.minutes);

    const totalOccasions = allLateOccasions.length;
    const freePasses     = maxLatesAllowed + maxHalfDaysAllowed;
    const excessCount    = Math.max(0, totalOccasions - freePasses);

    // Deduct the worst `excessCount` occasions
    const toDeduct = allLateOccasions.slice(0, excessCount);
    let lateDeduction = 0;
    for (const occ of toDeduct) {
      if (occ.type === 'half_day') {
        lateDeduction += perDay * 0.5;
      } else {
        // Convert late_minutes to hours, deduct per hour
        const hoursLate = occ.minutes / 60;
        lateDeduction += hoursLate * perHour;
      }
    }
    lateDeduction = Math.round(lateDeduction);

    // 6. Absent deduction (only unpaid absents, not annual leaves)
    const absentDeduction = Math.round(unpaidAbsents.length * perDay);

    // 7. Overtime
    const { data: overtimeData } = await supabase.from('employee_overtime')
      .select('hours').eq('employee_id', employee_id).gte('date', start).lte('date', end);
    const totalOvertimeHours = (overtimeData||[]).reduce((s,o)=>s+Number(o.hours),0);
    const overtimePay = Math.round(totalOvertimeHours * perHour * getSetting('overtime_rate_multiplier', 1.5));

    // 8. Advances
    const { data: advances } = await supabase.from('employee_advances')
      .select('amount, id').eq('employee_id', employee_id)
      .eq('deduct_month', month).eq('status', 'pending');
    const advanceDeduction = (advances||[]).reduce((s,a)=>s+Number(a.amount),0);

    // 9. Time Bonus — if total late occasions within free passes
    const earnedTimeBonus = totalOccasions <= freePasses ? timeBonusAmount : 0;

    // 10. Leaderboard Bonus
    let earnedLeaderboardBonus = 0;
    try {
      const { data: packingLogs } = await supabase.from('packing_log')
        .select('employee_id, items_packed')
        .gte('completed_at', `${month}-01`).lte('completed_at', `${month}-31T23:59:59`);
      if (packingLogs?.length > 0) {
        const packMap = {};
        for (const log of packingLogs) packMap[log.employee_id] = (packMap[log.employee_id]||0) + (log.items_packed||0);
        const sorted = Object.entries(packMap).sort((a,b)=>b[1]-a[1]);
        if (sorted[0] && Number(sorted[0][0]) === Number(employee_id) && sorted[0][1] > 0)
          earnedLeaderboardBonus = leaderboardBonus;
      }
    } catch {}

    const totalBonus = Number(body.bonus||0) + earnedTimeBonus + earnedLeaderboardBonus;

    const netSalary = Math.max(0,
      baseSalary + overtimePay + totalBonus
      - lateDeduction - absentDeduction - advanceDeduction
    );

    // Yearly leaves used this year
    const yearStart = month.slice(0,4) + '-01-01';
    const yearEnd   = month.slice(0,4) + '-12-31';
    const { count: yearlyLeavesUsed } = await supabase.from('employee_attendance')
      .select('*', { count: 'exact', head: true })
      .eq('employee_id', employee_id).eq('leave_type', 'annual_leave')
      .gte('date', yearStart).lte('date', yearEnd);

    const calculation = {
      employee_id, month,
      base_salary: baseSalary,
      per_day: Math.round(perDay),
      per_hour: Math.round(perHour),
      present_days: present,
      absent_days: absent,
      late_days: late,
      half_days: halfDay,
      annual_leaves_used: yearlyLeavesUsed || 0,
      yearly_leaves_allowed: emp.yearly_leaves_allowed || 14,
      unpaid_absents: unpaidAbsents.length,
      total_late_occasions: totalOccasions,
      free_passes: freePasses,
      excess_deducted: excessCount,
      overtime_hours: totalOvertimeHours,
      overtime_pay: overtimePay,
      bonus: totalBonus,
      manual_bonus: Number(body.bonus||0),
      time_bonus: earnedTimeBonus,
      leaderboard_bonus: earnedLeaderboardBonus,
      late_deduction: lateDeduction,
      absent_deduction: absentDeduction,
      advance_deduction: advanceDeduction,
      net_salary: netSalary,
      status: 'draft',
    };

    return NextResponse.json({ success: true, calculation, advance_ids: (advances||[]).map(a=>a.id) });
  }

  // ── Save / Finalize salary ──
  if (action === 'save') {
    const { calculation, advance_ids } = body;

    const { data, error } = await supabase.from('salary_records').upsert({
      ...calculation,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,month' }).select().single();

    if (error) return NextResponse.json({ success: false, error: error.message });

    // Mark advances as deducted
    if (advance_ids?.length) {
      await supabase.from('employee_advances')
        .update({ status: 'deducted', updated_at: new Date().toISOString() })
        .in('id', advance_ids);
    }

    return NextResponse.json({ success: true, record: data });
  }

  // ── Mark as paid ──
  if (action === 'mark_paid') {
    const { error } = await supabase.from('salary_records').update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    }).eq('id', body.id);
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true });
  }

  // ── Calculate all employees for a month ──
  if (action === 'calculate_all') {
    const { month } = body;
    const { data: employees } = await supabase.from('employees').select('id').eq('status', 'active');
    return NextResponse.json({ success: true, employee_ids: (employees || []).map(e => e.id), month });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' });
}
