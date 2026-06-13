// =====================================================================
// RS ZEVAR — Storefront Virtual Try-On: Gemini Image REST wrapper
// File: lib/storefront-tryon/gemini-image.js
//
// No SDK dependency — plain fetch against the AI Studio Gemini REST API.
// Takes the PRODUCT image + the CUSTOMER selfie and returns a single
// photorealistic image of the customer wearing the exact necklace.
//
// Model is env-configurable (GEMINI_IMAGE_MODEL).
//   default  -> gemini-2.5-flash-image   (~$0.039/img, fast, cheap)
//   upgrade  -> gemini-3.1-flash-image   (2K, better realism, costlier)
// Swap without touching code — same pattern as the chatbot's GEMINI_MODEL.
// =====================================================================

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Strong default prompt tuned for jewelry try-on realism + design fidelity.
// Override entirely via TRYON_PROMPT env if you want to tweak tone/rules
// without redeploying code.
const DEFAULT_PROMPT = [
  'You are a professional jewelry try-on photo editor.',
  'You are given TWO images.',
  'The FIRST image is a piece of jewelry — a necklace.',
  'The SECOND image is a photo of a person.',
  '',
  'Task: edit the SECOND photo so the person is naturally wearing the EXACT',
  'necklace from the FIRST image around their neck.',
  '',
  'Strict requirements:',
  '- Reproduce the necklace design, shape, colour, metal tone, stones, pendant',
  '  and length EXACTLY as shown in the first image. Do NOT redesign, simplify,',
  '  recolour or invent any part of it.',
  '- Keep the person\'s face, identity, expression, hairstyle, skin tone, pose,',
  '  clothing and background completely unchanged.',
  '- Place the necklace realistically on the neckline with correct drape, scale,',
  '  perspective and natural soft shadows where it meets skin/clothing.',
  '- Match the lighting direction and colour temperature of the person\'s photo so',
  '  the necklace looks genuinely worn, not pasted on.',
  '- Do NOT add any text, watermark, logo, or extra jewelry.',
  '',
  'Output exactly one photorealistic image and nothing else.',
].join('\n');

// generateTryOn: single call -> returns { mimeType, data } (base64) of result.
//   apiKey       : Gemini API key
//   model        : model id (e.g. gemini-2.5-flash-image)
//   product      : { mimeType, data }  base64, the necklace product image
//   selfie       : { mimeType, data }  base64, the customer photo
//   prompt       : optional override string
//   aspectRatio  : '3:4' portrait by default (good for neck/portrait shots)
//   timeoutMs    : hard timeout (default 50s, under Vercel's 60s ceiling)
export async function generateTryOn({
  apiKey,
  model,
  product,
  selfie,
  prompt,
  aspectRatio = '3:4',
  timeoutMs = 50000,
}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  if (!product || !product.data) throw new Error('product image missing');
  if (!selfie || !selfie.data) throw new Error('selfie image missing');

  const usedModel = model || 'gemini-2.5-flash-image';
  const finalPrompt = prompt || process.env.TRYON_PROMPT || DEFAULT_PROMPT;

  // Order matters: prompt references "FIRST image" = product, "SECOND" = selfie.
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: finalPrompt },
          { inline_data: { mime_type: product.mimeType || 'image/jpeg', data: product.data } },
          { inline_data: { mime_type: selfie.mimeType || 'image/jpeg', data: selfie.data } },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp;
  try {
    resp = await fetch(
      `${ENDPOINT}/${encodeURIComponent(usedModel)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new Error('Try-on timed out. Please try again.');
    }
    throw err;
  }
  clearTimeout(timer);

  const raw = await resp.text();
  if (!resp.ok) {
    // Surface Gemini's error message but keep it short for the client.
    let msg = `Gemini error ${resp.status}`;
    try {
      const j = JSON.parse(raw);
      if (j && j.error && j.error.message) msg += `: ${j.error.message}`;
    } catch (_) {}
    throw new Error(msg);
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (_) {
    throw new Error('Bad response from Gemini (not JSON)');
  }

  const parts =
    (json &&
      json.candidates &&
      json.candidates[0] &&
      json.candidates[0].content &&
      json.candidates[0].content.parts) ||
    [];

  for (const part of parts) {
    // REST may return camelCase (inlineData) or snake_case (inline_data).
    const inline = part.inlineData || part.inline_data;
    if (inline && inline.data) {
      return {
        mimeType: inline.mimeType || inline.mime_type || 'image/png',
        data: inline.data,
      };
    }
  }

  // No image came back — usually a safety block or a refusal. Report cleanly.
  const finishReason =
    json &&
    json.candidates &&
    json.candidates[0] &&
    (json.candidates[0].finishReason || json.candidates[0].finish_reason);
  throw new Error(
    finishReason
      ? `No image generated (reason: ${finishReason}). Try a clearer, well-lit selfie.`
      : 'No image generated. Try a clearer, well-lit selfie.'
  );
}
