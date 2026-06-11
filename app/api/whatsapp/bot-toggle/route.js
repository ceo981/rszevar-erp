// ============================================================================
// RS ZEVAR ERP — WhatsApp bot auto-reply master switch
// GET  /api/whatsapp/bot-toggle            → { enabled }
// POST /api/whatsapp/bot-toggle {enabled}   → set on/off (super_admin only)
// ============================================================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/permissions';
import { createServerClient } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const db = createServerClient();
    const { data } = await db
      .from('bot_settings')
      .select('whatsapp_autoreply_enabled')
      .eq('id', 1)
      .maybeSingle();

    return NextResponse.json({ success: true, enabled: data?.whatsapp_autoreply_enabled === true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (user.profile.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Only the CEO can change this' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const enabled = body.enabled === true;

    const db = createServerClient();
    const { error } = await db
      .from('bot_settings')
      .upsert({ id: 1, whatsapp_autoreply_enabled: enabled, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;

    return NextResponse.json({ success: true, enabled });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
