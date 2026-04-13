import { NextResponse } from 'next/server';
import { sendTemplate, formatPhone } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const { phone } = await request.json();
    if (!phone) return NextResponse.json({ success: false, error: 'Phone required' });

    // Send hello_world template (pre-approved by Meta)
    const result = await sendTemplate(phone, 'hello_world', [], 'en_US');

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
