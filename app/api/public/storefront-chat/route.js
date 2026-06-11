// ============================================================================
// RS ZEVAR ERP — Public Storefront Chat Endpoint (Phase 1)
// Path: app/api/public/storefront-chat/route.js
//
// POST  → customer chat. Body: { messages:[{role,text}], image?, sessionId }
// GET   → health/handshake: { ok, configured }
// OPTIONS → CORS preflight
//
// Lives under /api/public/* → middleware auto-bypasses auth (same as the
// order tracker). Protected by: CORS origin lock + per-IP & per-session
// rate limit + message/image size caps.
//
// Uses the shared Bot Brain (system prompt + knowledge + tools) so it stays in
// sync with the Bot Brain admin tab. Gemini key optional — if not set, the bot
// gracefully hands the customer off to WhatsApp instead of erroring.
// ============================================================================

import { createServerClient } from '../../../../lib/supabase';
import { generateContent, isGeminiConfigured, firstCandidateParts } from '../../../../lib/bot-brain/gemini';
import { TOOL_DECLARATIONS, executeTool } from '../../../../lib/bot-brain/tools';
import { buildSystemPrompt, HANDOFF_WHATSAPP, HANDOFF_TOKEN } from '../../../../lib/bot-brain/system-prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = ['https://rszevar.com', 'https://www.rszevar.com'];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://rszevar.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
  };
}

function jsonRes(origin, obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function GET(request) {
  const origin = request.headers.get('origin') || '';
  return jsonRes(origin, { ok: true, configured: isGeminiConfigured() });
}

// ─── Rate limiting (per-IP + per-session, in-memory sliding window) ──────────
const ipMap = new Map();
const sessMap = new Map();
const IP_LIMIT = 40;        // messages / hour / IP
const SESS_LIMIT = 60;      // messages / hour / session
const WINDOW_MS = 60 * 60 * 1000;

function limited(map, key, max) {
  if (!key) return false;
  const now = Date.now();
  const hits = (map.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= max) return true;
  hits.push(now);
  map.set(key, hits);
  return false;
}

// ─── Caps ─────────────────────────────────────────────────────────────────────
const MAX_MESSAGES = 14;        // keep only the recent turns
const MAX_TEXT_LEN = 2000;      // per message
const MAX_IMAGE_B64 = 4_000_000; // ~3MB image (Vercel body limit ~4.5MB)

// ─── Build Gemini contents from chat history (+ optional image on last user) ──
function buildContents(messages, image) {
  const trimmed = (Array.isArray(messages) ? messages : []).slice(-MAX_MESSAGES);
  const contents = [];
  trimmed.forEach((m, idx) => {
    const role = m.role === 'assistant' || m.role === 'model' ? 'model' : 'user';
    const text = String(m.text || '').slice(0, MAX_TEXT_LEN);
    const parts = [];
    if (text) parts.push({ text });
    // Attach image only to the LAST user message
    const isLast = idx === trimmed.length - 1;
    if (isLast && role === 'user' && image && image.data && image.mimeType) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
    if (parts.length) contents.push({ role, parts });
  });
  return contents;
}

function finalize(origin, rawText) {
  let text = String(rawText || '').trim();
  let handoff = false;
  if (text.includes(HANDOFF_TOKEN)) {
    handoff = true;
    text = text.replace(HANDOFF_TOKEN, '').trim();
  }
  if (!text) {
    handoff = true;
    text = 'Main aap ko apni team se connect kar deti hun 😊';
  }
  return jsonRes(origin, {
    success: true,
    reply: text,
    handoff,
    whatsapp: handoff ? HANDOFF_WHATSAPP : null,
  });
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request) {
  const origin = request.headers.get('origin') || '';
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';

    const body = await request.json().catch(() => ({}));
    const sessionId = String(body.sessionId || '').slice(0, 80);

    if (limited(ipMap, ip, IP_LIMIT) || limited(sessMap, sessionId, SESS_LIMIT)) {
      return jsonRes(origin, { success: false, error: 'rate_limited', reply: 'Thora ruk ke try karein 😊', handoff: true, whatsapp: HANDOFF_WHATSAPP }, 429);
    }

    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonRes(origin, { success: false, error: 'messages required' }, 400);
    }

    // Validate optional image
    let image = null;
    if (body.image && body.image.data && body.image.mimeType) {
      if (String(body.image.data).length > MAX_IMAGE_B64) {
        return jsonRes(origin, { success: false, error: 'image too large', reply: 'Image thori choti bhej dein please 😊' }, 413);
      }
      image = { data: String(body.image.data), mimeType: String(body.image.mimeType) };
    }

    // No Gemini key yet → graceful handoff so the widget still works.
    if (!isGeminiConfigured()) {
      return finalize(origin, `Main aap ko apni team se connect kar deti hun 😊 ${HANDOFF_TOKEN}`);
    }

    const supabase = createServerClient();
    const systemInstruction = await buildSystemPrompt(supabase, 'website');
    let contents = buildContents(messages, image);

    // ── Function-calling loop (max 3 tool rounds) ──
    for (let round = 0; round < 3; round++) {
      const data = await generateContent({ systemInstruction, contents, tools: TOOL_DECLARATIONS });
      const parts = firstCandidateParts(data);
      const calls = parts.filter((p) => p.functionCall);

      if (calls.length === 0) {
        const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('').trim();
        return finalize(origin, text);
      }

      // Append the model's tool-call turn, then the tool results.
      contents.push({ role: 'model', parts });
      const responseParts = [];
      for (const p of calls) {
        const result = await executeTool(p.functionCall.name, p.functionCall.args || {}, supabase);
        responseParts.push({ functionResponse: { name: p.functionCall.name, response: { result } } });
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    // Tool rounds exhausted without a final text → ask the model once more, plain.
    const last = await generateContent({ systemInstruction, contents });
    const text = firstCandidateParts(last).filter((p) => typeof p.text === 'string').map((p) => p.text).join('').trim();
    return finalize(origin, text || `${HANDOFF_TOKEN}`);
  } catch (e) {
    // Any failure → don't show a raw error to the customer; hand off kindly.
    return jsonRes(origin, {
      success: false,
      error: e.message,
      reply: 'Maazrat, abhi thori dikkat aa rahi hai 😊 main aap ko team se connect kar deti hun.',
      handoff: true,
      whatsapp: HANDOFF_WHATSAPP,
    }, 200);
  }
}
