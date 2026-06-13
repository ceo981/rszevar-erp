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
//   gemini-2.5-flash-image          -> old Nano Banana. Fast/cheap, but DRIFTS
//                                      on jewelry design. Not recommended here.
//   gemini-3.1-flash-image-preview  -> Nano Banana 2 (Feb 2026). RECOMMENDED:
//                                      keeps input object fidelity, Flash price.
//   gemini-3-pro-image              -> Nano Banana Pro. Max fidelity, ~$0.13/img.
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
    'You are a precise virtual jewelry try-on compositor, NOT a designer.',
    'You are given TWO images.',
    'IMAGE 1 = a real jewelry PRODUCT (the exact item the customer is buying).',
    'IMAGE 2 = a photo of a person.',
    '',
    'IMPORTANT: IMAGE 1 may itself show a model or mannequin already wearing the',
    'jewelry. If so, IGNORE that model completely — do NOT copy their face, neck,',
    'skin, hair, hands, body or background. Extract ONLY the jewelry piece itself',
    'and transfer just that piece onto the person in IMAGE 2.',
    '',
    'Goal: reproduce IMAGE 2 unchanged, except the person is now wearing the',
    'jewelry from IMAGE 1, placed ' + placementClause(category),
    '',
    'CRITICAL — the jewelry must be an EXACT, FAITHFUL COPY of IMAGE 1:',
    '- Treat IMAGE 1 as the ground truth. Replicate it identically: the same',
    '  overall shape and silhouette, the same metal colour and tone, the same',
    '  number, size, colour, cut and arrangement of every stone / bead / pearl,',
    '  the same pendant(s) and charms, the same chain style and length, the same',
    '  engraving and pattern.',
    '- Do NOT redesign, restyle, beautify, simplify, recolour, add or remove any',
    '  element of the jewelry, and do NOT invent a different piece. If perfect',
    '  placement is difficult, KEEP THE EXACT DESIGN and accept a slightly less',
    '  perfect fit — design accuracy matters more than placement.',
    '- Keep its real-world scale correct relative to the body.',
    '',
    'Keep EVERYTHING ELSE identical to IMAGE 2:',
    '- Same face, identity, expression, skin tone, hair, pose, hands, clothing',
    '  and background. Change nothing about the person except adding the jewelry.',
    '',
    'Realism:',
    '- Add correct perspective, contact points and soft natural shadows where the',
    '  jewelry meets skin or clothing, and match the photo\'s lighting direction',
    '  and colour temperature so it looks genuinely worn, not pasted on.',
    '',
    'Do NOT add any text, watermark, logo, or extra jewelry.',
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
