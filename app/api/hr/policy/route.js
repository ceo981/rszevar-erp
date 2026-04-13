// RS ZEVAR ERP — HR Policy Settings
// GET  /api/hr/policy → fetch all policy settings
// POST /api/hr/policy → update settings

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULTS = {
  office_start_time:      '11:00',
  grace_minutes:          '30',
  max_lates_allowed:      '6',
  max_half_days_allowed:  '3',
  time_bonus_amount:      '500',
  leaderboard_bonus:      '3000',
  working_days_per_month: '26',
  overtime_rate_multiplier: '1.5',
  late_deduction_per_minute: '1',
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
