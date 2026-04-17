/**
 * POST /api/whatsapp/inbox/send
 * =============================
 * Send a manual text reply from team member to customer.
 * Only works within 24hr customer service window (Meta's rule).
 *
 * Body:
 *   { conversation_id: "uuid", text: "Hello!" }
 *   OR
 *   { phone: "923001234567", text: "Hello!" }
 *
 * Returns:
 *   { success, message_id, error? }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendText } from '../../../../../lib/whatsapp';
import { handleOutgoingMessage } from '../../../../../lib/whatsapp-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const body = await request.json();
    const { conversation_id, phone: phoneRaw, text, user_id, user_email } = body;

    if (!text || !text.trim()) {
      return NextResponse.json(
        { success: false, error: 'text is required' },
        { status: 400 }
      );
    }
    if (text.length > 4096) {
      return NextResponse.json(
        { success: false, error: 'Message too long (max 4096 chars)' },
        { status: 400 }
      );
    }

    // Resolve phone
    let phone = phoneRaw;
    if (!phone && conversation_id) {
      const { data: conv } = await supabase
        .from('whatsapp_conversations')
        .select('customer_phone')
        .eq('id', conversation_id)
        .single();
      phone = conv?.customer_phone;
    }
    if (!phone) {
      return NextResponse.json(
        { success: false, error: 'No recipient phone (provide conversation_id or phone)' },
        { status: 400 }
      );
    }

    // Send via Meta Cloud API
    const result = await sendText(phone, text);
    if (!result.sent) {
      return NextResponse.json(
        { success: false, error: result.reason || 'Send failed' },
        { status: 500 }
      );
    }

    // Save outgoing message to inbox
    const saved = await handleOutgoingMessage({
      phone,
      message_type: 'text',
      body: text,
      wa_message_id: result.message_id,
      sent_by_user_id: user_id || null,
      sent_by_system: false,
      metadata: user_email ? { sent_by_email: user_email } : {},
    });

    return NextResponse.json({
      success: true,
      message_id: result.message_id,
      conversation_id: saved?.conversationId || conversation_id,
    });
  } catch (e) {
    console.error('[inbox/send] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
