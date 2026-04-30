// ============================================================================
// RS ZEVAR ERP — Update Order Type Tags Route (Apr 2026)
// POST /api/orders/update-tags
//   { order_id, tag, value, performed_by, performed_by_email }
//   tag: 'walkin' | 'international' | 'wholesale'
//   value: true | false (toggle on/off)
// ----------------------------------------------------------------------------
// Order page se walk-in / international / wholesale tag manually toggle karne
// ke liye. Pehle yeh tags rszevar.com platform side se aate the (Shopify tags)
// — ab ERP se hi set ho sakte hain, kyunki team rszevar.com platform pe
// directly access nahi karega.
//
// What it updates:
//   - orders.is_walkin / is_international / is_wholesale boolean
//   - orders.tags JSONB array (add/remove the tag string)
//   - rszevar.com platform tags (best-effort — if API call fails, ERP still saves)
//   - order_activity_log entry
//
// IMPORTANT: Yeh tags sirf INFORMATIONAL hain. Koi auto-action trigger nahi
// karte. Walk-in tag lagane se order auto-deliver NAHI hota.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { updateShopifyOrderTags } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Whitelist of allowed tags + their DB column mapping
const TAG_CONFIG = {
  walkin:        { column: 'is_walkin',        label: 'Walk-in' },
  international: { column: 'is_international', label: 'International' },
  wholesale:     { column: 'is_wholesale',     label: 'Wholesale' },
};

export async function POST(request) {
  try {
    const { order_id, tag, value, performed_by, performed_by_email } = await request.json();

    if (!order_id || !tag) {
      return NextResponse.json(
        { success: false, error: 'order_id aur tag dono required hain' },
        { status: 400 },
      );
    }

    const config = TAG_CONFIG[tag];
    if (!config) {
      return NextResponse.json(
        { success: false, error: `Invalid tag: ${tag}. Allowed: walkin, international, wholesale` },
        { status: 400 },
      );
    }

    const newValue = !!value;
    const supabase = createServerClient();

    // Fetch order
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, shopify_order_id, tags, ' + config.column)
      .eq('id', order_id)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // No-op: already at desired value
    if (!!order[config.column] === newValue) {
      return NextResponse.json({
        success: true,
        order_id,
        tag,
        value: newValue,
        no_change: true,
      });
    }

    // Update orders.tags JSONB array (add or remove the tag string)
    const currentTags = Array.isArray(order.tags) ? order.tags.filter(t => String(t).toLowerCase() !== tag) : [];
    if (newValue) currentTags.push(tag);

    const updatePayload = {
      [config.column]: newValue,
      tags: currentTags,
      updated_at: new Date().toISOString(),
    };

    const { error: updateErr } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', order_id);

    if (updateErr) throw updateErr;

    // Mirror to rszevar.com platform side (best-effort)
    let platformSyncError = null;
    if (order.shopify_order_id) {
      try {
        if (newValue) {
          await updateShopifyOrderTags(order.shopify_order_id, [tag], []);
        } else {
          await updateShopifyOrderTags(order.shopify_order_id, [], [tag]);
        }
      } catch (e) {
        platformSyncError = e.message;
        console.error('[update-tags] platform sync failed:', e.message);
      }
    }

    // Activity log
    await supabase.from('order_activity_log').insert({
      order_id,
      action: newValue ? `tag_added:${tag}` : `tag_removed:${tag}`,
      notes: `${config.label} tag ${newValue ? 'added' : 'removed'} by ${performed_by || 'Staff'}.${platformSyncError ? ` Platform sync warning: ${platformSyncError}` : ''}`,
      performed_by: performed_by || 'Staff',
      performed_by_email: performed_by_email || null,
      performed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      order_id,
      order_number: order.order_number,
      tag,
      value: newValue,
      label: config.label,
      platform_synced: !platformSyncError,
      warning: platformSyncError,
    });
  } catch (e) {
    console.error('[update-tags] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
