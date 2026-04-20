// =====================================================================
// RS ZEVAR ERP — ABC Stats Endpoint
// File path: app/api/products/abc-stats/route.js
//
// Returns ABC class distribution counts for the Inventory page bar chart.
// Accepts ?window=90d or ?window=180d (default: 90d)
//
// FIX (Apr 20 2026): Previously used a single .select() which silently
// capped at Supabase's default 1000-row limit — with 4,984+ variants
// the counts were wildly under-reported. Now uses per-class HEAD count
// queries (4 fast metadata-only queries, no row transfer).
// =====================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const supabase = createServerClient();
    const url = new URL(request.url);
    const abcWindow = url.searchParams.get('window') === '180d' ? '180d' : '90d';
    const col = abcWindow === '180d' ? 'abc_180d' : 'abc_90d';

    // Count each class with a HEAD query (no data transfer, exact count)
    const [aRes, bRes, cRes, dRes, nullRes, totalRes] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true })
        .eq('is_active', true).eq(col, 'A'),
      supabase.from('products').select('*', { count: 'exact', head: true })
        .eq('is_active', true).eq(col, 'B'),
      supabase.from('products').select('*', { count: 'exact', head: true })
        .eq('is_active', true).eq(col, 'C'),
      supabase.from('products').select('*', { count: 'exact', head: true })
        .eq('is_active', true).eq(col, 'D'),
      // Products with no ABC yet (never sold / newly synced) — bucket into D
      supabase.from('products').select('*', { count: 'exact', head: true })
        .eq('is_active', true).is(col, null),
      supabase.from('products').select('*', { count: 'exact', head: true })
        .eq('is_active', true),
    ]);

    // Surface any query error loudly
    const err = aRes.error || bRes.error || cRes.error || dRes.error || nullRes.error || totalRes.error;
    if (err) throw err;

    const counts = {
      class_a: aRes.count || 0,
      class_b: bRes.count || 0,
      class_c: cRes.count || 0,
      class_d: (dRes.count || 0) + (nullRes.count || 0),
    };

    return NextResponse.json({
      success: true,
      window: abcWindow,
      ...counts,
      total: totalRes.count || 0,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
