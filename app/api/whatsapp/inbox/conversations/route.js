/**
 * GET /api/whatsapp/inbox/conversations
 * =====================================
 * List all WhatsApp conversations sorted by latest activity.
 *
 * Query params:
 *   ?search=      — filter by name/phone/preview (case-insensitive)
 *   ?status=open  — filter by status (default: all)
 *   ?limit=50     — pagination (max 100)
 *   ?page=1       — page number
 *
 * Returns:
 *   { success: true, conversations: [...], total, unread_total }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim();
    const status = searchParams.get('status') || 'open';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('whatsapp_conversations')
      .select('*', { count: 'exact' })
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (search) {
      // Search across phone, name, wa_name, last message preview
      query = query.or(
        `customer_phone.ilike.%${search}%,customer_name.ilike.%${search}%,customer_wa_name.ilike.%${search}%,last_message_text.ilike.%${search}%`
      );
    }

    const { data: conversations, count, error } = await query;
    if (error) throw error;

    // Total unread across all open conversations (for sidebar badge)
    const { data: unreadRows } = await supabase
      .from('whatsapp_conversations')
      .select('unread_count')
      .eq('status', 'open')
      .gt('unread_count', 0);

    const unreadTotal = (unreadRows || []).reduce((s, r) => s + (r.unread_count || 0), 0);

    return NextResponse.json({
      success: true,
      conversations: conversations || [],
      total: count || 0,
      page,
      limit,
      unread_total: unreadTotal,
    });
  } catch (e) {
    console.error('[inbox/conversations] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
