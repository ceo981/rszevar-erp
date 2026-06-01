// ============================================================================
// RS ZEVAR ERP — Auto-Absent
// ----------------------------------------------------------------------------
// Jis bhi WORKING day ki attendance kisi active employee ki log nahi hui,
// configured buffer (HR Policy → auto_absent_hours, default 24) guzarne ke baad
// usko automatically 'absent' mark kar deta hai.
//
// SKIPS:
//   • Sundays (weekly off)
//   • holiday_calendar ke holidays
//   • Jo din employee ki join_date se pehle ka ho
//   • Jo din employee ki termination_date ke baad ka ho
//
// SAFETY:
//   • Pehle se mojood koi bhi record (manual/auto) ko KABHI overwrite nahi karta.
//     Pehle window ke existing records select karta hai + insert pe
//     ON CONFLICT DO NOTHING (ignoreDuplicates) — double guard.
//   • source = 'auto-absent' tag hota hai, taake distinguish ho sake.
//     Galti se mark hua to cell pe click kar ke edit/delete kar sakte ho.
//
// TIMEZONE: Pakistan = UTC+5 (no DST). Saara "due" calculation PKT wall-clock
//   ke hisaab se hota hai. Cron Vercel pe UTC mein chalta hai.
//
// TRIGGERS:
//   • Vercel cron (GET)  — daily
//   • Manual button (POST) — HR → Attendance → "Run Auto-Absent"
//   • Dry-run preview: GET ?dry_run=1  ya  POST { dry_run: true }
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // Pakistan = UTC+5, no DST

// "now" wall-clock in PKT (read via getUTC* methods)
function nowPKT() { return new Date(Date.now() + PKT_OFFSET_MS); }

function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

async function runAutoAbsent({ days = 31, dryRun = false } = {}) {
  const supabase = createServerClient();

  // ── Policy ──────────────────────────────────────────────────────────────
  const { data: polRows } = await supabase.from('hr_settings').select('key, value');
  const getPol = (k, dflt) => {
    const r = (polRows || []).find(x => x.key === k);
    return r ? r.value : dflt;
  };
  const enabled = String(getPol('auto_absent_enabled', 'true')) !== 'false';
  const bufferHours = Math.max(0, parseFloat(getPol('auto_absent_hours', '24')) || 24);

  if (!enabled) {
    return { success: true, enabled: false, marked: 0, dates: [], message: 'Auto-absent HR Policy mein disabled hai' };
  }

  // ── Active employees ──────────────────────────────────────────────────────
  const { data: emps, error: empErr } = await supabase
    .from('employees')
    .select('id, join_date, termination_date, status')
    .eq('status', 'active');
  if (empErr) return { success: false, error: empErr.message };
  const employees = emps || [];
  if (employees.length === 0) {
    return { success: true, enabled: true, marked: 0, dates: [], message: 'Koi active employee nahi' };
  }

  // ── Holidays ───────────────────────────────────────────────────────────────
  const { data: hols } = await supabase.from('holiday_calendar').select('date');
  const holidaySet = new Set((hols || []).map(h => h.date));

  // ── Due working dates (yesterday se peeche `days` tak) ─────────────────────
  const p = nowPKT();
  const py = p.getUTCFullYear();
  const pm = p.getUTCMonth();
  const pd = p.getUTCDate();

  const lookback = Math.min(Math.max(parseInt(days) || 31, 1), 120);
  const dueDates = [];
  for (let i = 1; i <= lookback; i++) {
    const dt = new Date(Date.UTC(py, pm, pd - i)); // PKT wall date, i days ago
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const da = dt.getUTCDate();
    const dateStr = ymd(y, mo, da);
    const dow = dt.getUTCDay();

    if (dow === 0) continue;               // Sunday — weekly off
    if (holidaySet.has(dateStr)) continue; // store-wide holiday

    // Day D ends at start of (D+1) PKT. Due jab us ke baad bufferHours guzar jayein.
    const endOfDayUTC = Date.UTC(y, mo - 1, da + 1, 0, 0, 0) - PKT_OFFSET_MS;
    const dueAtUTC = endOfDayUTC + bufferHours * 60 * 60 * 1000;
    if (Date.now() >= dueAtUTC) dueDates.push(dateStr);
  }

  if (dueDates.length === 0) {
    return { success: true, enabled: true, marked: 0, dates: [], buffer_hours: bufferHours, message: 'Abhi koi din due nahi' };
  }

  const minDate = dueDates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dueDates.reduce((a, b) => (a > b ? a : b));

  // ── Existing records (window) → kabhi overwrite mat karo ───────────────────
  const { data: existing, error: exErr } = await supabase
    .from('employee_attendance')
    .select('employee_id, date')
    .gte('date', minDate)
    .lte('date', maxDate);
  if (exErr) return { success: false, error: exErr.message };
  const haveSet = new Set((existing || []).map(r => `${r.employee_id}|${r.date}`));

  // ── Build inserts ──────────────────────────────────────────────────────────
  const toInsert = [];
  for (const dateStr of dueDates) {
    for (const emp of employees) {
      if (emp.join_date && dateStr < emp.join_date) continue;
      if (emp.termination_date && dateStr > emp.termination_date) continue;
      if (haveSet.has(`${emp.id}|${dateStr}`)) continue;
      toInsert.push({
        employee_id: emp.id,
        date: dateStr,
        status: 'absent',
        time_in: null,
        time_out: null,
        late_minutes: 0,
        leave_type: null,
        notes: 'Auto-marked absent — koi attendance log nahi hui',
        source: 'auto-absent',
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (dryRun) {
    return { success: true, enabled: true, dry_run: true, marked: toInsert.length, dates: dueDates, buffer_hours: bufferHours };
  }

  // ── Insert (chunked, ON CONFLICT DO NOTHING) ───────────────────────────────
  let marked = 0;
  const chunkSize = 200;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    const { data: ins, error } = await supabase
      .from('employee_attendance')
      .upsert(chunk, { onConflict: 'employee_id,date', ignoreDuplicates: true })
      .select('id');
    if (error) return { success: false, error: error.message, marked };
    marked += (ins || []).length;
  }

  return { success: true, enabled: true, marked, dates: dueDates, buffer_hours: bufferHours };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dry_run') === '1';
  const days = parseInt(searchParams.get('days') || '31');
  const result = await runAutoAbsent({ days, dryRun });
  return NextResponse.json(result);
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const result = await runAutoAbsent({ days: body.days || 31, dryRun: !!body.dry_run });
  return NextResponse.json(result);
}
