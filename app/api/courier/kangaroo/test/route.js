import { NextResponse } from 'next/server';
import { getKangarooToken } from '../../../../../lib/kangaroo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const variant = searchParams.get('v') || '1';
  const result = { variant };

  try {
    const { token, userId } = await getKangarooToken();

    // Try different payload variations
    const variants = {
      '1': { cname:'Test',caddress:'Block 5 Gulshan Karachi',cnumber:'03001234567',amount:1000,invoice:'T'+Date.now(),city:'Karachi',Productname:'Jewelry',Productcode:'',comments:'',Ordertype:'COD' },
      '2': { cname:'Test',caddress:'Block 5 Gulshan Karachi',cnumber:'03001234567',amount:'1000',invoice:'T'+Date.now(),city:'Karachi',Productname:'Jewelry',Productcode:'TEST',comments:'test',Ordertype:'COD' },
      '3': { cname:'Test',caddress:'Block 5 Gulshan Karachi',cnumber:'+923001234567',amount:1000,invoice:'T'+Date.now(),city:'Karachi',Productname:'Jewelry',Productcode:'',comments:'',Ordertype:'COD' },
      '4': { cname:'Test',caddress:'Block 5 Gulshan Karachi',cnumber:'923001234567',amount:1000,invoice:'T'+Date.now(),city:'Karachi',Productname:'Jewelry',Productcode:'',comments:'',Ordertype:'COD' },
      '5': { cname:'Test',caddress:'Block 5 Gulshan Karachi',cnumber:'03001234567',amount:1000,invoice:'T'+Date.now(),city:'Karachi',Productname:'Jewelry',Ordertype:'COD' },
    };

    const orderData = variants[variant] || variants['1'];
    const payload = { orders: [orderData] };
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
