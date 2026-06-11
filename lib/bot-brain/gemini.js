// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR — lib/bot-brain/gemini.js
// ────────────────────────────────────────────────────────────────────────────
// Thin wrapper around Google's Gemini `generateContent` REST endpoint.
// No SDK dependency (uses fetch) so package.json doesn't change.
//
// Supports: text, image input (inlineData), and function calling (tools).
//
// MODEL: gemini-2.5-flash-lite is the current stable, cost-efficient, multimodal
// model (Gemini 2.0 Flash/Flash-Lite were shut down June 1 2026). Overridable
// via env GEMINI_MODEL so you can switch to gemini-3.1-flash-lite later without
// a code change.
//
// ENV:
//   GEMINI_API_KEY   (required — get a free key from Google AI Studio)
//   GEMINI_MODEL     (optional — defaults to gemini-2.5-flash-lite)
// ════════════════════════════════════════════════════════════════════════════

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export function isGeminiConfigured() {
  return Boolean(GEMINI_API_KEY);
}

export function geminiModel() {
  return GEMINI_MODEL;
}

// Returns the raw generateContent JSON. Throws on HTTP error / missing key.
export async function generateContent({
  systemInstruction,
  contents,
  tools,
  temperature = 0.5,
  maxOutputTokens = 700,
} = {}) {
  if (!GEMINI_API_KEY) {
    const e = new Error('GEMINI_API_KEY not set');
    e.code = 'NO_KEY';
    throw e;
  }

  const url = `${BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: contents || [],
    generationConfig: { temperature, maxOutputTokens },
    // Keep the bot safe but not over-blocking for normal jewellery chat.
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
  if (tools && tools.length) body.tools = [{ functionDeclarations: tools }];

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const e = new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// Parts of the first candidate (array of { text } | { functionCall } | ...).
export function firstCandidateParts(data) {
  return data?.candidates?.[0]?.content?.parts || [];
}

// Concatenated plain text from the first candidate.
export function firstCandidateText(data) {
  return firstCandidateParts(data)
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
}
