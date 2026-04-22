/**
 * Claude API client for blog post generation (STREAMING VERSION)
 * Uses streaming to bypass Vercel 60s function timeout
 *
 * Why streaming fixes the timeout issue:
 * - Non-streaming: Full response waits at server for up to 90s before Vercel fn responds
 * - Streaming: Chunks arrive incrementally, Vercel counts the fn as "active" throughout,
 *   and total allowed duration scales with time-between-chunks, not total time
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildBlogPrompt, calculateCost, CLAUDE_PRICING } from './prompt-builder';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Generate a blog post using Claude Sonnet 4.6 via STREAMING
 */
export async function generateBlogPost(input) {
  const startTime = Date.now();
  const { systemPrompt, userPrompt } = buildBlogPrompt(input);

  try {
    // STREAMING call — accumulates text as chunks arrive
    const stream = await anthropic.messages.stream({
      model: CLAUDE_PRICING.model,
      max_tokens: 6000, // Reduced from 8000 — plenty for 2000-word articles + JSON overhead
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    // Accumulate the streamed response
    let accumulatedText = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        accumulatedText += event.delta.text || '';
      }
    }

    // Get final message metadata (usage tokens)
    const finalMessage = await stream.finalMessage();

    const durationMs = Date.now() - startTime;
    console.log(`[claude-client] Stream complete in ${durationMs}ms, ${accumulatedText.length} chars`);

    // Parse JSON output
    const parsedArticle = parseClaudeJson(accumulatedText);

    // Cost calculation
    const inputTokens = finalMessage.usage?.input_tokens || 0;
    const outputTokens = finalMessage.usage?.output_tokens || 0;
    const { cost_usd, cost_pkr } = calculateCost(inputTokens, outputTokens);

    // Quality metrics
    const wordCount = countWords(parsedArticle.body_html || '');
    const faqCount = Array.isArray(parsedArticle.faqs) ? parsedArticle.faqs.length : 0;
    const internalLinksCount = countInternalLinks(parsedArticle.body_html || '');

    return {
      success: true,
      article: parsedArticle,
      metadata: {
        ai_model: CLAUDE_PRICING.model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        cost_usd,
        cost_pkr,
        duration_ms: durationMs,
        output_word_count: wordCount,
        output_has_faqs: faqCount > 0,
        output_faq_count: faqCount,
        output_internal_links_count: internalLinksCount,
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error('[claude-client] generateBlogPost error:', error);

    return {
      success: false,
      error: error.message || 'Unknown error',
      metadata: {
        ai_model: CLAUDE_PRICING.model,
        duration_ms: durationMs,
      },
    };
  }
}

/**
 * Parse Claude's JSON output, handling common formatting issues
 */
function parseClaudeJson(rawText) {
  if (!rawText) {
    throw new Error('Empty response from Claude');
  }

  // Strip markdown fences if Claude included them despite instructions
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```\s*$/, '');
  }

  // Sometimes Claude adds a preamble before the JSON. Find first { and last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace > 0 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);

    // Validate required fields
    const required = ['title', 'body_html', 'meta_title', 'meta_description', 'excerpt'];
    const missing = required.filter((field) => !parsed[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required fields from Claude output: ${missing.join(', ')}`);
    }

    // Defaults for optional fields
    parsed.tags = Array.isArray(parsed.tags) ? parsed.tags : [];
    parsed.faqs = Array.isArray(parsed.faqs) ? parsed.faqs : [];

    return parsed;
  } catch (err) {
    console.error('[claude-client] JSON parse failed. Raw text (first 1000 chars):', rawText.substring(0, 1000));
    console.error('[claude-client] Raw text (last 500 chars):', rawText.substring(Math.max(0, rawText.length - 500)));
    throw new Error(`Failed to parse Claude JSON output: ${err.message}`);
  }
}

/**
 * Count words in HTML content (strips tags)
 */
function countWords(html) {
  if (!html) return 0;
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Count internal links to rszevar.com in HTML
 */
function countInternalLinks(html) {
  if (!html) return 0;
  const matches = html.match(/href=["']https?:\/\/(www\.)?rszevar\.com[^"']*["']/gi);
  return matches ? matches.length : 0;
}
