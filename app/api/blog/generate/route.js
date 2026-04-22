/**
 * POST /api/blog/generate — v3 with SMART LINKING
 *
 * Flow:
 * 1. Receive topic + keyword from user
 * 2. Fetch REAL catalog (collections + A-class products) from Supabase
 * 3. Pass catalog to Claude prompt (AI uses only verified URLs)
 * 4. Validate generated URLs against catalog (safety check)
 * 5. Save article with products_mentioned tracking
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateBlogPost } from '../../../../lib/blog/claude-client';
import { generateUniqueSlug } from '../../../../lib/blog/slug-generator';
import { getCatalogContextForPrompt } from '../../../../lib/blog/catalog-fetcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  try {
    const body = await request.json();
    const { topic, keyword, article_type, word_count_target, notes } = body;

    if (!topic || typeof topic !== 'string' || topic.trim().length < 10) {
      return NextResponse.json({ error: 'Topic is required (min 10 characters)' }, { status: 400 });
    }
    if (!keyword || typeof keyword !== 'string' || keyword.trim().length < 3) {
      return NextResponse.json({ error: 'Target keyword is required (min 3 characters)' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // Get user from auth
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

    // ========================================================================
    // NEW: Fetch catalog context before generation
    // ========================================================================
    console.log('[/api/blog/generate] Fetching catalog context...');
    const topicHint = `${topic} ${keyword}`;
    const catalog = await getCatalogContextForPrompt({
      topicHint,
      maxCollections: 40,
      maxProducts: 15,
    });
    console.log(
      `[/api/blog/generate] Catalog loaded: ${catalog.collectionsCount} collections, ${catalog.productsCount} products`
    );

    // Generate via Claude with catalog injection
    console.log('[/api/blog/generate] Starting streaming generation:', { topic, keyword, article_type });

    const result = await generateBlogPost({
      topic: topic.trim(),
      keyword: keyword.trim(),
      article_type: article_type || 'guide',
      word_count_target: word_count_target || 1500,
      notes: notes || '',
      catalog, // ← NEW: pass catalog to Claude
    });

    if (!result.success) {
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
      return NextResponse.json({ error: 'Article generation failed', details: result.error }, { status: 500 });
    }

    const { article, metadata } = result;

    // ========================================================================
    // NEW: Validate generated URLs against catalog (safety check)
    // ========================================================================
    const linkValidation = validateArticleLinks(article.body_html, catalog);
    console.log('[/api/blog/generate] Link validation:', linkValidation);

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
      link_validation: linkValidation, // NEW: report which links are valid
      catalog_used: {
        collections: catalog.collectionsCount,
        products: catalog.productsCount,
      },
    });
  } catch (error) {
    console.error('[/api/blog/generate] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

/**
 * Validate that all /collections/ and /products/ links in article
 * actually exist in the catalog we provided to AI
 */
function validateArticleLinks(bodyHtml, catalog) {
  if (!bodyHtml) return { valid_links: [], invalid_links: [], total: 0 };

  const allLinks = [];
  const linkRegex = /href=["']https?:\/\/(?:www\.)?rszevar\.com(\/[^"']*)["']/gi;
  let match;
  while ((match = linkRegex.exec(bodyHtml)) !== null) {
    allLinks.push(match[1]);
  }

  const validCollectionHandles = new Set((catalog.rawCollections || []).map((c) => c.handle));
  const validProductHandles = new Set((catalog.rawProducts || []).map((p) => p.handle));
  const allowedStaticPaths = ['/', '/pages/wholesale', '/pages/about', '/collections'];

  const valid = [];
  const invalid = [];

  for (const path of allLinks) {
    const cleanPath = path.split('?')[0].split('#')[0].replace(/\/$/, '') || '/';

    if (allowedStaticPaths.includes(cleanPath)) {
      valid.push(path);
      continue;
    }

    if (cleanPath.startsWith('/collections/')) {
      const handle = cleanPath.replace('/collections/', '');
      if (validCollectionHandles.has(handle)) {
        valid.push(path);
      } else {
        invalid.push(path);
      }
      continue;
    }

    if (cleanPath.startsWith('/products/')) {
      const handle = cleanPath.replace('/products/', '');
      if (validProductHandles.has(handle)) {
        valid.push(path);
      } else {
        invalid.push(path);
      }
      continue;
    }

    // Other paths (blogs, etc.) — accept as valid for now
    valid.push(path);
  }

  return {
    valid_links: valid,
    invalid_links: invalid,
    total: allLinks.length,
    all_valid: invalid.length === 0,
  };
}
