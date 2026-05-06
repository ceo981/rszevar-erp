// RS ZEVAR ERP — HR Policy Settings
// GET  /api/hr/policy → fetch all policy settings
// POST /api/hr/policy → update settings

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULTS = {
  office_start_time:           '11:00',
  grace_minutes:               '25',   // 11:00 → 11:25 = ON TIME
  // ── Late tiered charge (May 6 2026) ──────────────────────────────────────
  // 11:26 onwards = LATE. First 6 lates per month are FREE.
  // From 7th late onwards, charge is based on ACTUAL ARRIVAL TIME:
  //   - 11:00–12:00 (first hour past office_start) = late_charge_first_hour
  //   - Every 30 min slab after 12:00 = +late_charge_per_30min_slab
  // Example with defaults (100 + 50): 11:50=100, 12:15=150, 12:30=150, 12:31=200
  max_lates_allowed:           '6',
  max_half_days_allowed:       '1',
  late_charge_first_hour:      '100',  // For 1st hour past office_start
  late_charge_per_30min_slab:  '50',   // Each 30 min after 1st hour
  late_deduction_amount:       '100',  // ── Deprecated ── kept for backward compat
  leaderboard_bonus_1st:       '2000',
  leaderboard_bonus_2nd:       '1000',
  overtime_rate_multiplier:    '1.5',
};

export async function GET() {
  const supabase = createServerClient();
  const { data } = await supabase.from('hr_settings').select('*');
  const map = {};
  for (const [k, v] of Object.entries(DEFAULTS)) map[k] = v;
  for (const row of data || []) map[row.key] = row.value;
  return NextResponse.json({ success: true, policy: map });
}

export async function POST(request) {
  const supabase = createServerClient();
  const body = await request.json();

  const rows = Object.entries(body).map(([key, value]) => ({
    key,
    value: String(value),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('hr_settings')
    .upsert(rows, { onConflict: 'key' });

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
