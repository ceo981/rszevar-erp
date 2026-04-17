/**
 * RS ZEVAR ERP — WhatsApp Webhook
 * =================================
 * GET  → Meta webhook verification (one-time setup)
 * POST → Incoming button replies from customers
 *
 * Flow:
 *  Customer clicks "✅ Yes, Confirm" → order confirmed + Shopify tag
 *  Customer clicks "❌ No, Cancel"   → order cancelled + Shopify tag
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendText } from '../../../../lib/whatsapp';
import { handleIncomingMessage, handleOutgoingMessage } from '../../../../lib/whatsapp-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

// ─── POST: Incoming button reply from customer ──────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json();

    // ── First: save ALL incoming messages to inbox (regardless of type) ──
    const entries = body?.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const messages = change.value?.messages || [];
        const contacts = change.value?.contacts || [];
        for (const msg of messages) {
          const contact = contacts.find(c => c.wa_id === msg.from);
          await handleIncomingMessage(msg, contact);
        }
      }
    }

    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    // Template quick reply buttons → type: 'button', payload in message.button.payload
    // Interactive messages → type: 'interactive', payload in interactive.button_reply.id
    let payload = null;
    let fromPhone = message?.from;

    if (message?.type === 'button') {
      // Template quick reply response
      payload = message?.button?.payload;
    } else if (message?.type === 'interactive') {
      // Interactive button reply
      payload = message?.interactive?.button_reply?.id;
    }

    if (!payload || !fromPhone) {
      return NextResponse.json({ received: true });
    }

    console.log(`[whatsapp-webhook] Button: ${payload} from ${fromPhone}`);

    // Parse action and order number
    const underscoreIdx = payload.indexOf('_');
    const action        = payload.substring(0, underscoreIdx);        // CONFIRM or CANCEL
    const orderNumber   = payload.substring(underscoreIdx + 1);       // ZEVAR-123456

    if (!orderNumber || !['CONFIRM', 'CANCEL'].includes(action)) {
      console.warn('[whatsapp-webhook] Unknown payload:', payload);
      return NextResponse.json({ received: true });
    }

    // Find order in DB
    const { data: order, error } = await supabase
      .from('orders')
      .select('id, status, shopify_order_id, order_number')
      .eq('order_number', orderNumber)
      .single();

    if (error || !order) {
      console.error('[whatsapp-webhook] Order not found:', orderNumber);
      return NextResponse.json({ received: true });
    }

    // Ignore if already locked
    const lockedStatuses = ['confirmed', 'dispatched', 'delivered', 'cancelled', 'returned', 'rto'];
    if (lockedStatuses.includes(order.status)) {
      console.log(`[whatsapp-webhook] Order ${orderNumber} already ${order.status} — ignoring`);
      return NextResponse.json({ received: true });
    }

    if (action === 'CONFIRM') {
      await supabase.from('orders').update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);

      if (order.shopify_order_id) {
        await addShopifyTag(order.shopify_order_id, 'whatsapp_confirmed');
      }

      await supabase.from('order_activity_log').insert({
        order_id: order.id,
        action: 'confirmed',
        notes: `Auto-confirmed via WhatsApp by customer (${fromPhone})`,
        performed_at: new Date().toISOString(),
      });

      console.log(`[whatsapp-webhook] ✅ Order ${orderNumber} confirmed`);

      // Auto-reply to customer (24hr window opens on button click)
      const confirmMsg =
        `Thank you for confirming your order ${orderNumber}.\n\n` +
        `This is an automatic message. Your order will be dispatched soon.\n\n` +
        `If you have any query, please reach us on WhatsApp: +92 303 2244550\n\n` +
        `Team RS ZEVAR ❤️`;
      const reply = await sendText(fromPhone, confirmMsg);
      if (!reply.sent) {
        console.error('[whatsapp-webhook] Confirm reply failed:', reply.reason);
      } else {
        console.log('[whatsapp-webhook] Confirm reply sent');
        // Save outgoing auto-reply to inbox
        await handleOutgoingMessage({
          phone: fromPhone,
          message_type: 'text',
          body: confirmMsg,
          wa_message_id: reply.message_id,
          sent_by_system: true,
          metadata: { auto_reply: 'confirm' },
        });
      }

    } else if (action === 'CANCEL') {
      await supabase.from('orders').update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);

      if (order.shopify_order_id) {
        await addShopifyTag(order.shopify_order_id, 'whatsapp_cancelled');
      }

      await supabase.from('order_activity_log').insert({
        order_id: order.id,
        action: 'cancelled',
        notes: `Auto-cancelled via WhatsApp by customer (${fromPhone})`,
        performed_at: new Date().toISOString(),
      });

      console.log(`[whatsapp-webhook] ❌ Order ${orderNumber} cancelled`);

      // Auto-reply to customer (24hr window opens on button click)
      const cancelMsg =
        `Your order ${orderNumber} has been cancelled.\n\n` +
        `This is an automatic message. If you cancelled by mistake, please reach us to reactivate your order on WhatsApp: +92 303 2244550\n\n` +
        `Team RS ZEVAR ❤️`;
      const reply = await sendText(fromPhone, cancelMsg);
      if (!reply.sent) {
        console.error('[whatsapp-webhook] Cancel reply failed:', reply.reason);
      } else {
        console.log('[whatsapp-webhook] Cancel reply sent');
        // Save outgoing auto-reply to inbox
        await handleOutgoingMessage({
          phone: fromPhone,
          message_type: 'text',
          body: cancelMsg,
          wa_message_id: reply.message_id,
          sent_by_system: true,
          metadata: { auto_reply: 'cancel' },
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    console.error('[whatsapp-webhook] Error:', e.message);
    return NextResponse.json({ received: true }); // Always 200 to Meta
  }
}

// ─── Add tag to Shopify order ───────────────────────────────────────────────
async function addShopifyTag(shopifyOrderId, newTag) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token  = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) return;

  try {
    const res = await fetch(
      `https://${domain}/admin/api/2024-01/orders/${shopifyOrderId}.json?fields=id,tags`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    const { order } = await res.json();
    const currentTags = order?.tags || '';
    const tagsArr = currentTags.split(',').map(t => t.trim()).filter(Boolean);

    if (!tagsArr.includes(newTag)) tagsArr.push(newTag);

    await fetch(
      `https://${domain}/admin/api/2024-01/orders/${shopifyOrderId}.json`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ order: { id: shopifyOrderId, tags: tagsArr.join(', ') } }),
      }
    );
    console.log(`[whatsapp-webhook] Shopify tag "${newTag}" added`);
  } catch (e) {
    console.error('[whatsapp-webhook] Shopify tag error:', e.message);
  }
}
