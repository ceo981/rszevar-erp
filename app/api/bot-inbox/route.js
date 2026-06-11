// ============================================================================
// RS ZEVAR ERP — Bot Inbox API
// GET   /api/bot-inbox?filter=needs|all|resolved   → list conversations
// PATCH /api/bot-inbox   body:{ id, status }       → update status (super_admin)
// ============================================================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../lib/permissions';
import { createServerClient } from '../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'needs';

    const supabase = createServerClient();
    let q = supabase
      .from('bot_conversations')
      .select('id, session_id, channel, transcript, last_message, message_count, handoff, order_ref, status, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(200);

    if (filter === 'needs') q = q.eq('handoff', true).neq('status', 'resolved');
    else if (filter === 'resolved') q = q.eq('status', 'resolved');
    // 'all' → no extra filter

    const { data, error } = await q;
    if (error) throw error;

    // Counts for tab badges
    const [needs, resolved] = await Promise.all([
      supabase.from('bot_conversations').select('id', { count: 'exact', head: true }).eq('handoff', true).neq('status', 'resolved'),
      supabase.from('bot_conversations').select('id', { count: 'exact', head: true }).eq('status', 'resolved'),
    ]);

    return NextResponse.json({
      success: true,
      conversations: data || [],
      counts: { needs: needs.count || 0, resolved: resolved.count || 0 },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (user.profile.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Only super admin can update status' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { id, status } = body;
    if (!id || !['new', 'reviewed', 'resolved'].includes(status)) {
      return NextResponse.json({ success: false, error: 'id and valid status required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('bot_conversations')
      .update({ status })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, row: data });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
