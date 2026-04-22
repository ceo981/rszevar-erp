/**
 * Claude API client — v2 with ROBUST JSON parsing
 * Streaming mode + tolerant parser (handles common AI output issues)
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildBlogPrompt, calculateCost, CLAUDE_PRICING } from './prompt-builder';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generateBlogPost(input) {
  const startTime = Date.now();
  const { systemPrompt, userPrompt } = buildBlogPrompt(input);

  try {
    const stream = await anthropic.messages.stream({
      model: CLAUDE_PRICING.model,
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    let accumulatedText = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        accumulatedText += event.delta.text || '';
      }
    }

    const finalMessage = await stream.finalMessage();
    const durationMs = Date.now() - startTime;
    console.log(`[claude-client] Stream complete in ${durationMs}ms, ${accumulatedText.length} chars`);

    const parsedArticle = parseClaudeJsonRobust(accumulatedText);

    const inputTokens = finalMessage.usage?.input_tokens || 0;
    const outputTokens = finalMessage.usage?.output_tokens || 0;
    const { cost_usd, cost_pkr } = calculateCost(inputTokens, outputTokens);

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
 * ROBUST JSON parser for Claude outputs
 *
 * Problem: Claude sometimes embeds HTML in body_html with double quotes like:
 *   "body_html": "<a href="https://rszevar.com">Link</a>"
 * This breaks standard JSON.parse().
 *
 * Strategy:
 *   1. Try standard JSON.parse first (works for clean output)
 *   2. If fails, use a "structured extraction" approach:
 *      - Find each top-level field by name
 *      - Extract value based on field type (string vs array vs object)
 *      - For body_html, find between first opening quote and the quote that
 *        precedes ",\n  "next_field_name":" pattern
 */
function parseClaudeJsonRobust(rawText) {
  if (!rawText) throw new Error('Empty response from Claude');

  // Strip markdown fences
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```\s*$/, '');
  }

  // Extract JSON object boundaries
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  // ATTEMPT 1: Standard JSON.parse
  try {
    const parsed = JSON.parse(cleaned);
    validateRequired(parsed);
    return normalizeArticle(parsed);
  } catch (standardErr) {
    console.warn('[claude-client] Standard JSON parse failed, attempting robust extraction:', standardErr.message);
  }

  // ATTEMPT 2: Robust field-by-field extraction
  // This handles the case where body_html has unescaped quotes in HTML attributes
  try {
    const extracted = extractFieldsRobustly(cleaned);
    validateRequired(extracted);
    return normalizeArticle(extracted);
  } catch (robustErr) {
    console.error('[claude-client] Robust extraction also failed:', robustErr.message);
    console.error('[claude-client] Raw text (first 1000):', rawText.substring(0, 1000));
    throw new Error(`Failed to parse Claude output: ${robustErr.message}`);
  }
}

/**
 * Field-by-field extraction that tolerates malformed JSON
 * Finds each expected field by name, extracts value based on delimiters
 */
function extractFieldsRobustly(text) {
  const result = {};

  // String fields — extract between quotes, handle escaped characters
  const stringFields = ['title', 'meta_title', 'meta_description', 'excerpt', 'primary_keyword_density'];
  for (const field of stringFields) {
    result[field] = extractStringField(text, field);
  }

  // body_html is special — can contain raw HTML with quotes
  result.body_html = extractBodyHtml(text);

  // Array fields
  result.tags = extractArrayField(text, 'tags') || [];
  result.faqs = extractFaqsField(text);
  result.internal_links_used = extractArrayField(text, 'internal_links_used') || [];

  // Numeric field
  const wcMatch = text.match(/"word_count"\s*:\s*(\d+)/);
  if (wcMatch) result.word_count = parseInt(wcMatch[1]);

  return result;
}

function extractStringField(text, fieldName) {
  // Match "fieldName": "value"   where value has no internal unescaped quotes
  const regex = new RegExp(`"${fieldName}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g');
  const match = regex.exec(text);
  if (!match) return null;
  return unescapeJsonString(match[1]);
}

function extractBodyHtml(text) {
  // body_html's value starts after "body_html": "
  // Ends just before the next top-level field indicator: ",\n  "
  const startMarker = /"body_html"\s*:\s*"/;
  const startMatch = text.match(startMarker);
  if (!startMatch) return '';

  const startIdx = startMatch.index + startMatch[0].length;

  // Find end: look for the pattern that indicates end of this field
  // Common next fields: meta_title, meta_description, excerpt, tags, faqs
  const endPatterns = [
    /",\s*\n\s*"meta_title"/,
    /",\s*\n\s*"meta_description"/,
    /",\s*\n\s*"excerpt"/,
    /",\s*\n\s*"tags"/,
    /",\s*\n\s*"faqs"/,
    /",\s*"meta_title"/,
    /",\s*"excerpt"/,
    /",\s*"tags"/,
  ];

  let endIdx = -1;
  for (const pattern of endPatterns) {
    const rest = text.substring(startIdx);
    const m = rest.match(pattern);
    if (m && m.index !== undefined) {
      endIdx = startIdx + m.index;
      break;
    }
  }

  if (endIdx === -1) {
    // Fallback: find last quote before closing brace
    const lastQuote = text.lastIndexOf('"', text.lastIndexOf('}'));
    endIdx = lastQuote > startIdx ? lastQuote : text.length;
  }

  const bodyRaw = text.substring(startIdx, endIdx);
  return unescapeJsonString(bodyRaw);
}

function extractArrayField(text, fieldName) {
  const regex = new RegExp(`"${fieldName}"\\s*:\\s*\\[([^\\]]*)\\]`);
  const match = text.match(regex);
  if (!match) return null;

  // Parse array contents as JSON array
  try {
    return JSON.parse('[' + match[1] + ']');
  } catch {
    // Fallback: extract string values manually
    const items = match[1].match(/"((?:[^"\\]|\\.)*)"/g);
    return items ? items.map((s) => unescapeJsonString(s.slice(1, -1))) : [];
  }
}

function extractFaqsField(text) {
  // faqs is an array of objects — find "faqs": [ ... ] block
  const startMatch = text.match(/"faqs"\s*:\s*\[/);
  if (!startMatch) return [];

  const startIdx = startMatch.index + startMatch[0].length;
  let depth = 1;
  let idx = startIdx;
  while (idx < text.length && depth > 0) {
    const ch = text[idx];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (depth === 0) break;
    idx++;
  }

  const faqsContent = text.substring(startIdx, idx);

  // Try standard parse first
  try {
    return JSON.parse('[' + faqsContent + ']');
  } catch {
    // Manual extraction
    const faqs = [];
    const itemRegex = /\{\s*"question"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"answer"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
    let m;
    while ((m = itemRegex.exec(faqsContent)) !== null) {
      faqs.push({
        question: unescapeJsonString(m[1]),
        answer: unescapeJsonString(m[2]),
      });
    }
    return faqs;
  }
}

function unescapeJsonString(s) {
  if (!s) return '';
  return s
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\\\/g, '\\')
    .replace(/\\\//g, '/');
}

function validateRequired(parsed) {
  const required = ['title', 'body_html', 'meta_title', 'meta_description', 'excerpt'];
  const missing = required.filter((field) => !parsed[field]);
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}

function normalizeArticle(parsed) {
  parsed.tags = Array.isArray(parsed.tags) ? parsed.tags : [];
  parsed.faqs = Array.isArray(parsed.faqs) ? parsed.faqs : [];
  return parsed;
}

function countWords(html) {
  if (!html) return 0;
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.split(/\s+/).filter(Boolean).length;
}

function countInternalLinks(html) {
  if (!html) return 0;
  const matches = html.match(/href=["']https?:\/\/(www\.)?rszevar\.com[^"']*["']/gi);
  return matches ? matches.length : 0;
}
