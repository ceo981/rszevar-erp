// ============================================================================
// RS ZEVAR ERP — Return to Office + Restock
// POST /api/orders/return-restock
// May 8 2026
// ----------------------------------------------------------------------------
// Use case: Parcel courier ne RTO kiya (return to origin) aur physically
// office wapas pohcha. Stock wapas inventory mein add karna hai aur order ko
// terminal "returned" state mein move karna hai.
//
// Pehle issue: staff cancel button click karte the (taa-ke Shopify cancel
// flow auto-restock kar de), but cancel route RTO state se block hoti hai
// kyun ke "RTO/Returned flow use karo" — lekin Returned flow UI mein tha hi
// nahi. Ye route woh gap fill karta hai.
//
// Flow:
//   1. Validate: order RTO state mein hona chahiye (ya optionally "delivered"
//      jab CEO refund/return scenario handle kar raha ho — opt-in via flag).
//   2. Stock restoration:
//      a) Local DB: products.current_stock + stock_quantity dono increment
//         (her order_item ke variant_id se match, fallback SKU).
//      b) Shopify: inventory_levels/set.json call (best-effort, log on fail).
//      c) inventory_adjustments mein audit row (source='rto_restock').
//   3. Order status: rto → returned (terminal, no further auto-progression).
//   4. Activity log: rto_restocked action with item-level summary.
//
// Permission: super_admin/admin/manager only (server-side check).
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { checkPermissionByEmail } from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── Shopify REST helper ──────────────────────────────────────────────────
const SHOPIFY_DOMAIN  = process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_DOMAIN;
const SHOPIFY_TOKEN   = process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_VER = process.env.SHOPIFY_API_VERSION || '2025-01';

async function shopifyREST(endpoint, { method = 'GET', body = null } = {}) {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VER}/${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  if (!res.ok) {
    const errMsg = data?.errors ? JSON.stringify(data.errors) : text;
    throw new Error(`Shopify ${method} ${endpoint} failed (${res.status}): ${errMsg}`);
  }
  return data;
}

// ─── Cached active Shopify location ───────────────────────────────────────
let _cachedLocId = null;
let _cachedLocAt = 0;
async function getShopifyLocationId() {
  const now = Date.now();
  if (_cachedLocId && (now - _cachedLocAt) < 10 * 60 * 1000) return _cachedLocId;
  const j = await shopifyREST('locations.json');
  const loc = (j.locations || []).find(l => l.active) || (j.locations || [])[0];
  if (!loc) throw new Error('No active Shopify location found');
  _cachedLocId = String(loc.id);
  _cachedLocAt = now;
  return _cachedLocId;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
export async function POST(request) {
  const startTime = Date.now();
  const supabase = createServerClient();
  try {
    const body = await request.json();
    const {
      order_id,
      reason,                  // optional human note (e.g. "courier returned 8 May")
      performed_by,
      performed_by_email,
      sync_shopify_stock,      // optional, default true
      allow_from_delivered,    // optional flag for refund/return from delivered
                               // (requires orders.force_status_revert permission)
    } = body;

    if (!order_id) {
      return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });
    }

    // ── Permission check (May 8 2026) ───────────────────────────────────────
    // Replaced hardcoded role gate with delegate-able permission check.
    // Default grants: super_admin, admin, manager. CEO can grant to other
    // roles via /roles page (e.g. CSR for parcel handling).
    const restockCheck = await checkPermissionByEmail(supabase, performed_by_email, 'orders.return_restock');
    if (!restockCheck.allowed) {
      return NextResponse.json(
        { success: false, error: restockCheck.reason },
        { status: 403 },
      );
    }

    // For delivered → returned (refund/return scenario), need a stronger perm.
    // Default: super_admin/admin only.
    if (allow_from_delivered === true) {
      const forceCheck = await checkPermissionByEmail(supabase, performed_by_email, 'orders.force_status_revert');
      if (!forceCheck.allowed) {
        return NextResponse.json(
          { success: false, error: 'Delivered se restock karne ke liye orders.force_status_revert permission chahiye' },
          { status: 403 },
        );
      }
    }

    const performer = performed_by || 'Staff';
    const shouldSyncShopify = sync_shopify_stock !== false;

    // ── Fetch order + items ─────────────────────────────────────────────────
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_number, status, shopify_order_id')
      .eq('id', order_id)
      .single();

    if (orderErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Status validation: rto allowed always; delivered only with explicit flag (perm-gated above)
    const fromStatus = order.status;
    const okFromRto       = fromStatus === 'rto';
    const okFromDelivered = fromStatus === 'delivered' && allow_from_delivered === true;
    if (!okFromRto && !okFromDelivered) {
      return NextResponse.json({
        success: false,
        error: `Restock sirf RTO state se ho sakta hai (current: ${fromStatus}). ` +
               `Delivered orders ke liye allow_from_delivered=true bhejo (force_status_revert perm required).`,
      }, { status: 400 });
    }

    const { data: items, error: itemsErr } = await supabase
      .from('order_items')
      .select('id, sku, shopify_variant_id, quantity, title')
      .eq('order_id', order_id);

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Order ke koi line items nahi mile — restock nahi ho sakti',
      }, { status: 400 });
    }

    // ── Lookup products by variant_id (preferred) and SKU (fallback) ────────
    const variantIds = [...new Set(items.filter(i => i.shopify_variant_id).map(i => i.shopify_variant_id))];
    const skus       = [...new Set(items.filter(i => !i.shopify_variant_id && i.sku).map(i => i.sku))];

    const productByVariant = {};
    if (variantIds.length > 0) {
      const { data: prods } = await supabase
        .from('products')
        .select('id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, sku, title, current_stock, stock_quantity')
        .in('shopify_variant_id', variantIds);
      for (const p of prods || []) {
        if (p.shopify_variant_id) productByVariant[p.shopify_variant_id] = p;
      }
    }

    const productBySku = {};
    if (skus.length > 0) {
      const { data: prods } = await supabase
        .from('products')
        .select('id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, sku, title, current_stock, stock_quantity')
        .in('sku', skus);
      for (const p of prods || []) {
        // first-hit-wins for shared SKUs (best we can do without variant_id)
        if (p.sku && !productBySku[p.sku]) productBySku[p.sku] = p;
      }
    }

    // ── Compute restock plan ────────────────────────────────────────────────
    const restockPlan = [];   // [{ orderItem, product, qty }]
    const skipped = [];       // [{ orderItem, reason }]

    for (const it of items) {
      let prod = null;
      if (it.shopify_variant_id && productByVariant[it.shopify_variant_id]) {
        prod = productByVariant[it.shopify_variant_id];
      } else if (it.sku && productBySku[it.sku]) {
        prod = productBySku[it.sku];
      }
      if (!prod) {
        skipped.push({ item_id: it.id, title: it.title, sku: it.sku, reason: 'no matching product in inventory' });
        continue;
      }
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) {
        skipped.push({ item_id: it.id, title: it.title, sku: it.sku, reason: 'zero quantity' });
        continue;
      }
      restockPlan.push({ item: it, product: prod, qty });
    }

    if (restockPlan.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Koi item restock ke layak nahi nikla. Inventory mein products missing ya quantity zero.',
        skipped,
      }, { status: 400 });
    }

    // ── Apply DB stock increments (one update per product row) ──────────────
    // Multiple order_items may share the same product (rare), so we sum first.
    const stockDeltaByProductId = new Map();   // productId → totalDelta
    const productById            = new Map();   // productId → product row (cached)
    const itemPlanByProductId    = new Map();   // productId → [items in plan]

    for (const entry of restockPlan) {
      const pid = entry.product.id;
      stockDeltaByProductId.set(pid, (stockDeltaByProductId.get(pid) || 0) + entry.qty);
      productById.set(pid, entry.product);
      if (!itemPlanByProductId.has(pid)) itemPlanByProductId.set(pid, []);
      itemPlanByProductId.get(pid).push(entry);
    }

    const stockResults = []; // for response summary
    const nowIso = new Date().toISOString();

    for (const [pid, delta] of stockDeltaByProductId.entries()) {
      const prod = productById.get(pid);
      const oldStock = Number(prod.current_stock ?? prod.stock_quantity ?? 0);
      const newStock = oldStock + delta;

      // a) Local DB update — both columns kept in sync
      const { error: updErr } = await supabase
        .from('products')
        .update({
          current_stock: newStock,
          stock_quantity: newStock,
          updated_at: nowIso,
        })
        .eq('id', pid);

      const result = {
        product_id: pid,
        sku: prod.sku,
        title: prod.title,
        old_stock: oldStock,
        new_stock: newStock,
        delta,
        local_db: !updErr,
        local_db_error: updErr?.message || null,
        shopify_synced: false,
        shopify_error: null,
        audit_logged: false,
      };

      // b) Shopify sync — best effort
      if (shouldSyncShopify && !updErr && prod.shopify_inventory_item_id) {
        try {
          const locId = await getShopifyLocationId();
          await shopifyREST('inventory_levels/set.json', {
            method: 'POST',
            body: {
              location_id: Number(locId),
              inventory_item_id: Number(prod.shopify_inventory_item_id),
              available: newStock,
            },
          });
          result.shopify_synced = true;
        } catch (e) {
          result.shopify_error = e.message;
          console.error(`[return-restock] Shopify sync failed for product ${pid}:`, e.message);
        }
      } else if (shouldSyncShopify && !prod.shopify_inventory_item_id) {
        result.shopify_error = 'shopify_inventory_item_id missing on products row';
      }

      // c) Audit row in inventory_adjustments
      if (!updErr) {
        try {
          const itemSummary = (itemPlanByProductId.get(pid) || [])
            .map(p => `${p.qty}× from ${order.order_number}`)
            .join(', ');
          const { error: auditErr } = await supabase.from('inventory_adjustments').insert({
            shopify_variant_id: prod.shopify_variant_id || null,
            shopify_inventory_item_id: prod.shopify_inventory_item_id || null,
            shopify_product_id: prod.shopify_product_id || null,
            sku: prod.sku || null,
            product_title: prod.title || null,
            activity: 'stock',
            description: `RTO restock: +${delta} from order ${order.order_number} (${itemSummary})`,
            field_name: 'stock',
            old_value: String(oldStock),
            new_value: String(newStock),
            stock_before: oldStock,
            stock_after: newStock,
            stock_delta: delta,
            performed_by: performer,
            performed_by_email: performed_by_email || null,
            reason: reason || `RTO restock from ${order.order_number}`,
            source: 'rto_restock',
          });
          result.audit_logged = !auditErr;
          if (auditErr) result.audit_error = auditErr.message;
        } catch (e) {
          result.audit_error = e.message;
        }
      }

      stockResults.push(result);
    }

    // ── Update order status: rto → returned (terminal) ──────────────────────
    const { error: orderUpdErr } = await supabase
      .from('orders')
      .update({
        status: 'returned',
        updated_at: nowIso,
      })
      .eq('id', order_id);

    if (orderUpdErr) {
      // Stock already restocked — order status update failure is non-fatal but flag it
      console.error('[return-restock] order status update failed:', orderUpdErr.message);
    }

    // ── Activity log ────────────────────────────────────────────────────────
    const totalRestocked = stockResults.reduce((s, r) => s + (r.local_db ? r.delta : 0), 0);
    const shopifyOkCount = stockResults.filter(r => r.shopify_synced).length;
    const shopifyFailCount = stockResults.filter(r => r.shopify_error).length;

    const summaryNotes = [
      `RTO restock by ${performer} (${restockCheck.role})`,
      `${totalRestocked} units across ${stockResults.length} product(s) returned to inventory`,
      shouldSyncShopify ? `Shopify: ${shopifyOkCount} synced${shopifyFailCount ? `, ${shopifyFailCount} failed` : ''}` : '(Shopify sync skipped)',
      reason ? `Note: ${reason}` : null,
      skipped.length > 0 ? `${skipped.length} item(s) skipped` : null,
      okFromDelivered ? '(from delivered — force_status_revert override)' : null,
    ].filter(Boolean).join(' | ');

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'rto_restocked',
      notes: summaryNotes,
      performed_by: performer,
      performed_by_email: performed_by_email || null,
      performed_at: nowIso,
    });

    return NextResponse.json({
      success: true,
      from_status: fromStatus,
      to_status: 'returned',
      total_units_restocked: totalRestocked,
      products_updated: stockResults.length,
      shopify_synced_count: shopifyOkCount,
      shopify_failed_count: shopifyFailCount,
      stock_results: stockResults,
      skipped,
      duration_ms: Date.now() - startTime,
    });

  } catch (e) {
    console.error('[return-restock] error:', e.message);
    return NextResponse.json({
      success: false,
      error: e.message,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
