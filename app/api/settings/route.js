// ============================================================================
// RS ZEVAR ERP — Settings API Route
// GET  /api/settings          → fetch all settings (grouped by category)
// GET  /api/settings?category → fetch one category
// POST /api/settings          → bulk update { updates: {key: value, ...} }
//                              super_admin only
// ============================================================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/permissions';
import { createServerClient } from '@/lib/supabase';
import { getAllSettingsWithMeta, setSettingsBulk, invalidateSettingsCache } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── GET — fetch settings ──────────────────────────────────────────────────
export async function GET(request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Everyone authenticated can READ settings (so the app can use them).
    // Only super_admin can WRITE (enforced in POST).

    const all = await getAllSettingsWithMeta();

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const filtered = category ? all.filter(s => s.category === category) : all;

    // Group by category for UI
    const grouped = {};
    for (const s of filtered) {
      if (!grouped[s.category]) grouped[s.category] = [];
      grouped[s.category].push(s);
    }

    return NextResponse.json({
      success: true,
      settings: filtered,
      grouped,
      count: filtered.length,
    });
  } catch (error) {
    console.error('[settings GET] error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ─── POST — bulk update (super_admin only) ────────────────────────────────
export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // SUPER ADMIN ONLY
    if (user.profile.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Only super admin can modify settings' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const updates = body.updates || {};

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No updates provided' },
        { status: 400 }
      );
    }

    // Basic value sanity — reject anything that isn't JSON-serializable
    for (const [key, value] of Object.entries(updates)) {
      try {
        JSON.stringify(value);
      } catch {
        return NextResponse.json(
          { success: false, error: `Invalid value for ${key}` },
          { status: 400 }
        );
      }
    }

    const { results, errors } = await setSettingsBulk(updates, {
      id: user.id,
      email: user.email,
      role: user.profile.role,
    });

    return NextResponse.json({
      success: true,
      updated: results.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `${results.length} settings updated`,
    });
  } catch (error) {
    console.error('[settings POST] error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
