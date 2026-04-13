import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const webhookToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  const ready = !!(phoneNumberId && accessToken && webhookToken);

  return NextResponse.json({
    phone_number_id: phoneNumberId || null,
    token_set: !!accessToken,
    webhook_token_set: !!webhookToken,
    ready,
  });
}
