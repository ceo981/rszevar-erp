// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR — lib/bot-brain/knowledge.js
// ────────────────────────────────────────────────────────────────────────────
// Bot Brain ka SHARED knowledge layer. Yehi do cheezein power karega:
//   1. Storefront chat widget (website)   — Phase 1
//   2. ERP WhatsApp auto-reply            — Phase 3
//
// Yahan sirf SERVER-SIDE read helpers + system-prompt context builder hai.
// Data do tables se aata hai (migration 20260611_bot_brain_knowledge.sql):
//   • bot_responses  — short tone/intent reply templates
//   • bot_knowledge  — policies, behaviour rules, links (category-tagged)
//
// Service role client use karta hai (createServerClient) — ye API routes /
// server contexts ke liye hai, browser ke liye NAHI.
// ════════════════════════════════════════════════════════════════════════════

import { createServerClient } from '../supabase';

// ── Category constants (UI + brain dono yahan se padhein, hardcode na karein) ──
export const KNOWLEDGE_CATEGORIES = [
  'behaviour',
  'policy',
  'shipping',
  'payment',
  'product',
  'packaging',
  'company',
  'collection_link',
];

export const RESPONSE_CATEGORIES = [
  'Order',
  'Delivery',
  'Payment',
  'Complaint',
  'Return',
  'Refund',
  'Product',
  'Packaging',
  'Address',
  'Logistics',
  'Support',
];

export const TONES = ['Calm', 'Neutral', 'Friendly', 'Soft', 'Firm', 'Helpful', 'Informative'];

// ── Simple in-memory cache (Vercel warm instance ke liye), 60s TTL ───────────
let _cache = { at: 0, responses: null, knowledge: null };
const CACHE_TTL_MS = 60 * 1000;

export function invalidateBotBrainCache() {
  _cache = { at: 0, responses: null, knowledge: null };
}

// ── Active responses (tone/intent templates) ─────────────────────────────────
export async function getActiveResponses(supabase) {
  const db = supabase || createServerClient();
  const { data, error } = await db
    .from('bot_responses')
    .select('*')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── Active knowledge chunks (policies / behaviour / links) ───────────────────
export async function getActiveKnowledge(supabase) {
  const db = supabase || createServerClient();
  const { data, error } = await db
    .from('bot_knowledge')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: false })
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── Sirf behaviour rules (system prompt ka core personality) ─────────────────
export async function getBehaviourRules(supabase) {
  const all = await getActiveKnowledge(supabase);
  return all.filter((k) => k.category === 'behaviour');
}

// ── Keyword search (tiny dataset → simple in-memory match; vector baad mein) ──
// query string ke against situation/keywords/title/content match karta hai.
// Returns { responses: [...], knowledge: [...] } ranked by naive score.
export async function searchKnowledge(query, supabase) {
  const q = String(query || '').toLowerCase().trim();
  const [responses, knowledge] = await Promise.all([
    getActiveResponses(supabase),
    getActiveKnowledge(supabase),
  ]);
  if (!q) return { responses: [], knowledge: [] };

  const terms = q.split(/\s+/).filter(Boolean);
  const score = (hay) => {
    const h = String(hay || '').toLowerCase();
    return terms.reduce((s, t) => s + (h.includes(t) ? 1 : 0), 0);
  };

  const scoredResponses = responses
    .map((r) => ({ row: r, s: score(`${r.situation} ${r.trigger_keywords} ${r.reply_en} ${r.reply_ru}`) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.row);

  const scoredKnowledge = knowledge
    .map((k) => ({ row: k, s: score(`${k.title} ${k.keywords} ${k.content}`) + (k.priority || 0) / 1000 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.row);

  return { responses: scoredResponses, knowledge: scoredKnowledge };
}

// ── System-prompt context block (Phase 1/3 brain isko inject karega) ─────────
// Behaviour rules + key policies ko ek compact text block mein bundle karta hai.
// Cached (60s) kyunki har customer message par DB hit avoid karna hai.
export async function buildSystemContext(supabase) {
  const now = Date.now();
  if (_cache.knowledge && now - _cache.at < CACHE_TTL_MS) {
    return _formatContext(_cache.responses, _cache.knowledge);
  }
  const [responses, knowledge] = await Promise.all([
    getActiveResponses(supabase),
    getActiveKnowledge(supabase),
  ]);
  _cache = { at: now, responses, knowledge };
  return _formatContext(responses, knowledge);
}

function _formatContext(responses, knowledge) {
  const byCat = (cat) => (knowledge || []).filter((k) => k.category === cat);

  const behaviour = byCat('behaviour')
    .map((k) => `- ${k.title}: ${k.content}`)
    .join('\n');

  const policyCats = ['policy', 'shipping', 'payment', 'product', 'packaging', 'company'];
  const facts = policyCats
    .flatMap((cat) => byCat(cat))
    .map((k) => `- [${k.category}] ${k.title}: ${k.content}`)
    .join('\n');

  const links = byCat('collection_link')
    .map((k) => `- ${k.title}: ${k.content}`)
    .join('\n');

  const replyBank = (responses || [])
    .map((r) => `- (${r.tone || 'Neutral'}) ${r.situation}: EN "${r.reply_en}" | RU "${r.reply_ru}"`)
    .join('\n');

  return [
    '## HOW TO SPEAK (behaviour rules — follow strictly)',
    behaviour || '(none)',
    '',
    '## BUSINESS FACTS (use only what is relevant; keep replies short)',
    facts || '(none)',
    '',
    '## OFFICIAL LINKS (share the correct one when asked)',
    links || '(none)',
    '',
    '## EXAMPLE REPLIES (match this tone/length; do not copy verbatim if context differs)',
    replyBank || '(none)',
  ].join('\n');
}
