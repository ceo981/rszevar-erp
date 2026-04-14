import { NextResponse } from 'next/server';
import { getKangarooToken } from '../../../../../lib/kangaroo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const result = {};

  try {
    const { token, userId } = await getKangarooToken();
    result.auth = { ok: true, userId, token_preview: token.slice(0, 10) + '...' };

    const payload = {
      orders: [{
        cname: 'Test Customer',
        caddress: 'Test Address Block 5 Karachi',
        cnumber: '03001234567',
        amount: '1000',
        invoice: 'TEST-DEBUG-001',
        city: 'Karachi',
        Productname: 'Jewelry',
        Productcode: 'TEST',
        comments: 'Test order',
        Ordertype: 'COD',
      }]
    };

    result.payload_sent = payload;

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
    result.response_headers = Object.fromEntries(res.headers.entries());
    const text = await res.text();
    result.response_raw = text.slice(0, 1000);

    try { result.response_json = JSON.parse(text); } catch (e) { result.parse_error = 'Not JSON — HTML response'; }

  } catch (e) {
    result.error = e.message;
    result.stack = e.stack?.slice(0, 300);
  }

  return NextResponse.json(result, { status: 200 });
}
