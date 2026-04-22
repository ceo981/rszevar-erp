/**
 * Claude API client for blog post generation
 * Wraps Anthropic SDK with structured output handling + cost tracking
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildBlogPrompt, calculateCost, CLAUDE_PRICING } from './prompt-builder';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Generate a blog post using Claude Sonnet 4.6
 *
 * @param {Object} input - { topic, keyword, article_type, word_count_target, notes }
 * @returns {Object} Generated article + metadata
 */
export async function generateBlogPost(input) {
  const startTime = Date.now();
  const { systemPrompt, userPrompt } = buildBlogPrompt(input);

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_PRICING.model,
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const durationMs = Date.now() - startTime;
    const rawText = response.content[0]?.text || '';

    // Parse JSON output (strip any accidental markdown fences)
    const parsedArticle = parseClaudeJson(rawText);

    // Cost calculation
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
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
    console.error('[claude-client] JSON parse failed. Raw text:', rawText.substring(0, 500));
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
