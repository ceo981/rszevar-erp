// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR — lib/bot-brain/whatsapp-autoreply.js
// Decides whether to auto-reply to an incoming WhatsApp text, generates the
// reply with the shared brain, sends it, and logs it. Heavily gated for safety:
//   • Master switch: bot_settings.whatsapp_autoreply_enabled (default FALSE)
//   • Text-only (media/buttons ignored — a human handles those)
//   • Pauses if a HUMAN agent replied in this chat in the last 12h
//   • Pauses the conversation on handoff (bot_paused = true)
// Never throws — any failure just means "no auto-reply" (human handles it).
// ════════════════════════════════════════════════════════════════════════════

import { createServerClient } from '../supabase';
import { generateBotReply } from './reply';
import { sendText } from '../whatsapp';
import { handleOutgoingMessage } from '../whatsapp-inbox';

const HUMAN_TAKEOVER_HOURS = 12;

export async function maybeAutoReply({ conversationId, fromPhone, msgType, bodyText }) {
  try {
    if (msgType !== 'text') return;            // v1: text only
    if (!conversationId || !fromPhone) return;
    const incoming = String(bodyText || '').trim();
    if (!incoming) return;

    const db = createServerClient();

    // 1) Master switch
    const { data: settings } = await db
      .from('bot_settings')
      .select('whatsapp_autoreply_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (!settings || settings.whatsapp_autoreply_enabled !== true) return;

    // 2) Conversation-level pause
    const { data: conv } = await db
      .from('whatsapp_conversations')
      .select('id, bot_paused')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv || conv.bot_paused === true) return;

    // 3) Stay quiet around (a) a recent HUMAN reply, or (b) the order
    //    confirm/cancel auto-message — don't talk over the confirmation flow.
    const { data: lastOut } = await db
      .from('whatsapp_messages')
      .select('sent_by_system, created_at, metadata')
      .eq('conversation_id', conversationId)
      .eq('direction', 'out')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastOut) {
      const ageMin = (Date.now() - new Date(lastOut.created_at).getTime()) / 60000;
      // (a) a human agent is handling this chat
      if (lastOut.sent_by_system === false && ageMin < HUMAN_TAKEOVER_HOURS * 60) return;
      // (b) order confirm/cancel auto-message just went out → let it stand
      const ar = lastOut.metadata && lastOut.metadata.auto_reply;
      if ((ar === 'confirm' || ar === 'cancel') && ageMin < 2) return;
    }

    // 4) Recent history for context (last 12 messages, oldest→newest)
    const { data: msgs } = await db
      .from('whatsapp_messages')
      .select('direction, message_type, body, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(12);
    const history = (msgs || [])
      .reverse()
      .filter((m) => m.body && String(m.body).trim())
      .map((m) => ({ role: m.direction === 'in' ? 'user' : 'assistant', text: m.body }));
    if (history.length === 0) history.push({ role: 'user', text: incoming });

    // 5) Generate reply
    const { text, handoff } = await generateBotReply({ messages: history, channel: 'whatsapp' });

    // 6) Handoff → pause the bot for this chat so the team takes over
    if (handoff) {
      await db
        .from('whatsapp_conversations')
        .update({ bot_paused: true, bot_paused_at: new Date().toISOString() })
        .eq('id', conversationId);
      const hoMsg = text && text.trim()
        ? text
        : 'Main aap ki query team ko forward kar raha hun, wo jald aap ki madad karenge 😊';
      const r = await sendText(fromPhone, hoMsg);
      if (r?.sent) {
        await handleOutgoingMessage({
          phone: fromPhone, message_type: 'text', body: hoMsg,
          wa_message_id: r.message_id, sent_by_system: true,
          metadata: { auto_reply: 'bot', handoff: true },
        });
      }
      return;
    }

    // 7) Normal auto-reply
    if (!text || !text.trim()) return;
    const r = await sendText(fromPhone, text);
    if (r?.sent) {
      await handleOutgoingMessage({
        phone: fromPhone, message_type: 'text', body: text,
        wa_message_id: r.message_id, sent_by_system: true,
        metadata: { auto_reply: 'bot' },
      });
    }
  } catch (e) {
    console.error('[wa-autoreply] error:', e?.message);
  }
}
