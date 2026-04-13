// RS ZEVAR ERP — Daily Work Submissions
// POST /api/hr/work-submit  → submit work
// GET  /api/hr/work-submit  → CEO sees all, employee sees own

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const supabase = createServerClient();
  const { searchParams } = new URL(request.url);
  const employee_id = searchParams.get('employee_id');
  const date_from   = searchParams.get('from') || new Date().toISOString().slice(0, 7) + '-01';
  const date_to     = searchParams.get('to')   || new Date().toISOString().slice(0, 10);
  const role_filter = searchParams.get('role');

  let q = supabase
    .from('work_submissions')
    .select('*')
    .gte('submission_date', date_from)
    .lte('submission_date', date_to)
    .order('created_at', { ascending: false });

  if (employee_id) q = q.eq('employee_id', employee_id);
  if (role_filter) q = q.eq('role', role_filter);

  const { data, error } = await q;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, submissions: data || [] });
}

export async function POST(request) {
  const supabase = createServerClient();
  const body = await request.json();
  const { employee_id, employee_name, role, data: workData, submission_date } = body;

  if (!employee_name || !role) {
    return NextResponse.json({ success: false, error: 'Name aur role required hai' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('work_submissions')
    .insert({
      employee_id:     employee_id || null,
      employee_name,
      role,
      submission_date: submission_date || new Date().toISOString().slice(0, 10),
      data:            workData || {},
      created_at:      new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, submission: data });
}
