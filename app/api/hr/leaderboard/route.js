// RS ZEVAR ERP — Packing Leaderboard
// GET /api/hr/leaderboard?month=2026-04

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const supabase = createServerClient();
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);

  const start = `${month}-01`;
  const end   = `${month}-31`;

  // 1. Packing log for the month
  const { data: logs, error } = await supabase
    .from('packing_log')
    .select('employee_id, items_packed, completed_at')
    .gte('completed_at', start)
    .lte('completed_at', end + 'T23:59:59');

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // 2. Aggregate by employee
  const empMap = {};
  for (const log of logs || []) {
    const id = log.employee_id;
    if (!empMap[id]) empMap[id] = { employee_id: id, total_items: 0, total_orders: 0 };
    empMap[id].total_items  += log.items_packed || 0;
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

  // 4. Build leaderboard sorted by items
  const leaderboard = Object.values(empMap)
    .map(entry => ({
      ...entry,
      name: empNameMap[entry.employee_id]?.name || 'Unknown',
      role: empNameMap[entry.employee_id]?.role || '',
    }))
    .sort((a, b) => b.total_items - a.total_items);

  // 5. Get policy (leaderboard_bonus amount)
  const { data: settings } = await supabase.from('hr_settings').select('key, value');
  const getSetting = (k, def) => {
    const s = (settings || []).find(s => s.key === k);
    return s ? parseFloat(s.value) : def;
  };
  const bonusAmount = getSetting('leaderboard_bonus', 3000);

  return NextResponse.json({
    success: true,
    month,
    leaderboard,
    winner: leaderboard[0] || null,
    bonus_amount: bonusAmount,
  });
}
