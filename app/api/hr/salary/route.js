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

    // 1. Get employee details
    const { data: emp } = await supabase.from('employees')
      .select('*').eq('id', employee_id).single();
    if (!emp) return NextResponse.json({ success: false, error: 'Employee not found' });

    // 2. Get HR settings
    const { data: settings } = await supabase.from('hr_settings').select('*');
    const getSetting = (key, def) => {
      const s = (settings || []).find(s => s.key === key);
      return s ? parseFloat(s.value) : def;
    };
    const workingDaysPerMonth  = getSetting('working_days_per_month', 26);
    const overtimeMultiplier   = getSetting('overtime_rate_multiplier', 1.5);
    const lateDeductPerMinute  = getSetting('late_deduction_per_minute', 1);
    const maxLatesAllowed      = getSetting('max_lates_allowed', 6);
    const maxHalfDaysAllowed   = getSetting('max_half_days_allowed', 3);
    const timeBonusAmount      = getSetting('time_bonus_amount', 500);
    const leaderboardBonus     = getSetting('leaderboard_bonus', 3000);

    // 3. Get attendance summary
    const start = `${month}-01`;
    const end = `${month}-31`;
    const { data: attendance } = await supabase.from('employee_attendance')
      .select('status, late_minutes')
      .eq('employee_id', employee_id)
      .gte('date', start).lte('date', end);

    const attData = attendance || [];
    const present = attData.filter(a => a.status === 'present' || a.status === 'late').length;
    const absent = attData.filter(a => a.status === 'absent').length;
    const late = attData.filter(a => a.status === 'late').length;
    const halfDay = attData.filter(a => a.status === 'half_day').length;
    const totalLateMinutes = attData.reduce((s, a) => s + (a.late_minutes || 0), 0);

    // 4. Get overtime
    const { data: overtimeData } = await supabase.from('employee_overtime')
      .select('hours')
      .eq('employee_id', employee_id)
      .gte('date', start).lte('date', end);
    const totalOvertimeHours = (overtimeData || []).reduce((s, o) => s + Number(o.hours), 0);

    // 5. Get advances to deduct this month
    const { data: advances } = await supabase.from('employee_advances')
      .select('amount, id')
      .eq('employee_id', employee_id)
      .eq('deduct_month', month)
      .eq('status', 'pending');
    const advanceDeduction = (advances || []).reduce((s, a) => s + Number(a.amount), 0);

    // 6. Get unpaid leaves
    const { data: leaves } = await supabase.from('employee_leaves')
      .select('days')
      .eq('employee_id', employee_id)
      .eq('leave_type', 'unpaid')
      .gte('start_date', start).lte('end_date', end);
    const unpaidLeaveDays = (leaves || []).reduce((s, l) => s + Number(l.days), 0);

    // 7. Salary Calculation
    const baseSalary = Number(emp.base_salary || emp.salary || 0);
    const perDayRate = baseSalary / workingDaysPerMonth;
    const perHourRate = perDayRate / 8;

    const overtimePay = Math.round(totalOvertimeHours * perHourRate * overtimeMultiplier);
    const lateDeduction = Math.round(totalLateMinutes * lateDeductPerMinute);
    const absentDeduction = Math.round(absent * perDayRate);
    const halfDayDeduction = Math.round(halfDay * perDayRate * 0.5);
    const unpaidLeaveDeduction = Math.round(unpaidLeaveDays * perDayRate);

    // Time Bonus: agar late_days <= max_lates_allowed to bonus milega
    const earnedTimeBonus = late <= maxLatesAllowed ? timeBonusAmount : 0;

    // Leaderboard Bonus: check if this employee is top packer this month
    let earnedLeaderboardBonus = 0;
    try {
      const { data: packingLogs } = await supabase
        .from('packing_log')
        .select('employee_id, items_packed')
        .gte('completed_at', `${month}-01`)
        .lte('completed_at', `${month}-31T23:59:59`);

      if (packingLogs?.length > 0) {
        const packMap = {};
        for (const log of packingLogs) {
          packMap[log.employee_id] = (packMap[log.employee_id] || 0) + (log.items_packed || 0);
        }
        const sorted = Object.entries(packMap).sort((a, b) => b[1] - a[1]);
        if (sorted[0] && Number(sorted[0][0]) === Number(employee_id) && sorted[0][1] > 0) {
          earnedLeaderboardBonus = leaderboardBonus;
        }
      }
    } catch {}

    const totalBonus = Number(body.bonus || 0) + earnedTimeBonus + earnedLeaderboardBonus;

    const netSalary = Math.max(0,
      baseSalary
      + overtimePay
      + totalBonus
      - lateDeduction
      - absentDeduction
      - halfDayDeduction
      - advanceDeduction
      - unpaidLeaveDeduction
    );

    const calculation = {
      employee_id,
      month,
      base_salary: baseSalary,
      working_days: workingDaysPerMonth,
      present_days: present,
      absent_days: absent,
      late_days: late,
      half_days: halfDay,
      max_lates_allowed: maxLatesAllowed,
      max_half_days_allowed: maxHalfDaysAllowed,
      overtime_hours: totalOvertimeHours,
      overtime_pay: overtimePay,
      bonus: totalBonus,
      manual_bonus: Number(body.bonus || 0),
      time_bonus: earnedTimeBonus,
      leaderboard_bonus: earnedLeaderboardBonus,
      late_deduction: lateDeduction,
      absent_deduction: absentDeduction + halfDayDeduction,
      advance_deduction: advanceDeduction,
      unpaid_leave_deduction: unpaidLeaveDeduction,
      net_salary: netSalary,
      status: 'draft',
    };

    return NextResponse.json({ success: true, calculation, advance_ids: (advances || []).map(a => a.id) });
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
