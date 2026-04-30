// ============================================================================
// RS ZEVAR ERP — Order Mark as Paid
// POST /api/orders/mark-paid  { order_id, payment_method?, payment_proof_url?,
//                               note?, performed_by, performed_by_email }
// ----------------------------------------------------------------------------
// Flow:
//   1. Validate order state (not cancelled, not refunded, not already paid)
//   2. Update ERP: payment_status = 'paid', paid_at = now, payment_method (optional)
//   3. Shopify sync (best-effort — failure doesn't roll back ERP change)
//   4. Activity log with performer attribution
//
// Apr 30 2026 — Method-aware mark paid.
//   `payment_method` field is OPTIONAL. When present, it overrides the
//   default 'COD' on the order so finance can later filter by Bank Alfalah /
//   Meezan / Easypaisa / JazzCash / Cash. Courier auto-paid flow does NOT
//   pass this field, so it stays as 'COD' (the column default) — courier
//   reconciliation untouched.
//
//   `payment_proof_url` and `note` are also optional and just embedded into
//   the activity log — they show up in the Timeline so staff and CEO can
//   click the screenshot link from there. No new column needed.
//
// Added Apr 20 2026 as part of Phase 2 (Shopify-style order page).
// Mirrors the pattern used by cancel/edit routes: ERP first, Shopify best-effort.
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { markShopifyOrderAsPaid } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Whitelist of payment_method values the UI sends. Anything else is rejected
// to keep the data clean for filtering/reporting later.
const ALLOWED_METHODS = new Set([
  'COD',
  'Cash',
  'Bank Alfalah',
  'Meezan Bank',
  'Easypaisa',
  'JazzCash',
  'Manual',
]);

export async function POST(request) {
  try {
    const {
      order_id,
      payment_method,        // NEW Apr 30 2026 — optional
      payment_proof_url,     // NEW Apr 30 2026 — optional, link saved in activity log
      note,                  // NEW Apr 30 2026 — optional staff comment
      performed_by,
      performed_by_email,
    } = await request.json();
    if (!order_id) {
      return NextResponse.json(
        { success: false, error: 'order_id zaroori hai' },
        { status: 400 },
      );
    }
    if (payment_method && !ALLOWED_METHODS.has(payment_method)) {
      return NextResponse.json(
        { success: false, error: `Invalid payment_method: ${payment_method}` },
        { status: 400 },
      );
    }

    const performer = performed_by || 'Staff';

    // 1. Fetch current order
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, status, payment_status, shopify_order_id, total_amount, payment_method')
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 },
      );
    }

    // 2. Guards
    if (order.payment_status === 'paid') {
      return NextResponse.json(
        { success: false, error: 'Order pehle se paid hai' },
        { status: 400 },
      );
    }
    if (order.payment_status === 'refunded') {
      return NextResponse.json(
        { success: false, error: 'Refunded order ko paid mark nahi kar sakte' },
        { status: 400 },
      );
    }
    if (order.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'Cancelled order ko paid mark nahi kar sakte' },
        { status: 400 },
      );
    }

    const nowIso = new Date().toISOString();

    // 3. ERP update — with resilient fallback if `paid_at` column missing
    //    (mirrors pattern from /api/orders/status route)
    const patch = {
      payment_status: 'paid',
      paid_at: nowIso,
      updated_at: nowIso,
    };
    // Only stamp the method when caller provided one. Empty/undefined leaves
    // the existing column value untouched (most often 'COD').
    if (payment_method) {
      patch.payment_method = payment_method;
    }

    let updateErr = null;
    let attempt = 0;
    while (attempt < 2) {
      const { error } = await supabase
        .from('orders')
        .update(patch)
        .eq('id', order_id)
        .eq('payment_status', 'unpaid'); // defence: only flip unpaid → paid
      if (!error) { updateErr = null; break; }
      updateErr = error;
      if (String(error.message || '').toLowerCase().includes('paid_at')) {
        delete patch.paid_at;
        attempt++;
        continue;
      }
      break;
    }
    if (updateErr) throw updateErr;

    // 4. Shopify sync (best-effort)
    let shopifyError = null;
    let shopifySynced = false;
    let shopifyAlreadyPaid = false;
    if (order.shopify_order_id) {
      try {
        const result = await markShopifyOrderAsPaid(order.shopify_order_id);
        shopifySynced = true;
        shopifyAlreadyPaid = !!result.already_paid;
      } catch (e) {
        shopifyError = e.message;
        console.error('[mark-paid] Shopify sync error:', e.message);
      }
    }

    // 5. Activity log — always, with performer attribution.
    // Apr 30 2026 — Embed payment_method, proof URL and note into the log
    // notes field. Yeh sirf-ERP-side reporting ke liye hai aur Timeline mein
    // dikh jaata hai (proof link clickable hota hai jab staff timeline kholte).
    const noteParts = [
      `Payment marked paid by ${performer}`,
      payment_method ? `Method: ${payment_method}` : null,
      note ? `Note: ${note}` : null,
      payment_proof_url ? `Proof: ${payment_proof_url}` : null,
      order.shopify_order_id
        ? (shopifySynced
          ? (shopifyAlreadyPaid ? '(Shopify already paid)' : '(Shopify synced ✓)')
          : `(Shopify sync failed: ${shopifyError})`)
        : '(no Shopify order — ERP only)',
    ].filter(Boolean);

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'payment_marked_paid',
      notes: noteParts.join(' '),
      performed_by: performer,
      performed_by_email: performed_by_email || null,
      performed_at: nowIso,
    });

    return NextResponse.json({
      success: true,
      order_id,
      order_number: order.order_number,
      payment_method_set: payment_method || null,
      shopify_synced: shopifySynced,
      shopify_already_paid: shopifyAlreadyPaid,
      warning: shopifyError,
    });
  } catch (e) {
    console.error('[mark-paid] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
