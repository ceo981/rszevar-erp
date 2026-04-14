import { NextResponse } from 'next/server';
import { getKangarooToken } from '../../../../../lib/kangaroo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const v = searchParams.get('v') || '1';
  const result = { v };

  try {
    const { token, userId } = await getKangarooToken();

    const payloads = {
      // Minimal - no optional fields
      '1': { orders: [{ cname:'Test', caddress:'Block 5 Gulshan Karachi', cnumber:'03001234567', amount:'1000', city:'Karachi', Ordertype:'COD' }] },
      // Amount as number
      '2': { orders: [{ cname:'Test', caddress:'Block 5 Gulshan Karachi', cnumber:'03001234567', amount:1000, city:'Karachi', Ordertype:'COD' }] },
      // With Productname only
      '3': { orders: [{ cname:'Test', caddress:'Block 5 Gulshan Karachi', cnumber:'03001234567', amount:'1000', city:'Karachi', Productname:'Jewelry', Ordertype:'COD' }] },
      // ordertype lowercase
      '4': { orders: [{ cname:'Test', caddress:'Block 5 Gulshan Karachi', cnumber:'03001234567', amount:'1000', city:'Karachi', Productname:'Jewelry', ordertype:'COD' }] },
      // Without Ordertype field
      '5': { orders: [{ cname:'Test', caddress:'Block 5 Gulshan Karachi', cnumber:'03001234567', amount:'1000', city:'Karachi', Productname:'Jewelry' }] },
    };

    const payload = payloads[v];
    result.payload = payload;

    const res = await fetch('https://api.kangaroo.pk/order/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Service': 'kangaroo',
        'Auth-Key': 'kangaroo',
        'Auth-Token': token,
        'User-ID': userId,
      },
      body: JSON.stringify(payload),
    });

    result.http_status = res.status;
    const text = await res.text();
    try { result.response = JSON.parse(text); } catch(e) { result.raw = text.slice(0,200); }
  } catch(e) { result.error = e.message; }

  return NextResponse.json(result);
}
