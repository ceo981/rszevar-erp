/**
 * POST /api/users/update-shared
 * =============================
 * Update a user's shared-login config (super_admin only).
 *
 * Body:
 *   {
 *     user_id: "uuid",
 *     is_shared_login: boolean,
 *     shared_staff_ids: ["emp-uuid-1", "emp-uuid-2", ...]
 *   }
 * Returns: { success: true }
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
    const { user_id, is_shared_login, shared_staff_ids } = await request.json();
    if (!user_id) {
      return NextResponse.json({ success: false, error: 'user_id required' }, { status: 400 });
    }

    // Verify caller is super_admin
    const authClient = await createServerClient();
    const { data: { user: caller } } = await authClient.auth.getUser();
    if (!caller) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    const { data: callerProfile } = await adminSupabase
      .from('profiles').select('role').eq('id', caller.id).single();
    if (callerProfile?.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Super admin only' }, { status: 403 });
    }

    // Validate employee IDs
    const clean = Array.isArray(shared_staff_ids)
      ? shared_staff_ids.filter(id => typeof id === 'string' && id.length > 0)
      : [];

    const { error } = await adminSupabase
      .from('profiles')
      .update({
        is_shared_login: !!is_shared_login,
        shared_staff_ids: clean,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user_id);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[users/update-shared] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
