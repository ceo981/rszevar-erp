import { NextResponse } from 'next/server';
import { getKangarooToken } from '../../../../../lib/kangaroo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const result = {};

  try {
    const { token, userId } = await getKangarooToken();
    result.auth = { ok: true, userId };

    // Test booking with minimal data
    const testPayload = {
      orders: [{
        Customername: 'Test Customer',
        Customeraddress: 'Test Address Karachi',
        Customernumber: '03001234567',
        Amount: '1000',
        Invoice: 'TEST-001',
        City: 'Karachi',
        Pieces: '1',
        Weight: '500',
      }]
    };

    result.payload_sent = testPayload;

    const res = await fetch('https://api.kangaroo.pk/order/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Service': 'kangaroo',
        'Auth-Key': 'kangaroo',
        'Auth-Token': token,
        'User-ID': userId,
      },
      body: JSON.stringify(testPayload),
    });

    const text = await res.text();
    result.http_status = res.status;
    result.response_raw = text.slice(0, 500);

    try { result.response_json = JSON.parse(text); } catch (e) { result.parse_error = e.message; }

  } catch (e) {
    result.error = e.message;
  }

  return NextResponse.json(result);
}
