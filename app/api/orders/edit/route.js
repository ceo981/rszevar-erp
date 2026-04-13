// RS ZEVAR ERP — Order Edit
// POST /api/orders/edit
// Address update → ERP + Shopify sync

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { updateShopifyOrderAddress, addShopifyOrderNote } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const supabase = createServerClient();
  try {
    const { order_id, customer_name, customer_phone, customer_address, customer_city, notes } = await request.json();
    if (!order_id) return NextResponse.json({ success: false, error: 'order_id required' }, { status: 400 });

    // Get current order
    const { data: order } = await supabase.from('orders').select('*').eq('id', order_id).single();
    if (!order) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });

    // Build update object — only update fields that were sent
    const erpUpdate = { updated_at: new Date().toISOString() };
    if (customer_name)    erpUpdate.customer_name    = customer_name;
    if (customer_phone)   erpUpdate.customer_phone   = customer_phone;
    if (customer_address) erpUpdate.customer_address = customer_address;
    if (customer_city)    erpUpdate.customer_city     = customer_city;

    // Update ERP
    await supabase.from('orders').update(erpUpdate).eq('id', order_id);

    // Shopify sync
    let shopifyError = null;
    if (order.shopify_order_id) {
      try {
        // Update shipping address
        if (customer_address || customer_city || customer_name || customer_phone) {
          const [first_name, ...rest] = (customer_name || order.customer_name || '').split(' ');
          await updateShopifyOrderAddress(order.shopify_order_id, {
            first_name,
            last_name: rest.join(' ') || '.',
            phone: customer_phone || order.customer_phone || '',
            address1: customer_address || order.customer_address || '',
            city: customer_city || order.customer_city || '',
            country: 'Pakistan',
          });
        }
        // Add note
        const changes = [];
        if (customer_name    && customer_name    !== order.customer_name)    changes.push(`Name: ${customer_name}`);
        if (customer_phone   && customer_phone   !== order.customer_phone)   changes.push(`Phone: ${customer_phone}`);
        if (customer_address && customer_address !== order.customer_address) changes.push(`Address: ${customer_address}`);
        if (customer_city    && customer_city    !== order.customer_city)    changes.push(`City: ${customer_city}`);
        if (notes) changes.push(`Note: ${notes}`);
        if (changes.length > 0) {
          await addShopifyOrderNote(order.shopify_order_id, `ERP Edit — ${changes.join(', ')}`);
        }
      } catch (e) {
        shopifyError = e.message;
        console.error('[edit] Shopify error:', e.message);
      }
    }

    await supabase.from('order_activity_log').insert({
      order_id,
      action: 'edited',
      notes: `Address/details updated${shopifyError ? ' (Shopify sync failed)' : ' + Shopify synced'}`,
      performed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      shopify_synced: !shopifyError,
      warning: shopifyError || null,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
