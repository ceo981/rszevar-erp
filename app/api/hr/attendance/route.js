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

// ─── Late charge helper (May 6 2026 — tiered) ────────────────────────────
// Computes per-late charge based on actual arrival time.
//   - First hour past office_start (11:00–12:00) = late_charge_first_hour
//   - Each additional 30-min slab past 12:00 = +late_charge_per_30min_slab
//   - Partial slabs round UP (12:01 → next slab; 12:30 still in same slab)
// Examples (defaults 100 + 50):
//   11:50 (50 min past) → 100
//   12:00 (60 min past) → 100
//   12:15 (75 min past) → 150  (1 slab past first hour)
//   12:30 (90 min past) → 150  (still in 1st 30-min slab)
//   12:31 (91 min past) → 200  (2 slabs past)
//   13:00 (120 min past) → 200
//   13:30 (150 min past) → 250
function computeChargedLateAmount(minutesPastOfficeStart, policy) {
  const firstHour = parseFloat(policy.late_charge_first_hour) || 100;
  const slab      = parseFloat(policy.late_charge_per_30min_slab) || 50;
  if (minutesPastOfficeStart <= 60) return firstHour;
  const slabsBeyond = Math.ceil((minutesPastOfficeStart - 60) / 30);
  return Math.round(firstHour + slab * slabsBeyond);
}

// Compute "minutes past office_start" for an attendance row.
// Prefers row.time_in (most accurate); falls back to (late_minutes + grace).
function minutesPastOfficeStart(row, officeStartMins, graceMinutes) {
  if (row.time_in) {
    const parts = String(row.time_in).split(':').map(Number);
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      const arrivalMins = parts[0] * 60 + parts[1];
      return Math.max(0, arrivalMins - officeStartMins);
    }
  }
  // Fallback: late_minutes is "minutes past grace deadline"
  // So minutes_past_office_start = late_minutes + grace
  return Math.max(0, (row.late_minutes || 0) + (graceMinutes || 25));
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
    grace_minutes:               num('grace_minutes', 25),
    max_lates_allowed:           num('max_lates_allowed', 6),
    max_half_days_allowed:       num('max_half_days_allowed', 1),
    late_deduction_amount:       num('late_deduction_amount', 100), // deprecated fallback
    late_charge_first_hour:      num('late_charge_first_hour',
                                     num('late_deduction_amount', 100)),
    late_charge_per_30min_slab:  num('late_charge_per_30min_slab', 50),
    office_start_time:           map.office_start_time || '11:00',
    leaderboard_bonus_1st:       num('leaderboard_bonus_1st', num('leaderboard_bonus', 2000)),
    leaderboard_bonus_2nd:       num('leaderboard_bonus_2nd', Math.round(num('leaderboard_bonus', 2000) / 2)),
    overtime_rate_multiplier:    num('overtime_rate_multiplier', 1.5),
    standard_work_hours_per_day: num('standard_work_hours_per_day', 9),
  };
}

async function calculatePayroll(supabase, employee_id, month, manualBonus = 0) {
  const empRes = await supabase
    .from('employees')
    .select('id, name, role, status, base_salary, advance_limit, time_bonus_amount, yearly_leaves_allowed, leaves_opening_used')
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
  // May 6 2026 fix — `leave_type` field bhi fetch karte hain.
  // Attendance route har absent ko leave_type assign karti hai:
  //   - 'annual_leave' → employee ki yearly allowance ke andar hai → FREE
  //                      (salary se deduction NAHI hogi)
  //   - 'unpaid'       → yearly allowance khatam → salary deduction
  //   - null           → legacy data (pehle ka), default unpaid treat karte
  // time_in + late_minutes — tiered late charge calc ke liye chahiye
  const { data: attendance } = await supabase
    .from('employee_attendance')
    .select('date, status, leave_type, time_in, late_minutes')
    .eq('employee_id', employee_id)
    .gte('date', start)
    .lte('date', end);

  const counts = {
    present: 0, late: 0, half_day: 0,
    paid_absent: 0,      // status='absent' && leave_type IS NOT 'annual_leave' → salary cut
    free_leave: 0,       // status='absent' && leave_type='annual_leave' → free (yearly balance se)
  };
  for (const row of attendance || []) {
    const s = String(row.status || '').toLowerCase();
    const lt = String(row.leave_type || '').toLowerCase();
    if (s === 'absent') {
      if (lt === 'annual_leave') counts.free_leave += 1;
      else                       counts.paid_absent += 1;
    } else if (s in counts) {
      counts[s] += 1;
    }
  }
  // Total marked attendance days (used to check if month is fully entered)
  const markedDays  = (attendance || []).length;
  const presentDays = counts.present + counts.late;          // Late counts as present for pay
  const absentDays  = counts.paid_absent;                    // Drives deduction (paid absents only)
  let   freeLeaveDays = counts.free_leave;                   // Reassigned below (year-aware split)
  let   totalAbsentDays = counts.paid_absent + counts.free_leave; // For UI display
  const lateDays    = counts.late;
  const halfDays    = counts.half_day;
  let   leaveDays   = freeLeaveDays;                         // Saved as 'leave_days' in DB

  // ── Policy + per-day rate ───────────────────────────────────────────────
  const policy = await getPolicy(supabase);
  const perDayRate = totalDays > 0 ? baseSalary / totalDays : 0;

  // Office start time in minutes (e.g., "11:00" → 660)
  const officeStartStr = policy.office_start_time || '11:00';
  const [osH, osM] = String(officeStartStr).split(':').map(Number);
  const officeStartMins = (osH || 11) * 60 + (osM || 0);

  // ── Late deduction (May 6 2026 — TIERED CHARGE) ────────────────────────
  // First N lates per month (max_lates_allowed) are FREE.
  // Beyond that, each "charged late" amount depends on actual arrival time:
  //   11:00–12:00 = first hour rate
  //   12:01–12:30 = first hour + 1 slab
  //   12:31–13:00 = first hour + 2 slabs
  //   ... etc
  // Free lates assigned in DATE ORDER — earliest 6 lates count as free.
  const lateRows = (attendance || [])
    .filter(r => String(r.status || '').toLowerCase() === 'late')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const freeLatesQuota   = policy.max_lates_allowed;            // typically 6
  const freeLatesUsed    = Math.min(lateRows.length, freeLatesQuota);
  const chargedLateRows  = lateRows.slice(freeLatesQuota);

  const lateChargesBreakdown = chargedLateRows.map(row => {
    const minsPast = minutesPastOfficeStart(row, officeStartMins, policy.grace_minutes);
    const charge   = computeChargedLateAmount(minsPast, policy);
    return {
      date: row.date,
      time_in: row.time_in || null,
      minutes_past_office: minsPast,
      charge,
    };
  });

  const lateDeduction = lateChargesBreakdown.reduce((s, x) => s + x.charge, 0);
  const excessLates   = chargedLateRows.length;   // for time bonus eligibility

  // ── Absent deduction ────────────────────────────────────────────────────
  // Sirf PAID absents par cut hota hai (jo yearly allowance se bahar gaye).
  // Free annual leaves cut nahi hoti — wo employee ki entitled time off hai.
  // Half day: per-day rate × 0.5 × half day count (after the allowed buffer)
  const excessHalfDays = Math.max(0, halfDays - policy.max_half_days_allowed);
  const absentDeduction = (absentDays * perDayRate) + (excessHalfDays * perDayRate * 0.5);

  // ── Yearly leave balance (May 6 2026) ───────────────────────────────────
  // Office year: Oct 1 – Sep 30 (matches attendance route)
  // Compute as of END of THIS month (so April slip shows April-end state).
  const allowed       = parseInt(emp.yearly_leaves_allowed) || 14;
  const opening       = parseInt(emp.leaves_opening_used)   || 0;
  const [yy, mm]      = month.split('-').map(Number);
  const officeYearStart = mm >= 10 ? `${yy}-10-01` : `${yy - 1}-10-01`;
  const officeYearEndOfMonth = end;  // already last day of this month

  let erpAnnualDates = [];
  try {
    const { data: alRows } = await supabase
      .from('employee_attendance')
      .select('date')
      .eq('employee_id', employee_id)
      .eq('status', 'absent')
      .eq('leave_type', 'annual_leave')
      .gte('date', officeYearStart)
      .lte('date', officeYearEndOfMonth)
      .order('date', { ascending: true });
    erpAnnualDates = (alRows || []).map(r => r.date);
  } catch (e) {
    console.error('[salary] yearly leaves fetch failed:', e.message);
  }
  const erpFreeLeavesThisYear = erpAnnualDates.length;

  // ── Over-quota reclassification (Jun 2026 fix) ──────────────────────────
  // Yearly paid-leave allowance = `allowed` (e.g. 6), jis mein se `opening`
  // (e.g. 3) ERP se pehle use ho chuke. To ERP ke andar free annual leaves =
  // allowed - opening. Date-order mein is quota se AAGE ki har annual-leave
  // OVER-QUOTA hai → unpaid (salary cut) — chahe attendance route ne usay
  // entry-time pe 'annual_leave' stamp kar diya ho (jaise opening_used baad
  // mein set hua, ya leaves backdated/out-of-order add hue). Cut us mahine
  // lagti hai jis mahine ki over-quota leave hai (date order ke hisaab se).
  const freeErpAllowance = Math.max(0, allowed - opening);
  // Is mahine ki annual-leave dates (year index ke saath) → free vs over-quota.
  // Basis = leave_type='annual_leave' (status nahi) taa ke "Annual Leaves Used"
  // aur "Over-Quota" counts unpaid cut se 100% reconcile karein.
  const monthAnnualDates = erpAnnualDates.filter(d => d >= start && d <= end);
  let freeThisMonth = 0;
  let overQuotaThisMonth = 0;
  monthAnnualDates.forEach(d => {
    const idx = erpAnnualDates.indexOf(d);
    if (idx >= 0 && idx < freeErpAllowance) freeThisMonth += 1;
    else overQuotaThisMonth += 1;
  });
  const annualLeavesThisMonth = monthAnnualDates.length;
  let overQuotaYearToDate = 0;
  erpAnnualDates.forEach((d, idx) => { if (idx >= freeErpAllowance) overQuotaYearToDate += 1; });

  // Display counts reassign — slip reconcile ho (free + over-quota = total annual)
  freeLeaveDays   = freeThisMonth;
  leaveDays       = freeThisMonth;
  totalAbsentDays = counts.paid_absent + annualLeavesThisMonth;

  const yearlyTotalUsed  = erpFreeLeavesThisYear + opening;
  const yearlyRemaining  = Math.max(0, allowed - yearlyTotalUsed);
  const yearlyLeaves = {
    allowed,
    opening_used: opening,
    erp_used_this_year: erpFreeLeavesThisYear,
    total_used: yearlyTotalUsed,
    remaining: yearlyRemaining,
    free_erp_allowance: freeErpAllowance,
    over_quota_this_month: overQuotaThisMonth,
    over_quota_year_to_date: overQuotaYearToDate,
    annual_leaves_this_month: annualLeavesThisMonth,
    office_year_start: officeYearStart,
    office_year_end: mm >= 10 ? `${yy + 1}-09-30` : `${yy}-09-30`,
  };

  // ── Working-days breakdown (Jun 2026) — salary slip clarity ─────────────
  // Month Days = calendar days. Working Days = Month Days − Sundays (weekly
  // off) − Public Holidays. (Per-day rate ka denominator alag hai — wo
  // calendar days hi rehta hai, ye sirf slip pe clear breakdown ke liye hai.)
  const monthDays = totalDays;
  let sundaysCount = 0;
  for (let dnum = 1; dnum <= monthDays; dnum++) {
    if (new Date(Date.UTC(yy, mm - 1, dnum)).getUTCDay() === 0) sundaysCount += 1;
  }
  let publicHolidaysCount = 0;
  try {
    const { data: hols } = await supabase
      .from('holiday_calendar')
      .select('date')
      .gte('date', start)
      .lte('date', end);
    publicHolidaysCount = (hols || []).filter(h => {
      const [hy, hm, hd] = String(h.date).split('-').map(Number);
      return new Date(Date.UTC(hy, hm - 1, hd)).getUTCDay() !== 0; // Sunday holiday double-count nahi
    }).length;
  } catch (e) {
    console.error('[salary] holiday count failed:', e.message);
  }
  const workingDaysActual = Math.max(0, monthDays - sundaysCount - publicHolidaysCount);

  // Unpaid leave deduction — is mahine ki over-quota annual leaves ka per-day
  // rate cut. (Pehle ye hamesha 0 tha — isi wajah se yearly quota khatam hone
  // ke baad bhi koi cut nahi lagti thi.)
  const unpaidLeaveDeduction = overQuotaThisMonth * perDayRate;

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
    // ── Late breakdown (May 6 2026 tiered) ────────────────────────────────
    // Stored in bonus_breakdown JSONB to avoid schema migration. Slip + UI
    // read this for showing free vs charged late breakdown.
    late_breakdown: {
      free_quota:        freeLatesQuota,
      free_used:         freeLatesUsed,
      charged_count:     chargedLateRows.length,
      charged_total_rs:  Math.round(lateDeduction),
      charged_details:   lateChargesBreakdown,    // [{date, time_in, charge}]
    },
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
      working_days:   workingDaysActual,
      month_days:     monthDays,
      sundays:        sundaysCount,
      public_holidays: publicHolidaysCount,
      marked_days:    markedDays,
      present_days:   presentDays,
      absent_days:    absentDays,           // PAID absents (drives deduction)
      total_absent_days: totalAbsentDays,   // For UI display (paid + free)
      free_leave_days: freeLeaveDays,       // Free annual leaves used this month
      late_days:      lateDays,
      half_days:      halfDays,
      leave_days:     leaveDays,            // Same as free_leave_days (saved to DB)
      yearly_leaves:  yearlyLeaves,         // {allowed, opening, used, remaining, ...}
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

  // ── Enrich each record with yearly_leaves info (May 6 2026) ─────────
  // Saved records mein ye field nahi hota — render time pe compute karte
  // hain taa ke slip pe accurate "Yearly Remaining" dikhe end-of-month
  // ke hisab se. Per-employee 1 query, total ~10-15 queries — fine.
  const records = data || [];
  const [yy, mm] = month.split('-').map(Number);
  const officeYearStart  = mm >= 10 ? `${yy}-10-01`     : `${yy - 1}-10-01`;
  const officeYearEnd    = mm >= 10 ? `${yy + 1}-09-30` : `${yy}-09-30`;
  const monthEnd         = `${month}-${String(new Date(yy, mm, 0).getDate()).padStart(2, '0')}`;
  const monthStartStr    = `${month}-01`;

  // Working-days breakdown for this month (employee-independent → compute once)
  const monthDaysAll = new Date(yy, mm, 0).getDate();
  let sundaysAll = 0;
  for (let dnum = 1; dnum <= monthDaysAll; dnum++) {
    if (new Date(Date.UTC(yy, mm - 1, dnum)).getUTCDay() === 0) sundaysAll += 1;
  }
  let publicHolidaysAll = 0;
  try {
    const { data: hols } = await supabase
      .from('holiday_calendar')
      .select('date')
      .gte('date', monthStartStr)
      .lte('date', monthEnd);
    publicHolidaysAll = (hols || []).filter(h => {
      const [hy, hm, hd] = String(h.date).split('-').map(Number);
      return new Date(Date.UTC(hy, hm - 1, hd)).getUTCDay() !== 0;
    }).length;
  } catch (e) {
    console.error('[salary] holiday count (enrich) failed:', e.message);
  }
  const workingDaysAll = Math.max(0, monthDaysAll - sundaysAll - publicHolidaysAll);

  if (records.length > 0) {
    const empIds = records.map(r => r.employee_id);
    // Fetch employee leave config in one query
    const { data: empRows } = await supabase
      .from('employees')
      .select('id, yearly_leaves_allowed, leaves_opening_used')
      .in('id', empIds);
    const empMap = new Map((empRows || []).map(e => [e.id, e]));

    // Per employee: dated free leaves in office year up to end of slip month
    const monthStart = `${month}-01`;
    await Promise.all(records.map(async (rec) => {
      try {
        const { data: alRows } = await supabase
          .from('employee_attendance')
          .select('date')
          .eq('employee_id', rec.employee_id)
          .eq('status', 'absent')
          .eq('leave_type', 'annual_leave')
          .gte('date', officeYearStart)
          .lte('date', monthEnd)
          .order('date', { ascending: true });
        const dates = (alRows || []).map(r => r.date);
        const count = dates.length;
        const emp = empMap.get(rec.employee_id) || {};
        const allowed = parseInt(emp.yearly_leaves_allowed) || 14;
        const opening = parseInt(emp.leaves_opening_used)   || 0;
        const totalUsed = count + opening;
        const freeErpAllowance = Math.max(0, allowed - opening);
        let overQuotaThisMonth = 0;
        let overQuotaYearToDate = 0;
        let annualThisMonth = 0;
        dates.forEach((d, idx) => {
          const inMonth = d >= monthStart && d <= monthEnd;
          if (inMonth) annualThisMonth += 1;
          if (idx >= freeErpAllowance) {
            overQuotaYearToDate += 1;
            if (inMonth) overQuotaThisMonth += 1;
          }
        });
        rec.yearly_leaves = {
          allowed,
          opening_used: opening,
          erp_used_this_year: count,
          total_used: totalUsed,
          remaining: Math.max(0, allowed - totalUsed),
          free_erp_allowance: freeErpAllowance,
          over_quota_this_month: overQuotaThisMonth,
          over_quota_year_to_date: overQuotaYearToDate,
          annual_leaves_this_month: annualThisMonth,
          office_year_start: officeYearStart,
          office_year_end: officeYearEnd,
        };
        // Working-days breakdown (display) — override stale saved working_days
        rec.month_days = monthDaysAll;
        rec.working_days = workingDaysAll;
        rec.public_holidays = publicHolidaysAll;
        rec.sundays = sundaysAll;
        // Free annual leaves shown = total annual this month − over-quota
        rec.free_leave_days = Math.max(0, annualThisMonth - overQuotaThisMonth);
      } catch (e) {
        rec.yearly_leaves = null;
      }
    }));
  }

  return NextResponse.json({ success: true, month, records });
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
