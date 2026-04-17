/**
 * POST /api/whatsapp/inbox/mark-read
 * ==================================
 * Reset unread_count to 0 for a conversation.
 * Called by UI when a conversation is opened.
 *
 * Body:
 *   { conversation_id: "uuid" }
 *
 * Returns:
 *   { success: true }
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

    const { error } = await supabase
      .from('whatsapp_conversations')
      .update({ unread_count: 0 })
      .eq('id', conversation_id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[inbox/mark-read] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
