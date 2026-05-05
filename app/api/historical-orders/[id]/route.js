// ============================================================================
// RS ZEVAR ERP — Historical Orders — Single Order Detail
// GET /api/historical-orders/[id]
// May 5 2026
// ----------------------------------------------------------------------------
// PURPOSE:
//   Returns a single archive order with all fields. Powers the read-only
//   detail page /historical-orders/[id].
//
// PARAMS:
//   :id — UUID of the historical order (NOT order_number)
//
// RESPONSE:
//   {
//     success: true,
//     order: { ...all columns... }
//   }
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id required' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    const { data: order, error } = await supabase
      .from('historical_orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Archive order not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      order,
    });
  } catch (e) {
    console.error('[GET /api/historical-orders/[id]] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
