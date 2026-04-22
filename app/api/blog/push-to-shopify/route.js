/**
 * POST /api/blog/push-to-shopify
 *
 * Pushes a blog post draft to Shopify Journal blog as an unpublished article.
 * Updates blog_posts with shopify_article_id + shopify_handle + status='pushed'.
 *
 * Request body:
 * {
 *   post_id: string (required) — blog_posts.id
 *   publish_immediately: boolean (default false) — if true, marks as published on Shopify too
 * }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { pushBlogPostToShopify, updateShopifyArticle } from '../../../../lib/blog/shopify-blog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const { post_id, publish_immediately } = body;

    if (!post_id) {
      return NextResponse.json({ error: 'post_id is required' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // Fetch the blog post
    const { data: post, error: fetchError } = await supabase
      .from('blog_posts')
      .select('*')
      .eq('id', post_id)
      .maybeSingle();

    if (fetchError || !post) {
      return NextResponse.json(
        { error: 'Post not found', details: fetchError?.message },
        { status: 404 }
      );
    }

    // Check if already pushed — if so, UPDATE Shopify article instead of creating new
    let shopifyResult;
    if (post.shopify_article_id && post.shopify_blog_id) {
      console.log(`[/api/blog/push-to-shopify] Updating existing Shopify article ${post.shopify_article_id}`);
      await updateShopifyArticle(post.shopify_blog_id, post.shopify_article_id, post);
      shopifyResult = {
        shopify_article_id: post.shopify_article_id,
        shopify_blog_id: post.shopify_blog_id,
        shopify_handle: post.shopify_handle,
        admin_url: `https://admin.shopify.com/store/rszevar/content/blogs/${post.shopify_blog_id}/articles/${post.shopify_article_id}`,
        public_url: `https://rszevar.com/blogs/journal/${post.shopify_handle}`,
        action: 'updated',
      };
    } else {
      console.log(`[/api/blog/push-to-shopify] Pushing new article to Shopify: ${post.title}`);
      shopifyResult = await pushBlogPostToShopify(post);
      shopifyResult.action = 'created';
    }

    // Update blog_posts with Shopify identifiers + status
    const newStatus = publish_immediately ? 'published' : 'pushed';
    const updates = {
      shopify_article_id: shopifyResult.shopify_article_id,
      shopify_blog_id: shopifyResult.shopify_blog_id,
      shopify_handle: shopifyResult.shopify_handle,
      status: newStatus,
      pushed_to_shopify_at: new Date().toISOString(),
    };
    if (publish_immediately) {
      updates.published_at = new Date().toISOString();
    }

    const { data: updatedPost, error: updateError } = await supabase
      .from('blog_posts')
      .update(updates)
      .eq('id', post_id)
      .select()
      .single();

    if (updateError) {
      console.error('[/api/blog/push-to-shopify] DB update failed:', updateError);
      return NextResponse.json(
        {
          error: 'Pushed to Shopify but failed to update ERP record',
          shopify_result: shopifyResult,
          details: updateError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      post: updatedPost,
      shopify: shopifyResult,
      message: shopifyResult.action === 'created'
        ? 'Article pushed to Shopify as draft. Publish manually from Shopify admin when ready.'
        : 'Existing Shopify article updated with latest content.',
    });
  } catch (error) {
    console.error('[/api/blog/push-to-shopify] error:', error);
    return NextResponse.json(
      { error: 'Shopify push failed', details: error.message },
      { status: 500 }
    );
  }
}
