// ============================================================================
// RS ZEVAR ERP — HR Salary Engine (Apr 30 2026)
// GET  /api/hr/salary?month=YYYY-MM           → list saved records for month
// POST /api/hr/salary  { action, ... }
//   action='calculate'    → preview only, ZERO DB writes
//   action='save'         → upsert as draft (status='draft')
//   action='mark_paid'    → flip draft → paid + lock advances
//   action='revert_paid'  → super_admin only — paid → draft + unlock advances
//   action='delete'       → super_admin only — drop draft (paid not deletable)
// ----------------------------------------------------------------------------
// Pehle is path par sirf hr_settings ka policy upsert handler tha (galti se
// salary route mein duplicate paste ho gaya tha). Ab proper engine hai.
//
// Calculation safety: 'calculate' action **read-only** hai — DB pe kuch
// likhta hi nahi. Staff preview dekh ke decide karega kab save karna hai.
// Save sirf draft banata — paid nahi karta. Mark Paid alag step hai aur
// reversible (super_admin se). Sab actions audit log bhi karte salary_records
// row ke columns mein.
//
// Tables read:
//   employees, employee_attendance, employee_advances, employee_overtime,
//   packing_log, hr_settings
// Tables written:
//   salary_records (insert/update/delete), employee_advances (status flip
//   on mark_paid + revert_paid)
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─── Helpers ───────────────────────────────────────────────────────────────
function daysInMonth(monthStr) {
  // monthStr = 'YYYY-MM'
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function monthRange(monthStr) {
  const last = daysInMonth(monthStr);
  return {
    start: `${monthStr}-01`,
    end:   `${monthStr}-${String(last).padStart(2, '0')}`,
  };
}

async function getPolicy(supabase) {
  const { data } = await supabase.from('hr_settings').select('key, value');
  const map = {};
  for (const row of data || []) map[row.key] = row.value;
  const num = (k, d) => {
    const v = parseFloat(map[k]);
    return Number.isFinite(v) ? v : d;
  };
  return {
    grace_minutes:               num('grace_minutes', 30),
    max_lates_allowed:           num('max_lates_allowed', 6),
    max_half_days_allowed:       num('max_half_days_allowed', 3),
    late_deduction_amount:       num('late_deduction_amount', 100),
    leaderboard_bonus_1st:       num('leaderboard_bonus_1st', num('leaderboard_bonus', 2000)),
    leaderboard_bonus_2nd:       num('leaderboard_bonus_2nd', Math.round(num('leaderboard_bonus', 2000) / 2)),
    overtime_rate_multiplier:    num('overtime_rate_multiplier', 1.5),
    standard_work_hours_per_day: num('standard_work_hours_per_day', 9),
  };
}

async function calculatePayroll(supabase, employee_id, month, manualBonus = 0) {
  const empRes = await supabase
    .from('employees')
    .select('id, name, role, status, base_salary, advance_limit, time_bonus_amount')
    .eq('id', employee_id)
    .single();
  if (empRes.error || !empRes.data) {
    throw new Error(`Employee not found: ${employee_id}`);
  }
  const emp = empRes.data;
  const baseSalary = parseFloat(emp.base_salary) || 0;
  const empTimeBonusAmount = parseFloat(emp.time_bonus_amount) || 0;

  const { start, end } = monthRange(month);
  const totalDays = daysInMonth(month);

  // ── Attendance breakdown ────────────────────────────────────────────────
  const { data: attendance } = await supabase
    .from('employee_attendance')
    .select('date, status')
    .eq('employee_id', employee_id)
    .gte('date', start)
    .lte('date', end);

  const counts = { present: 0, late: 0, absent: 0, leave: 0, half_day: 0 };
  for (const row of attendance || []) {
    const s = String(row.status || '').toLowerCase();
    if (s in counts) counts[s] += 1;
  }
  // Total marked attendance days (used to check if month is fully entered)
  const markedDays = (attendance || []).length;
  const presentDays = counts.present + counts.late;   // Late counts as present for pay
  const absentDays  = counts.absent;
  const lateDays    = counts.late;
  const halfDays    = counts.half_day;
  const leaveDays   = counts.leave;                    // Treated as paid leave

  // ── Policy + per-day rate ───────────────────────────────────────────────
  const policy = await getPolicy(supabase);
  const perDayRate = totalDays > 0 ? baseSalary / totalDays : 0;

  // ── Late deduction (only on lates beyond the allowed buffer) ────────────
  const excessLates = Math.max(0, lateDays - policy.max_lates_allowed);
  const lateDeduction = excessLates * policy.late_deduction_amount;

  // ── Absent deduction ────────────────────────────────────────────────────
  // Full absent: per-day rate × days
  // Half day: per-day rate × 0.5 × half day count (after the allowed buffer)
  const excessHalfDays = Math.max(0, halfDays - policy.max_half_days_allowed);
  const absentDeduction = (absentDays * perDayRate) + (excessHalfDays * perDayRate * 0.5);

  // Unpaid leave deduction — separate column for clarity in slip. For now
  // we treat 'leave' status as paid (yearly_leaves_allowed handles the
  // unpaid case via the attendance route auto-converting excess leaves to
  // 'absent'). So unpaid_leave_deduction stays 0 here.
  const unpaidLeaveDeduction = 0;

  // ── Overtime pay ────────────────────────────────────────────────────────
  const { data: overtimeRows } = await supabase
    .from('employee_overtime')
    .select('hours')
    .eq('employee_id', employee_id)
    .gte('date', start)
    .lte('date', end);
  const overtimeHours = (overtimeRows || []).reduce((s, r) => s + (parseFloat(r.hours) || 0), 0);
  const hourlyRate = (perDayRate / Math.max(1, policy.standard_work_hours_per_day)) * policy.overtime_rate_multiplier;
  const overtimePay = Math.round(overtimeHours * hourlyRate);

  // ── Leaderboard bonus (packing winner / runner-up) ──────────────────────
  // Use packing_log directly so we don't have to call our own /leaderboard
  // route (which has role-based filtering). We need raw amounts here.
  const { data: packLogs } = await supabase
    .from('packing_log')
    .select('employee_id, items_packed, items_amount')
    .gte('completed_at', start)
    .lte('completed_at', end + 'T23:59:59');
  const tally = {};
  for (const log of packLogs || []) {
    const id = log.employee_id;
    if (!tally[id]) tally[id] = { employee_id: id, items: 0, amount: 0 };
    tally[id].items  += log.items_packed || 0;
    tally[id].amount += parseFloat(log.items_amount) || 0;
  }
  const ranked = Object.values(tally).sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount;
    return b.items - a.items;
  });
  let leaderboardBonus = 0;
  let leaderboardRank = null;
  if (ranked[0]?.employee_id === employee_id) {
    leaderboardBonus = policy.leaderboard_bonus_1st;
    leaderboardRank = '1st';
  } else if (ranked[1]?.employee_id === employee_id) {
    leaderboardBonus = policy.leaderboard_bonus_2nd;
    leaderboardRank = '2nd';
  }

  // ── Time bonus (per-employee "good attendance" bonus) ─────────────────────
  // Each employee has their own `time_bonus_amount` set in their profile
  // (HR → Employees → edit). Eligibility rules (per HR policy):
  //   - Lates within max_lates_allowed (no excess)
  //   - Half days within max_half_days_allowed (no excess)
  //   - Zero full absents in the month
  // Agar koi rule break hai to bonus 0 milta — frontend "⚠️ Time Bonus
  // nahi mila — lates/half days rule tooti hai" hint dikhata hai using
  // the time_bonus_eligible flag we return in bonus_breakdown.
  const timeBonusEligible =
    excessLates === 0 &&
    excessHalfDays === 0 &&
    absentDays === 0 &&
    empTimeBonusAmount > 0;
  const timeBonus = timeBonusEligible ? empTimeBonusAmount : 0;

  // ── Bonus breakdown ─────────────────────────────────────────────────────
  const manual = Math.max(0, parseFloat(manualBonus) || 0);
  const totalBonus = leaderboardBonus + timeBonus + manual;
  const bonusBreakdown = {
    leaderboard:          leaderboardBonus,
    leaderboard_rank:     leaderboardRank,
    time_bonus:           timeBonus,
    time_bonus_eligible:  timeBonusEligible,
    time_bonus_configured: empTimeBonusAmount,    // for UI hint when not eligible
    manual:               manual,
  };

  // ── Pending advances (eligible for deduction this month) ────────────────
  // Eligible = status='pending' AND (deduct_month IS NULL OR deduct_month <= this month)
  // The OR null part lets old advances without deduct_month still get deducted.
  const { data: advances } = await supabase
    .from('employee_advances')
    .select('id, amount, deduct_month, given_date, status, notes')
    .eq('employee_id', employee_id)
    .eq('status', 'pending');
  const eligibleAdvances = (advances || []).filter(a => {
    if (!a.deduct_month) return true;
    return String(a.deduct_month) <= month;
  });
  const advanceDeduction = eligibleAdvances.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
  const advanceIds = eligibleAdvances.map(a => a.id);

  // ── Final net ───────────────────────────────────────────────────────────
  const earnings   = baseSalary + overtimePay + totalBonus;
  const deductions = lateDeduction + absentDeduction + unpaidLeaveDeduction + advanceDeduction;
  const netSalary  = Math.round(earnings - deductions);

  return {
    calculation: {
      employee_id,
      employee_name: emp.name,
      month,
      working_days:   totalDays,
      marked_days:    markedDays,
      present_days:   presentDays,
      absent_days:    absentDays,
      late_days:      lateDays,
      half_days:      halfDays,
      leave_days:     leaveDays,
      base_salary:    baseSalary,
      overtime_hours: overtimeHours,
      overtime_pay:   overtimePay,
      bonus:          totalBonus,
      bonus_breakdown: bonusBreakdown,
      late_deduction:        Math.round(lateDeduction),
      absent_deduction:      Math.round(absentDeduction),
      unpaid_leave_deduction: Math.round(unpaidLeaveDeduction),
      advance_deduction:     Math.round(advanceDeduction),
      net_salary:            netSalary,
      // Soft warnings — frontend can choose to show
      warnings: [
        markedDays < (totalDays - 4)
          ? `Sirf ${markedDays}/${totalDays} dinon ki attendance entered hai — incomplete data`
          : null,
        baseSalary <= 0
          ? `Employee ka base_salary 0 hai — pehle profile mein set karo`
          : null,
        netSalary < 0
          ? `Net salary negative aa raha hai (${netSalary}) — verify karo deductions`
          : null,
      ].filter(Boolean),
    },
    advance_ids: advanceIds,
    advance_count: eligibleAdvances.length,
    // Apr 30 2026 — Detailed breakdown of pending advances so the UI can
    // show staff exactly which advances will be deducted on Mark Paid.
    // Save action is informational; actual lock happens at mark_paid.
    advances_detail: eligibleAdvances.map(a => ({
      id: a.id,
      amount: parseFloat(a.amount) || 0,
      given_date: a.given_date,
      deduct_month: a.deduct_month,
      notes: a.notes || '',
    })),
    emp: {
      id: emp.id,
      name: emp.name,
      role: emp.role,
      base_salary: baseSalary,
    },
  };
}

// ─── GET — list records for month ───────────────────────────────────────────
export async function GET(request) {
  const supabase = createServerClient();
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);

  const { data, error } = await supabase
    .from('salary_records')
    .select('*')
    .eq('month', month)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { success: false, error: `salary_records read error: ${error.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true, month, records: data || [] });
}

// ─── POST — actions ────────────────────────────────────────────────────────
export async function POST(request) {
  const supabase = createServerClient();
  try {
    const body = await request.json();
    const { action } = body;

    // ─────────────────────────────────────────────────────────────────────
    //  CALCULATE — pure preview, NO DB writes
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'calculate') {
      const { employee_id, month, bonus } = body;
      if (!employee_id || !month) {
        return NextResponse.json(
          { success: false, error: 'employee_id aur month dono required hain' },
          { status: 400 },
        );
      }
      const result = await calculatePayroll(supabase, employee_id, month, bonus);
      return NextResponse.json({ success: true, ...result });
    }

    // ─────────────────────────────────────────────────────────────────────
    //  SAVE — upsert as draft. Doesn't touch advances yet.
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'save') {
      const { calculation, advance_ids, performed_by } = body;
      if (!calculation || !calculation.employee_id || !calculation.month) {
        return NextResponse.json(
          { success: false, error: 'calculation object incomplete (employee_id + month chahiye)' },
          { status: 400 },
        );
      }

      const performer = performed_by || 'Staff';
      const nowIso = new Date().toISOString();

      // If a non-draft record already exists for this employee+month, refuse.
      // Operator must revert/delete first — guards against silent overwrite of
      // already-paid salaries.
      const existing = await supabase
        .from('salary_records')
        .select('id, status')
        .eq('employee_id', calculation.employee_id)
        .eq('month', calculation.month)
        .maybeSingle();

      if (existing.data && existing.data.status !== 'draft') {
        return NextResponse.json(
          {
            success: false,
            error: `Yeh employee ki ${calculation.month} salary already ${existing.data.status} hai. Pehle revert/delete karo.`,
            existing_id: existing.data.id,
            existing_status: existing.data.status,
          },
          { status: 400 },
        );
      }

      const row = {
        employee_id:            calculation.employee_id,
        month:                  calculation.month,
        working_days:           calculation.working_days,
        present_days:           calculation.present_days,
        absent_days:            calculation.absent_days,
        late_days:              calculation.late_days,
        half_days:              calculation.half_days,
        leave_days:             calculation.leave_days,
        base_salary:            calculation.base_salary,
        overtime_hours:         calculation.overtime_hours,
        overtime_pay:           calculation.overtime_pay,
        bonus:                  calculation.bonus,
        bonus_breakdown:        calculation.bonus_breakdown,
        late_deduction:         calculation.late_deduction,
        absent_deduction:       calculation.absent_deduction,
        unpaid_leave_deduction: calculation.unpaid_leave_deduction,
        advance_deduction:      calculation.advance_deduction,
        advance_ids:            advance_ids || [],
        net_salary:             calculation.net_salary,
        status:                 'draft',
        updated_at:             nowIso,
        updated_by:             performer,
      };

      let saved;
      if (existing.data?.id) {
        const upd = await supabase
          .from('salary_records')
          .update(row)
          .eq('id', existing.data.id)
          .select()
          .single();
        if (upd.error) throw upd.error;
        saved = upd.data;
      } else {
        row.created_at = nowIso;
        row.created_by = performer;
        const ins = await supabase
          .from('salary_records')
          .insert(row)
          .select()
          .single();
        if (ins.error) throw ins.error;
        saved = ins.data;
      }

      return NextResponse.json({ success: true, id: saved.id, status: saved.status });
    }

    // ─────────────────────────────────────────────────────────────────────
    //  MARK PAID — draft → paid + lock advances
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'mark_paid') {
      const { id, performed_by } = body;
      if (!id) {
        return NextResponse.json(
          { success: false, error: 'id required' },
          { status: 400 },
        );
      }
      const performer = performed_by || 'Staff';
      const nowIso = new Date().toISOString();

      const { data: rec, error: fetchErr } = await supabase
        .from('salary_records')
        .select('id, status, advance_ids, employee_id, month, net_salary')
        .eq('id', id)
        .single();
      if (fetchErr || !rec) {
        return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
      }
      if (rec.status === 'paid') {
        return NextResponse.json(
          { success: false, error: 'Yeh salary pehle se paid hai' },
          { status: 400 },
        );
      }

      const { error: updErr } = await supabase
        .from('salary_records')
        .update({
          status:    'paid',
          paid_at:   nowIso,
          paid_by:   performer,
          updated_at: nowIso,
          updated_by: performer,
        })
        .eq('id', id)
        .eq('status', 'draft');
      if (updErr) throw updErr;

      // Lock the advances consumed in this salary
      let advanceLockError = null;
      const advanceIds = rec.advance_ids || [];
      if (advanceIds.length > 0) {
        const { error: advErr } = await supabase
          .from('employee_advances')
          .update({
            status: 'deducted',
            updated_at: nowIso,
          })
          .in('id', advanceIds)
          .eq('status', 'pending');
        if (advErr) {
          advanceLockError = advErr.message;
          console.error('[salary mark_paid] advance lock error:', advErr.message);
        }
      }

      return NextResponse.json({
        success: true,
        advances_locked: advanceIds.length,
        advance_lock_error: advanceLockError,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    //  REVERT PAID — paid → draft + unlock advances (super_admin only — UI gates this)
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'revert_paid') {
      const { id, performed_by } = body;
      if (!id) {
        return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
      }
      const performer = performed_by || 'Staff';
      const nowIso = new Date().toISOString();

      const { data: rec } = await supabase
        .from('salary_records')
        .select('id, status, advance_ids')
        .eq('id', id)
        .single();
      if (!rec) {
        return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
      }
      if (rec.status !== 'paid') {
        return NextResponse.json(
          { success: false, error: `Yeh record paid nahi hai (current: ${rec.status})` },
          { status: 400 },
        );
      }

      const { error: updErr } = await supabase
        .from('salary_records')
        .update({
          status:     'draft',
          paid_at:    null,
          paid_by:    null,
          updated_at: nowIso,
          updated_by: performer,
        })
        .eq('id', id);
      if (updErr) throw updErr;

      // Unlock the advances
      const advanceIds = rec.advance_ids || [];
      if (advanceIds.length > 0) {
        await supabase
          .from('employee_advances')
          .update({ status: 'pending', updated_at: nowIso })
          .in('id', advanceIds)
          .eq('status', 'deducted');
      }

      return NextResponse.json({
        success: true,
        advances_unlocked: advanceIds.length,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    //  DELETE — only drafts (paid first revert karo)
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { id } = body;
      if (!id) {
        return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
      }
      const { data: rec } = await supabase
        .from('salary_records')
        .select('id, status')
        .eq('id', id)
        .single();
      if (!rec) {
        return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
      }
      if (rec.status === 'paid') {
        return NextResponse.json(
          {
            success: false,
            error: 'Paid record delete nahi ho sakta. Pehle Revert karo, phir Delete.',
          },
          { status: 400 },
        );
      }
      const { error } = await supabase
        .from('salary_records')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 },
    );
  } catch (e) {
    console.error('[salary] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
