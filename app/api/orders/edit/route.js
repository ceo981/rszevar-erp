// ============================================================================
// RS ZEVAR ERP — Commit Order Edit
// POST /api/orders/edit-commit  { order_id, calculated_order_id, reason,
//                                  notify_customer, performed_by, performed_by_email }
// ----------------------------------------------------------------------------
// Commits the staged edits to the real Shopify order, then syncs the updated
// order + line items back to ERP so the UI reflects truth immediately (instead
// of waiting for the orders/edited webhook to arrive).
//
// Steps:
//   1. Guards (order exists, status allowed, role allowed)
//   2. Shopify orderEditCommit (THE atomic change)
//   3. Fetch fresh order from Shopify (REST) → transform to ERP shape
//   4. Replace order_items rows (delete old, insert new from Shopify truth)
//   5. Update orders table totals/subtotal/shipping/discount/updated_at
//   6. Activity log with reason + performer
//
// If step 2 succeeds but 3–5 fail, the Shopify order IS edited but ERP may be
// stale. The orders/edited webhook is a safety net — it'll reconcile within
// seconds. We return success=true with warning=<sync error> so UI can alert.
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { commitOrderEdit } from '@/lib/shopify-order-edit';
import { fetchOrder, transformLineItems } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ALLOWED_STATUSES = new Set(['pending', 'confirmed', 'on_packing', 'packed', 'hold']);
const ALLOWED_ROLES    = new Set(['super_admin', 'admin', 'manager', 'customer_support']);

async function checkRole(email) {
  if (!email) return null;
  const { data } = await supabase.from('profiles').select('role').eq('email', email).single();
  return data?.role || null;
}

// Resync a single order's line items + totals from Shopify truth
async function resyncOrderFromShopify(orderRow) {
  // ─── FIX Apr 2026 — Shopify eventual consistency ──────────────────────────
  // Bug: User adds an item via edit page → commits → goes back → item GAYAB
  // (but total includes it).
  //
  // Root cause: orderEditCommit (GraphQL) returns immediately, but REST
  // /orders/{id}.json can be stale for up to ~2s. fetchOrder() runs
  // immediately after commit and returns OLD line_items array (missing the
  // newly-added item). resync then writes stale items to ERP, while
  // total_amount comes from commitResult.new_total (which is fresh). End
  // result: items disappear from view but total reflects the new item.
  //
  // Fix: wait briefly, fetch, and retry once if the REST response looks
  // suspiciously stale (heuristic: line_items length is less than what we
  // had before the commit). Webhook is the backup safety net.
  await new Promise(r => setTimeout(r, 1500));

  let so = await fetchOrder(orderRow.shopify_order_id);
  if (!so) throw new Error('Shopify order not found after commit');

  // Verify-and-retry: compare fetched active line item count against current
  // DB count. If fetched is LESS, that's either a deletion (legitimate) OR a
  // stale read (bug). Retry once after another 1s — if it was a real deletion,
  // the retry returns same data (harmless ~1s extra latency). If it was stale,
  // retry should now have fresh data including the addition.
  try {
    const { count: dbItemCount } = await supabase
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderRow.id);

    const fetchedActive = (so.line_items || []).filter(li => {
      // Inline isActiveLineItem logic — avoids importing for one check
      if (li.current_quantity !== undefined && li.current_quantity !== null) {
        return li.current_quantity > 0;
      }
      return (li.quantity || 0) > 0;
    }).length;

    if (typeof dbItemCount === 'number' && fetchedActive < dbItemCount) {
      console.log(`[edit-commit] count mismatch (fetched ${fetchedActive} < db ${dbItemCount}) — retrying after 1s`);
      await new Promise(r => setTimeout(r, 1000));
      const retry = await fetchOrder(orderRow.shopify_order_id);
      if (retry) so = retry;
    }
  } catch (countErr) {
    // Defensive — if count check fails for any reason, just proceed with
    // first fetch. Webhook will reconcile if there's still an issue.
    console.warn('[edit-commit] count check failed (proceeding):', countErr.message);
  }
  // ─── End fix ──────────────────────────────────────────────────────────────

  const subtotal = parseFloat(so.subtotal_price || so.current_subtotal_price || 0);
  const shippingFee = parseFloat(
    (so.shipping_lines || [])
      .reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0),
  );
  const discount = parseFloat(so.total_discounts || so.current_total_discounts || 0);
  const total = parseFloat(so.total_price || so.current_total_price || 0);

  // Pre-fetch SKU → image map (same pattern as webhook)
  let skuImageMap = {};
  try {
    const { data: productImages } = await supabase
      .from('products')
      .select('sku, image_url')
      .not('sku', 'is', null)
      .not('image_url', 'is', null);
    for (const p of productImages || []) {
      if (p.sku && p.image_url && !skuImageMap[p.sku]) skuImageMap[p.sku] = p.image_url;
    }
  } catch {}

  const newItems = transformLineItems(so, skuImageMap).map(i => ({
    ...i,
    order_id: orderRow.id,
  }));

  // Replace order_items atomically-ish: delete old, insert new
  await supabase.from('order_items').delete().eq('order_id', orderRow.id);
  if (newItems.length > 0) {
    const { error: insErr } = await supabase.from('order_items').insert(newItems);
    if (insErr) throw new Error(`order_items insert: ${insErr.message}`);
  }

  // Update orders totals
  const { error: updErr } = await supabase.from('orders').update({
    subtotal,
    shipping_fee: shippingFee,
    discount,
    total_amount: total,
    updated_at: new Date().toISOString(),
    shopify_synced_at: new Date().toISOString(),
  }).eq('id', orderRow.id);
  if (updErr) throw new Error(`orders update: ${updErr.message}`);

  return { subtotal, shipping_fee: shippingFee, discount, total_amount: total, items_count: newItems.length };
}

export async function POST(request) {
  try {
    const {
      order_id,
      calculated_order_id,
      reason,
      notify_customer,
      performed_by,
      performed_by_email,
    } = await request.json();

    if (!order_id || !calculated_order_id) {
      return NextResponse.json(
        { success: false, error: 'order_id + calculated_order_id required' },
        { status: 400 },
      );
    }

    // Role gate
    if (performed_by_email) {
      const role = await checkRole(performed_by_email);
      if (role && !ALLOWED_ROLES.has(role)) {
        return NextResponse.json(
          { success: false, error: `Role '${role}' ko order edit ki permission nahi hai` },
          { status: 403 },
        );
      }
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, status, shopify_order_id, payment_status, total_amount')
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    if (!order.shopify_order_id) {
      return NextResponse.json({ success: false, error: 'No Shopify link' }, { status: 400 });
    }
    if (!ALLOWED_STATUSES.has(order.status)) {
      return NextResponse.json(
        { success: false, error: `Status '${order.status}' ke order ab edit commit nahi ho sakta` },
        { status: 400 },
      );
    }

    const performer = performed_by || 'Staff';
    const nowIso = new Date().toISOString();

    // Step 1: Shopify commit
    const staffNote = reason ? `ERP Edit by ${performer}: ${reason}` : `ERP Edit by ${performer}`;
    const commitResult = await commitOrderEdit({
      calculated_order_id,
      notify_customer: !!notify_customer,
      staff_note: staffNote,
    });

    // Step 2: ERP resync (best-effort — webhook is backup)
    let syncError = null;
    let syncResult = null;
    try {
      syncResult = await resyncOrderFromShopify(order);
    } catch (e) {
      syncError = e.message;
      console.error('[edit-commit] ERP resync error (webhook will retry):', e.message);
    }

    // Step 3: Activity log — include what changed if we synced successfully
    const changeNote = syncResult
      ? `Order edited by ${performer}. New total: Rs ${syncResult.total_amount.toLocaleString('en-PK')} ` +
        `(was Rs ${parseFloat(order.total_amount || 0).toLocaleString('en-PK')}). ` +
        `Items: ${syncResult.items_count}. ` +
        (notify_customer ? 'Customer notified via Shopify email.' : 'Customer NOT notified.') +
        (reason ? ` Reason: ${reason}` : '')
      : `Order edited in Shopify by ${performer}. ERP sync pending (webhook will reconcile).` +
        (reason ? ` Reason: ${reason}` : '');

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'order_edited',
      notes: changeNote,
      performed_by: performer,
      performed_by_email: performed_by_email || null,
      performed_at: nowIso,
    });

    return NextResponse.json({
      success: true,
      order_id,
      order_number: order.order_number,
      shopify_new_total: commitResult.new_total,
      erp_synced: !syncError,
      warning: syncError,
      ...(syncResult || {}),
    });
  } catch (e) {
    console.error('[edit-commit] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
