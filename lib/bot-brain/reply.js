// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR — lib/bot-brain/reply.js
// Shared "brain": turns a list of {role,text} messages into a reply using the
// same system prompt + Gemini function-calling + catalog/track tools that power
// the storefront widget. Text-only (used by the WhatsApp auto-reply). Returns
// { text, handoff }.
// ════════════════════════════════════════════════════════════════════════════

import { generateContent, isGeminiConfigured, firstCandidateParts } from './gemini';
import { TOOL_DECLARATIONS, executeTool } from './tools';
import { buildSystemPrompt, HANDOFF_TOKEN } from './system-prompt';
import { createServerClient } from '../supabase';

function buildContents(messages) {
  return (messages || [])
    .map((m) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: [{ text: String(m.text || '').slice(0, 4000) }],
    }))
    .filter((c) => c.parts[0].text);
}

function splitHandoff(rawText) {
  let text = String(rawText || '').trim();
  let handoff = false;
  if (text.includes(HANDOFF_TOKEN)) {
    handoff = true;
    text = text.replace(HANDOFF_TOKEN, '').trim();
  }
  return { text, handoff };
}

export async function generateBotReply({ messages, channel = 'whatsapp' }) {
  if (!isGeminiConfigured()) return { text: '', handoff: true };

  const contents = buildContents(messages);
  if (contents.length === 0) return { text: '', handoff: true };

  const supabase = createServerClient();
  const __lastUser = [...(messages || [])].reverse().find((m) => m && m.role === 'user');
  const __lastUserText = __lastUser ? String(__lastUser.text || '') : '';
  const systemInstruction = await buildSystemPrompt(supabase, channel, __lastUserText);

  // Function-calling loop (max 3 tool rounds)
  for (let round = 0; round < 3; round++) {
    const data = await generateContent({ systemInstruction, contents, tools: TOOL_DECLARATIONS });
    const parts = firstCandidateParts(data);
    const calls = parts.filter((p) => p.functionCall);

    if (calls.length === 0) {
      const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('').trim();
      return splitHandoff(text);
    }

    contents.push({ role: 'model', parts });
    const responseParts = [];
    for (const p of calls) {
      const result = await executeTool(p.functionCall.name, p.functionCall.args || {}, supabase);
      responseParts.push({ functionResponse: { name: p.functionCall.name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  // Tool rounds exhausted → one plain pass
  const last = await generateContent({ systemInstruction, contents });
  const text = firstCandidateParts(last).filter((p) => typeof p.text === 'string').map((p) => p.text).join('').trim();
  const out = splitHandoff(text);
  if (!out.text) out.handoff = true;
  return out;
}
