import { NextResponse } from 'next/server';
import { handleOrderWebhook } from '@/lib/shopify-webhook';

// Webhooks must run on Node runtime (crypto module) and never be cached
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { status, body } = await handleOrderWebhook(request, {
    topic: 'orders/updated',
    insertLineItems: false,
  });
  return NextResponse.json(body, { status });
}
