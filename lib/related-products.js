// RS ZEVAR ERP — Related Products shared library
// Used by both /api/products/related/generate-one and /generate-batch routes.
// All generation logic lives here so batch can call it directly without
// internal HTTP fetches (which fail middleware auth).

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';
const PRICE_INPUT_PER_M  = 3.00;
const PRICE_OUTPUT_PER_M = 15.00;

const SYSTEM_PROMPT = `You are a senior jewelry merchandising expert for RS ZEVAR, a premium Pakistani artificial jewelry brand. Your task: select the 4 best companion pieces for cross-sell on a product detail page.

LANGUAGE RULES — output for international desi diaspora + boutique buyers:
- Sentence structure must be English. Use the loanwords below where they describe specific products, styles, or events — they are part of international desi-English jewelry vocabulary and drive real search traffic.
- ALLOWED loanwords (use freely, treat as English): kundan, meenakari, polki, mehndi, bridal, jhumka, jhumki, lehenga, dupatta, kameez, baraat, walima, dulhan, shaadi, nikkah, haldi, dholki, rasm, churi, kangans, kara, tikka, maang, jhoomar, bindi, payal, anklet, choker, ranihaar.
- DO NOT write fully transliterated sentences (e.g. "Yeh dulhan ke liye perfect hai") — keep grammar English, use loanwords as nouns within English sentences. Good: "Pairs naturally with bridal jhumka earrings for a complete shaadi look." Bad: "Dulhan ke liye yeh ek perfect option hai."
- No Hindi/Urdu function words (yeh, woh, ka, ke, ki, hai, hain, mein, se, ko, etc.).

CATEGORY DIVERSITY RULE (CRITICAL):
- Among the 4 picks, MAXIMUM 2 may share the same category as the target product.
- MINIMUM 2 picks MUST be from a DIFFERENT category than the target.
- Goal: build a complete jewelry look (e.g. for a bangles target → 1-2 bangles + 1 necklace + 1 earring set), NOT 4 redundant items of the same category.
- The candidates list provides their categories — use this to enforce diversity.
- This rule overrides aesthetic preferences. If forced to choose, pick a less-perfect cross-category item over a more-perfect same-category duplicate.

SELECTION CRITERIA (in priority order):
1. Category diversity (above) — non-negotiable
2. Occasion alignment — bridal with bridal, casual with casual, formal with formal
3. Color and finish coordination — gold tones together, oxidized silver together
4. Aesthetic harmony — pieces that visually complete a styled look together
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
  const lines = candidates.map((c, i) => {
    const isSame = target.category && c.category === target.category;
    const tag = isSame ? '[SAME-CAT]' : '[CROSS-CAT]';
    return `${i + 1}. ${tag} ID: ${c.shopify_product_id} | "${c.parent_title}" | category: ${c.category || 'Uncategorized'} | Rs ${c.selling_price || 0} | collections: ${(c.collections || []).map(x => x.handle).join(', ') || 'none'}`;
  }).join('\n');

  return `TARGET PRODUCT:
- ID: ${target.shopify_product_id}
- Title: ${target.parent_title}
- Category: ${target.category || 'Uncategorized'}
- Price: Rs ${target.selling_price || 0}
- Collections: ${(target.collections || []).map(c => c.handle).join(', ') || 'none'}

CANDIDATES (${candidates.length} options — pick 4 best):
${lines}

REMINDER: Maximum 2 picks may be tagged [SAME-CAT]. At least 2 picks MUST be tagged [CROSS-CAT].

Return JSON only with exactly 4 picks.`;
}

function scoreCandidate(target, c) {
  let score = 0;
  const tColls = new Set((target.collections || []).map(x => x.handle));
  const cColls = (c.collections || []).map(x => x.handle);
  const overlap = cColls.filter(h => tColls.has(h)).length;
  const sameCategory = !!(target.category && c.category === target.category);

  if (!sameCategory && overlap > 0) score += 20 + (overlap * 5);
  else if (sameCategory && overlap > 0) score += 8 + (overlap * 3);
  else if (sameCategory) score += 4;

  const tPrice = Number(target.selling_price) || 0;
  const cPrice = Number(c.selling_price) || 0;
  if (tPrice > 0 && cPrice > 0) {
    const ratio = Math.min(tPrice, cPrice) / Math.max(tPrice, cPrice);
    if (ratio >= 0.7) score += 5;
    else if (ratio >= 0.4) score += 2;
  }

  if (target.abc_90d && c.abc_90d === target.abc_90d) score += 3;
  return score;
}

function selectDiverseCandidates(target, allCandidates) {
  const tColls = new Set((target.collections || []).map(x => x.handle));
  const sameCat = (c) => target.category && c.category === target.category;
  const sharedColl = (c) => (c.collections || []).some(x => tColls.has(x.handle));

  const tier1 = allCandidates.filter(c => !sameCat(c) && sharedColl(c));
  const tier2 = allCandidates.filter(c => sameCat(c) && sharedColl(c));
  const tier3 = allCandidates.filter(c => !sameCat(c) && !sharedColl(c));
  const tier4 = allCandidates.filter(c => sameCat(c) && !sharedColl(c));

  const sortByScore = (arr) =>
    arr.map(c => ({ ...c, _score: scoreCandidate(target, c) }))
       .sort((a, b) => b._score - a._score);

  const t1 = sortByScore(tier1);
  const t2 = sortByScore(tier2);
  const t3 = sortByScore(tier3);
  const t4 = sortByScore(tier4);

  const composed = [
    ...t1.slice(0, 12),
    ...t2.slice(0, 5),
    ...t3.slice(0, 3),
  ];

  if (composed.length < 20) {
    const used = new Set(composed.map(c => c.shopify_product_id));
    const fillers = [...t1.slice(12), ...t2.slice(5), ...t3.slice(3), ...t4]
      .filter(c => !used.has(c.shopify_product_id));
    composed.push(...fillers.slice(0, 20 - composed.length));
  }

  return composed.slice(0, 20);
}

// Main exported function — generates related products for a single product.
// Takes a Supabase client (server-side) and shopify_product_id.
// Returns the payload object (also writes it to the DB).
export async function generateRelatedProductsForOne(supabase, shopify_product_id) {
  const startTime = Date.now();
  const pid = String(shopify_product_id);

  // ── Step 1: Load target product ──
  const { data: targetRow, error: tErr } = await supabase
    .from('products')
    .select('shopify_product_id, parent_title, category, collections, selling_price, abc_90d')
    .eq('shopify_product_id', pid)
    .limit(1)
    .maybeSingle();

  if (tErr) throw new Error(`Target fetch failed: ${tErr.message}`);
  if (!targetRow) throw new Error('Product not found');

  // ── Step 2: Pull all eligible candidates ──
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
    if (error) throw new Error(`Candidate fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    candRows.push(...data);
    if (data.length < PAGE) break;
    off += PAGE;
  }

  // Dedupe by parent
  const seen = new Map();
  for (const r of candRows) {
    if (!seen.has(r.shopify_product_id)) seen.set(r.shopify_product_id, r);
  }
  let allCandidates = Array.from(seen.values());

  // Price band filter
  if (targetRow.selling_price > 0) {
    allCandidates = allCandidates.filter(c => {
      const p = Number(c.selling_price) || 0;
      return p >= candPriceMin && p <= candPriceMax;
    });
  }

  const candidates = selectDiverseCandidates(targetRow, allCandidates);

  // ── Step 3: Decide picks ──
  let picks = [];
  let aiUsed = false;
  let tokensIn = 0, tokensOut = 0, costUsd = 0;

  if (candidates.length === 0) {
    picks = [];
  } else if (candidates.length <= 4) {
    picks = candidates.map(c => ({
      shopify_product_id: c.shopify_product_id,
      rationale: `Same price range and active stock — natural pairing for cross-sell.`,
    }));
  } else {
    aiUsed = true;
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
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
      console.error('[related-products lib] JSON parse failed:', text.slice(0, 500));
      throw new Error('AI returned malformed JSON');
    }

    const validIds = new Set(candidates.map(c => String(c.shopify_product_id)));
    picks = (parsed.picks || [])
      .filter(p => validIds.has(String(p.shopify_product_id)))
      .slice(0, 4)
      .map(p => ({
        shopify_product_id: String(p.shopify_product_id),
        rationale: String(p.rationale || '').trim(),
      }));

    // Diversity safety guard — replace excess same-cat picks if AI ignored rule
    const sameCatCount = picks.filter(p => {
      const c = candidates.find(x => String(x.shopify_product_id) === p.shopify_product_id);
      return c && targetRow.category && c.category === targetRow.category;
    }).length;

    if (sameCatCount > 2) {
      const pickedIds = new Set(picks.map(p => p.shopify_product_id));
      const crossCatPool = candidates.filter(c =>
        targetRow.category &&
        c.category !== targetRow.category &&
        !pickedIds.has(String(c.shopify_product_id))
      );
      let toReplace = sameCatCount - 2;
      for (let i = picks.length - 1; i >= 0 && toReplace > 0; i--) {
        const c = candidates.find(x => String(x.shopify_product_id) === picks[i].shopify_product_id);
        if (c && targetRow.category && c.category === targetRow.category && crossCatPool.length > 0) {
          const replacement = crossCatPool.shift();
          picks[i] = {
            shopify_product_id: String(replacement.shopify_product_id),
            rationale: `Different category complement — pairs with the target to build a fuller jewelry look.`,
          };
          toReplace--;
        }
      }
    }
  }

  // ── Step 4: Enrich with snapshots ──
  const pickIds = picks.map(p => p.shopify_product_id);
  let snapshots = {};
  if (pickIds.length > 0) {
    const { data: snapRows } = await supabase
      .from('products')
      .select('shopify_product_id, parent_title, image_url, selling_price, category')
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
    category_snapshot: snapshots[p.shopify_product_id]?.category || null,
  }));

  // ── Step 5: Save ──
  const payload = {
    version: 2,
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

  if (updErr) throw new Error(`DB update failed: ${updErr.message}`);

  return {
    shopify_product_id: pid,
    target_title: targetRow.parent_title,
    target_category: targetRow.category,
    ...payload,
  };
}
