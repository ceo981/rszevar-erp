/**
 * RS ZEVAR ERP — WhatsApp Utility (Meta Cloud API)
 * =================================================
 * Official Meta Cloud API — no third party, no monthly fee.
 * Only pay Meta's per-conversation rate (very cheap for Pakistan).
 *
 * Env vars needed (add in Vercel):
 *   WHATSAPP_PHONE_NUMBER_ID  — from Meta Developer dashboard
 *   WHATSAPP_ACCESS_TOKEN     — from Meta Developer dashboard
 */

const META_API_VERSION = 'v20.0';

/**
 * Format Pakistani phone number to E.164 format.
 * 03001234567 → +923001234567
 */
export function formatPhone(phone) {
  if (!phone) return null;
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('92')) return `+${p}`;
  if (p.startsWith('0')) return `+92${p.slice(1)}`;
  if (p.length === 10 && p.startsWith('3')) return `+92${p}`;
  return `+${p}`;
}

// ─── Internal: centralized Meta message POST ───────────────────────────────
async function postToMeta(payload) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.warn('[whatsapp] Meta Cloud API not configured — skipping');
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json();
    if (data.error) {
      console.error('[whatsapp] Meta API error:', data.error);
      return { sent: false, reason: data.error.message, raw: data };
    }
    return { sent: true, message_id: data.messages?.[0]?.id, raw: data };
  } catch (e) {
    console.error('[whatsapp] Fetch error:', e.message);
    return { sent: false, reason: e.message };
  }
}

/**
 * Core: Send template message via Meta Cloud API.
 * Templates must be pre-approved by Meta before use.
 */
export async function sendTemplate(phone, templateName, components = [], language = 'en') {
  const to = formatPhone(phone);
  if (!to) return { sent: false, reason: 'invalid_phone' };

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length > 0 && { components }),
    },
  };
  return postToMeta(body);
}

/**
 * Core: Send freeform text (only within 24hr customer-initiated window).
 */
export async function sendText(phone, text) {
  const to = formatPhone(phone);
  if (!to) return { sent: false, reason: 'invalid_phone' };

  return postToMeta({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  });
}

// ─── NEW: Media sending (image / video / audio / document / voice note) ────
//
// Use with a media_id returned from uploadMediaToMeta() (see lib/whatsapp-media.js).
// `type` is one of: 'image' | 'video' | 'audio' | 'document' | 'sticker'.
// Optional `caption` (not valid for audio/sticker), `filename` (document only),
// `voice` (audio: true → renders as voice note on recipient's phone).
export async function sendMedia(phone, { type, media_id, caption, filename, voice }) {
  const to = formatPhone(phone);
  if (!to) return { sent: false, reason: 'invalid_phone' };
  if (!type || !media_id) return { sent: false, reason: 'missing_type_or_media_id' };

  const mediaObj = { id: media_id };
  if (caption && (type === 'image' || type === 'video' || type === 'document')) {
    mediaObj.caption = caption;
  }
  if (filename && type === 'document') {
    mediaObj.filename = filename;
  }
  if (voice && type === 'audio') {
    mediaObj.voice = true;
  }

  return postToMeta({
    messaging_product: 'whatsapp',
    to,
    type,
    [type]: mediaObj,
  });
}

// ─── Convenience wrappers ────────────────────────────────────────────────────

/**
 * Order confirmation to customer.
 */
export async function sendOrderConfirmation({ phone, customer_name, order_number, total_amount }) {
  const firstName = (customer_name || 'Customer').split(' ')[0];
  const amount = total_amount ? Number(total_amount).toLocaleString() : '0';

  return sendTemplate(phone, 'rs_zevar_order_confirm', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: firstName },
        { type: 'text', text: order_number || 'N/A' },
        { type: 'text', text: amount },
      ],
    },
  ]);
}

/**
 * Dispatch notification to customer.
 */
export async function sendOrderDispatched({ phone, customer_name, order_number, items, courier, tracking_number }) {
  const firstName = (customer_name || 'Customer').split(' ')[0];
  const itemsText = items || 'N/A';

  return sendTemplate(phone, 'rs_zevar_order_dispatched', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: firstName },
        { type: 'text', text: order_number || 'N/A' },
        { type: 'text', text: itemsText },
        { type: 'text', text: courier || 'N/A' },
        { type: 'text', text: tracking_number || 'N/A' },
      ],
    },
  ]);
}

/**
 * Complaint alert to employee (freeform text).
 */
export async function sendComplaintAlert({ phone, order_number, category, customer_name, customer_phone }) {
  const text = `⚠️ RS ZEVAR ERP\n\nAapko complaint assign hui:\n\nOrder: ${order_number || 'N/A'}\nIssue: ${category || 'N/A'}\nCustomer: ${customer_name || 'N/A'}${customer_phone ? `\nPhone: ${customer_phone}` : ''}\n\nERP mein check karein.`;
  return sendText(phone, text);
}

// Backward compat aliases (shopify-webhook.js uses these)
export const sendWhatsApp = sendText;
export const msgOrderConfirmation = ({ order_number, total_amount, customer_name }) => {
  const firstName = (customer_name || 'Customer').split(' ')[0];
  return `RS ZEVAR: Assalam o Alaikum ${firstName}! Order ${order_number} receive hua. Amount: Rs. ${total_amount ? Number(total_amount).toLocaleString() : 'N/A'}. Jald dispatch karein ge!`;
};
export const msgOrderDispatched = ({ order_number, courier, tracking_number, customer_name }) => {
  const firstName = (customer_name || 'Customer').split(' ')[0];
  return `RS ZEVAR: ${firstName}, aapka order ${order_number} dispatch ho gaya! Courier: ${courier}. Tracking: ${tracking_number || 'N/A'}. 1-3 din mein deliver hoga.`;
};
export const msgComplaintAssigned = ({ order_number, category, customer_name, customer_phone }) =>
  `RS ZEVAR ERP: Complaint assign hui. Order: ${order_number}. Issue: ${category}. Customer: ${customer_name}${customer_phone ? ` (${customer_phone})` : ''}.`;

/**
 * Interactive order confirmation with buttons (to customer).
 */
export async function sendOrderConfirmInteractive({ phone, customer_name, order_number, total_amount, items, address }) {
  const firstName = (customer_name || 'Customer').split(' ')[0];
  const amount = total_amount ? Number(total_amount).toLocaleString() : '0';
  const itemsText = items || 'N/A';
  const addressText = address || 'N/A';

  return sendTemplate(phone, 'rs_zevar_order_interactive', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: firstName },
        { type: 'text', text: order_number || 'N/A' },
        { type: 'text', text: itemsText },
        { type: 'text', text: amount },
        { type: 'text', text: addressText },
      ],
    },
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [{ type: 'payload', payload: `CONFIRM_${order_number}` }],
    },
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: '1',
      parameters: [{ type: 'payload', payload: `CANCEL_${order_number}` }],
    },
  ]);
}
