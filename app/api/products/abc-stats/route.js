// =====================================================================
// RS ZEVAR ERP — ABC Stats Endpoint
// File path: app/api/products/abc-stats/route.js
//
// Returns ABC class distribution counts for the Inventory page bar chart.
// Accepts ?window=90d or ?window=180d (default: 90d)
// =====================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const supabase = createServerClient();
    const url = new URL(request.url);
    const window = url.searchParams.get('window') === '180d' ? '180d' : '90d';
    const col = window === '180d' ? 'abc_180d' : 'abc_90d';

    // Count by class (only active products)
    const { data, error } = await supabase
      .from('products')
      .select(col)
      .eq('is_active', true);

    if (error) throw error;

    const counts = { class_a: 0, class_b: 0, class_c: 0, class_d: 0 };
    for (const row of data || []) {
      const cls = (row[col] || 'D').toUpperCase();
      if (cls === 'A') counts.class_a++;
      else if (cls === 'B') counts.class_b++;
      else if (cls === 'C') counts.class_c++;
      else counts.class_d++;
    }

    return NextResponse.json({
      success: true,
      window,
      ...counts,
      total: data?.length || 0,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
