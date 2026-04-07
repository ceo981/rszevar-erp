import crypto from 'crypto';
import { createServerClient } from './supabase';
import { transformOrder, transformLineItems } from './shopify';

// Same rules as /api/shopify/sync — never let Shopify overwrite terminal states
const LOCKED_STATUSES = ['delivered', 'returned', 'rto', 'cancelled', 'refunded'];

/**
 * Verify Shopify webhook HMAC signature.
 * Shopify signs every webhook with SHOPIFY_WEBHOOK_SECRET — if signature doesn't
 * match, the request is fake and must be rejected.
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
 * Shared handler for all order webhooks (create / updated / cancelled / fulfilled / paid).
 *
 * Flow:
 *   1. Read raw body (needed for HMAC)
 *   2. Verify HMAC signature
 *   3. Parse JSON
 *   4. Transform via existing lib/shopify.js logic (tag-based confirmation,
 *      payment_status, etc.)
 *   5. Apply LOCKED_STATUSES rules (don't overwrite delivered/returned/rto/etc.)
 *   6. Upsert order
 *   7. For NEW orders only: insert line items + upsert customer
 *   8. Log to order_activity_log (best-effort)
 *
 * Returns { status, body } — route files wrap in NextResponse.
 */
export async function handleOrderWebhook(request, { topic, insertLineItems = false }) {
  const startTime = Date.now();

  // 1. Read raw body FIRST (consumes stream — can only do once)
  const rawBody = await request.text();
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256');
  const shopDomain = request.headers.get('x-shopify-shop-domain');

  // 2. HMAC verify — reject fake requests
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

  // 4. Transform (uses existing mapShopifyStatus in lib/shopify.js — tag + payment_status logic)
  const orderData = transformOrder(shopifyOrder);

  // 5. Check existing order + apply LOCKED_STATUSES rules
  const { data: existing } = await supabase
    .from('orders')
    .select('id, status, payment_status')
    .eq('shopify_order_id', orderData.shopify_order_id)
    .maybeSingle();

  if (existing) {
    if (LOCKED_STATUSES.includes(existing.status)) {
      delete orderData.status;
    }
    if (existing.payment_status === 'paid' && orderData.payment_status === 'unpaid') {
      delete orderData.payment_status;
    }
    if (existing.payment_status === 'refunded') {
      delete orderData.payment_status;
    }
  }

  // 6. Upsert
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

  // 7. For NEW orders only — insert line items + upsert customer
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
  }

  // 8. Activity log (best-effort — don't fail webhook if log fails)
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
