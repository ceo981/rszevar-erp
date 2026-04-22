/**
 * GET /api/blog/posts/[id]   — fetch single post (full content)
 * PUT /api/blog/posts/[id]   — update post (edits from review screen)
 * DELETE /api/blog/posts/[id] — delete post (also deletes from Shopify if pushed)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

// ============================================================================
// GET — fetch single post
// ============================================================================
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from('blog_posts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    return NextResponse.json({ post: data });
  } catch (error) {
    console.error('[/api/blog/posts/[id]] GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// ============================================================================
// PUT — update post
// ============================================================================
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const supabase = getServiceClient();

    // Whitelist editable fields
    const allowed = [
      'title',
      'body_html',
      'excerpt',
      'meta_title',
      'meta_description',
      'target_keyword',
      'tags',
      'faqs',
      'article_type',
      'status',
      'author_name',
    ];
    const updates = {};
    allowed.forEach((field) => {
      if (body[field] !== undefined) updates[field] = body[field];
    });

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // If status transitioning to 'published', stamp published_at
    if (updates.status === 'published') {
      updates.published_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('blog_posts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[/api/blog/posts/[id]] PUT error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, post: data });
  } catch (error) {
    console.error('[/api/blog/posts/[id]] PUT unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE — delete post (keeps Shopify article if exists; manual cleanup there)
// ============================================================================
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const supabase = getServiceClient();

    // Fetch first to check if pushed to Shopify
    const { data: existing } = await supabase
      .from('blog_posts')
      .select('shopify_article_id, shopify_blog_id, title')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    const { error } = await supabase.from('blog_posts').delete().eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deleted_id: id,
      note: existing.shopify_article_id
        ? `Post deleted from ERP. Shopify article ${existing.shopify_article_id} still exists — delete manually from Shopify admin if needed.`
        : 'Post deleted from ERP.',
    });
  } catch (error) {
    console.error('[/api/blog/posts/[id]] DELETE unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
