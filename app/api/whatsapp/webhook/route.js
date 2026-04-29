/**
 * RS ZEVAR ERP — WhatsApp Webhook  (UPDATED Apr 2026 — media caching)
 * ====================================================================
 * GET  → Meta webhook verification (one-time setup)
 * POST → Incoming messages (text + media), button replies, status updates
 *
 * NEW in this version:
 *  - Inbound media (image/video/audio/document/sticker) is downloaded
 *    from Meta right after saving, cached in Supabase Storage, and the
 *    public URL is written back to message.metadata.media_url. This is
 *    what lets the inbox UI render voice notes, images, videos etc.
 *    (Meta's raw media URLs expire in ~5 minutes, so we MUST cache.)
 *
 * ── TAG LOGIC (unchanged — CEO protocol) ──
 *   Message sent          → add 'confirmation pending'   [ERP: no change]
 *   Customer confirms     → add 'whatsapp_confirmed'     + remove 'confirmation pending'
 *   Customer cancels      → add 'whatsapp_cancelled'     + 'whatsapp cancelled' + remove 'confirmation pending'
 *   Number not on WhatsApp → add 'no whatsapp'           + remove 'confirmation pending' [ERP: no change]
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendText } from '../../../../lib/whatsapp';
import { updateShopifyOrderTags } from '../../../../lib/shopify';
import { handleIncomingMessage, handleOutgoingMessage } from '../../../../lib/whatsapp-inbox';
import { enrichInboundMessageMedia } from '../../../../lib/whatsapp-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Meta error codes — specifically for "recipient not on WhatsApp"
const NO_WHATSAPP_ERROR_CODES = new Set([131026]);

// ─── GET: Meta webhook verification ────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[whatsapp-webhook] Verified ✅');
    return new Response(challenge, { status: 200 });
  }

  return new Response('Forbidden', { status: 403 });
}

// ─── POST: Incoming messages + status updates from Meta ────────────────────
export async function POST(request) {
  try {
    const body = await request.json();
    const entries = body?.entry || [];

    // ── 1. Save ALL incoming messages to inbox, then cache any media ──
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const messages = change.value?.messages || [];
        const contacts = change.value?.contacts || [];
        for (const msg of messages) {
          const contact = contacts.find(c => c.wa_id === msg.from);
          try {
            const saved = await handleIncomingMessage(msg, contact);
            // NEW: if this was a media message, download from Meta → Supabase Storage
            // so the UI can play/show it. Failure is non-fatal — UI will show a
            // "media unavailable" fallback and you can manually refresh.
            if (saved?.messageId && ['image', 'video', 'audio', 'document', 'sticker'].includes(msg.type)) {
              try {
                await enrichInboundMessageMedia(saved.messageId);
              } catch (mediaErr) {
                console.error('[whatsapp-webhook] media cache error:', mediaErr?.message);
              }
            }
          } catch (e) {
            console.error('[whatsapp-webhook] incoming save error:', e.message);
          }
        }
      }
    }

    // ── 2. Handle message status updates (for no-whatsapp detection) ──
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const statuses = change.value?.statuses || [];
        for (const st of statuses) {
          try {
            await handleStatusUpdate(st);
          } catch (e) {
            console.error('[whatsapp-webhook] status update error:', e.message);
          }
        }
      }
    }

    // ── 3. Handle button/interactive replies (existing logic) ──
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    let payload = null;
    let fromPhone = message?.from;

    if (message?.type === 'button') {
      payload = message?.button?.payload;
    } else if (message?.type === 'interactive') {
      payload = message?.interactive?.button_reply?.id;
    }

    if (!payload || !fromPhone) {
      return NextResponse.json({ received: true });
    }

    console.log(`[whatsapp-webhook] Button: ${payload} from ${fromPhone}`);

    const underscoreIdx = payload.indexOf('_');
    const action        = payload.substring(0, underscoreIdx);   // CONFIRM | CANCEL
    const orderNumber   = payload.substring(underscoreIdx + 1);  // ZEVAR-123456

    if (!orderNumber || !['CONFIRM', 'CANCEL'].includes(action)) {
      console.warn('[whatsapp-webhook] Unknown payload:', payload);
      return NextResponse.json({ received: true });
    }

    const { data: order, error } = await supabase
      .from('orders')
      .select('id, status, shopify_order_id, order_number')
      .eq('order_number', orderNumber)
      .single();

    if (error || !order) {
      console.error('[whatsapp-webhook] Order not found:', orderNumber);
      return NextResponse.json({ received: true });
    }

    const lockedStatuses = ['confirmed', 'on_packing', 'packed', 'dispatched', 'delivered', 'cancelled', 'returned', 'rto'];
    if (lockedStatuses.includes(order.status)) {
      console.log(`[whatsapp-webhook] Order ${orderNumber} already ${order.status} — ignoring button click`);
      if (order.shopify_order_id) {
        try {
          await updateShopifyOrderTags(order.shopify_order_id, [], ['confirmation pending']);
        } catch (e) { console.error('[whatsapp-webhook] cleanup tag error:', e.message); }
      }
      return NextResponse.json({ received: true });
    }

    const nowIso = new Date().toISOString();

    // ── CONFIRM ────────────────────────────────────────────────────────────
    if (action === 'CONFIRM') {
      await supabase.from('orders').update({
        status: 'confirmed',
        confirmed_at: nowIso,
        updated_at: nowIso,
      }).eq('id', order.id);

      if (order.shopify_order_id) {
        try {
          await updateShopifyOrderTags(
            order.shopify_order_id,
            ['whatsapp_confirmed'],
            ['confirmation pending'],
          );
          console.log(`[whatsapp-webhook] Tags updated: +whatsapp_confirmed, -confirmation pending`);
        } catch (e) {
          console.error('[whatsapp-webhook] confirm tag error:', e.message);
        }
      }

      await supabase.from('order_activity_log').insert({
        order_id: order.id,
        action: 'confirmed',
        notes: `Auto-confirmed via WhatsApp by customer (${fromPhone})`,
        performed_by: 'WhatsApp Customer',
        performed_at: nowIso,
      });

      console.log(`[whatsapp-webhook] ✅ Order ${orderNumber} confirmed`);

      const confirmMsg =
        `Thank you for confirming your order ${orderNumber}.\n\n` +
        `This is an automatic message. Your order will be dispatched soon.\n\n` +
        `If you have any query, please reach us on WhatsApp: +92 303 2244550\n\n` +
        `Team RS ZEVAR ❤️`;
      const reply = await sendText(fromPhone, confirmMsg);
      if (reply.sent) {
        await handleOutgoingMessage({
          phone: fromPhone,
          message_type: 'text',
          body: confirmMsg,
          wa_message_id: reply.message_id,
          sent_by_system: true,
          metadata: { auto_reply: 'confirm' },
        });
      } else {
        console.error('[whatsapp-webhook] Confirm reply failed:', reply.reason);
      }

    // ── CANCEL ─────────────────────────────────────────────────────────────
    } else if (action === 'CANCEL') {
      await supabase.from('orders').update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancel_reason: 'Customer cancelled via WhatsApp',
        updated_at: nowIso,
      }).eq('id', order.id);

      if (order.shopify_order_id) {
        try {
          await updateShopifyOrderTags(
            order.shopify_order_id,
            ['whatsapp_cancelled', 'whatsapp cancelled'],
            ['confirmation pending'],
          );
          console.log(`[whatsapp-webhook] Tags updated: +whatsapp_cancelled, +whatsapp cancelled, -confirmation pending`);
        } catch (e) {
          console.error('[whatsapp-webhook] cancel tag error:', e.message);
        }
      }

      await supabase.from('order_activity_log').insert({
        order_id: order.id,
        action: 'cancelled',
        notes: `Auto-cancelled via WhatsApp by customer (${fromPhone})`,
        performed_by: 'WhatsApp Customer',
        performed_at: nowIso,
      });

      console.log(`[whatsapp-webhook] ❌ Order ${orderNumber} cancelled`);

      const cancelMsg =
        `Your order ${orderNumber} has been cancelled.\n\n` +
        `This is an automatic message. If you cancelled by mistake, please reach us to reactivate your order on WhatsApp: +92 303 2244550\n\n` +
        `Team RS ZEVAR ❤️`;
      const reply = await sendText(fromPhone, cancelMsg);
      if (reply.sent) {
        await handleOutgoingMessage({
          phone: fromPhone,
          message_type: 'text',
          body: cancelMsg,
          wa_message_id: reply.message_id,
          sent_by_system: true,
          metadata: { auto_reply: 'cancel' },
        });
      } else {
        console.error('[whatsapp-webhook] Cancel reply failed:', reply.reason);
      }
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    console.error('[whatsapp-webhook] Error:', e.message);
    return NextResponse.json({ received: true });
  }
}

// ─── Handle message status update from Meta (unchanged) ────────────────────
async function handleStatusUpdate(status) {
  const messageId = status.id;
  const statusType = status.status;

  if (statusType !== 'failed') return;

  const errors = status.errors || [];
  const isNoWhatsApp = errors.some(e =>
    NO_WHATSAPP_ERROR_CODES.has(e.code) ||
    String(e.title || '').toLowerCase().includes('undeliverable') ||
    String(e.message || '').toLowerCase().includes('not a whatsapp')
  );

  if (!isNoWhatsApp) {
    console.log(`[whatsapp-webhook] Message ${messageId} failed — not a no-whatsapp scenario:`, errors);
    return;
  }

  const { data: log } = await supabase
    .from('whatsapp_logs')
    .select('id, order_id, status')
    .eq('wa_message_id', messageId)
    .maybeSingle();

  if (!log?.order_id) {
    console.log(`[whatsapp-webhook] No whatsapp_logs entry for failed message_id: ${messageId}`);
    return;
  }

  if (log.status === 'no_whatsapp') return;

  const { data: order } = await supabase
    .from('orders')
    .select('shopify_order_id, order_number')
    .eq('id', log.order_id)
    .single();

  if (!order?.shopify_order_id) {
    console.log(`[whatsapp-webhook] No shopify_order_id for order ${log.order_id} — skipping tag`);
    return;
  }

  try {
    await updateShopifyOrderTags(
      order.shopify_order_id,
      ['no whatsapp'],
      ['confirmation pending'],
    );
    console.log(`[whatsapp-webhook] Order ${order.order_number} tagged "no whatsapp" (number not on WA)`);
  } catch (e) {
    console.error('[whatsapp-webhook] no whatsapp tag error:', e.message);
    return;
  }

  await supabase
    .from('whatsapp_logs')
    .update({ status: 'no_whatsapp' })
    .eq('id', log.id);

  await supabase.from('order_activity_log').insert({
    order_id: log.order_id,
    action: 'whatsapp:no_whatsapp_detected',
    notes: 'Customer number WhatsApp pe nahi hai — Shopify pe "no whatsapp" tag laga. ERP status pending hi raha (protocol).',
    performed_by: 'WhatsApp Status Webhook',
    performed_at: new Date().toISOString(),
  });
}
