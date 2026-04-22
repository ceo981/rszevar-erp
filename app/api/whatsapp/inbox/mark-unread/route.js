/**
 * POST /api/whatsapp/inbox/mark-unread
 * ====================================
 * Manually flag a conversation as unread so the team sees it on the
 * next refresh and doesn't lose it. Sets unread_count to max(1, current)
 * — i.e. only raises, never overwrites an already-counting badge.
 *
 * Body: { conversation_id: "uuid" }
 * Returns: { success: true }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { conversation_id } = await request.json();

    if (!conversation_id) {
      return NextResponse.json(
        { success: false, error: 'conversation_id required' },
        { status: 400 }
      );
    }

    // Fetch current count first so we don't clobber an existing higher value
    const { data: conv, error: readErr } = await supabase
      .from('whatsapp_conversations')
      .select('unread_count')
      .eq('id', conversation_id)
      .single();

    if (readErr) throw readErr;

    const newCount = Math.max(1, Number(conv?.unread_count || 0) || 0, 1);

    const { error } = await supabase
      .from('whatsapp_conversations')
      .update({ unread_count: newCount })
      .eq('id', conversation_id);

    if (error) throw error;

    return NextResponse.json({ success: true, unread_count: newCount });
  } catch (e) {
    console.error('[inbox/mark-unread] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
