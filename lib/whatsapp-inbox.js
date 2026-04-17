/**
 * RS ZEVAR ERP — WhatsApp Inbox Helpers
 * =====================================
 * Centralized functions for saving WhatsApp messages to DB.
 * Handles:
 *   - Incoming messages from Meta webhook (text, button, media, etc.)
 *   - Outgoing messages sent by ERP (auto-replies, manual replies, templates)
 *   - Conversation upsert with unread tracking and customer name matching
 *
 * Called from:
 *   - app/api/whatsapp/webhook/route.js (incoming + auto-replies)
 *   - app/api/whatsapp/inbox/send/route.js (manual replies — Phase 3)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Normalize phone to E.164-without-plus (e.g. 923001234567).
 * PK defaults applied for 10-digit or 0-prefixed numbers.
 */
export function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('92')) return p;
  if (p.startsWith('0')) return '92' + p.slice(1);
  if (p.length === 10 && p.startsWith('3')) return '92' + p;
  return p;
}

/**
 * Build a short preview string for conversation list.
 */
function previewForMessage(messageType, body, metadata) {
  if (body && body.trim()) {
    const clean = body.trim();
    return clean.length > 100 ? clean.slice(0, 100) + '…' : clean;
  }
  switch (messageType) {
    case 'image':       return '📷 Image';
    case 'video':       return '🎥 Video';
    case 'audio':       return '🎵 Audio';
    case 'document':    return '📄 Document';
    case 'location':    return '📍 Location';
    case 'sticker':     return '🗯 Sticker';
    case 'contacts':    return '👤 Contact';
    case 'button':      return '▶ ' + (metadata?.button_text || 'Button');
    case 'interactive': return '▶ ' + (metadata?.button_text || 'Button');
    case 'template':    return '📤 ' + (metadata?.template_name || 'Template');
    default:            return `[${messageType}]`;
  }
}

/**
 * Upsert conversation row. Returns conversation_id.
 * Auto-matches customer_name from orders table if not provided.
 */
async function upsertConversation({
  phone,
  wa_name,
  customer_name,
  last_message_text,
  last_message_direction,
  last_message_at,
  increment_unread = 0,
}) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  // Check existing
  const { data: existing } = await supabase
    .from('whatsapp_conversations')
    .select('id, customer_name, customer_wa_name, unread_count')
    .eq('customer_phone', normalized)
    .maybeSingle();

  const ts = last_message_at || new Date().toISOString();

  if (existing) {
    const newUnread = Math.max(0, (existing.unread_count || 0) + increment_unread);
    const patch = {
      last_message_text,
      last_message_direction,
      last_message_at: ts,
      unread_count: newUnread,
    };
    // Fill in missing name fields if we have new info
    if (!existing.customer_wa_name && wa_name) patch.customer_wa_name = wa_name;
    if (!existing.customer_name && customer_name) patch.customer_name = customer_name;

    await supabase.from('whatsapp_conversations').update(patch).eq('id', existing.id);
    return existing.id;
  }

  // New conversation — try to match customer_name from orders
  let matchedName = customer_name || null;
  if (!matchedName) {
    try {
      // Orders might have phone in multiple formats — try a few
      const phoneVariants = [
        normalized,                 // 923001234567
        '+' + normalized,           // +923001234567
        '0' + normalized.slice(2),  // 03001234567
      ];
      const { data: order } = await supabase
        .from('orders')
        .select('customer_name')
        .in('customer_phone', phoneVariants)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (order?.customer_name) matchedName = order.customer_name;
    } catch (_) {
      // ignore — name match is best-effort
    }
  }

  const { data: created, error: insErr } = await supabase
    .from('whatsapp_conversations')
    .insert({
      customer_phone: normalized,
      customer_name: matchedName,
      customer_wa_name: wa_name,
      last_message_text,
      last_message_direction,
      last_message_at: ts,
      unread_count: Math.max(0, increment_unread),
    })
    .select('id')
    .single();

  if (insErr) {
    console.error('[whatsapp-inbox] create conversation error:', insErr.message);
    return null;
  }
  return created?.id || null;
}

/**
 * Insert a message row. Idempotent if wa_message_id is provided.
 */
async function saveMessage({
  conversation_id,
  wa_message_id,
  direction,
  message_type,
  body,
  metadata = {},
  raw_payload,
  sent_by_user_id = null,
  sent_by_system = false,
  wa_status = null,
  created_at,
}) {
  if (!conversation_id) return null;

  // Dedup by wa_message_id if provided
  if (wa_message_id) {
    const { data: existing } = await supabase
      .from('whatsapp_messages')
      .select('id')
      .eq('wa_message_id', wa_message_id)
      .maybeSingle();
    if (existing) return existing.id;
  }

  const { data, error } = await supabase
    .from('whatsapp_messages')
    .insert({
      conversation_id,
      wa_message_id: wa_message_id || null,
      direction,
      message_type,
      body: body || null,
      metadata,
      raw_payload: raw_payload || null,
      sent_by_user_id,
      sent_by_system,
      wa_status,
      created_at: created_at || new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('[whatsapp-inbox] saveMessage error:', error.message);
    return null;
  }
  return data?.id || null;
}

/**
 * Handle an incoming Meta webhook message object.
 * Extracts type-specific fields, upserts conversation, saves message.
 */
export async function handleIncomingMessage(metaMessage, metaContact) {
  try {
    if (!metaMessage?.from || !metaMessage?.id) return null;

    const fromPhone = metaMessage.from;
    const waMessageId = metaMessage.id;
    const msgType = metaMessage.type || 'unknown';
    const waName = metaContact?.profile?.name || null;

    let body = null;
    let metadata = {};

    switch (msgType) {
      case 'text':
        body = metaMessage.text?.body || null;
        break;

      case 'button':
        body = metaMessage.button?.text || null;
        metadata = {
          button_text: metaMessage.button?.text,
          button_payload: metaMessage.button?.payload,
        };
        break;

      case 'interactive': {
        const br = metaMessage.interactive?.button_reply;
        const lr = metaMessage.interactive?.list_reply;
        body = br?.title || lr?.title || null;
        metadata = {
          interactive_type: metaMessage.interactive?.type,
          button_text: br?.title || lr?.title,
          button_id: br?.id || lr?.id,
          reply_description: lr?.description,
        };
        break;
      }

      case 'image':
      case 'video':
      case 'audio':
      case 'document':
      case 'sticker':
        body = metaMessage[msgType]?.caption || null;
        metadata = {
          media_id: metaMessage[msgType]?.id,
          mime_type: metaMessage[msgType]?.mime_type,
          sha256: metaMessage[msgType]?.sha256,
          filename: metaMessage[msgType]?.filename,
        };
        break;

      case 'location':
        body = metaMessage.location?.name || 'Location shared';
        metadata = {
          latitude: metaMessage.location?.latitude,
          longitude: metaMessage.location?.longitude,
          address: metaMessage.location?.address,
          name: metaMessage.location?.name,
        };
        break;

      case 'contacts':
        body = (metaMessage.contacts?.[0]?.name?.formatted_name) || 'Contact shared';
        metadata = { contacts: metaMessage.contacts };
        break;

      default:
        body = `[${msgType}]`;
    }

    const preview = previewForMessage(msgType, body, metadata);
    const timestamp = metaMessage.timestamp
      ? new Date(parseInt(metaMessage.timestamp, 10) * 1000).toISOString()
      : new Date().toISOString();

    const conversationId = await upsertConversation({
      phone: fromPhone,
      wa_name: waName,
      last_message_text: preview,
      last_message_direction: 'in',
      last_message_at: timestamp,
      increment_unread: 1,
    });

    if (!conversationId) {
      console.error('[whatsapp-inbox] failed to upsert conversation for', fromPhone);
      return null;
    }

    const messageId = await saveMessage({
      conversation_id: conversationId,
      wa_message_id: waMessageId,
      direction: 'in',
      message_type: msgType,
      body,
      metadata,
      raw_payload: metaMessage,
      created_at: timestamp,
    });

    return { conversationId, messageId };
  } catch (e) {
    console.error('[whatsapp-inbox] handleIncomingMessage error:', e.message);
    return null;
  }
}

/**
 * Save an outgoing message after successful send via Meta API.
 * Call this AFTER sendText / sendTemplate returns success.
 */
export async function handleOutgoingMessage({
  phone,
  message_type = 'text',
  body,
  metadata = {},
  wa_message_id,
  sent_by_user_id = null,
  sent_by_system = false,
  raw_payload,
}) {
  try {
    if (!phone) return null;

    const preview = previewForMessage(message_type, body, metadata);
    const timestamp = new Date().toISOString();

    const conversationId = await upsertConversation({
      phone,
      last_message_text: preview,
      last_message_direction: 'out',
      last_message_at: timestamp,
      // No unread increment for outgoing — we sent it ourselves
    });

    if (!conversationId) return null;

    const messageId = await saveMessage({
      conversation_id: conversationId,
      wa_message_id,
      direction: 'out',
      message_type,
      body,
      metadata,
      raw_payload,
      sent_by_user_id,
      sent_by_system,
      wa_status: 'sent',
      created_at: timestamp,
    });

    return { conversationId, messageId };
  } catch (e) {
    console.error('[whatsapp-inbox] handleOutgoingMessage error:', e.message);
    return null;
  }
}
