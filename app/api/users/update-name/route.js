/**
 * POST /api/users/update-name
 * ===========================
 * Update any user's full_name. Super admin can edit anyone; a regular
 * user can only edit their own name (self-service from sidebar).
 *
 * Body: { user_id: "uuid", full_name: "string" }
 * Returns: { success: true, full_name }
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
    const { user_id, full_name } = await request.json();

    if (!user_id || !full_name || !full_name.trim()) {
      return NextResponse.json(
        { success: false, error: 'user_id aur full_name dono chahiye' },
        { status: 400 }
      );
    }

    const cleanName = full_name.trim().slice(0, 80);

    // ── Verify caller ───────────────────────────────────────────────
    const authClient = await createServerClient();
    const { data: { user: caller } } = await authClient.auth.getUser();
    if (!caller) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    // Self-edit is always allowed. Otherwise, must be super_admin.
    const isSelf = caller.id === user_id;
    if (!isSelf) {
      const { data: callerProfile } = await adminSupabase
        .from('profiles')
        .select('role')
        .eq('id', caller.id)
        .single();
      if (callerProfile?.role !== 'super_admin') {
        return NextResponse.json(
          { success: false, error: 'Sirf apna naam edit kar sakte ho (ya super admin kisi ka bhi)' },
          { status: 403 }
        );
      }
    }

    // ── Update ──────────────────────────────────────────────────────
    const { error } = await adminSupabase
      .from('profiles')
      .update({ full_name: cleanName, updated_at: new Date().toISOString() })
      .eq('id', user_id);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, full_name: cleanName });
  } catch (e) {
    console.error('[users/update-name] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
