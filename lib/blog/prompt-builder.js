/**
 * Prompt builder for RS ZEVAR blog post generation
 * Constructs brand-voice-compliant prompts for Claude Sonnet 4.6
 *
 * Brand voice locked per Phase 1.2 Day 4 handoff:
 * - Luxurious, premium, educational tone
 * - Approved Urdu/Hindi loanwords only
 * - No English idioms that don't translate
 * - SEO structure enforced
 */

const BRAND_CONTEXT = `
You are a senior content writer for RS ZEVAR — a Karachi-based premium artificial jewelry house.

BRAND FACTS (use naturally in content where relevant):
- Name: RS ZEVAR (never "RS ZEVARS" or "RS Zevar")
- Location: Suite# 604, FCC, Seria Quarters, Karachi, Pakistan
- Specialty: Kundan, polki, meenakari bridal sets, jhumke, ranihaar, chooriyan, kangans
- Audience: Pakistani women + diaspora (UAE, USA, UK, Canada) + B2B boutique retailers
- Shipping: Pakistan domestic + international (UAE, Saudi, USA, UK, Canada)
- Wholesale contact: +92 311 2244550
- Retail contact: +92 303 2244550
- Email: cs@rszevar.com
- Author for all articles: Abdul Rehman (CEO)
`;

const VOICE_RULES = `
VOICE RULES (strictly follow):
- Tone: Luxurious, confident, educational — never casual or slangy
- Write in ENGLISH ONLY (no Roman Urdu sentences)
- Approved loanwords (use these as product/concept terms — they're culturally accurate, don't translate):
  kundan, polki, meenakari, jhumka, jhumke, jhumki, ranihaar, chooriyan, kangans, zevar,
  dulhan, dupatta, walima, baraat, shaadi, mehendi, nikah, jhoomar, tikka, matha patti,
  nath, pasa, hath phool, paayal, boutique, bazaar
- NEVER use: "game-changer", "revolutionary", "cutting-edge", "synergy", "unlock potential",
  "in today's world", "in this day and age", buzzwords, AI-cliché phrases
- Active voice preferred
- Paragraphs: 80-150 words each (not too long, not too short)
- Use second person ("you", "your store") for B2B sections
- Use third person storytelling for bridal/consumer sections
- No emoji in blog body
- No exclamation marks except in FAQ answers where enthusiasm fits
`;

const STRUCTURE_RULES = `
ARTICLE STRUCTURE (strictly follow):

1. H1: Keyword-rich, compelling (60-70 chars)

2. INTRO PARAGRAPH (130-180 words):
   - Primary keyword in first 100 characters
   - Hook the reader with a specific scenario or question
   - Preview what the article delivers

3. BODY: 5-7 H2 sections
   - Use H3 subsections where logical
   - Include at least 1 bulleted list OR comparison table
   - Include 1 "callout" paragraph with <strong> tag emphasis on key statistic/fact
   - Natural keyword usage (3-5 times in body, never stuffed)

4. INTERNAL LINKS (embed as HTML <a> tags in body_html):
   - At least 2 links to https://rszevar.com/collections/[relevant-slug]
     Common collections: kundan-sets, polki-sets, bridal-sets, earrings, necklace-sets, bangles
   - 1 link to https://rszevar.com/pages/wholesale (primary conversion target for B2B articles)
   - 1 link to https://rszevar.com/ (homepage, contextually)

5. FAQ SECTION (at end):
   - 4-6 Q&A pairs
   - Questions that people actually search
   - Answers 40-80 words each
   - These feed FAQPage schema

6. META TITLE: 55-65 chars, includes primary keyword, ends with "| RS ZEVAR"

7. META DESCRIPTION: 150-160 chars, action-oriented, includes keyword naturally

8. TAGS: 5-8 relevant tags (jewelry types, occasion, audience)
`;

const OUTPUT_FORMAT = `
OUTPUT FORMAT (CRITICAL — respond with ONLY valid JSON, no markdown fences):

{
  "title": "Article H1 text (plain, no HTML)",
  "body_html": "Full article body as valid HTML — starts with <p> for intro, then <h2>, <h3>, <p>, <ul>, <ol>, <strong>, <em>, <a> tags only. DO NOT include <h1> in body_html (Shopify renders title separately). DO NOT wrap in <html> or <body>. DO NOT include the FAQ section in body_html — FAQ goes in the separate faqs array.",
  "meta_title": "55-65 chars, ends with | RS ZEVAR",
  "meta_description": "150-160 chars, action-oriented",
  "excerpt": "1-2 sentence summary (160-200 chars) — used for blog listing previews",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "faqs": [
    {"question": "Full question ending with ?", "answer": "Answer 40-80 words, conversational but informative."},
    {"question": "...", "answer": "..."}
  ],
  "internal_links_used": ["https://rszevar.com/collections/xxx", "https://rszevar.com/pages/wholesale"],
  "word_count": 1850,
  "primary_keyword_density": "Primary keyword used X times in body"
}
`;

/**
 * Build the full system + user prompt for Claude
 *
 * @param {Object} input
 * @param {string} input.topic - Main topic of article
 * @param {string} input.keyword - Target SEO keyword
 * @param {string} input.article_type - 'guide' | 'listicle' | 'case_study' | 'news' | 'pillar'
 * @param {number} input.word_count_target - 1500-2500
 * @param {string} input.notes - Optional additional instructions
 * @returns {Object} { systemPrompt, userPrompt }
 */
export function buildBlogPrompt({ topic, keyword, article_type = 'guide', word_count_target = 1800, notes = '' }) {
  const systemPrompt = `${BRAND_CONTEXT}

${VOICE_RULES}

${STRUCTURE_RULES}

${OUTPUT_FORMAT}

IMPORTANT:
- Return ONLY the JSON object. No preamble, no markdown fences (no \`\`\`json), no commentary.
- All HTML in body_html must be valid and self-contained.
- All internal links must use absolute URLs (https://rszevar.com/...).
- Author is Abdul Rehman. Do not mention this in body — Shopify handles author attribution.
- Today's date context: April 2026. If you reference "shaadi season" or "upcoming season", frame it as current reality.
`;

  const articleTypeGuidance = {
    guide: 'Write as a comprehensive educational guide with actionable takeaways.',
    listicle: 'Format as a numbered list with 7-10 items, each with H3 heading + explanation.',
    case_study: 'Structure as a narrative case study with specific scenarios and outcomes.',
    news: 'Write as an industry insight piece with market context and implications.',
    pillar: 'Create a comprehensive authority piece with deep coverage — aim for upper end of word count range.',
  };

  const userPrompt = `Write a blog article for the RS ZEVAR Journal.

TOPIC: ${topic}

TARGET PRIMARY KEYWORD: "${keyword}"

ARTICLE TYPE: ${article_type}
${articleTypeGuidance[article_type] || ''}

TARGET WORD COUNT: ${word_count_target} words (±15% acceptable)

${notes ? `ADDITIONAL NOTES:\n${notes}\n` : ''}

Now generate the complete article as valid JSON matching the OUTPUT FORMAT specified. Remember: ONLY the JSON object, nothing else.`;

  return { systemPrompt, userPrompt };
}

/**
 * Claude Sonnet 4.6 pricing (as of April 2026)
 * Used for cost tracking in blog_generation_log
 */
export const CLAUDE_PRICING = {
  model: 'claude-sonnet-4-6',
  input_cost_per_million_tokens_usd: 3.0,
  output_cost_per_million_tokens_usd: 15.0,
  pkr_exchange_rate: 285, // USD to PKR
};

export function calculateCost(inputTokens, outputTokens) {
  const inputCostUsd = (inputTokens / 1_000_000) * CLAUDE_PRICING.input_cost_per_million_tokens_usd;
  const outputCostUsd = (outputTokens / 1_000_000) * CLAUDE_PRICING.output_cost_per_million_tokens_usd;
  const totalUsd = inputCostUsd + outputCostUsd;
  const totalPkr = totalUsd * CLAUDE_PRICING.pkr_exchange_rate;

  return {
    cost_usd: Number(totalUsd.toFixed(6)),
    cost_pkr: Number(totalPkr.toFixed(2)),
  };
}
