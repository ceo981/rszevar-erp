// RS ZEVAR ERP — Packing Leaderboard (Amount-Prioritized)
// GET /api/hr/leaderboard?month=2026-04
//
// Ranking logic:
//   Primary: total_amount DESC (jo zyada amount ka saman pack kare wo top pe)
//   Tiebreaker: total_items DESC (same amount ho to zyada items wala upar)
//
// Winner bonus (1st): leaderboard_bonus_1st (default Rs. 2,000)
// Runner-up bonus (2nd): leaderboard_bonus_2nd (default Rs. 1,000)

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const supabase = createServerClient();
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);

  // ── Role check — non-super_admin gets name + items/orders count only (no Rs amounts)
  const user = await getCurrentUser();
  const isSuperAdmin = user?.profile?.role === 'super_admin';

  const start = `${month}-01`;
  const [_y, _m] = month.split('-').map(Number);
  const _lastDay = new Date(_y, _m, 0).getDate();
  const end = `${month}-${String(_lastDay).padStart(2, '0')}`;

  // 1. Packing log for the month (items + amount dono)
  const { data: logs, error } = await supabase
    .from('packing_log')
    .select('employee_id, items_packed, items_amount, completed_at')
    .gte('completed_at', start)
    .lte('completed_at', end + 'T23:59:59');

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // 2. Aggregate by employee — items, amount, orders count
  const empMap = {};
  for (const log of logs || []) {
    const id = log.employee_id;
    if (!empMap[id]) empMap[id] = { employee_id: id, total_items: 0, total_amount: 0, total_orders: 0 };
    empMap[id].total_items  += log.items_packed || 0;
    empMap[id].total_amount += parseFloat(log.items_amount) || 0;
    empMap[id].total_orders += 1;
  }

  // 3. Get employee names
  const empIds = Object.keys(empMap).map(Number);
  let employees = [];
  if (empIds.length > 0) {
    const { data: emps } = await supabase
      .from('employees')
      .select('id, name, role')
      .in('id', empIds);
    employees = emps || [];
  }

  const empNameMap = {};
  for (const e of employees) empNameMap[e.id] = e;

  // 4. Build leaderboard — SORT BY AMOUNT (primary), items (tiebreaker)
  const leaderboard = Object.values(empMap)
    .map(entry => ({
      ...entry,
      total_amount: Math.round(entry.total_amount * 100) / 100, // 2 decimals
      name: empNameMap[entry.employee_id]?.name || 'Unknown',
      role: empNameMap[entry.employee_id]?.role || '',
    }))
    .sort((a, b) => {
      if (b.total_amount !== a.total_amount) return b.total_amount - a.total_amount;
      return b.total_items - a.total_items; // tiebreaker
    });

  // 5. Get bonus amounts from settings (with fallback to old single bonus, then defaults)
  const { data: settings } = await supabase.from('hr_settings').select('key, value');
  const getSetting = (k, def) => {
    const s = (settings || []).find(s => s.key === k);
    return s ? parseFloat(s.value) : def;
  };

  const oldBonus    = getSetting('leaderboard_bonus', 3000); // backward compat fallback
  const bonus1st    = getSetting('leaderboard_bonus_1st', oldBonus);
  const bonus2nd    = getSetting('leaderboard_bonus_2nd', Math.round(oldBonus / 2));

  // ── Build response (strip Rs amounts for non-super_admin — defense in depth) ──
  // Ranking order is preserved (already sorted by amount server-side), but non-CEO
  // callers only get items/orders counts in each row. Bonus amounts also hidden.
  const stripAmount = (row) => {
    if (!row) return row;
    const { total_amount, ...rest } = row;
    return rest;
  };

  const publicLeaderboard = isSuperAdmin
    ? leaderboard
    : leaderboard.map(stripAmount);

  return NextResponse.json({
    success: true,
    month,
    is_super_admin: isSuperAdmin, // frontend hint (also double-checked in useUser)
    leaderboard: publicLeaderboard,
    winner:    isSuperAdmin ? (leaderboard[0] || null) : stripAmount(leaderboard[0] || null),
    runner_up: isSuperAdmin ? (leaderboard[1] || null) : stripAmount(leaderboard[1] || null),
    bonus_amount_1st: isSuperAdmin ? bonus1st : null,
    bonus_amount_2nd: isSuperAdmin ? bonus2nd : null,
    // Backward compat — old frontends still reading bonus_amount
    bonus_amount: isSuperAdmin ? bonus1st : null,
  });
}
