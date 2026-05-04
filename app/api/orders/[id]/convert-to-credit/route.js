// ============================================================================
// RS ZEVAR ERP — Convert Order to Credit (Udhaar)
// POST /api/orders/[id]/convert-to-credit       → mark as credit
// POST /api/orders/[id]/convert-to-credit?revert=true → unmark (revert)
// May 2 2026 · Step 6 of 6
// May 4 2026 · ALSO push tracking-less Shopify fulfillment so order doesn't
//              stay stuck in Shopify "unfulfilled" state forever.
// ----------------------------------------------------------------------------
// PURPOSE:
//   Toggle is_credit_order flag on an order. When enabled:
//     - is_credit_order = true
//     - status auto-flips to 'delivered' (real-time fulfillment for credit
//       customer who already has the goods)
//     - payment_status STAYS unpaid (will become partial/paid via payments)
//     - **NEW (May 4 2026)** Shopify ko bhi tracking-less fulfillment push hota
//       hai — taake Shopify side `fulfillment_status='fulfilled'` ho jaye aur
//       order ERP ke "Unfulfilled" filter mein stuck na rahe.
//     - Activity log entry written
//
//   When reverted (revert=true):
//     - is_credit_order = false
//     - Status NOT auto-reverted (admin can manually change back if needed)
//     - Shopify fulfillment NOT cancelled (use Cancel Fulfillment if needed)
//     - WARN if there are existing payment_allocations on this order
//       (revert ko block nahi karte but admin ko bata dete hain)
//
// REQUEST BODY:
//   {
//     performed_by: "Abdul Rehman",
//     performed_by_email: "abdul@rszevar.com",
//     reason: "Customer ne udhaar request kiya"  (optional)
//   }
//
// RESPONSE:
//   {
//     success: true,
//     order: { id, order_number, is_credit_order, status, payment_status },
//     warnings: [...]  // e.g. existing allocations on revert, Shopify push failures
//     shopify_synced: true|false   // only on convert flow
//   }
//
// AUTH:
//   - Frontend asserts super_admin before showing button (existing pattern)
//   - Backend allows authenticated calls (existing codebase pattern)
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { createShopifyFulfillment } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const revert = searchParams.get('revert') === 'true';

    if (!id) {
      return NextResponse.json({ success: false, error: 'Order id required' }, { status: 400 });
    }

    let body = {};
    try { body = await request.json(); } catch {}

    const performer = body.performed_by || 'Staff';
    const performerEmail = body.performed_by_email || null;
    const reason = body.reason || null;

    const supabase = createServerClient();

    // ── 1. Fetch current order ──
    // May 4 2026 — Added shopify_order_id + shopify_fulfillment_id + shopify_raw
    // so we can decide whether to push fulfillment to Shopify.
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select(
        'id, order_number, status, payment_status, is_credit_order, ' +
        'customer_phone, customer_name, total_amount, paid_amount, ' +
        'shopify_order_id, shopify_fulfillment_id, shopify_raw'
      )
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    const warnings = [];

    if (revert) {
      // ── REVERT FLOW ──
      if (!order.is_credit_order) {
        return NextResponse.json(
          { success: false, error: 'Order is already not a credit order' },
          { status: 400 },
        );
      }

      // Check for existing payment allocations (warn, don't block)
      const { data: allocs } = await supabase
        .from('payment_allocations')
        .select('id, amount, payment_id')
        .eq('order_id', id);

      if (allocs && allocs.length > 0) {
        warnings.push(
          `${allocs.length} payment allocation(s) exist on this order (Rs ${allocs.reduce((s, a) => s + (a.amount || 0), 0).toFixed(2)} total). Reverting will NOT delete payments — they will remain in customer's khaata. Consider voiding payments first if needed.`
        );
      }

      // May 4 2026 — Note: We do NOT auto-cancel the Shopify fulfillment that
      // was pushed during conversion. If admin wants to undo Shopify side too,
      // they can use the existing Cancel Fulfillment route separately.
      if (order.shopify_fulfillment_id) {
        warnings.push(
          'Shopify fulfillment is still active. Order Shopify side pe abhi bhi "Fulfilled" rahega. ' +
          'Agar Shopify pe bhi unfulfilled karna hai to alag se "Cancel Fulfillment" use karein.'
        );
      }

      const { data: updated, error: updateErr } = await supabase
        .from('orders')
        .update({
          is_credit_order: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('id, order_number, is_credit_order, status, payment_status')
        .single();

      if (updateErr) throw updateErr;

      // Activity log
      try {
        await supabase.from('order_activity').insert({
          order_id: id,
          action: 'credit_reverted',
          performed_by: performer,
          performed_by_email: performerEmail,
          notes: reason || 'Reverted from credit order',
        });
      } catch (e) {
        console.warn('[convert-to-credit] activity log failed:', e.message);
      }

      return NextResponse.json({
        success: true,
        order: updated,
        warnings,
        message: 'Order reverted from credit',
      });
    }

    // ── CONVERT FLOW (default) ──
    if (order.is_credit_order) {
      return NextResponse.json(
        { success: false, error: 'Order is already marked as credit' },
        { status: 400 },
      );
    }

    if (order.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'Cancelled orders cannot be converted to credit' },
        { status: 400 },
      );
    }

    if (order.payment_status === 'paid') {
      warnings.push('Order is already fully paid — converting to credit but no balance to track.');
    }

    // ── 2. Push Shopify fulfillment (best-effort) ──
    // May 4 2026 — Yeh new step hai. Pehle convert sirf ERP DB update karta tha,
    // jiski wajah se Shopify side pe `fulfillment_status` null hi rehta tha aur
    // order "Unfulfilled" filter mein hamesha ke liye phans jata tha.
    //
    // Ab tracking-less fulfillment push karte hain — Shopify line items
    // "fulfilled" ho jayenge aur shipping email bhi nahi jayega
    // (createShopifyFulfillment auto-suppresses email when no tracking).
    //
    // Conditions to push:
    //   (a) Shopify-linked order (shopify_order_id present) — wholesale/walkin
    //       jo Shopify pe nahi hain unke liye yeh skip
    //   (b) Already fulfilled nahi hai (shopify_fulfillment_id null)
    //   (c) Shopify raw mein fulfillment_status already 'fulfilled' nahi
    //
    // Failure best-effort — DB update phir bhi hota hai, sirf warning add hoti.
    let shopifyFulfillmentId = null;
    let shopifyFulfilledAt = null;
    let shopifySynced = false;
    let shopifyPushError = null;
    let shopifyPushSkippedReason = null;

    const shopifyAlreadyFulfilled = order.shopify_raw?.fulfillment_status === 'fulfilled';

    if (!order.shopify_order_id) {
      shopifyPushSkippedReason = 'no_shopify_order_id';
    } else if (order.shopify_fulfillment_id) {
      shopifyPushSkippedReason = 'already_has_fulfillment_id';
    } else if (shopifyAlreadyFulfilled) {
      shopifyPushSkippedReason = 'shopify_status_already_fulfilled';
    } else {
      try {
        const fulfillment = await createShopifyFulfillment(
          order.shopify_order_id,
          null,         // no tracking — credit/udhaar customer pe maal physically pohanch chuka
          'Pickup',     // courier label for in-house/walk-in pickup
          null,         // no tracking URL
          { notify_customer: false },  // don't email customer "shipped" — woh sample le ke gaya hua hai
        );
        shopifyFulfillmentId = fulfillment?.id ? String(fulfillment.id) : null;
        shopifyFulfilledAt = new Date().toISOString();
        shopifySynced = !!shopifyFulfillmentId;
      } catch (e) {
        shopifyPushError = e.message;
        console.error('[convert-to-credit] Shopify fulfillment push failed:', e.message);
        warnings.push(
          `Shopify fulfillment push failed: ${e.message}. Order DB mein credit ho gaya hai but Shopify side ` +
          `pe abhi bhi "Unfulfilled" dikhega. ERP filter is fix se phir bhi clean rahega ` +
          `(credit orders Unfulfilled tab se exclude hain).`
        );
      }
    }

    // ── 3. Update order in ERP DB ──
    // Mark as credit + auto-deliver + (if Shopify push succeeded) save fulfillment_id
    const updates = {
      is_credit_order: true,
      updated_at: new Date().toISOString(),
    };

    // Auto-deliver: if not already delivered/cancelled, mark as delivered
    // (real-time fulfillment — credit customer pe maal physically pohanch chuka hai)
    const TERMINAL_STATUSES = ['delivered', 'cancelled', 'returned'];
    let statusChanged = false;
    if (!TERMINAL_STATUSES.includes(order.status)) {
      updates.status = 'delivered';
      updates.delivered_at = new Date().toISOString();
      statusChanged = true;
    }

    // Save Shopify fulfillment IDs if push succeeded
    if (shopifyFulfillmentId) {
      updates.shopify_fulfillment_id = shopifyFulfillmentId;
      updates.shopify_fulfilled_at = shopifyFulfilledAt;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select('id, order_number, is_credit_order, status, payment_status, shopify_fulfillment_id')
      .single();

    if (updateErr) throw updateErr;

    // ── 4. Activity log ──
    try {
      const parts = [];
      if (statusChanged) {
        parts.push(`Converted to credit order · auto-delivered (was: ${order.status})`);
      } else {
        parts.push('Converted to credit order');
      }
      if (shopifySynced) {
        parts.push('Shopify fulfilled (tracking-less, no email)');
      } else if (shopifyPushError) {
        parts.push(`Shopify push failed: ${shopifyPushError}`);
      } else if (shopifyPushSkippedReason) {
        parts.push(`Shopify push skipped (${shopifyPushSkippedReason})`);
      }
      const actionMsg = parts.join(' — ');

      await supabase.from('order_activity').insert({
        order_id: id,
        action: 'credit_converted',
        performed_by: performer,
        performed_by_email: performerEmail,
        notes: reason ? `${actionMsg} — ${reason}` : actionMsg,
      });
    } catch (e) {
      console.warn('[convert-to-credit] activity log failed:', e.message);
    }

    // ── 5. Build response message ──
    const messageParts = [];
    if (statusChanged) {
      messageParts.push(`Order converted to credit + delivered (was ${order.status})`);
    } else {
      messageParts.push('Order converted to credit');
    }
    if (shopifySynced) {
      messageParts.push('Shopify auto-fulfilled');
    }

    return NextResponse.json({
      success: true,
      order: updated,
      warnings,
      status_changed: statusChanged,
      previous_status: order.status,
      shopify_synced: shopifySynced,
      shopify_skipped_reason: shopifyPushSkippedReason,
      message: messageParts.join(' · '),
    });
  } catch (e) {
    console.error('[POST /api/orders/[id]/convert-to-credit] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
