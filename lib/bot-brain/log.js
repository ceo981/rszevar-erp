// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR — lib/bot-brain/log.js
// Saves each storefront/WhatsApp conversation to bot_conversations so the team
// can follow up (complaints/handoffs) and review what the bot couldn't answer.
// Best-effort: any failure here must NEVER break the chat response.
// ════════════════════════════════════════════════════════════════════════════

import { createServerClient } from '../supabase';

function extractOrderRef(text) {
  if (!text) return null;
  var s = String(text);
  var m = s.match(/ZEVAR[-\s]?(\d{4,})/i);
  if (m) return 'ZEVAR-' + m[1];
  var n = s.match(/\b(\d{5,7})\b/); // raw order numbers customers often paste
  return n ? n[1] : null;
}

export async function logConversation({ sessionId, channel, messages, reply, handoff }) {
  if (!sessionId) return;
  try {
    const db = createServerClient();

    const transcript = (Array.isArray(messages) ? messages : []).map((m) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
      text: String(m.text || '').slice(0, 1500),
    }));
    if (reply) transcript.push({ role: 'assistant', text: String(reply).slice(0, 1500) });

    const lastUser = [...(messages || [])].reverse().find((m) => m.role === 'user');
    const last_message = lastUser ? String(lastUser.text || '').slice(0, 400) : null;

    // order ref from any user turn
    let order_ref = null;
    for (const t of transcript) { if (t.role === 'user') { const r = extractOrderRef(t.text); if (r) { order_ref = r; break; } } }

    // Keep handoff sticky (once escalated, stays flagged for review)
    let stickyHandoff = !!handoff;
    if (!stickyHandoff) {
      const { data: existing } = await db
        .from('bot_conversations')
        .select('handoff')
        .eq('session_id', sessionId)
        .maybeSingle();
      if (existing && existing.handoff) stickyHandoff = true;
    }

    await db.from('bot_conversations').upsert(
      {
        session_id: sessionId,
        channel: channel || 'website',
        transcript,
        last_message,
        message_count: transcript.length,
        handoff: stickyHandoff,
        order_ref,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' }
    );
  } catch (e) {
    // swallow — logging must never affect the customer reply
  }
}
