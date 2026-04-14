import { NextResponse } from 'next/server';
import { getKangarooToken } from '../../../../../lib/kangaroo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const result = {};

  try {
    const { token, userId } = await getKangarooToken();
    result.auth = { ok: true, userId };

    // Use timestamp to ensure unique invoice
    const uniqueInvoice = 'TEST-' + Date.now();

    const payload = {
      orders: [{
        cname: 'Test Customer',
        caddress: 'Block 5 Gulshan Karachi',
        cnumber: '03001234567',
        amount: '1000',
        invoice: uniqueInvoice,
        city: 'Karachi',
        Productname: 'Jewelry',
        Productcode: '',
        comments: '',
        Ordertype: 'COD',
      }]
    };

    result.payload_sent = payload;
    result.invoice_used = uniqueInvoice;

    const res = await fetch('https://api.kangaroo.pk/order/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Service': 'kangaroo',
        'Auth-Key': 'kangaroo',
        'Auth-Token': token,
        'User-ID': String(userId),
      },
      body: JSON.stringify(payload),
    });

    result.http_status = res.status;
    const text = await res.text();
    result.response_raw = text.slice(0, 800);
    try { result.response_json = JSON.parse(text); } catch (e) { result.html_error = true; }

  } catch (e) {
    result.error = e.message;
  }

  return NextResponse.json(result);
}
