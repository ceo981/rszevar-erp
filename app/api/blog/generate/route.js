/**
 * POST /api/blog/generate
 *
 * Generates a blog post using Claude Sonnet 4.6 (streaming) and saves as draft.
 *
 * UPDATED: maxDuration increased to 300 for Pro plan buffer.
 * If on Hobby plan (60s max), streaming still helps because chunks reset the clock.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateBlogPost } from '../../../../lib/blog/claude-client';
import { generateUniqueSlug } from '../../../../lib/blog/slug-generator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — plenty of buffer. Pro plan honors this; Hobby caps at 60 but streaming still works.

export async function POST(request) {
  try {
    // Parse request
    const body = await request.json();
    const { topic, keyword, article_type, word_count_target, notes } = body;

    // Validate input
    if (!topic || typeof topic !== 'string' || topic.trim().length < 10) {
      return NextResponse.json(
        { error: 'Topic is required (min 10 characters)' },
        { status: 400 }
      );
    }
    if (!keyword || typeof keyword !== 'string' || keyword.trim().length < 3) {
      return NextResponse.json(
        { error: 'Target keyword is required (min 3 characters)' },
        { status: 400 }
      );
    }

    // Service role client for DB writes
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // Get user from auth header (optional)
    const authHeader = request.headers.get('authorization');
    let userId = null;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const userClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      );
      const { data: userData } = await userClient.auth.getUser(token);
      userId = userData?.user?.id || null;
    }

    // Generate article via Claude (STREAMING)
    console.log('[/api/blog/generate] Starting streaming generation:', { topic, keyword, article_type });

    const result = await generateBlogPost({
      topic: topic.trim(),
      keyword: keyword.trim(),
      article_type: article_type || 'guide',
      word_count_target: word_count_target || 1500, // Reduced default 1800 -> 1500 for speed
      notes: notes || '',
    });

    if (!result.success) {
      // Log failure
      await supabase.from('blog_generation_log').insert({
        input_topic: topic.trim(),
        input_keyword: keyword.trim(),
        input_article_type: article_type || 'guide',
        input_word_count_target: word_count_target || 1500,
        input_notes: notes || null,
        ai_model: result.metadata.ai_model,
        duration_ms: result.metadata.duration_ms,
        status: 'failed',
        error_message: result.error,
        triggered_by: userId,
      });

      return NextResponse.json(
        { error: 'Article generation failed', details: result.error },
        { status: 500 }
      );
    }

    const { article, metadata } = result;

    // Generate unique slug
    const slug = await generateUniqueSlug(article.title, async (candidateSlug) => {
      const { data } = await supabase
        .from('blog_posts')
        .select('id')
        .eq('slug', candidateSlug)
        .maybeSingle();
      return !!data;
    });

    // Insert into blog_posts
    const { data: insertedPost, error: insertError } = await supabase
      .from('blog_posts')
      .insert({
        title: article.title,
        slug,
        body_html: article.body_html,
        excerpt: article.excerpt,
        meta_title: article.meta_title,
        meta_description: article.meta_description,
        target_keyword: keyword.trim(),
        tags: article.tags || [],
        faqs: article.faqs || [],
        article_type: article_type || 'guide',
        status: 'draft',
        generated_by_ai: true,
        ai_model: metadata.ai_model,
        generation_cost_usd: metadata.cost_usd,
        generation_cost_pkr: metadata.cost_pkr,
        created_by: userId,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[/api/blog/generate] DB insert failed:', insertError);
      return NextResponse.json(
        { error: 'Failed to save generated article', details: insertError.message },
        { status: 500 }
      );
    }

    // Log success
    await supabase.from('blog_generation_log').insert({
      blog_post_id: insertedPost.id,
      input_topic: topic.trim(),
      input_keyword: keyword.trim(),
      input_article_type: article_type || 'guide',
      input_word_count_target: word_count_target || 1500,
      input_notes: notes || null,
      ai_model: metadata.ai_model,
      input_tokens: metadata.input_tokens,
      output_tokens: metadata.output_tokens,
      total_tokens: metadata.total_tokens,
      cost_usd: metadata.cost_usd,
      cost_pkr: metadata.cost_pkr,
      duration_ms: metadata.duration_ms,
      output_word_count: metadata.output_word_count,
      output_has_faqs: metadata.output_has_faqs,
      output_faq_count: metadata.output_faq_count,
      output_internal_links_count: metadata.output_internal_links_count,
      status: 'success',
      triggered_by: userId,
    });

    return NextResponse.json({
      success: true,
      post: insertedPost,
      metadata: {
        word_count: metadata.output_word_count,
        faq_count: metadata.output_faq_count,
        internal_links: metadata.output_internal_links_count,
        cost_usd: metadata.cost_usd,
        cost_pkr: metadata.cost_pkr,
        duration_ms: metadata.duration_ms,
      },
    });
  } catch (error) {
    console.error('[/api/blog/generate] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
