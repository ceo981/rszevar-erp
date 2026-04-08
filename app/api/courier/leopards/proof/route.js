// ============================================================================
// Leopards — Electronic Proof of Delivery Lookup
// ============================================================================
// On-demand endpoint: given a tracking number (or comma-separated list),
// returns Leopards' proof of delivery data (signature image URL, etc.)
//
// Usage: GET /api/courier/leopards/proof?cn=KI123456789
// ============================================================================

import { NextResponse } from 'next/server';
import { fetchLeopardsProof } from '@/lib/leopards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const cn = searchParams.get('cn') || searchParams.get('tracking');

    if (!cn) {
      return NextResponse.json(
        { success: false, error: 'Missing cn or tracking query parameter' },
        { status: 400 }
      );
    }

    const data = await fetchLeopardsProof(cn);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
