/**
 * GET /api/blog/posts
 *
 * Lists all blog posts with optional filters.
 *
 * Query params:
 *   status: 'draft' | 'review' | 'pushed' | 'published' | 'archived' (optional)
 *   article_type: 'guide' | 'listicle' | 'case_study' | 'news' | 'pillar' (optional)
 *   search: string (searches title + target_keyword)
 *   limit: number (default 50, max 200)
 *   offset: number (default 0)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const articleType = searchParams.get('article_type');
    const search = searchParams.get('search');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // Build query
    let query = supabase
      .from('blog_posts')
      .select(
        'id, title, slug, excerpt, meta_title, meta_description, target_keyword, tags, article_type, status, shopify_article_id, shopify_handle, author_name, generated_by_ai, generation_cost_pkr, pushed_to_shopify_at, published_at, created_at, updated_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }
    if (articleType) {
      query = query.eq('article_type', articleType);
    }
    if (search) {
      query = query.or(`title.ilike.%${search}%,target_keyword.ilike.%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[/api/blog/posts] GET error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Status counts for dashboard pipeline
    const { data: statusCounts } = await supabase
      .from('blog_posts')
      .select('status');

    const counts = {
      draft: 0,
      review: 0,
      pushed: 0,
      published: 0,
      archived: 0,
      total: 0,
    };
    if (statusCounts) {
      counts.total = statusCounts.length;
      statusCounts.forEach((row) => {
        if (counts[row.status] !== undefined) counts[row.status]++;
      });
    }

    return NextResponse.json({
      posts: data || [],
      pagination: {
        total: count || 0,
        limit,
        offset,
      },
      status_counts: counts,
    });
  } catch (error) {
    console.error('[/api/blog/posts] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
