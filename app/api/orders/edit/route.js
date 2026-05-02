// ============================================================================
// RS ZEVAR ERP — Order Customer Info Edit  (RESTORED May 2026)
// POST /api/orders/edit
// ----------------------------------------------------------------------------
// PURPOSE: Edit customer-facing fields on an order (name, phone, address, city)
// from ERP and sync back to Shopify. This is the "Edit contact information /
// Edit shipping address" handler — NOT line-items edit (that's edit-commit).
//
// PREVIOUSLY: The file content was accidentally overwritten with a near-copy of
// /api/orders/edit-commit/route.js, which expected `calculated_order_id` and
// returned 400 on every save attempt. The drawer + kebab-menu "Save + Sync to
// Shopify" silently failed for weeks. This file restores the original behavior.
//
// REQUEST BODY:
//   {
//     order_id: number,
//     customer_name?: string,
//     customer_phone?: string,
//     customer_address?: string,
//     customer_city?: string,
//     notes?: string,                 // audit log only
//     performed_by?: string,
//     performed_by_email?: string,
//     skip_shopify?: boolean          // optional — ERP-only edit (rare cases)
//   }
//
// RESPONSE:
//   { success, shopify_synced, warning?, patch }
//
// FLOW:
//   1. Fetch existing order (must exist)
//   2. Compute diff vs body — only changed fields go into update
//   3. Update orders table
//   4. If shopify_order_id present and !skip_shopify: PUT shipping_address
//   5. Activity log with before/after + reason
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { updateShopifyOrderAddress } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Statuses jin pe customer info edit allowed hai. RTO/cancelled/delivered ke
// baad address change ka koi practical use nahi — courier already done.
// Super-admin manual override ke liye `force` future mein add ho sakta hai.
const EDITABLE_STATUSES = new Set([
  'pending',
  'confirmed',
  'on_packing',
  'packed',
  'dispatched',  // Sometimes courier-side address change request aati hai
  'attempted',
  'hold',
]);

export async function POST(request) {
  const supabase = createServerClient();
  const startTime = Date.now();

  try {
    const body = await request.json();
    const {
      order_id,
      customer_name,
      customer_phone,
      customer_address,
      customer_city,
      notes,
      performed_by,
      performed_by_email,
      skip_shopify,
    } = body;

    if (!order_id) {
      return NextResponse.json(
        { success: false, error: 'order_id required' },
        { status: 400 },
      );
    }

    // ── 1. Fetch order ──
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, status, shopify_order_id, customer_name, customer_phone, customer_address, customer_city')
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 },
      );
    }

    if (!EDITABLE_STATUSES.has(order.status)) {
      return NextResponse.json(
        {
          success: false,
          error: `Order status '${order.status}' pe customer info edit nahi ho sakti`,
        },
        { status: 400 },
      );
    }

    // ── 2. Diff before/after ──
    const before = {
      customer_name: order.customer_name || '',
      customer_phone: order.customer_phone || '',
      customer_address: order.customer_address || '',
      customer_city: order.customer_city || '',
    };

    const patch = {};
    const isStr = (v) => typeof v === 'string';

    if (isStr(customer_name)    && customer_name.trim()    && customer_name.trim()    !== before.customer_name)    patch.customer_name    = customer_name.trim();
    if (isStr(customer_phone)   && customer_phone.trim()   && customer_phone.trim()   !== before.customer_phone)   patch.customer_phone   = customer_phone.trim();
    if (isStr(customer_address) && customer_address.trim() && customer_address.trim() !== before.customer_address) patch.customer_address = customer_address.trim();
    if (isStr(customer_city)    && customer_city.trim()    && customer_city.trim()    !== before.customer_city)    patch.customer_city    = customer_city.trim();

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Koi field change nahi hua — kuch save karne ki zaroorat nahi',
        shopify_synced: false,
        patch: {},
        duration_ms: Date.now() - startTime,
      });
    }

    // ── 3. Update ERP ──
    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('orders')
      .update({ ...patch, updated_at: nowIso })
      .eq('id', order_id);

    if (updErr) {
      throw new Error(`ERP update failed: ${updErr.message}`);
    }

    // ── 4. Sync to Shopify (best-effort) ──
    let shopifySynced = false;
    let shopifyError = null;

    if (order.shopify_order_id && !skip_shopify) {
      try {
        // Build complete address payload — Shopify needs full shipping_address
        // object even if only one field changed. Use new value if patched, else
        // keep original.
        const finalName    = patch.customer_name    ?? before.customer_name;
        const finalPhone   = patch.customer_phone   ?? before.customer_phone;
        const finalAddress = patch.customer_address ?? before.customer_address;
        const finalCity    = patch.customer_city    ?? before.customer_city;

        // Shopify wants first_name + last_name split. Heuristic: split on first space.
        const nameParts = String(finalName || 'Customer').trim().split(/\s+/);
        const firstName = nameParts[0] || 'Customer';
        const lastName  = nameParts.slice(1).join(' ') || '.';

        await updateShopifyOrderAddress(order.shopify_order_id, {
          first_name: firstName,
          last_name: lastName,
          name: finalName,
          phone: finalPhone || '',
          address1: finalAddress || '',
          city: finalCity || 'Karachi',
          country: 'Pakistan',
          country_code: 'PK',
        });
        shopifySynced = true;
      } catch (e) {
        shopifyError = e.message;
        console.error('[orders/edit] Shopify sync error:', e.message);
      }
    }

    // ── 5. Activity log ──
    const performer = performed_by || 'Staff';
    const changeStr = Object.keys(patch)
      .map(k => `${k.replace('customer_', '')}: "${before[k]}" → "${patch[k]}"`)
      .join(' | ');

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'customer_edited',
      notes: [
        changeStr,
        notes && String(notes).trim() ? `Reason: ${String(notes).trim()}` : null,
        shopifySynced ? '+ Shopify synced' : null,
        shopifyError ? `Shopify sync failed: ${shopifyError}` : null,
        skip_shopify ? '(Shopify sync skipped on request)' : null,
      ].filter(Boolean).join(' | '),
      performed_by: performer,
      performed_by_email: performed_by_email || null,
      performed_at: nowIso,
    });

    return NextResponse.json({
      success: true,
      shopify_synced: shopifySynced,
      warning: shopifyError ? `ERP saved but Shopify sync failed: ${shopifyError}` : null,
      patch,
      duration_ms: Date.now() - startTime,
    });
  } catch (e) {
    console.error('[orders/edit] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
