import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

// Related Products — batch generator (SELF-CONTAINED)
// v2.5 — no prefill. Robust JSON extraction handles any response format.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';
const PRICE_INPUT_PER_M  = 3.00;
const PRICE_OUTPUT_PER_M = 15.00;
const DEFAULT_BATCH = 8;
const DEFAULT_CONCURRENCY = 2;

const SYSTEM_PROMPT = `You are a senior jewelry merchandising expert for RS ZEVAR, a premium Pakistani artificial jewelry brand. Select 4 best companion pieces for cross-sell.

LANGUAGE RULES — output for international desi diaspora + boutique buyers:
- Sentence structure must be English. Use loanwords below as nouns within English sentences.
- ALLOWED loanwords: kundan, meenakari, polki, mehndi, bridal, jhumka, jhumki, lehenga, dupatta, kameez, baraat, walima, dulhan, shaadi, nikkah, haldi, dholki, rasm, churi, kangans, kara, tikka, maang, jhoomar, bindi, payal, anklet, choker, ranihaar.
- NO fully transliterated sentences. NO Hindi/Urdu function words (yeh, woh, ka, ke, ki, hai, mein, etc.).

CATEGORY DIVERSITY RULE (CRITICAL):
- Among the 4 picks, MAXIMUM 2 may share the same category as the target.
- MINIMUM 2 picks MUST be from a DIFFERENT category than the target.

SELECTION CRITERIA:
1. Category diversity (above) — non-negotiable
2. Occasion alignment — bridal with bridal, casual with casual
3. Color/finish coordination
4. Aesthetic harmony
5. Price compatibility

RATIONALE QUALITY — avoid: "elevate", "timeless", "perfect for any occasion", "stunning", "gorgeous", "exquisite craftsmanship", "statement piece", "add a touch of". Be specific about visual or occasion link.

CRITICAL OUTPUT RULES:
- Respond with ONLY a JSON object. Nothing before it. Nothing after it.
- Start your response with the opening brace {
- End your response with the closing brace }
- Do not use markdown code fences like triple-backtick json.
- Do not write any explanation or preamble.

JSON structure:
{
  "picks": [
    {"shopify_product_id": "EXACT_ID_FROM_CANDIDATES", "rationale": "One sentence, 12-22 words, specific styling synergy."}
  ]
}

Pick exactly 4. Use only IDs from the CANDIDATES list. Do not invent IDs.`;

// ============================================================================
// HELPERS
// ============================================================================

async function loadPool(supabase) {
  const rows = [];
  const PAGE = 1000;
  let off = 0;
  while (off < 6000) {
    const { data, error } = await supabase
      .from('products')
      .select('shopify_product_id, parent_title, category, collections, selling_price, stock_quantity, is_active, abc_90d')
      .eq('is_active', true)
      .gt('stock_quantity', 0)
      .range(off, off + PAGE - 1);
    if (error) throw new Error(`Pool fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    off += PAGE;
  }
  const seen = new Map();
  for (const r of rows) {
    if (!seen.has(r.shopify_product_id)) seen.set(r.shopify_product_id, r);
  }
  return Array.from(seen.values());
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
  const sort = (arr) => arr.map(c => ({ ...c, _score: scoreCandidate(target, c) })).sort((a, b) => b._score - a._score);
  const composed = [...sort(tier1).slice(0, 12), ...sort(tier2).slice(0, 5), ...sort(tier3).slice(0, 3)];
  if (composed.length < 20) {
    const used = new Set(composed.map(c => c.shopify_product_id));
    const fillers = [...sort(tier1).slice(12), ...sort(tier2).slice(5), ...sort(tier3).slice(3), ...sort(tier4)].filter(c => !used.has(c.shopify_product_id));
    composed.push(...fillers.slice(0, 20 - composed.length));
  }
  return composed.slice(0, 20);
}

function buildUserPrompt(target, candidates) {
  const lines = candidates.map((c, i) => {
    const tag = target.category && c.category === target.category ? '[SAME-CAT]' : '[CROSS-CAT]';
    return `${i + 1}. ${tag} ID: ${c.shopify_product_id} | "${c.parent_title}" | category: ${c.category || 'Uncategorized'} | Rs ${c.selling_price || 0} | collections: ${(c.collections || []).map(x => x.handle).join(', ') || 'none'}`;
  }).join('\n');
  return `TARGET:
- ID: ${target.shopify_product_id}
- Title: ${target.parent_title}
- Category: ${target.category || 'Uncategorized'}
- Price: Rs ${target.selling_price || 0}
- Collections: ${(target.collections || []).map(c => c.handle).join(', ') || 'none'}

CANDIDATES (${candidates.length}):
${lines}

Max 2 [SAME-CAT], min 2 [CROSS-CAT].`;
}

async function callClaudeWithRetry(client, params, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (e) {
      lastError = e;
      const status = e.status || e?.response?.status;
      const msg = String(e.message || '').toLowerCase();
      const isRetryable = status === 429 || status === 529 || status === 503 || msg.includes('rate_limit') || msg.includes('overloaded');
      if (!isRetryable || attempt === maxRetries) throw e;
      const delay = 3000 * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// Robust JSON extraction — handles any response shape AI might return
function extractJson(text) {
  // Strategy 1: direct parse
  try { return JSON.parse(text); } catch {}

  // Strategy 2: strip common markdown fences
  const unfenced = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(unfenced); } catch {}

  // Strategy 3: greedy extract between first { and last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch {}
  }

  throw new Error('Could not extract JSON');
}

async function generateForOne(supabase, client, target, pool) {
  const startTime = Date.now();

  const candPriceMin = (target.selling_price || 0) * 0.4;
  const candPriceMax = (target.selling_price || 0) * 1.6;
  let allCandidates = pool.filter(c => c.shopify_product_id !== target.shopify_product_id);
  if (target.selling_price > 0) {
    allCandidates = allCandidates.filter(c => {
      const p = Number(c.selling_price) || 0;
      return p >= candPriceMin && p <= candPriceMax;
    });
  }
  const candidates = selectDiverseCandidates(target, allCandidates);

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
    const userPrompt = buildUserPrompt(target, candidates);

    // Simple messages — no prefill (model compatibility)
    const response = await callClaudeWithRetry(client, {
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }, 3);

    tokensIn = response.usage?.input_tokens || 0;
    tokensOut = response.usage?.output_tokens || 0;
    costUsd = (tokensIn * PRICE_INPUT_PER_M / 1_000_000) + (tokensOut * PRICE_OUTPUT_PER_M / 1_000_000);

    const text = (response.content.find(b => b.type === 'text')?.text || '').trim();
    let parsed;
    try {
      parsed = extractJson(text);
    } catch (e) {
      console.error('[batch] JSON extract failed. Raw:', text.slice(0, 300));
      throw new Error(`AI JSON malformed. Preview: ${text.slice(0, 100).replace(/\n/g, ' ')}`);
    }

    const validIds = new Set(candidates.map(c => String(c.shopify_product_id)));
    picks = (parsed.picks || [])
      .filter(p => validIds.has(String(p.shopify_product_id)))
      .slice(0, 4)
      .map(p => ({
        shopify_product_id: String(p.shopify_product_id),
        rationale: String(p.rationale || '').trim(),
      }));

    // Diversity safety net
    const sameCatCount = picks.filter(p => {
      const c = candidates.find(x => String(x.shopify_product_id) === p.shopify_product_id);
      return c && target.category && c.category === target.category;
    }).length;
    if (sameCatCount > 2) {
      const pickedIds = new Set(picks.map(p => p.shopify_product_id));
      const crossCatPool = candidates.filter(c => target.category && c.category !== target.category && !pickedIds.has(String(c.shopify_product_id)));
      let toReplace = sameCatCount - 2;
      for (let i = picks.length - 1; i >= 0 && toReplace > 0; i--) {
        const c = candidates.find(x => String(x.shopify_product_id) === picks[i].shopify_product_id);
        if (c && target.category && c.category === target.category && crossCatPool.length > 0) {
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

  // Enrich snapshots
  const poolMap = new Map(pool.map(p => [p.shopify_product_id, p]));
  const enrichedPicks = picks.map(p => {
    const row = poolMap.get(p.shopify_product_id);
    return {
      ...p,
      title_snapshot: row?.parent_title || null,
      image_snapshot: null,
      price_snapshot: row?.selling_price || null,
      category_snapshot: row?.category || null,
    };
  });

  // Fetch image URLs separately (not in pool)
  if (enrichedPicks.length > 0) {
    const pickIds = enrichedPicks.map(p => p.shopify_product_id);
    const { data: imgRows } = await supabase
      .from('products')
      .select('shopify_product_id, image_url')
      .in('shopify_product_id', pickIds);
    const imgMap = new Map();
    for (const r of imgRows || []) {
      if (!imgMap.has(r.shopify_product_id)) imgMap.set(r.shopify_product_id, r.image_url);
    }
    for (const p of enrichedPicks) {
      p.image_snapshot = imgMap.get(p.shopify_product_id) || null;
    }
  }

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
    .eq('shopify_product_id', target.shopify_product_id);
  if (updErr) throw new Error(`DB update failed: ${updErr.message}`);

  return { ai_used: aiUsed, picks_count: picks.length, cost_usd: costUsd };
}

async function runWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async (_, wi) => {
    await new Promise(r => setTimeout(r, wi * 200));
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = { success: false, error: e.message };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

export async function GET() {
  try {
    const supabase = createServerClient();
    const all = [];
    const PAGE = 1000;
    let off = 0;
    while (off < 10000) {
      const { data, error } = await supabase
        .from('products')
        .select('shopify_product_id, related_products, is_active, stock_quantity')
        .not('shopify_product_id', 'is', null)
        .range(off, off + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      off += PAGE;
    }
    const seen = new Map();
    for (const r of all) {
      if (!seen.has(r.shopify_product_id)) seen.set(r.shopify_product_id, r);
    }
    let total = 0, withRelated = 0, activeInStock = 0, pending = 0, totalCostUsd = 0;
    for (const r of seen.values()) {
      total++;
      const isEligible = r.is_active && (r.stock_quantity || 0) > 0;
      if (isEligible) activeInStock++;
      const rp = r.related_products;
      const hasPicks = rp && Array.isArray(rp.picks) && rp.picks.length > 0;
      if (hasPicks) {
        withRelated++;
        if (typeof rp.cost_usd === 'number') totalCostUsd += rp.cost_usd;
      } else if (isEligible) {
        pending++;
      }
    }
    return NextResponse.json({
      success: true,
      total_products: total,
      eligible_products: activeInStock,
      with_related: withRelated,
      pending,
      progress_pct: activeInStock > 0 ? Math.round((withRelated / activeInStock) * 100) : 0,
      total_cost_usd_so_far: Number(totalCostUsd.toFixed(4)),
    });
  } catch (err) {
    console.error('[batch GET]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const startTime = Date.now();
  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(parseInt(body.batch_size) || DEFAULT_BATCH, 1), 15);
    const concurrency = Math.min(Math.max(parseInt(body.concurrency) || DEFAULT_CONCURRENCY, 1), 3);

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    const poolStart = Date.now();
    const pool = await loadPool(supabase);
    const poolMs = Date.now() - poolStart;

    const relRows = [];
    const PAGE = 1000;
    let off = 0;
    while (off < 10000) {
      const { data, error } = await supabase
        .from('products')
        .select('shopify_product_id, related_products')
        .not('shopify_product_id', 'is', null)
        .range(off, off + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      relRows.push(...data);
      if (data.length < PAGE) break;
      off += PAGE;
    }
    const relMap = new Map();
    for (const r of relRows) {
      if (!relMap.has(r.shopify_product_id)) relMap.set(r.shopify_product_id, r.related_products);
    }

    const pending = pool.filter(p => {
      const rp = relMap.get(p.shopify_product_id);
      return !(rp && Array.isArray(rp.picks) && rp.picks.length > 0);
    });

    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All eligible products already have related_products generated.',
        processed: 0, remaining: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    const batch = pending.slice(0, batchSize);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });

    const results = await runWithConcurrency(batch, concurrency, async (p) => {
      try {
        const r = await generateForOne(supabase, client, p, pool);
        return {
          shopify_product_id: p.shopify_product_id,
          title: p.parent_title,
          success: true,
          ai_used: r.ai_used,
          picks_count: r.picks_count,
          cost_usd: r.cost_usd || 0,
          error: null,
        };
      } catch (e) {
        return {
          shopify_product_id: p.shopify_product_id,
          title: p.parent_title,
          success: false,
          ai_used: false,
          picks_count: 0,
          cost_usd: 0,
          error: e.message,
        };
      }
    });

    const ok = results.filter(r => r.success).length;
    const fail = results.filter(r => !r.success).length;
    const totalCost = results.reduce((s, r) => s + (r.cost_usd || 0), 0);
    const aiCalls = results.filter(r => r.ai_used).length;

    const failureReasons = {};
    for (const r of results.filter(x => !x.success)) {
      const key = r.error?.slice(0, 80) || 'unknown';
      failureReasons[key] = (failureReasons[key] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      processed: ok,
      failed: fail,
      ai_calls: aiCalls,
      remaining: pending.length - batch.length,
      batch_cost_usd: Number(totalCost.toFixed(6)),
      batch_cost_pkr: Math.round(totalCost * 285),
      pool_load_ms: poolMs,
      duration_ms: Date.now() - startTime,
      failure_reasons: failureReasons,
      results,
    });
  } catch (err) {
    console.error('[batch POST]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
