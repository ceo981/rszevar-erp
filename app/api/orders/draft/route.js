// RS ZEVAR ERP — Draft Order (WhatsApp orders)
// POST /api/orders/draft

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { createShopifyDraftOrder } from '@/lib/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const supabase = createServerClient();
  try {
    const { customer_name, customer_phone, customer_address, customer_city, line_items, note, source } = await request.json();

    if (!customer_name || !customer_phone) {
      return NextResponse.json({ success: false, error: 'Customer name aur phone required hai' }, { status: 400 });
    }
    if (!line_items?.length) {
      return NextResponse.json({ success: false, error: 'Kam az kam 1 product add karo' }, { status: 400 });
    }

    // Create draft in Shopify
    const data = await createShopifyDraftOrder({
      customer_name,
      customer_phone,
      customer_address,
      customer_city,
      line_items: line_items.map(item => ({
        variant_id: item.shopify_variant_id ? parseInt(item.shopify_variant_id) : undefined,
        title: item.title,
        quantity: item.quantity || 1,
        price: String(item.price || 0),
      })),
      note: note || `Source: ${source || 'WhatsApp'} | ERP se create kiya`,
    });

    const draft = data.draft_order;
    if (!draft) throw new Error('Shopify draft order create nahi hua');

    // Save to ERP orders table as pending
    const total = parseFloat(draft.total_price || 0);
    const { data: erpOrder, error } = await supabase.from('orders').insert({
      shopify_order_id: String(draft.id),
      order_number: draft.name || `DRAFT-${draft.id}`,
      customer_name,
      customer_phone,
      customer_address: [customer_address, customer_city].filter(Boolean).join(', '),
      customer_city: customer_city || '',
      total_amount: total,
      subtotal: total,
      payment_method: 'COD',
      status: 'pending',
      payment_status: 'unpaid',
      tags: ['draft', source || 'whatsapp'],
      is_wholesale: false,
      is_international: false,
      is_walkin: false,
      shopify_synced_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select().single();

    if (error) console.error('[draft] ERP insert error:', error.message);

    return NextResponse.json({
      success: true,
      draft_order_id: draft.id,
      draft_order_name: draft.name,
      invoice_url: draft.invoice_url,
      erp_order_id: erpOrder?.id || null,
    });
  } catch (e) {
    console.error('[draft] Error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
