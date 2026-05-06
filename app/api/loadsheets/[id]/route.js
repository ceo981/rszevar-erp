// ============================================================================
// RS ZEVAR ERP — Get Single Loadsheet Route (May 6 2026)
// GET /api/loadsheets/[id]
// ----------------------------------------------------------------------------
// Returns full loadsheet header + all orders for the print page (and any
// future detail/history page). Orders sorted by `position` (scan order).
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const supabase = createServerClient();

  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Loadsheet id required' },
        { status: 400 },
      );
    }

    // ── Fetch header ──────────────────────────────────────────────────────
    const { data: loadsheet, error: headErr } = await supabase
      .from('loadsheets')
      .select('*')
      .eq('id', id)
      .single();

    if (headErr || !loadsheet) {
      return NextResponse.json(
        { success: false, error: 'Loadsheet not found' },
        { status: 404 },
      );
    }

    // ── Fetch orders (snapshot rows, sorted by position) ──────────────────
    const { data: orders, error: ordErr } = await supabase
      .from('loadsheet_orders')
      .select('*')
      .eq('loadsheet_id', id)
      .order('position', { ascending: true });

    if (ordErr) throw ordErr;

    return NextResponse.json({
      success: true,
      loadsheet: {
        ...loadsheet,
        orders: orders || [],
      },
    });

  } catch (e) {
    console.error('[loadsheet:get] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
