// ============================================================================
// RS ZEVAR ERP — HR Policy + Leave Balance Report
// GET /api/hr/print-report?upto=2026-03-31
// Returns a full printable HTML page
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const upto = searchParams.get('upto') || '2026-03-31';

  // ── 1. Fetch HR Policy ──────────────────────────────────────
  const { data: policyRows } = await supabase.from('hr_settings').select('*');
  const pol = {};
  (policyRows || []).forEach(r => { pol[r.key] = r.value; });
  const officeStart    = pol.office_start_time      || '11:00';
  const graceMinutes   = parseInt(pol.grace_minutes || 30);
  const maxLates       = parseInt(pol.max_lates_allowed || 6);
  const maxHalfDays    = parseInt(pol.max_half_days_allowed || 1);
  const overtimeRate   = parseFloat(pol.overtime_rate_multiplier || 1.5);
  const leaderBonus    = parseInt(pol.leaderboard_bonus || 3000);

  // Office time calculations
  const [oh, om] = officeStart.split(':').map(Number);
  const deadlineMins  = oh * 60 + om + graceMinutes;
  const deadlineHH    = Math.floor(deadlineMins / 60);
  const deadlineMM    = deadlineMins % 60;
  const deadlineStr   = `${String(deadlineHH).padStart(2,'0')}:${String(deadlineMM).padStart(2,'0')}`;
  const halfDayStart  = `${String(deadlineHH + (deadlineMM > 0 ? 1 : 0)).padStart(2,'0')}:00`; // 12:00

  // ── 2. Fetch Employees ──────────────────────────────────────
  const { data: employees } = await supabase
    .from('employees')
    .select('id, name, role, designation, base_salary, salary, yearly_leaves_allowed, leaves_opening_used, time_bonus_amount')
    .eq('status', 'active')
    .order('name');

  // ── 3. Fetch Attendance up to upto date ─────────────────────
  // Office year for upto date (Oct–Sep)
  const [uy, um] = upto.slice(0, 7).split('-').map(Number);
  const yearStart = um >= 10 ? `${uy}-10-01`    : `${uy - 1}-10-01`;
  const yearEnd   = um >= 10 ? `${uy + 1}-09-30` : `${uy}-09-30`;

  const { data: attRecords } = await supabase
    .from('employee_attendance')
    .select('employee_id, date, status, leave_type')
    .eq('leave_type', 'annual_leave')
    .gte('date', yearStart)
    .lte('date', upto);

  // Build leave count map: employee_id → count of annual_leave records
  const leaveUsedMap = {};
  (attRecords || []).forEach(r => {
    leaveUsedMap[r.employee_id] = (leaveUsedMap[r.employee_id] || 0) + 1;
  });

  // ── 4. Build employee rows ──────────────────────────────────
  const empRows = (employees || []).map(emp => {
    const allowed   = emp.yearly_leaves_allowed || 3;
    const opening   = emp.leaves_opening_used   || 0;
    const erpUsed   = leaveUsedMap[emp.id]      || 0;
    const totalUsed = opening + erpUsed;
    const remaining = Math.max(0, allowed - totalUsed);
    const status    = remaining === 0 ? 'khatam' : remaining <= 1 ? 'kam' : 'bacha';
    return { ...emp, allowed, opening, erpUsed, totalUsed, remaining, status };
  });

  // ── 5. Generate HTML ────────────────────────────────────────
  const today = new Date().toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' });
  const uptoFormatted = new Date(upto).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' });

  const rowsHtml = empRows.map((e, i) => {
    const bgColor  = i % 2 === 0 ? '#ffffff' : '#f8f9fa';
    const remColor = e.status === 'khatam' ? '#dc2626' : e.status === 'kam' ? '#d97706' : '#16a34a';
    const remBg    = e.status === 'khatam' ? '#fee2e2' : e.status === 'kam' ? '#fef3c7' : '#dcfce7';
    return `
      <tr style="background:${bgColor};">
        <td style="padding:10px 14px;font-weight:600;color:#111;">${e.name}</td>
        <td style="padding:10px 14px;color:#555;font-size:13px;">${e.role || '—'}</td>
        <td style="padding:10px 14px;text-align:center;font-weight:700;">${e.allowed}</td>
        <td style="padding:10px 14px;text-align:center;color:#666;">${e.opening}</td>
        <td style="padding:10px 14px;text-align:center;color:#666;">${e.erpUsed}</td>
        <td style="padding:10px 14px;text-align:center;font-weight:700;color:#111;">${e.totalUsed}</td>
        <td style="padding:10px 14px;text-align:center;">
          <span style="background:${remBg};color:${remColor};padding:3px 10px;border-radius:12px;font-weight:700;font-size:13px;">
            ${e.remaining}
          </span>
        </td>
        <td style="padding:10px 14px;text-align:center;font-size:12px;color:${remColor};">
          ${e.status === 'khatam' ? '⚠️ Khatam — agli chuti pe cut' : e.status === 'kam' ? '⚡ Sirf 1 bacha' : '✅ Available'}
        </td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ur" dir="ltr">
<head>
  <meta charset="UTF-8">
  <title>RS ZEVAR — HR Rules &amp; Leave Balance Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; background: #fff; padding: 32px; font-size: 14px; }
    h1 { font-size: 24px; color: #92400e; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 13px; margin-bottom: 6px; }
    .meta { color: #888; font-size: 12px; margin-bottom: 28px; }
    .gold-line { height: 3px; background: linear-gradient(to right, #c9a96e, #f5d48b, #c9a96e); margin-bottom: 28px; border-radius: 2px; }
    h2 { font-size: 16px; color: #92400e; margin-bottom: 14px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
    .rules-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 28px; }
    .rule-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; }
    .rule-label { font-size: 11px; color: #92400e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .rule-value { font-size: 20px; font-weight: 800; color: #111; }
    .rule-sub { font-size: 12px; color: #555; margin-top: 3px; }
    .rule-desc { grid-column: 1 / -1; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; font-size: 13px; line-height: 1.7; color: #374151; }
    .rule-desc b { color: #111; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
    thead tr { background: #c9a96e; }
    thead th { padding: 10px 14px; text-align: left; color: #fff; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    thead th:not(:first-child) { text-align: center; }
    tbody tr:hover { background: #fef9ee !important; }
    .section { margin-bottom: 28px; }
    .note-box { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 14px; margin-bottom: 24px; font-size: 13px; color: #7f1d1d; line-height: 1.6; }
    .note-box b { color: #991b1b; }
    .footer { border-top: 1px solid #e5e7eb; padding-top: 14px; color: #9ca3af; font-size: 11px; text-align: center; }
    @media print {
      body { padding: 18px; font-size: 12px; }
      .rule-value { font-size: 17px; }
      .no-print { display: none; }
      thead tr { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .rule-box { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <!-- Print Button (hides on print) -->
  <div class="no-print" style="margin-bottom:20px;display:flex;gap:10px;">
    <button onclick="window.print()" style="background:#c9a96e;color:#fff;border:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;">🖨️ Print / Save as PDF</button>
    <button onclick="window.close()" style="background:#f1f5f9;color:#374151;border:1px solid #e2e8f0;padding:10px 18px;border-radius:6px;font-size:14px;cursor:pointer;">✕ Close</button>
  </div>

  <!-- Header -->
  <h1>💎 RS ZEVAR — HR Rules &amp; Leave Balance</h1>
  <div class="subtitle">Office Attendance Policy — Tamam Employees ke liye</div>
  <div class="meta">Report Date: ${today} &nbsp;|&nbsp; Leave Balance: October 2025 – ${uptoFormatted} tak</div>
  <div class="gold-line"></div>

  <!-- Section 1: Office Timings -->
  <div class="section">
    <h2>📅 Office Timings &amp; Late Policy</h2>
    <div class="rules-grid">
      <div class="rule-box">
        <div class="rule-label">Office Start</div>
        <div class="rule-value">${officeStart} AM</div>
        <div class="rule-sub">Yahi time par aana hai</div>
      </div>
      <div class="rule-box">
        <div class="rule-label">Late Threshold</div>
        <div class="rule-value">${deadlineStr}</div>
        <div class="rule-sub">${graceMinutes} min grace ke baad late count</div>
      </div>
      <div class="rule-box">
        <div class="rule-label">Half Day Start</div>
        <div class="rule-value">12:01 PM – 3:00 PM</div>
        <div class="rule-sub">12 baje se 3 baje tk aana = half day</div>
      </div>
      <div class="rule-box">
        <div class="rule-label">After 3:00 PM</div>
        <div class="rule-value">Full Absent</div>
        <div class="rule-sub">Annual leave ya unpaid deduction</div>
      </div>
      <div class="rule-box">
        <div class="rule-label">Free Lates / Month</div>
        <div class="rule-value">${maxLates}</div>
        <div class="rule-sub">${officeStart}–12:00 PM wali lates free</div>
      </div>
      <div class="rule-box">
        <div class="rule-label">Free Half Days / Month</div>
        <div class="rule-value">${maxHalfDays}</div>
        <div class="rule-sub">12:01–3:00 PM (sirf 1 free)</div>
      </div>
      <div class="rule-box">
        <div class="rule-label">Late Deduction</div>
        <div class="rule-value">Rs. ${pol.late_deduction_amount || 100}</div>
        <div class="rule-sub">7th late se flat Rs.100 per late</div>
      </div>
      <div class="rule-box">
        <div class="rule-label">Overtime Rate</div>
        <div class="rule-value">${overtimeRate}x</div>
        <div class="rule-sub">Per hour rate ka ${overtimeRate} guna</div>
      </div>
    </div>

    <div class="rule-desc">
      <b>Late ka Rule:</b> ${officeStart} se ${graceMinutes} minutes baad (yaani ${deadlineStr} ke baad) aana <b>Late</b> count hoga.
      Mahine mein <b>${maxLates} Late (${deadlineStr}–12:00 PM)</b> bilkul free hain — salary nahi kategi.
      Sirf <b>1 Half Day (12:01 PM – 3:00 PM)</b> free hai. 3:00 PM ke baad aana = <b>Full Absent</b>.
      <br><br>
      <b>Excess Late Deduction:</b> 7th late se har ek late = flat <b>Rs. ${pol.late_deduction_amount || 100}</b>. Excess half day = actual late ghante × per hour salary.
      <br><br>
      <b>Time Bonus:</b> Milega SIRF tab jab: Normal lates <b>${maxLates} ya kam</b> hon AUR Half day lates <b>${maxHalfDays} ya kam</b> hon. Koi bhi rule tuta = Time Bonus nahi milega.
    </div>
  </div>

  <!-- Section 2: Leave Policy -->
  <div class="section">
    <h2>🌴 Yearly Leave Policy</h2>
    <div class="rule-desc">
      <b>Office Year:</b> 1 October se 30 September tak. Har saal October 1 ko leaves reset hoti hain.<br>
      <b>Leave = Chhuti lena:</b> Jab koi employee absent hota hai, pehle uski yearly leaves check hoti hain.
      Agar leaves bachi hain → koi salary cut nahi. Agar leaves khatam → <b>us din ki poori salary kategi (1 din = Salary ÷ 30)</b>.<br>
      <b>Important:</b> Yeh rule October 2025 se shuru hota hai. March 2026 tak ki leaves is report mein dikhaye gayi hain.
    </div>
  </div>

  <!-- Section 3: Leave Balance Table -->
  <div class="section">
    <h2>📊 Employee Leave Balance — ${uptoFormatted} Tak</h2>
    <table>
      <thead>
        <tr>
          <th>Employee</th>
          <th>Role</th>
          <th style="text-align:center;">Allowed / Year</th>
          <th style="text-align:center;">Oct–Mar Used (Manual)</th>
          <th style="text-align:center;">Apr Used (ERP)</th>
          <th style="text-align:center;">Total Used</th>
          <th style="text-align:center;">Remaining</th>
          <th style="text-align:center;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="note-box">
      <b>⚠️ Important Note:</b> Jis employee ka "Remaining" 0 hai — unki agli abhi se koi bhi chhuti pe <b>salary cut hogi per day ke hisab se.</b>
      Jis ka 1 bacha hai — 1 aur free chhuti le sakte hain, phir agla cut hoga.
      Yeh balance <b>30 September 2026</b> ko reset ho jaayega.
    </div>
  </div>

  <div class="footer">
    Generated by RS ZEVAR ERP &nbsp;|&nbsp; ${today} &nbsp;|&nbsp; rszevar-erp.vercel.app
  </div>

</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
