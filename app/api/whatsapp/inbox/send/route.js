/**
 * POST /api/whatsapp/inbox/send
 * =============================
 * Send a manual text reply from team member to customer.
 * Only works within 24hr customer service window (Meta's rule).
 *
 * SECURITY (May 2026):
 *   This route bypasses middleware auth (because /api/whatsapp/* is exempted
 *   for Meta's incoming webhook). To prevent random internet POSTs from
 *   sending arbitrary messages from RS ZEVAR's WhatsApp Business number,
 *   we now do an EXPLICIT auth check at the top of the handler. The user_id
 *   used in the inbox log is derived from the authenticated session (NOT
 *   the request body) — so impersonation is not possible.
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
import { createClient as createAuthClient } from '@/lib/supabase/server';
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
    // ── SECURITY FIX (May 2026) — Explicit auth check ─────────────────────
    // /api/whatsapp/* middleware bypass kar deti hai (Meta webhook ke liye
    // zaroori hai). Lekin yeh send route admin-only honi chahiye — pehle
    // koi bhi internet se POST karke RS ZEVAR ke WhatsApp Business number
    // se arbitrary text customers ko bhej sakta tha. Ab session se logged-in
    // user verify karte hain.
    const authClient = await createAuthClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Fetch profile to get email + verify is_active
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || profile.is_active === false) {
      return NextResponse.json(
        { success: false, error: 'Account not active' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { conversation_id, phone: phoneRaw, text } = body;

    // SECURITY: user_id + user_email AB session se derive hote hain — body se
    // accept karna impersonation risk tha. Frontend ne galti se kuch bheja bhi
    // to ignore karenge.
    const sentByUserId = user.id;
    const sentByEmail = profile.email || user.email || null;

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
        .maybeSingle();
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

    // Save outgoing message to inbox — attribution from authenticated session
    const saved = await handleOutgoingMessage({
      phone,
      message_type: 'text',
      body: text,
      wa_message_id: result.message_id,
      sent_by_user_id: sentByUserId,
      sent_by_system: false,
      metadata: sentByEmail ? { sent_by_email: sentByEmail } : {},
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
