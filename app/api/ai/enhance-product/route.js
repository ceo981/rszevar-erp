import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

// RS ZEVAR ERP — AI Enhance: Generate product description + SEO via Claude
// POST: generates 9-section output, saves to ai_enhancements table.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';

const PRICING = {
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-opus-4-7':   { input: 15.00, output: 75.00 },
  'claude-opus-4-6':   { input: 15.00, output: 75.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
};

const SYSTEM_PROMPT = `You are a senior SEO copywriter for RS ZEVAR, a Karachi-based premium artificial jewelry brand. You write product content for their Shopify store (rszevar.com) targeting Pakistani women.

═══ BRAND VOICE ═══
Target audience: Pakistani women aged 22-45, middle to upper-middle class
Cultural context: South Asian wedding culture, Eid celebrations, daily office wear, family functions
Tone principles: Warm, aspirational, rooted in tradition yet modern. Speaks TO the wearer, not ABOUT the product.
Price positioning: Mid-premium artificial jewelry (Rs 1,500 - Rs 10,000) — affordable luxury

═══ SEO RULES (STRICT) ═══
• Meta title: 55-60 characters, primary keyword in first 35 chars, end with " | RS ZEVAR" when space allows
• Meta description: 150-155 characters, must contain CTA or benefit, include a specific detail or number when natural
• Alt text: Under 100 characters each, describe image naturally (don't keyword-stuff)
• URL handle: lowercase, hyphens, 3-6 words, keyword-rich, no stopwords
• Natural keyword density — never stuff. Variations > repetition.

═══ LOCAL SEO SIGNALS (use naturally, never force) ═══
Geographic: Pakistan, Karachi, Lahore, Islamabad
Contextual: wedding, bridal, mehndi ceremony, Eid, engagement, party — all in English.
Include 1-2 of these per description only where context genuinely calls for them.

═══ LANGUAGE — STRICT PURE ENGLISH ═══
Output MUST be in PURE ENGLISH only. Do not use any Urdu, Hindi, or romanized vernacular
words. Forbidden words include (but not limited to): dulhan, shaadi, nikkah, baraat,
walima, rasm, mehndi ke liye, dholki, haldi. Use English equivalents: "bride", "wedding",
"ceremony", "reception", "ritual", "for mehndi event".
EXCEPTION: "mehndi" and "bridal" are acceptable as globally-recognized English loanwords
used in Pakistani/Indian jewelry marketing. Nothing else.

═══ FORBIDDEN PHRASES (overused AI/copy slop) ═══
Never use:
• "Elevate your look" / "Elevate your style"
• "Timeless elegance" / "Timeless beauty"
• "Premium quality" without specifics
• "Add a touch of..."
• "Perfect for any occasion" (too generic)
• "Stunning" or "gorgeous" as main description verbs (too hollow)
• "Exquisite craftsmanship" (cliché — describe the craftsmanship specifically instead)
• "Statement piece" (unless genuinely earned)

═══ DESCRIPTION STRUCTURE (220-280 words, HTML) ═══
Paragraph 1 — The moment (50-70 words):
  Paint a specific picture. The wearer, the occasion, the feeling. Present tense. Sensory language. Avoid starting with "This" or "The".

Paragraph 2 — The craft (80-110 words):
  What it's made of, how it's made, what makes THIS piece specific. Be concrete: "24k gold plating", "hand-set kundan stones", "Turkish-inspired filigree", "oxidized silver finish". Use <strong> on 2-3 key selling phrases.

Paragraph 3 — The styling + care (70-90 words):
  When to wear it, what to pair with it, how to care for it. Include one practical tip (e.g., "store separately to prevent tarnish").

═══ OUTPUT FORMAT (STRICT JSON, NO MARKDOWN FENCES, NO PREAMBLE) ═══

{
  "title_suggestions": [
    { "title": "...", "reasoning": "One-line rationale" },
    { "title": "...", "reasoning": "..." },
    { "title": "...", "reasoning": "..." }
  ],
  "description_html": "<p>...</p><p>...</p><p>...</p>",
  "meta_title": "... | RS ZEVAR",
  "meta_description": "...",
  "url_handle": "lowercase-hyphenated-handle",
  "alt_texts": [
    { "position": 1, "alt": "Model wearing..." },
    { "position": 2, "alt": "Close-up of..." },
    { "position": 3, "alt": "..." },
    { "position": 4, "alt": "..." },
    { "position": 5, "alt": "..." },
    { "position": 6, "alt": "..." }
  ],
  "tags": ["tag 1", "tag 2", "tag 3", "tag 4", "tag 5", "tag 6", "tag 7"],
  "faqs": [
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." }
  ],
  "seo_score": 85,
  "seo_notes": "1-2 sentences: what earned this score, where improvement is possible"
}

═══ SECTION GUIDELINES ═══

TITLE SUGGESTIONS (3 variants, each 50-70 chars):
- Primary keyword in first 4 words when possible
- Variant A: occasion-focused (e.g., "Bridal Kundan Necklace Set...")
- Variant B: craft/style-focused (e.g., "Handcrafted Turkish Style...")
- Variant C: customer/benefit-focused (e.g., "Lightweight Statement Necklace for...")
- Reasoning: one specific SEO or conversion rationale per variant

ALT TEXTS:
- Generate exactly 6 alt texts (positions 1-6) — extras are ignored if fewer images
- Position 1 = hero image (assume model/full shot)
- Position 2 = close-up or detail shot
- Position 3-6 = alternate angles, color variants, styling shots
- Natural descriptive language, each under 100 chars

FAQS (exactly 3 items):
- Focus on purchase-decision questions:
  • Allergy/skin safety / tarnish resistance
  • Weight / comfort / sizing
  • Care / storage instructions
  • Occasion appropriateness / styling
  • Gift-giving suitability
- Answers: 1-2 factual sentences, cautious where uncertain

TAGS (7-10 items):
- Mix: category / occasion / style / material / price-point / audience
- Use lowercase with spaces for multi-word (e.g., "bridal jewelry", "kundan set")
- Include 1-2 long-tail tags (e.g., "lightweight bridal necklace")

URL HANDLE:
- 3-6 words, hyphenated
- Primary keyword first
- No stopwords (the, a, for, in, with)
- Example: "antique-turkish-bridal-kundan-necklace"

SEO_SCORE (0-100):
- 90-100: all SEO criteria met perfectly
- 75-89: solid, minor gaps (e.g., meta description under-length)
- 60-74: acceptable but missing key elements
- Below 60: should not happen — flag why

Your output must be valid parseable JSON. No markdown code fences. No preamble. No trailing commentary. Just the JSON object.`;

function buildUserPrompt({
  product_title,
  current_description,
  category,
  vendor,
  variants_summary,
  image_count,
  selling_price,
  input_facts,
  input_occasions,
  input_customers,
  input_keywords,
  input_tone,
  input_language_mix,
}) {
  const occasions = input_occasions?.length ? input_occasions.join(', ') : '(not specified)';
  const customers = input_customers?.length ? input_customers.join(', ') : '(not specified)';

  return `Generate enhanced product content for this RS ZEVAR product.

══ PRODUCT CONTEXT ══
Current title: ${product_title}
Category: ${category || '(not set)'}
Vendor: ${vendor || 'RS ZEVAR'}
Price: Rs ${selling_price || 'N/A'}
Variants: ${variants_summary || '(single variant)'}
Image count: ${image_count || 5}

Current description (for reference — rewrite completely):
${current_description ? current_description.slice(0, 800) : '(none — write from scratch)'}

══ USER INPUT FOR THIS GENERATION ══
Quick facts from the product team:
${input_facts || '(none provided — infer from title and category)'}

Target occasions: ${occasions}
Target customer: ${customers}
Preferred keywords: ${input_keywords || '(none — choose naturally)'}
Tone: ${input_tone}
Language mix: ${input_language_mix}

══ TASK ══
Generate the full JSON output with all 9 sections as defined in your system instructions.
Return ONLY the JSON object. No preamble, no code fences.`;
}

export async function POST(request) {
  const startTime = Date.now();

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({
        success: false,
        error: 'ANTHROPIC_API_KEY not set in environment variables',
      }, { status: 500 });
    }

    const body = await request.json();
    const {
      shopify_product_id,
      product_title,
      current_description,
      category,
      vendor,
      variants_summary,
      image_count,
      selling_price,
      input_facts,
      input_occasions = [],
      input_customers = [],
      input_keywords = '',
      input_tone = 'luxurious',
      input_language_mix = 'mixed',
    } = body;

    if (!shopify_product_id || !product_title) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: shopify_product_id, product_title',
      }, { status: 400 });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const userPrompt = buildUserPrompt({
      product_title, current_description, category, vendor,
      variants_summary, image_count, selling_price,
      input_facts, input_occasions, input_customers,
      input_keywords, input_tone, input_language_mix,
    });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const rawText = textBlock?.text || '';

    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    let generated;
    try {
      generated = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('[ai-enhance] JSON parse failed. Raw:', rawText.slice(0, 500));
      return NextResponse.json({
        success: false,
        error: 'AI returned malformed JSON. Try again.',
        raw_preview: rawText.slice(0, 500),
        duration_ms: Date.now() - startTime,
      }, { status: 500 });
    }

    const requiredKeys = [
      'title_suggestions', 'description_html', 'meta_title',
      'meta_description', 'url_handle', 'alt_texts', 'tags', 'faqs',
    ];
    const missing = requiredKeys.filter(k => !(k in generated));
    if (missing.length > 0) {
      return NextResponse.json({
        success: false,
        error: `AI output missing keys: ${missing.join(', ')}`,
        partial: generated,
      }, { status: 500 });
    }

    const pricing = PRICING[MODEL] || PRICING['claude-sonnet-4-6'];
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const costUsd = ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1000000;

    const supabase = createServerClient();
    const { data: saved, error: dbErr } = await supabase
      .from('ai_enhancements')
      .insert({
        shopify_product_id,
        product_title,
        input_facts,
        input_occasions,
        input_customers,
        input_keywords,
        input_tone,
        input_language_mix,
        generated_output: generated,
        model_used: MODEL,
        tokens_input: inputTokens,
        tokens_output: outputTokens,
        cost_usd: costUsd.toFixed(6),
        duration_ms: Date.now() - startTime,
        status: 'draft',
      })
      .select()
      .single();

    if (dbErr) {
      console.error('[ai-enhance] DB save error:', dbErr);
      return NextResponse.json({
        success: true,
        warning: 'Generation succeeded but DB save failed: ' + dbErr.message,
        enhancement_id: null,
        generated,
        usage: response.usage,
        cost_usd: costUsd,
        duration_ms: Date.now() - startTime,
      });
    }

    return NextResponse.json({
      success: true,
      enhancement_id: saved.id,
      generated,
      usage: response.usage,
      cost_usd: costUsd,
      duration_ms: Date.now() - startTime,
    });

  } catch (err) {
    console.error('[ai-enhance] error:', err);
    return NextResponse.json({
      success: false,
      error: err.message || 'Unknown error',
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
