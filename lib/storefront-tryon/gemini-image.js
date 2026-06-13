// =====================================================================
// RS ZEVAR — Storefront Virtual Try-On: Gemini Image REST wrapper
// File: lib/storefront-tryon/gemini-image.js
//
// No SDK dependency — plain fetch against the AI Studio Gemini REST API.
// Takes the PRODUCT image + the CUSTOMER photo and returns a single
// photorealistic image of the customer wearing the exact jewelry.
//
// Prompt is now JEWELRY-TYPE AWARE: necklace -> neck, earrings -> ears,
// ring -> finger, bangle/bracelet -> wrist, bridal/set -> full set.
//
// Model is env-configurable (GEMINI_IMAGE_MODEL).
//   default  -> gemini-2.5-flash-image   (~$0.039/img, fast, cheap)
//   upgrade  -> gemini-3.1-flash-image   (2K, better realism, costlier)
// =====================================================================

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Decide the body-placement instruction from product type + title keywords.
// Robust: checks both the Shopify product.type and the title text.
function detectCategory(jewelryType, productTitle) {
  const s = ((jewelryType || '') + ' ' + (productTitle || '')).toLowerCase();
  if (/(earring|ear ring|jhumk|jhumka|jhumke|stud|tops|bali|bujli)/.test(s)) return 'ears';
  if (/(\bring\b|anguthi|angoothi)/.test(s)) return 'finger';
  if (/(bangle|kara|kangan|kangna|bracelet|choor|chur|churi)/.test(s)) return 'wrist';
  if (/(bridal|jewellery set|jewelry set|\bset\b|dulhan|barat|nikkah|nikah)/.test(s)) return 'set';
  if (/(necklace|pendant|choker|chain|locket|mala|haar|rani haar|maala)/.test(s)) return 'neck';
  return 'generic';
}

function placementClause(category) {
  switch (category) {
    case 'ears':
      return 'on the person\'s ear lobes (both ears if both are visible), hanging naturally.';
    case 'finger':
      return 'on a finger of the hand shown in the photo, sized and angled naturally on the finger.';
    case 'wrist':
      return 'around the wrist of the hand/arm shown in the photo, sitting naturally on the wrist.';
    case 'set':
      return 'as a complete matching set in their correct positions (necklace around the neck, earrings on the ears, and any head/forehead piece on the hairline), all worn together naturally.';
    case 'neck':
      return 'around the person\'s neck, resting naturally on the collarbone/décolletage with correct drape, length and shadows.';
    default:
      return 'in its natural worn position on the person, placed realistically.';
  }
}

function buildPrompt(category) {
  return [
    'You are a professional jewelry try-on photo editor.',
    'You are given TWO images.',
    'The FIRST image is a piece of jewelry.',
    'The SECOND image is a photo of a person.',
    '',
    'Task: edit the SECOND photo so the person is naturally wearing the EXACT',
    'jewelry from the FIRST image, placed ' + placementClause(category),
    '',
    'Strict requirements:',
    '- Reproduce the jewelry design, shape, colour, metal tone, stones, pattern',
    '  and proportions EXACTLY as shown in the first image. Do NOT redesign,',
    '  simplify, recolour or invent any part of it.',
    '- Keep the person\'s face, identity, expression, hairstyle, skin tone, pose,',
    '  hands, clothing and background completely unchanged.',
    '- Place it realistically with correct scale, perspective and soft natural',
    '  shadows where it meets skin/clothing.',
    '- Match the lighting direction and colour temperature of the person\'s photo',
    '  so the jewelry looks genuinely worn, not pasted on.',
    '- Do NOT add any text, watermark, logo, or extra jewelry.',
    '',
    'Output exactly one photorealistic image and nothing else.',
  ].join('\n');
}

// generateTryOn -> { mimeType, data } (base64) of result image.
export async function generateTryOn({
  apiKey,
  model,
  product,
  selfie,
  jewelryType,
  productTitle,
  prompt,
  aspectRatio = '3:4',
  timeoutMs = 50000,
}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  if (!product || !product.data) throw new Error('product image missing');
  if (!selfie || !selfie.data) throw new Error('selfie image missing');

  const usedModel = model || 'gemini-2.5-flash-image';
  const category = detectCategory(jewelryType, productTitle);
  // Priority: explicit prompt arg > TRYON_PROMPT env (advanced override) > built type-aware prompt.
  const finalPrompt = prompt || process.env.TRYON_PROMPT || buildPrompt(category);

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
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') throw new Error('Try-on timed out. Please try again.');
    throw err;
  }
  clearTimeout(timer);

  const raw = await resp.text();
  if (!resp.ok) {
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
    (json && json.candidates && json.candidates[0] && json.candidates[0].content &&
      json.candidates[0].content.parts) || [];

  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    if (inline && inline.data) {
      return { mimeType: inline.mimeType || inline.mime_type || 'image/png', data: inline.data };
    }
  }

  const finishReason =
    json && json.candidates && json.candidates[0] &&
    (json.candidates[0].finishReason || json.candidates[0].finish_reason);
  throw new Error(
    finishReason
      ? `No image generated (reason: ${finishReason}). Try a clearer, well-lit photo.`
      : 'No image generated. Try a clearer, well-lit photo.'
  );
}
