// ============================================================================
// RS ZEVAR ERP — Loadsheets List Route (May 6 2026)
// GET /api/loadsheets?limit=50&offset=0&search=
// ----------------------------------------------------------------------------
// Paginated list of all loadsheets, newest first. Used by:
//   - /orders/loadsheets    (dedicated history page)
//   - /orders/dispatch-scan (recent activity widget at bottom)
//
// Search: matches loadsheet_number (e.g. "LS-20260506") or generated_by name.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const supabase = createServerClient();

  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);
    const search = (url.searchParams.get('search') || '').trim();

    let q = supabase
      .from('loadsheets')
      .select(
        'id, loadsheet_number, generated_at, generated_by, total_parcels, total_cod, couriers_summary, notes',
        { count: 'exact' }
      )
      .order('generated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      // Match either loadsheet_number or generated_by
      q = q.or(`loadsheet_number.ilike.%${search}%,generated_by.ilike.%${search}%`);
    }

    const { data, error, count } = await q;
    if (error) throw error;

    return NextResponse.json({
      success: true,
      loadsheets: data || [],
      total: count || 0,
      limit,
      offset,
    });

  } catch (e) {
    console.error('[loadsheets:list] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
