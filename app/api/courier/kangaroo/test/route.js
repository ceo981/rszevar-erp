import { NextResponse } from 'next/server';
import { getKangarooToken } from '../../../../../lib/kangaroo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const result = {};
  try {
    const { token, userId } = await getKangarooToken();
    result.userId = userId;

    const payload = {
      orders: [{
        cname: 'Test Customer',
        caddress: 'Block 5 Gulshan Karachi',
        cnumber: '03001234567',
        amount: 1000,
        city: 'Karachi',
        Productname: 'Jewelry',
        Productcode: '',
        comments: '',
        Ordertype: 'COD',
      }]
    };

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
    try { result.response = JSON.parse(text); } catch(e) { result.raw = text.slice(0, 300); }
  } catch(e) { result.error = e.message; }

  return NextResponse.json(result);
}
