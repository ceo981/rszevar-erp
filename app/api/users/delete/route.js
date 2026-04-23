/**
 * POST /api/users/delete
 * ======================
 * Fully remove a team member from the ERP:
 *   1. Delete the Supabase auth.users row    (cascade → profiles row goes too)
 *   2. Clean up ERP references that would be orphaned and unused going forward
 *      (order_assignments whose user_id matches — history log entries preserve
 *       the name snapshot in text, so past records stay readable.)
 *
 * Security:
 *   - Caller MUST be logged in AND have role = 'super_admin'.
 *   - Cannot delete yourself.
 *   - Uses SUPABASE_SERVICE_ROLE_KEY for auth.admin ops (bypasses RLS safely
 *     because we've already checked the caller's role).
 *
 * Body: { user_id: "uuid" }
 * Returns: { success: true, deleted: { auth: true, profile: true } }
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export async function POST(request) {
  try {
    const { user_id } = await request.json();
    if (!user_id) {
      return NextResponse.json({ success: false, error: 'user_id required' }, { status: 400 });
    }

    // ── 1. Verify caller is super_admin ──────────────────────────────
    const authClient = await createServerClient();
    const { data: { user: caller } } = await authClient.auth.getUser();
    if (!caller) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (caller.id === user_id) {
      return NextResponse.json({ success: false, error: 'Apne aap ko delete nahi kar sakte' }, { status: 400 });
    }

    const { data: callerProfile } = await adminSupabase
      .from('profiles')
      .select('role, full_name, email')
      .eq('id', caller.id)
      .single();

    if (callerProfile?.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Sirf super admin ye kar sakta hai' }, { status: 403 });
    }

    // ── 2. Grab the target's info for an audit trail log ──────────────
    const { data: target } = await adminSupabase
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', user_id)
      .single();

    if (!target) {
      return NextResponse.json({ success: false, error: 'Ye user already delete ho chuka hai ya exist nahi karta' }, { status: 404 });
    }

    // ── 3. Clean up orphan-prone references ──────────────────────────
    // (past activity logs preserve performed_by as TEXT, so those stay intact.)
    // Future-facing assignments are cleared.
    try {
      await adminSupabase.from('order_assignments').delete().eq('assigned_to', user_id);
    } catch (e) {
      console.warn('[users/delete] order_assignments cleanup warn:', e?.message);
    }

    // ── 4. Delete the auth.users row. Profiles row drops via FK cascade. ─
    const { error: delAuthErr } = await adminSupabase.auth.admin.deleteUser(user_id);
    if (delAuthErr) {
      // Some Supabase setups don't have the profiles→auth.users FK configured
      // with ON DELETE CASCADE. Fallback: delete profile row explicitly.
      console.error('[users/delete] auth delete error:', delAuthErr.message);
      // Still try to kill the profile so the user can't log in
      await adminSupabase.from('profiles').delete().eq('id', user_id);
      return NextResponse.json({
        success: false,
        error: `Auth user delete failed: ${delAuthErr.message}. Profile row removed as safety net — inform IT.`,
      }, { status: 500 });
    }

    // Belt-and-braces: if cascade wasn't set, drop the profile too.
    await adminSupabase.from('profiles').delete().eq('id', user_id);

    return NextResponse.json({
      success: true,
      deleted: {
        auth: true,
        profile: true,
        target: { full_name: target.full_name, email: target.email, role: target.role },
        by: callerProfile?.full_name || callerProfile?.email || caller.email,
      },
    });
  } catch (e) {
    console.error('[users/delete] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
