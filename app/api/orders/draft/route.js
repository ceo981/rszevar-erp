// RS ZEVAR ERP — Draft Order (WhatsApp orders)
// POST /api/orders/draft

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION    = '2024-01';

async function shopifyPost(endpoint, body) {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/${endpoint}`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

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

    const shopifyLineItems = line_items.map(item => {
      if (item.shopify_variant_id) {
        return { variant_id: parseInt(item.shopify_variant_id), quantity: item.quantity || 1 };
      }
      return { title: item.title || 'Custom Item', quantity: item.quantity || 1, price: String(item.price || 0) };
    });

    const [first_name, ...rest] = (customer_name || 'Customer').split(' ');

    const data = await shopifyPost('draft_orders.json', {
      draft_order: {
        line_items: shopifyLineItems,
        shipping_address: {
          first_name,
          last_name: rest.join(' ') || '.',
          phone: customer_phone || '',
          address1: customer_address || '',
          city: customer_city || 'Karachi',
          country: 'Pakistan',
        },
        note: `Source: ${source || 'WhatsApp'} | ${note || 'ERP se create kiya'}`,
        tags: `draft,${source || 'whatsapp'},erp-order`,
      },
    });

    const draft = data.draft_order;
    if (!draft?.id) throw new Error('Shopify draft order create nahi hua');

    const total = parseFloat(draft.total_price || 0) ||
      line_items.reduce((s, i) => s + (parseFloat(i.price || 0) * (i.quantity || 1)), 0);

    const { data: erpOrder, error: erpErr } = await supabase.from('orders').insert({
      shopify_order_id:  String(draft.id),
      order_number:      draft.name || `#DRAFT-${draft.id}`,
      customer_name,
      customer_phone,
      customer_address:  [customer_address, customer_city].filter(Boolean).join(', '),
      customer_city:     customer_city || '',
      total_amount:      total,
      subtotal:          total,
      payment_method:    'COD',
      status:            'pending',
      payment_status:    'unpaid',
      tags:              ['draft', source || 'whatsapp'],
      is_wholesale:      false,
      is_international:  false,
      is_walkin:         false,
      shopify_raw:       draft,
      shopify_synced_at: new Date().toISOString(),
      created_at:        new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    }).select().single();

    if (erpErr) console.error('[draft] ERP insert error:', erpErr.message);

    return NextResponse.json({
      success:          true,
      draft_order_id:   draft.id,
      draft_order_name: draft.name,
      invoice_url:      draft.invoice_url,
      erp_order_id:     erpOrder?.id || null,
    });

  } catch (e) {
    console.error('[draft] Error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
