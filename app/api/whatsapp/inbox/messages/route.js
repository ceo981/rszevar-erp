/**
 * GET /api/whatsapp/inbox/messages?conversation_id=XXX
 * ====================================================
 * Load messages for a specific conversation, ordered by created_at ASC.
 * Also returns customer's recent orders (for context panel in UI).
 *
 * Query params:
 *   ?conversation_id=  — required UUID
 *   ?limit=100         — last N messages (default 200, max 500)
 *
 * Returns:
 *   { success, conversation, messages, orders }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversation_id');
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '200', 10)));

    if (!conversationId) {
      return NextResponse.json(
        { success: false, error: 'conversation_id required' },
        { status: 400 }
      );
    }

    // Fetch conversation
    const { data: conversation, error: convErr } = await supabase
      .from('whatsapp_conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (convErr || !conversation) {
      return NextResponse.json(
        { success: false, error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Fetch messages (latest N, reversed so oldest first)
    const { data: messagesDesc, error: msgErr } = await supabase
      .from('whatsapp_messages')
      .select('id, direction, message_type, body, metadata, sent_by_user_id, sent_by_system, wa_status, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (msgErr) throw msgErr;

    const messages = (messagesDesc || []).reverse();

    // Fetch recent orders for this customer (for context panel)
    const phone = conversation.customer_phone;
    const phoneVariants = [
      phone,
      '+' + phone,
      '0' + phone.slice(2),
    ];

    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_number, status, payment_status, total_amount, created_at, dispatched_courier, tracking_number')
      .in('customer_phone', phoneVariants)
      .order('created_at', { ascending: false })
      .limit(10);

    return NextResponse.json({
      success: true,
      conversation,
      messages,
      orders: orders || [],
    });
  } catch (e) {
    console.error('[inbox/messages] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
