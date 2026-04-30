// ============================================================================
// RS ZEVAR ERP — Review Resolution Route (Apr 30 2026)
// POST /api/orders/review/resolve
// ----------------------------------------------------------------------------
// Resolves orders sitting in the "⚠️ Review" tab — i.e. orders that the
// customer cancelled via the WhatsApp confirmation message. Such orders are:
//   - status='cancelled' in ERP
//   - tagged 'whatsapp_cancelled' on Shopify
//   - **NOT physically cancelled on Shopify** (they're still active there —
//     intentional "manual review before destruction" pattern)
//
// Two actions a staff member can take here:
//
//   action='confirm_cancel'
//     - Push the cancellation to Shopify (cancelShopifyOrder with refund +
//       restock; same defaults as the regular cancel route)
//     - Remove the 'whatsapp_cancelled' / 'whatsapp cancelled' review tags
//     - Leave the order in ERP status='cancelled' (already there)
//     - Log: "WhatsApp cancellation confirmed and pushed to Shopify"
//     - Result: order leaves Review tab → Cancelled tab
//
//   action='restore'
//     - Move ERP status back to 'confirmed' (canTransition allows this for
//       the cancelled state — manual override path)
//     - Clear cancelled_at / cancel_reason
//     - Remove 'whatsapp_cancelled' / 'whatsapp cancelled' tags from Shopify
//     - Add 'whatsapp_confirmed' tag back so it looks like a normal confirm
//     - Send the customer a WhatsApp text: "your order is reactivated"
//     - Save the outgoing message via handleOutgoingMessage so it shows up
//       in the inbox
//     - Log: "Order restored from WhatsApp cancellation"
//     - Result: order leaves Review tab → Confirmed tab
//
// Why a new route (not a flag on /api/orders/cancel)?
//   /api/orders/cancel returns 400 if order is already cancelled in ERP — the
//   "Review → confirm cancel" case violates that. Forking the cancel route
//   would muddy that clean check. Restore is also a fundamentally different
//   operation. Cleaner to have a dedicated review-resolution route.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { canTransition } from '@/lib/order-status';
import {
  cancelShopifyOrder,
  updateShopifyOrderTags,
  addShopifyOrderNote,
} from '@/lib/shopify';
import { sendText } from '@/lib/whatsapp';
import { handleOutgoingMessage } from '@/lib/whatsapp-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const REVIEW_TAGS = ['whatsapp_cancelled', 'whatsapp cancelled'];

export async function POST(request) {
  const supabase = createServerClient();
  try {
    const {
      order_id,
      action,                  // 'confirm_cancel' | 'restore'
      notes,                   // optional staff comment
      performed_by,
      performed_by_email,
    } = await request.json();

    if (!order_id) {
      return NextResponse.json(
        { success: false, error: 'order_id required' },
        { status: 400 },
      );
    }
    if (!['confirm_cancel', 'restore'].includes(action)) {
      return NextResponse.json(
        { success: false, error: "action must be 'confirm_cancel' or 'restore'" },
        { status: 400 },
      );
    }

    const performer = performed_by || 'Staff';
    const nowIso = new Date().toISOString();

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, status, tags, shopify_order_id, order_number, customer_phone, shopify_raw, customer_name')
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // ─── Eligibility check — must be in Review state ─────────────────────
    // status='cancelled' AND has whatsapp_cancelled tag
    const tagsLower = (order.tags || []).map(t => String(t).toLowerCase());
    const isReview = order.status === 'cancelled' && tagsLower.includes('whatsapp_cancelled');
    if (!isReview) {
      return NextResponse.json(
        {
          success: false,
          error: 'Order Review state mein nahi hai. Yeh action sirf WhatsApp se cancel hue orders ke liye hai.',
          current_status: order.status,
        },
        { status: 400 },
      );
    }

    // ════════════════════════════════════════════════════════════════════
    //  ACTION: CONFIRM CANCEL  →  push to Shopify, clear review tags
    // ════════════════════════════════════════════════════════════════════
    if (action === 'confirm_cancel') {
      const shopifyAlreadyCancelled = !!order.shopify_raw?.cancelled_at;
      let shopifyCancelled = false;
      let shopifyCancelError = null;

      if (order.shopify_order_id && !shopifyAlreadyCancelled) {
        try {
          await cancelShopifyOrder(order.shopify_order_id, {
            reason: 'customer',
            restock: true,
            refund: true,
            notifyCustomer: false,            // we already sent WA cancel auto-reply
            staffNote: `Review confirmed by ${performer}: WhatsApp cancellation finalized${notes ? ` — ${notes}` : ''}`,
          });
          shopifyCancelled = true;
        } catch (e) {
          shopifyCancelError = e.message;
          console.error('[review-resolve] Shopify cancel error:', e.message);
        }
      }

      // Remove the review tags from Shopify regardless of cancel outcome — the
      // ERP-side decision is final, and leaving the tag would keep the order
      // in the Review tab forever.
      let tagCleanupError = null;
      if (order.shopify_order_id) {
        try {
          await updateShopifyOrderTags(order.shopify_order_id, [], REVIEW_TAGS);
        } catch (e) {
          tagCleanupError = e.message;
          console.error('[review-resolve] tag cleanup error:', e.message);
        }
      }

      // Mirror the tag cleanup in ERP so the Review filter no longer matches
      const cleanedTags = (order.tags || []).filter(t => !REVIEW_TAGS.includes(String(t).toLowerCase()));
      const { error: updateErr } = await supabase
        .from('orders')
        .update({
          tags: cleanedTags,
          cancelled_at: order.shopify_raw?.cancelled_at || nowIso,
          cancel_reason: notes || 'WhatsApp cancellation (review confirmed)',
          updated_at: nowIso,
        })
        .eq('id', order_id);

      if (updateErr) throw updateErr;

      await supabase.from('order_activity_log').insert({
        order_id,
        action: 'review_cancel_confirmed',
        notes: [
          'WhatsApp cancellation review-confirmed',
          notes ? `Reason: ${notes}` : null,
          shopifyCancelled ? '+ Shopify order cancelled (refund + restock)' : null,
          shopifyAlreadyCancelled ? '+ Shopify side was already cancelled (sync cleanup)' : null,
          shopifyCancelError ? `Shopify cancel error: ${shopifyCancelError}` : null,
          tagCleanupError ? `Tag cleanup error: ${tagCleanupError}` : null,
        ].filter(Boolean).join(' | '),
        performed_by: performer,
        performed_by_email: performed_by_email || null,
        performed_at: nowIso,
      });

      return NextResponse.json({
        success: true,
        action: 'confirm_cancel',
        shopify_cancelled: shopifyCancelled,
        shopify_already_cancelled: shopifyAlreadyCancelled,
        warning: shopifyCancelError
          ? `ERP cleaned up but Shopify cancel failed: ${shopifyCancelError}`
          : null,
      });
    }

    // ════════════════════════════════════════════════════════════════════
    //  ACTION: RESTORE  →  back to confirmed, swap tags, message customer
    // ════════════════════════════════════════════════════════════════════
    if (action === 'restore') {
      // Defence-in-depth: canTransition allows manual cancelled → confirmed
      // but verify just in case rules change later.
      const gate = canTransition('cancelled', 'confirmed', 'manual');
      if (!gate.allowed) {
        return NextResponse.json(
          { success: false, error: `Restore blocked: ${gate.reason}` },
          { status: 400 },
        );
      }

      // Update ERP first — most important step. Tag/message failures are
      // best-effort and shouldn't roll this back.
      const cleanedTags = [
        ...(order.tags || []).filter(t => !REVIEW_TAGS.includes(String(t).toLowerCase())),
        // Add whatsapp_confirmed if it isn't already there
        ...((order.tags || []).some(t => String(t).toLowerCase() === 'whatsapp_confirmed')
          ? []
          : ['whatsapp_confirmed']),
      ];

      const { error: updateErr } = await supabase
        .from('orders')
        .update({
          status: 'confirmed',
          confirmed_at: nowIso,
          cancelled_at: null,
          cancel_reason: null,
          tags: cleanedTags,
          updated_at: nowIso,
        })
        .eq('id', order_id);

      if (updateErr) throw updateErr;

      // Shopify tag swap
      let tagSwapError = null;
      if (order.shopify_order_id) {
        try {
          await updateShopifyOrderTags(
            order.shopify_order_id,
            ['whatsapp_confirmed'],
            REVIEW_TAGS,
          );
        } catch (e) {
          tagSwapError = e.message;
          console.error('[review-resolve] tag swap error:', e.message);
        }
        // Add a Shopify staff note for paper trail
        try {
          await addShopifyOrderNote(
            order.shopify_order_id,
            `Order restored from WhatsApp cancellation by ${performer}${notes ? `: ${notes}` : ''}`,
          );
        } catch (e) {
          console.error('[review-resolve] Shopify note error:', e.message);
        }
      }

      // ── WhatsApp customer notification ─────────────────────────────────
      // If we have a customer phone, tell them their order is alive again.
      // Best-effort — failure to send doesn't abort the restore.
      let waSent = false;
      let waError = null;
      const phone = order.customer_phone;
      if (phone) {
        const restoreMsg =
          `Good news! Your order ${order.order_number} has been reactivated.\n\n` +
          `This is an automatic message. Your order will be dispatched soon.\n\n` +
          `If you have any query, please reach us on WhatsApp: +92 303 2244550\n\n` +
          `Team RS ZEVAR ❤️`;

        try {
          const reply = await sendText(phone, restoreMsg);
          if (reply.sent) {
            waSent = true;
            await handleOutgoingMessage({
              phone,
              message_type: 'text',
              body: restoreMsg,
              wa_message_id: reply.message_id,
              sent_by_system: true,
              metadata: { auto_reply: 'restore' },
            });
          } else {
            waError = reply.reason || 'send failed';
          }
        } catch (e) {
          waError = e.message;
          console.error('[review-resolve] WA send error:', e.message);
        }
      }

      await supabase.from('order_activity_log').insert({
        order_id,
        action: 'review_restored',
        notes: [
          'Order restored from WhatsApp cancellation',
          notes ? `Reason: ${notes}` : null,
          waSent ? '+ Customer notified on WhatsApp' : null,
          waError ? `WA notification failed: ${waError}` : null,
          tagSwapError ? `Tag swap failed: ${tagSwapError}` : null,
        ].filter(Boolean).join(' | '),
        performed_by: performer,
        performed_by_email: performed_by_email || null,
        performed_at: nowIso,
      });

      return NextResponse.json({
        success: true,
        action: 'restore',
        whatsapp_sent: waSent,
        whatsapp_error: waError,
        tag_swap_error: tagSwapError,
      });
    }

    // Unreachable — action validated above
    return NextResponse.json({ success: false, error: 'Unhandled action' }, { status: 500 });
  } catch (e) {
    console.error('[review-resolve] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
