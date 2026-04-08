// ============================================================================
// RS ZEVAR ERP — Tag Definitions API
// GET  /api/settings/tags        → list all tags
// POST /api/settings/tags        → create new tag      (super_admin)
// PUT  /api/settings/tags        → update existing tag (super_admin)
// DELETE /api/settings/tags?id=  → delete tag          (super_admin)
// ============================================================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/permissions';
import { createServerClient } from '../../../../lib/supabase';
import { invalidateTagCache } from '../../../../lib/tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireSuperAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: 'Unauthorized', status: 401 };
  if (user.profile.role !== 'super_admin') {
    return { error: 'Only super admin can modify tags', status: 403 };
  }
  return { user };
}

// ─── GET ──────────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('tag_definitions')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ success: true, tags: data || [] });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ─── POST — create ────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const auth = await requireSuperAdmin();
    if (auth.error) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const {
      tag_key, label, description, category = 'custom',
      color = '#888', auto_action = {}, sort_order = 100,
    } = body;

    if (!tag_key || !label) {
      return NextResponse.json({ success: false, error: 'tag_key and label required' }, { status: 400 });
    }

    // Normalize tag_key
    const normalized = String(tag_key).toLowerCase().trim().replace(/\s+/g, '');
    if (!/^[a-z0-9_]+$/.test(normalized)) {
      return NextResponse.json({
        success: false,
        error: 'tag_key must be lowercase letters, numbers, and underscores only',
      }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('tag_definitions')
      .insert({
        tag_key: normalized,
        label,
        description: description || null,
        category,
        color,
        auto_action,
        sort_order,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: `Tag "${normalized}" already exists` }, { status: 409 });
      }
      throw error;
    }

    invalidateTagCache();
    return NextResponse.json({ success: true, tag: data });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ─── PUT — update ─────────────────────────────────────────────────────────
export async function PUT(request) {
  try {
    const auth = await requireSuperAdmin();
    if (auth.error) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const { id, ...updates } = body;

    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    // Don't allow changing tag_key via update (to prevent orphans)
    delete updates.tag_key;
    updates.updated_at = new Date().toISOString();

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('tag_definitions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    invalidateTagCache();
    return NextResponse.json({ success: true, tag: data });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────
export async function DELETE(request) {
  try {
    const auth = await requireSuperAdmin();
    if (auth.error) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    const supabase = createServerClient();

    // Prevent deleting core system tags (safer)
    const { data: tag } = await supabase
      .from('tag_definitions')
      .select('tag_key')
      .eq('id', id)
      .maybeSingle();

    const CORE_TAGS = ['wholesale', 'international', 'walkin', 'kangaroo', 'order_confirmed'];
    if (tag && CORE_TAGS.includes(tag.tag_key)) {
      return NextResponse.json({
        success: false,
        error: `Cannot delete core system tag "${tag.tag_key}". Disable it instead.`,
      }, { status: 400 });
    }

    const { error } = await supabase.from('tag_definitions').delete().eq('id', id);
    if (error) throw error;

    invalidateTagCache();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
