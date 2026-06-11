// ============================================================================
// RS ZEVAR ERP — Bot Brain Knowledge API
// GET    /api/bot-knowledge            → { responses[], knowledge[] }
// POST   /api/bot-knowledge            → create   (super_admin) body:{kind,...}
// PUT    /api/bot-knowledge            → update   (super_admin) body:{kind,id,...}
// DELETE /api/bot-knowledge?kind=&id=  → delete   (super_admin)
//
// kind = 'response' (table bot_responses) | 'knowledge' (table bot_knowledge)
// Mirrors /api/settings/tags pattern: getCurrentUser + service-role client.
// ============================================================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../lib/permissions';
import { createServerClient } from '../../../lib/supabase';
import { invalidateBotBrainCache } from '../../../lib/bot-brain/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLE = { response: 'bot_responses', knowledge: 'bot_knowledge' };

// Allowed writable columns per kind (whitelist → ignore stray fields)
const FIELDS = {
  response: ['category', 'situation', 'trigger_keywords', 'reply_en', 'reply_ru', 'tone', 'notes', 'is_active'],
  knowledge: ['category', 'title', 'content', 'keywords', 'priority', 'is_active'],
};

function pick(body, kind) {
  const out = {};
  for (const f of FIELDS[kind]) {
    if (body[f] !== undefined) out[f] = body[f];
  }
  return out;
}

async function requireSuperAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: 'Unauthorized', status: 401 };
  if (user.profile.role !== 'super_admin') {
    return { error: 'Only super admin can edit the bot knowledge base', status: 403 };
  }
  return { user };
}

// ─── GET — both lists ──────────────────────────────────────────────────────
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const supabase = createServerClient();

    const [resp, know] = await Promise.all([
      supabase.from('bot_responses').select('*').order('category', { ascending: true }).order('id', { ascending: true }),
      supabase.from('bot_knowledge').select('*').order('priority', { ascending: false }).order('id', { ascending: true }),
    ]);

    if (resp.error) throw resp.error;
    if (know.error) throw know.error;

    return NextResponse.json({
      success: true,
      responses: resp.data || [],
      knowledge: know.data || [],
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ─── POST — create ─────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const auth = await requireSuperAdmin();
    if (auth.error) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const kind = body.kind;
    if (!TABLE[kind]) {
      return NextResponse.json({ success: false, error: "kind must be 'response' or 'knowledge'" }, { status: 400 });
    }

    const row = pick(body, kind);

    if (kind === 'response') {
      if (!row.category || !row.situation) {
        return NextResponse.json({ success: false, error: 'category and situation are required' }, { status: 400 });
      }
    } else {
      if (!row.category || !row.title || !row.content) {
        return NextResponse.json({ success: false, error: 'category, title and content are required' }, { status: 400 });
      }
    }
    if (row.is_active === undefined) row.is_active = true;

    const supabase = createServerClient();
    const { data, error } = await supabase.from(TABLE[kind]).insert(row).select().single();
    if (error) throw error;

    invalidateBotBrainCache();
    return NextResponse.json({ success: true, row: data });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ─── PUT — update ──────────────────────────────────────────────────────────
export async function PUT(request) {
  try {
    const auth = await requireSuperAdmin();
    if (auth.error) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const kind = body.kind;
    const id = body.id;
    if (!TABLE[kind]) {
      return NextResponse.json({ success: false, error: "kind must be 'response' or 'knowledge'" }, { status: 400 });
    }
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    const updates = pick(body, kind);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'no valid fields to update' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase.from(TABLE[kind]).update(updates).eq('id', id).select().single();
    if (error) throw error;

    invalidateBotBrainCache();
    return NextResponse.json({ success: true, row: data });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ─── DELETE ────────────────────────────────────────────────────────────────
export async function DELETE(request) {
  try {
    const auth = await requireSuperAdmin();
    if (auth.error) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind');
    const id = searchParams.get('id');
    if (!TABLE[kind]) {
      return NextResponse.json({ success: false, error: "kind must be 'response' or 'knowledge'" }, { status: 400 });
    }
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    const supabase = createServerClient();
    const { error } = await supabase.from(TABLE[kind]).delete().eq('id', id);
    if (error) throw error;

    invalidateBotBrainCache();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
