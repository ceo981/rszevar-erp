import crypto from 'crypto';
import { createServerClient } from './supabase';
import { transformOrder, transformLineItems } from './shopify';
import { getSettings } from './settings';
import { sendOrderConfirmInteractive } from './whatsapp';

// Fallback if settings table is unreachable
const DEFAULT_LOCKED = ['delivered', 'returned', 'rto', 'cancelled', 'refunded'];

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
 * Chunk 3: transformOrder is now async (reads settings + tag definitions).
 * LOCKED_STATUSES now come from settings with fallback.
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

  const supabase = createServerClient();

  // 4. Read locked statuses from settings (cached 60s — cheap)
  let lockedStatuses = DEFAULT_LOCKED;
  try {
    const rules = await getSettings('business_rules');
    if (rules['rules.locked_statuses'] && Array.isArray(rules['rules.locked_statuses'])) {
      lockedStatuses = rules['rules.locked_statuses'];
    }
  } catch {}

  // 5. Transform (NOW ASYNC — reads settings + tag definitions)
  const orderData = await transformOrder(shopifyOrder);

  // 6. Check existing + apply LOCKED_STATUSES rules
  const { data: existing } = await supabase
    .from('orders')
    .select('id, status, payment_status')
    .eq('shopify_order_id', orderData.shopify_order_id)
    .maybeSingle();

  if (existing) {
    if (lockedStatuses.includes(existing.status)) {
      delete orderData.status;
    }
    if (existing.payment_status === 'paid' && orderData.payment_status === 'unpaid') {
      delete orderData.payment_status;
    }
    if (existing.payment_status === 'refunded') {
      delete orderData.payment_status;
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

  // 8. Line items + customer for NEW orders only
  if (insertLineItems && orderId && wasNew) {
    const items = transformLineItems(shopifyOrder).map(i => ({ ...i, order_id: orderId }));
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

    // ── WhatsApp interactive order confirmation (best-effort) ──
    const customerPhone =
      shopifyOrder.shipping_address?.phone ||
      shopifyOrder.customer?.phone ||
      shopifyOrder.billing_address?.phone;
    if (customerPhone) {
      try {
        await sendOrderConfirmInteractive({
          phone: customerPhone,
          order_number: orderData.order_number,
          total_amount: orderData.total_amount,
          customer_name: orderData.customer_name,
        });
      } catch (e) {
        console.error('[webhook:orders/create] WhatsApp error:', e.message);
      }
    }
  }

  // 9. Activity log (best-effort)
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
      duration_ms: Date.now() - startTime,
    },
  };
}
