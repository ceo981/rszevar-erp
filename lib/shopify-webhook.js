import crypto from 'crypto';
import { createServerClient } from './supabase';
import { transformOrder, transformLineItems } from './shopify';
import { getSettings } from './settings';
import { sendOrderConfirmInteractive } from './whatsapp';
import { PRE_DISPATCH_STATUSES } from './order-status';

// Fallback if settings table is unreachable
const DEFAULT_LOCKED = ['confirmed', 'on_packing', 'packed', 'dispatched', 'delivered', 'returned', 'rto', 'cancelled', 'refunded'];

/**
 * Verify Shopify webhook HMAC signature.
 */
export function verifyShopifyWebhook(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!hmacHeader || !secret) return false;
  try {
    const computed = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('base64');

    const a = Buffer.from(computed);
    const b = Buffer.from(hmacHeader);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Shared handler for all order webhooks.
 *
 * FIX Apr 2026 — Cancellation bypass:
 * Previously, if Shopify cancelled an order and ERP had it in a "locked" status
 * (confirmed/on_packing/packed/etc.), the webhook silently dropped the cancel.
 * Result: Shopify cancelled, ERP still confirmed → permanent desync.
 *
 * Now: if the Shopify payload has `cancelled_at`, the 'cancelled' status ALWAYS
 * applies — regardless of locked-status rules. This is the one case where
 * Shopify's source-of-truth MUST override ERP's flow state, since the customer
 * has explicitly cancelled and we should not dispatch a cancelled order.
 *
 * PROTOCOL GUARD (unchanged): Shopify webhook ab silently office status ko pre-
 * dispatch zone ke andar nahi badlega. Agar Shopify fulfillment tracking ke
 * sath aaya magar order ERP mein abhi pending/confirmed/on_packing hai to
 * sirf tracking_number, dispatched_courier, courier_status_raw update hoga —
 * office status untouched rahega aur exception log ban jayega.
 */
export async function handleOrderWebhook(request, { topic, insertLineItems = false }) {
  const startTime = Date.now();

  // 1. Read raw body
  const rawBody = await request.text();
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256');
  const shopDomain = request.headers.get('x-shopify-shop-domain');

  // 2. HMAC verify
  if (!verifyShopifyWebhook(rawBody, hmacHeader)) {
    console.warn(`[webhook:${topic}] HMAC verification failed from ${shopDomain || 'unknown'}`);
    return { status: 401, body: { success: false, error: 'Invalid HMAC signature' } };
  }

  // 3. Parse JSON
  let shopifyOrder;
  try {
    shopifyOrder = JSON.parse(rawBody);
  } catch (e) {
    return { status: 400, body: { success: false, error: 'Invalid JSON body' } };
  }

  // 3b. Skip draft/invalid orders
  const orderNum = shopifyOrder.order_number || shopifyOrder.name;
  const hasCustomer = shopifyOrder.customer?.id || shopifyOrder.shipping_address?.name;
  const hasAmount = parseFloat(shopifyOrder.total_price || 0) > 0;

  console.log(`[webhook:${topic}] Order: ${orderNum}, hasCustomer: ${!!hasCustomer}, hasAmount: ${hasAmount}, insertLineItems: ${insertLineItems}`);

  if (!orderNum || !hasCustomer || !hasAmount) {
    console.log(`[webhook:${topic}] Skipping invalid/draft order — no order_number, customer, or amount`);
    return { status: 200, body: { success: true, skipped: 'draft_or_invalid_order' } };
  }

  const supabase = createServerClient();

  // 4. Read locked statuses from settings (cached 60s)
  let lockedStatuses = DEFAULT_LOCKED;
  try {
    const rules = await getSettings('business_rules');
    if (rules['rules.locked_statuses'] && Array.isArray(rules['rules.locked_statuses'])) {
      lockedStatuses = rules['rules.locked_statuses'];
    }
  } catch {}

  // 5. Transform
  const orderData = await transformOrder(shopifyOrder);

  // 6. Check existing row + apply lock/override rules
  const { data: existing } = await supabase
    .from('orders')
    .select('id, status, payment_status, confirmed_at')
    .eq('shopify_order_id', orderData.shopify_order_id)
    .maybeSingle();

  let protocolViolation = null;

  // ── CANCELLATION BYPASS (new) ──────────────────────────────────────────
  // Detect Shopify cancellation intent: either topic is orders/cancelled, OR
  // the payload has cancelled_at set. In both cases, 'cancelled' status must
  // apply regardless of ERP lock state.
  const isShopifyCancellation =
    topic === 'orders/cancelled' ||
    !!shopifyOrder.cancelled_at ||
    orderData.status === 'cancelled';

  if (existing) {
    if (isShopifyCancellation) {
      // ALLOW the status through even if existing.status was locked
      // Don't apply any other lock rules — cancellation is authoritative
      // Keep existing confirmed_at (history) but status = cancelled
      delete orderData.confirmed_at;
    } else {
      if (lockedStatuses.includes(existing.status)) {
        delete orderData.status;
        delete orderData.confirmed_at;
      }
      if (existing.payment_status === 'paid' && orderData.payment_status === 'unpaid') {
        delete orderData.payment_status;
      }
      if (existing.payment_status === 'refunded') {
        delete orderData.payment_status;
      }
      if (existing.confirmed_at && orderData.confirmed_at) {
        delete orderData.confirmed_at;
      }

      // PROTOCOL GUARD: tracking added externally but ERP still pre-dispatch
      // FIX Apr 2026 — Phase 1 flow refactor.
      //
      // OLD behavior: any pre-dispatch status + tracking arrival → drop the
      //               status update + log protocol_violation. This left orders
      //               stuck in 'confirmed' even after team booked courier in
      //               Shopify, which is the bug Abdul reported.
      //
      // NEW behavior:
      //   - If existing status === 'confirmed' AND tracking arrived → AUTO-
      //     ADVANCE to 'on_packing'. This matches the new flow philosophy:
      //     "Fulfilled = slip nikali = on_packing (packer ka kaam shuru)".
      //   - For ANY other pre-dispatch status (pending/on_packing/packed/
      //     processing/hold), keep the OLD protocol-violation behavior —
      //     unexpected for tracking to arrive there, log it for staff review.
      const fulfillments = shopifyOrder.fulfillments || [];
      const hasActiveTracking = fulfillments.some(
        f => f.tracking_number && f.status !== 'cancelled',
      );

      if (hasActiveTracking && existing.status === 'confirmed') {
        // Sweet spot — fulfillment arrived after a confirmed order. This is
        // the expected flow for Shopify-side bookings (Kangaroo app, Leopards
        // portal). Promote to on_packing so the order shows up in the right
        // tab + assignment dropdown unlocks.
        orderData.status = 'on_packing';
        delete orderData.confirmed_at;
        protocolViolation = {
          office_status: existing.status,
          reason: 'auto_advance:confirmed_to_on_packing_via_fulfillment',
          newStatus: 'on_packing',
        };
      } else if (hasActiveTracking && PRE_DISPATCH_STATUSES.includes(existing.status)) {
        // Other pre-dispatch states — unexpected. Drop status update + log.
        // (e.g. status=pending but Shopify already fulfilled — rare race
        // condition or staff skipped ERP confirm step.)
        delete orderData.status;
        delete orderData.confirmed_at;
        protocolViolation = {
          office_status: existing.status,
          reason: `shopify_webhook:tracking_added_but_office_still_${existing.status}`,
        };
      }
    }
  }

  // 7. Upsert
  const { data: upserted, error: upsertError } = await supabase
    .from('orders')
    .upsert(orderData, { onConflict: 'shopify_order_id' })
    .select('id')
    .single();

  if (upsertError) {
    console.error(`[webhook:${topic}] upsert error:`, upsertError.message);
    return { status: 500, body: { success: false, error: upsertError.message } };
  }

  const orderId = upserted?.id;
  const wasNew = !existing;

  // 7b. Log protocol violation OR auto-advance event
  // FIX Apr 2026 — Phase 1: confirmed→on_packing auto-advance is expected
  // behavior, not a violation. Log it cleanly with positive framing. Other
  // pre-dispatch states still get the violation log (unchanged behavior).
  if (protocolViolation && orderId) {
    try {
      const isAutoAdvance = protocolViolation.reason?.startsWith('auto_advance');
      await supabase.from('order_activity_log').insert({
        order_id: orderId,
        action: isAutoAdvance
          ? 'auto_advanced_via_shopify_fulfillment'
          : 'protocol_violation:shopify_tracking_ahead_of_office',
        notes: isAutoAdvance
          ? `Shopify fulfillment received — order auto-advanced from "${protocolViolation.office_status}" to "${protocolViolation.newStatus}". Tracking + courier metadata saved. Packer assignment ab unlocked hai.`
          : `Shopify fulfillment tracking aayi magar office status abhi "${protocolViolation.office_status}" pe hai. Office status unchanged — staff ne ERP flow skip kiya. Confirm/Packed buttons click nahi hue.`,
        performed_by: 'Shopify Webhook',
        performed_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error(`[webhook:${topic}] activity log failed:`, e.message);
    }
  }

  // 7c. Log Shopify-triggered cancellation
  if (isShopifyCancellation && existing && orderId) {
    try {
      await supabase.from('order_activity_log').insert({
        order_id: orderId,
        action: 'cancelled_via_shopify',
        notes:
          existing.status !== 'cancelled'
            ? `Shopify se cancellation aayi — ERP status "${existing.status}" se "cancelled" pe shift. Shopify authoritative for cancellations.`
            : 'Shopify cancellation webhook received (already cancelled in ERP)',
        performed_by: 'Shopify Webhook',
        performed_at: new Date().toISOString(),
      });
    } catch (e) { console.error(`[webhook:${topic}] cancel log failed:`, e.message); }
  }

  // 8. Line items — `wasNew` par INSERT, aur edits par RE-SYNC.
  //
  // FIX Apr 2026 — Shopify order edits (items add/remove/price change) ab
  // properly reflect hote hain. Pehle sirf `wasNew` pe line items insert hote
  // the — agar baad mein order edit hua (items removed/added/price changed),
  // ERP ka order_items stale reh jata tha aur totals bhi mismatch hote.
  //
  // SAFETY: Hum transformLineItems PEHLE chalate hain. Agar result non-empty ho
  // tab hi DELETE+INSERT karte hain — taake failed-transform ki surat mein
  // DB mein stale-but-existing items ko wipe na kar dein (empty state worse
  // hota hai stale state se).
  const hasLineItemsInPayload = Array.isArray(shopifyOrder.line_items) && shopifyOrder.line_items.length > 0;
  const shouldSyncLineItems = orderId && hasLineItemsInPayload && (wasNew || topic === 'orders/updated' || topic === 'orders/edited');

  if (shouldSyncLineItems) {
    let skuImageMap = {};
    try {
      const { data: productImages } = await supabase
        .from('products')
        .select('sku, image_url')
        .not('sku', 'is', null)
        .not('image_url', 'is', null);
      for (const p of productImages || []) {
        if (p.sku && p.image_url && !skuImageMap[p.sku]) {
          skuImageMap[p.sku] = p.image_url;
        }
      }
    } catch {}

    // Transform PEHLE — agar kuch fail ho gaya to DB ko chhed hi na dein.
    const items = transformLineItems(shopifyOrder, skuImageMap).map(i => ({ ...i, order_id: orderId }));

    if (items.length > 0) {
      // On UPDATE: delete stale items first (since we have valid replacements ready).
      // On NEW (wasNew=true): no existing items to delete, straight insert.
      if (!wasNew) {
        try {
          const { error: delError } = await supabase
            .from('order_items')
            .delete()
            .eq('order_id', orderId);
          if (delError) {
            console.error(`[webhook:${topic}] delete old items failed:`, delError.message);
            // Don't insert if delete failed — would cause duplicates.
            // Stale state is better than corrupted duplicate state.
            return { status: 200, body: { success: true, warning: 'items delete failed, not re-inserted' } };
          }
          console.log(`[webhook:${topic}] deleted old line items for order ${orderId} — re-syncing with current Shopify state`);
        } catch (e) {
          console.error(`[webhook:${topic}] delete old items threw:`, e.message);
          return { status: 200, body: { success: true, warning: 'items delete threw, not re-inserted' } };
        }
      }

      const { error: itemsError } = await supabase.from('order_items').insert(items);
      if (itemsError) {
        console.error(`[webhook:${topic}] line items insert error:`, itemsError.message);
        // At this point if !wasNew, we've deleted old items but failed insert.
        // Log loudly so admin can manual re-sync. Webhook still returns 200
        // to prevent Shopify retry storm.
      } else {
        console.log(`[webhook:${topic}] inserted ${items.length} line items for order ${orderId}`);
      }
    } else {
      // transformLineItems returned [] despite hasLineItemsInPayload being true.
      // Shouldn't happen with current code, but defensive: don't touch DB.
      console.warn(`[webhook:${topic}] transformLineItems returned empty despite non-empty payload — keeping existing order_items unchanged`);
    }
  }

  // 8b. Customer upsert — INDEPENDENT of line items sync.
  // Previously this was nested inside the items block, which meant if payload
  // had no line_items, customer would not be created. Now it's always done
  // on new orders (regardless of line items status).
  if (wasNew && orderId && shopifyOrder.customer) {
    const c = shopifyOrder.customer;
    await supabase.from('customers').upsert({
      shopify_customer_id: String(c.id),
      name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown',
      phone: c.phone || null,
      email: c.email || null,
      city: shopifyOrder.shipping_address?.city || null,
      address: shopifyOrder.shipping_address?.address1 || null,
    }, { onConflict: 'shopify_customer_id' });
  }

  // 8b. WhatsApp confirmation — on create only
  if (insertLineItems && orderId) {
    const customerPhone =
      shopifyOrder.shipping_address?.phone ||
      shopifyOrder.customer?.phone ||
      shopifyOrder.billing_address?.phone;

    console.log(`[webhook:orders/create] customerPhone: ${customerPhone}, orderId: ${orderId}`);

    if (customerPhone) {
      try {
        const { data: existingLog } = await supabase
          .from('whatsapp_logs')
          .select('id')
          .eq('order_id', orderId)
          .limit(1)
          .maybeSingle();

        if (!existingLog) {
          const itemsText = (shopifyOrder.line_items || [])
            .map(i => `${i.title}${i.variant_title ? ` (${i.variant_title})` : ''} x${i.quantity}`)
            .join(', ') || 'N/A';

          const sa = shopifyOrder.shipping_address;
          const addressText = sa
            ? [sa.address1, sa.city, sa.province].filter(Boolean).join(', ')
            : 'N/A';

          console.log(`[webhook:orders/create] Sending WhatsApp to ${customerPhone}`);

          const waResult = await sendOrderConfirmInteractive({
            phone: customerPhone,
            order_number: orderData.order_number,
            total_amount: orderData.total_amount,
            customer_name: orderData.customer_name,
            items: itemsText,
            address: addressText,
          });

          console.log(`[webhook:orders/create] WhatsApp result:`, JSON.stringify(waResult));

          await supabase.from('whatsapp_logs').insert({
            order_id: orderId,
            customer_phone: customerPhone,
            template_name: 'rs_zevar_order_interactive',
            status: waResult?.sent ? 'sent' : 'failed',
            message_content: orderData.order_number,
            wa_message_id: waResult?.message_id || null,
            sent_at: new Date().toISOString(),
          });

          // ── NEW: If message sent successfully, add "confirmation pending" tag
          // to Shopify (automatic — CEO requirement). ERP status UNTOUCHED.
          // If message failed at send-time (invalid phone etc), "no whatsapp"
          // tag will be added later by the status webhook when Meta confirms.
          if (waResult?.sent && orderData.shopify_order_id) {
            try {
              const { updateShopifyOrderTags } = await import('./shopify');
              await updateShopifyOrderTags(
                orderData.shopify_order_id,
                ['confirmation pending'],  // add
                [],                        // remove
              );
              console.log(`[webhook:orders/create] Tag "confirmation pending" added for ${orderData.order_number}`);
            } catch (e) {
              console.error('[webhook:orders/create] confirmation pending tag error:', e.message);
            }
          }
        } else {
          console.log(`[webhook:orders/create] WhatsApp already sent for ${orderData.order_number} — skipping`);
        }
      } catch (e) {
        console.error('[webhook:orders/create] WhatsApp error:', e.message);
      }
    }
  }

  // 9. Activity log
  if (orderId) {
    try {
      await supabase.from('order_activity_log').insert({
        order_id: orderId,
        action: `webhook:${topic}`,
        notes: `Real-time ${topic} from Shopify (${wasNew ? 'new' : 'updated'})`,
        performed_at: new Date().toISOString(),
      });
    } catch {}
  }

  return {
    status: 200,
    body: {
      success: true,
      topic,
      order_number: orderData.order_number,
      action: wasNew ? 'created' : 'updated',
      protocol_violation: !!protocolViolation,
      cancellation_applied: !!(isShopifyCancellation && existing),
      duration_ms: Date.now() - startTime,
    },
  };
}
