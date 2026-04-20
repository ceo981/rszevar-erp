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
      const fulfillments = shopifyOrder.fulfillments || [];
      const hasActiveTracking = fulfillments.some(
        f => f.tracking_number && f.status !== 'cancelled',
      );

      if (hasActiveTracking && PRE_DISPATCH_STATUSES.includes(existing.status)) {
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

  // 7b. Log protocol violation
  if (protocolViolation && orderId) {
    try {
      await supabase.from('order_activity_log').insert({
        order_id: orderId,
        action: 'protocol_violation:shopify_tracking_ahead_of_office',
        notes:
          `Shopify fulfillment tracking aayi magar office status abhi "${protocolViolation.office_status}" pe hai. ` +
          `Office status unchanged — staff ne ERP flow skip kiya. Confirm/Packed buttons click nahi hue.`,
        performed_by: 'Shopify Webhook',
        performed_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error(`[webhook:${topic}] violation log failed:`, e.message);
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

  // 8. Line items + customer — sirf wasNew pe
  if (insertLineItems && orderId && wasNew) {
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

    const items = transformLineItems(shopifyOrder, skuImageMap).map(i => ({ ...i, order_id: orderId }));
    if (items.length > 0) {
      const { error: itemsError } = await supabase.from('order_items').insert(items);
      if (itemsError) console.error(`[webhook:${topic}] line items error:`, itemsError.message);
    }

    if (shopifyOrder.customer) {
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
