// ============================================================================
// RS ZEVAR ERP — Settings Audit Log API
// GET /api/settings/audit — recent settings changes (super_admin only)
// ============================================================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/permissions';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.profile.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Only super admin can view audit log' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const key = searchParams.get('key');

    const supabase = createServerClient();
    let query = supabase
      .from('settings_audit_log')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(limit);

    if (key) query = query.eq('setting_key', key);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      success: true,
      entries: data || [],
      count: data?.length || 0,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
