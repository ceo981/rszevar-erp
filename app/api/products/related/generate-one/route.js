import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

// Related Products — single product generator
// POST { shopify_product_id } → picks 4 best companion products via Claude,
// stores in products.related_products JSONB.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';

// Pricing (USD per 1M tokens) — keep in sync with Anthropic console
const PRICE_INPUT_PER_M  = 3.00;
const PRICE_OUTPUT_PER_M = 15.00;

const SYSTEM_PROMPT = `You are a senior jewelry merchandising expert for RS ZEVAR, a premium Pakistani artificial jewelry brand. Your task: select the 4 best companion pieces for cross-sell on a product detail page.

LANGUAGE RULES — output for international desi diaspora + boutique buyers:
- Sentence structure must be English. Use the loanwords below where they describe specific products, styles, or events — they are part of international desi-English jewelry vocabulary and drive real search traffic.
- ALLOWED loanwords (use freely, treat as English): kundan, meenakari, polki, mehndi, bridal, jhumka, jhumki, lehenga, dupatta, kameez, baraat, walima, dulhan, shaadi, nikkah, haldi, dholki, rasm.
- DO NOT write fully transliterated sentences (e.g. "Yeh dulhan ke liye perfect hai") — keep grammar English, use loanwords as nouns within English sentences. Good: "Pairs naturally with bridal jhumka earrings for a complete shaadi look." Bad: "Dulhan ke liye yeh ek perfect option hai."
- No Hindi/Urdu function words (yeh, woh, ka, ke, ki, hai, hain, mein, se, ko, etc.).

SELECTION CRITERIA (in priority order):
1. Aesthetic harmony — pieces that visually complete a styled look together
2. Occasion alignment — bridal with bridal, casual with casual, formal with formal
3. Color and finish coordination — gold tones together, oxidized silver together
4. Category complementarity — necklace pairs with earrings/bangles/ring, AVOID duplicate-category pairings (do not pick 4 necklaces for a necklace)
5. Price compatibility — broadly within range, avoid extreme jumps unless intentional upsell

OUTPUT FORMAT — return ONLY a JSON object, no preamble or explanation outside the JSON:
{
  "picks": [
    {
      "shopify_product_id": "EXACT_ID_FROM_CANDIDATES",
      "rationale": "One single sentence, 12-22 words, describing the styling synergy specifically."
    }
  ]
}

RATIONALE QUALITY — avoid these clichés: "elevate", "timeless", "perfect for any occasion", "stunning", "gorgeous", "exquisite craftsmanship", "statement piece", "add a touch of". Be specific about visual link or occasion match.

Pick exactly 4. Use only IDs from the CANDIDATES list provided. Do not invent IDs.`;

function buildUserPrompt(target, candidates) {
  const lines = candidates.map((c, i) =>
    `${i + 1}. ID: ${c.shopify_product_id} | "${c.parent_title}" | ${c.category || 'Uncategorized'} | Rs ${c.selling_price || 0} | collections: ${(c.collections || []).map(x => x.handle).join(', ') || 'none'}`
  ).join('\n');

  return `TARGET PRODUCT:
- ID: ${target.shopify_product_id}
- Title: ${target.parent_title}
- Category: ${target.category || 'Uncategorized'}
- Price: Rs ${target.selling_price || 0}
- Collections: ${(target.collections || []).map(c => c.handle).join(', ') || 'none'}

CANDIDATES (${candidates.length} options — pick 4 best):
${lines}

Return JSON only with exactly 4 picks.`;
}

// Score candidates by relevance to target. Higher = more relevant.
function scoreCandidate(target, c) {
  let score = 0;
  // Same category +10
  if (target.category && c.category === target.category) score += 10;
  // Collection overlap +5 per shared collection
  const tColls = new Set((target.collections || []).map(x => x.handle));
  const cColls = (c.collections || []).map(x => x.handle);
  const overlap = cColls.filter(h => tColls.has(h)).length;
  score += overlap * 5;
  // Price proximity (within 30% = +5, within 60% = +2)
  const tPrice = Number(target.selling_price) || 0;
  const cPrice = Number(c.selling_price) || 0;
  if (tPrice > 0 && cPrice > 0) {
    const ratio = Math.min(tPrice, cPrice) / Math.max(tPrice, cPrice);
    if (ratio >= 0.7) score += 5;
    else if (ratio >= 0.4) score += 2;
  }
  // ABC class match (A products with A products = better cross-sell)
  if (target.abc_90d && c.abc_90d === target.abc_90d) score += 3;
  return score;
}

export async function POST(request) {
  const startTime = Date.now();
  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));
    const { shopify_product_id } = body;

    if (!shopify_product_id) {
      return NextResponse.json({ success: false, error: 'shopify_product_id required' }, { status: 400 });
    }

    const pid = String(shopify_product_id);

    // ── Step 1: Load target product (any variant works — same parent metadata) ──
    const { data: targetRow, error: tErr } = await supabase
      .from('products')
      .select('shopify_product_id, parent_title, category, collections, selling_price, abc_90d')
      .eq('shopify_product_id', pid)
      .limit(1)
      .maybeSingle();

    if (tErr) throw tErr;
    if (!targetRow) {
      return NextResponse.json({ success: false, error: 'Product not found' }, { status: 404 });
    }

    // ── Step 2: Pull candidates (active, in-stock, exclude self) ──
    const candPriceMin = (targetRow.selling_price || 0) * 0.4;
    const candPriceMax = (targetRow.selling_price || 0) * 1.6;

    const candRows = [];
    const PAGE = 1000;
    let off = 0;
    while (off < 6000) {
      const { data, error } = await supabase
        .from('products')
        .select('shopify_product_id, parent_title, category, collections, selling_price, stock_quantity, is_active, abc_90d')
        .neq('shopify_product_id', pid)
        .eq('is_active', true)
        .gt('stock_quantity', 0)
        .range(off, off + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      candRows.push(...data);
      if (data.length < PAGE) break;
      off += PAGE;
    }

    // Dedupe to one row per shopify_product_id (first variant)
    const seen = new Map();
    for (const r of candRows) {
      if (!seen.has(r.shopify_product_id)) seen.set(r.shopify_product_id, r);
    }
    let candidates = Array.from(seen.values());

    // Apply price band filter (skip if target has no price)
    if (targetRow.selling_price > 0) {
      candidates = candidates.filter(c => {
        const p = Number(c.selling_price) || 0;
        return p >= candPriceMin && p <= candPriceMax;
      });
    }

    // Pre-filter: keep only candidates with at least some relevance signal
    candidates = candidates.filter(c => {
      if (targetRow.category && c.category === targetRow.category) return true;
      const tColls = new Set((targetRow.collections || []).map(x => x.handle));
      const cColls = (c.collections || []).map(x => x.handle);
      return cColls.some(h => tColls.has(h));
    });

    // Score and take top 20
    candidates = candidates
      .map(c => ({ ...c, _score: scoreCandidate(targetRow, c) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 20);

    // ── Step 3: Decide picks ──
    let picks = [];
    let aiUsed = false;
    let tokensIn = 0, tokensOut = 0, costUsd = 0;

    if (candidates.length === 0) {
      picks = [];
    } else if (candidates.length <= 4) {
      // Trivial — just use what we have
      picks = candidates.map(c => ({
        shopify_product_id: c.shopify_product_id,
        rationale: `Same category and price range — natural pairing for cross-sell.`,
      }));
    } else {
      // ── Step 4: Claude pick ──
      aiUsed = true;
      if (!process.env.ANTHROPIC_API_KEY) {
        return NextResponse.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
      }

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const userPrompt = buildUserPrompt(targetRow, candidates);

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      tokensIn = response.usage?.input_tokens || 0;
      tokensOut = response.usage?.output_tokens || 0;
      costUsd = (tokensIn * PRICE_INPUT_PER_M / 1_000_000) + (tokensOut * PRICE_OUTPUT_PER_M / 1_000_000);

      const text = (response.content.find(b => b.type === 'text')?.text || '').trim();
      const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        console.error('[related-products one] JSON parse failed:', text.slice(0, 500));
        return NextResponse.json({
          success: false,
          error: 'AI returned malformed JSON',
          raw_preview: text.slice(0, 500),
        }, { status: 500 });
      }

      // Validate picks: must reference real candidate IDs, max 4
      const validIds = new Set(candidates.map(c => String(c.shopify_product_id)));
      picks = (parsed.picks || [])
        .filter(p => validIds.has(String(p.shopify_product_id)))
        .slice(0, 4)
        .map(p => ({
          shopify_product_id: String(p.shopify_product_id),
          rationale: String(p.rationale || '').trim(),
        }));
    }

    // ── Step 5: Enrich with title snapshot for ERP UI ──
    const pickIds = picks.map(p => p.shopify_product_id);
    let snapshots = {};
    if (pickIds.length > 0) {
      const { data: snapRows } = await supabase
        .from('products')
        .select('shopify_product_id, parent_title, image_url, selling_price')
        .in('shopify_product_id', pickIds);
      for (const s of snapRows || []) {
        if (!snapshots[s.shopify_product_id]) snapshots[s.shopify_product_id] = s;
      }
    }
    const enrichedPicks = picks.map(p => ({
      ...p,
      title_snapshot: snapshots[p.shopify_product_id]?.parent_title || null,
      image_snapshot: snapshots[p.shopify_product_id]?.image_url || null,
      price_snapshot: snapshots[p.shopify_product_id]?.selling_price || null,
    }));

    // ── Step 6: Save to all variants of this parent ──
    const payload = {
      version: 1,
      generated_at: new Date().toISOString(),
      model: aiUsed ? MODEL : 'rule-based',
      candidates_considered: candidates.length,
      ai_used: aiUsed,
      tokens_input: tokensIn,
      tokens_output: tokensOut,
      cost_usd: Number(costUsd.toFixed(6)),
      duration_ms: Date.now() - startTime,
      picks: enrichedPicks,
    };

    const { error: updErr } = await supabase
      .from('products')
      .update({ related_products: payload })
      .eq('shopify_product_id', pid);

    if (updErr) throw updErr;

    return NextResponse.json({
      success: true,
      shopify_product_id: pid,
      target_title: targetRow.parent_title,
      ...payload,
    });
  } catch (err) {
    console.error('[related-products one] error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
