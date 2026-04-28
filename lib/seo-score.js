// ============================================================================
// RS ZEVAR ERP — SEO Score Engine (Phase C)
// ----------------------------------------------------------------------------
// Pure JavaScript SEO scoring. No DB, no I/O, no async — fully deterministic.
//
// Replaces the broken Supabase RPC `update_product_seo_score` which returned 100
// for all products (templated default).
//
// USAGE
//   import { calculateSeoScore } from '@/lib/seo-score';
//   const { score, tier, breakdown } = calculateSeoScore(productRow);
//
// INPUT — productRow (from `products` table, after Phase A sync)
//   {
//     parent_title:           string,
//     description_html:       string | null,
//     tags:                   string[],
//     handle:                 string | null,
//     seo_meta_title:         string | null,
//     seo_meta_description:   string | null,
//     images_data:            [{ src, alt, position, ... }, ...]
//   }
//
// OUTPUT
//   {
//     score:     0–100 (integer),
//     tier:      'green' | 'yellow' | 'red',
//     breakdown: {
//       title:           { points, max, label, note },
//       description:     { points, max, label, note },
//       meta_title:      { points, max, label, note },
//       meta_description:{ points, max, label, note },
//       alt_text:        { points, max, label, note },
//       tags:            { points, max, label, note },
//       handle:          { points, max, label, note },
//       images:          { points, max, label, note },
//     }
//   }
//
// TIERS
//   80-100  green   — solid SEO
//   60-79   yellow  — acceptable, minor gaps
//   0-59    red     — major gaps
// ============================================================================

// ── Helpers ─────────────────────────────────────────────────────────────────
function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function band(value, full, half) {
  // band(58, [50,70], [30,90]) — 58 is in full range → 1.0 (full points)
  // band(40, [50,70], [30,90]) — 40 is in half range → 0.5 (half points)
  // band(20, [50,70], [30,90]) — 20 is outside both → 0
  if (value >= full[0] && value <= full[1]) return 1.0;
  if (value >= half[0] && value <= half[1]) return 0.5;
  return 0;
}

// ── Individual criteria ─────────────────────────────────────────────────────
function scoreTitle(p) {
  const max = 10;
  const title = (p.parent_title || '').trim();
  const len = title.length;

  if (!title) {
    return { points: 0, max, label: 'Title', note: 'Missing' };
  }

  // Sweet spot: 50-70 chars (Google search snippet)
  // Acceptable: 30-49 or 71-89
  // Poor: <30 or >89
  const factor = band(len, [50, 70], [30, 89]);
  const points = Math.round(factor * max);
  const note = factor === 1
    ? `${len} chars — ideal length`
    : factor === 0.5
      ? (len < 50 ? `${len} chars — too short (aim for 50-70)` : `${len} chars — too long (aim for 50-70)`)
      : (len < 30 ? `${len} chars — far too short` : `${len} chars — far too long`);

  return { points, max, label: 'Title', note };
}

function scoreDescription(p) {
  const max = 15;
  const html = p.description_html || '';
  const text = stripHtml(html);
  const len = text.length;

  // Three sub-criteria, 5 pts each:
  //   1. Description present at all
  //   2. Length ≥ 300 chars (substantive)
  //   3. HTML formatting present (paragraphs / bold / lists — not flat text)
  let points = 0;
  const subNotes = [];

  if (len > 0) {
    points += 5;
    subNotes.push('present');
  } else {
    return { points: 0, max, label: 'Description', note: 'Missing' };
  }

  if (len >= 300) {
    points += 5;
    subNotes.push(`${len} chars`);
  } else {
    subNotes.push(`only ${len} chars (aim for 300+)`);
  }

  // Check for actual HTML formatting (not just <p> wrapper around plain text)
  const hasFormatting = /<(strong|b|ul|ol|li|h[1-6])\b/i.test(html);
  if (hasFormatting) {
    points += 5;
    subNotes.push('formatted');
  } else {
    subNotes.push('plain text — add bold/lists for scannability');
  }

  return { points, max, label: 'Description', note: subNotes.join(', ') };
}

function scoreMetaTitle(p) {
  const max = 15;
  const meta = (p.seo_meta_title || '').trim();
  const len = meta.length;

  if (!meta) {
    return { points: 0, max, label: 'Meta Title', note: 'Missing — set in Shopify SEO section' };
  }

  // Google search snippet shows ~60 chars. Sweet: 30-60. Half: 20-29 or 61-70.
  const factor = band(len, [30, 60], [20, 70]);
  const points = Math.round(factor * max);
  const note = factor === 1
    ? `${len} chars — ideal`
    : factor === 0.5
      ? `${len} chars — outside ideal 30-60 range`
      : `${len} chars — too short or too long`;

  return { points, max, label: 'Meta Title', note };
}

function scoreMetaDescription(p) {
  const max = 15;
  const meta = (p.seo_meta_description || '').trim();
  const len = meta.length;

  if (!meta) {
    return { points: 0, max, label: 'Meta Description', note: 'Missing — set in Shopify SEO section' };
  }

  // Google search snippet shows ~155 chars. Sweet: 120-160. Half: 80-119 or 161-200.
  const factor = band(len, [120, 160], [80, 200]);
  const points = Math.round(factor * max);
  const note = factor === 1
    ? `${len} chars — ideal`
    : factor === 0.5
      ? `${len} chars — outside ideal 120-160 range`
      : `${len} chars — too short or too long`;

  return { points, max, label: 'Meta Description', note };
}

function scoreAltText(p) {
  const max = 15;
  const images = Array.isArray(p.images_data) ? p.images_data : [];

  if (images.length === 0) {
    return { points: 0, max, label: 'Alt Text', note: 'No images' };
  }

  const withAlt = images.filter(img => img.alt && String(img.alt).trim().length > 0).length;
  const coverage = withAlt / images.length;

  let points;
  let note;
  if (coverage === 1) {
    points = max;
    note = `${withAlt}/${images.length} images — full coverage`;
  } else if (coverage >= 0.5) {
    points = Math.round(max * 0.5);
    note = `${withAlt}/${images.length} images — partial coverage`;
  } else {
    points = 0;
    note = `${withAlt}/${images.length} images — needs alt text`;
  }

  return { points, max, label: 'Alt Text', note };
}

function scoreTags(p) {
  const max = 10;
  const tags = Array.isArray(p.tags) ? p.tags.filter(t => t && String(t).trim()) : [];
  const count = tags.length;

  if (count === 0) {
    return { points: 0, max, label: 'Tags', note: 'No tags' };
  }

  // Sweet spot: 5-10 tags (good filter coverage without overstuffing)
  // Half: 1-4 or 11-20
  // 0: 21+ (tag stuffing penalty)
  const factor = band(count, [5, 10], [1, 20]);
  const points = Math.round(factor * max);
  const note = factor === 1
    ? `${count} tags — ideal`
    : factor === 0.5
      ? (count < 5 ? `${count} tags — add a few more (5-10 ideal)` : `${count} tags — too many (5-10 ideal)`)
      : `${count} tags — way too many (likely stuffing)`;

  return { points, max, label: 'Tags', note };
}

function scoreHandle(p) {
  const max = 10;
  const handle = (p.handle || '').trim();

  if (!handle) {
    return { points: 0, max, label: 'URL Handle', note: 'Missing' };
  }

  // Good handle: lowercase, hyphenated, 3-6 words, no stopwords
  const isLowercase = handle === handle.toLowerCase();
  const usesHyphens = !handle.includes('_') && !handle.includes(' ');
  const wordCount = handle.split('-').filter(Boolean).length;
  const STOPWORDS = ['the', 'a', 'an', 'for', 'in', 'with', 'and', 'or', 'of'];
  const hasStopwords = handle.split('-').some(w => STOPWORDS.includes(w));

  let points = 0;
  const issues = [];

  if (isLowercase) points += 3; else issues.push('uppercase');
  if (usesHyphens) points += 3; else issues.push('underscores/spaces');
  if (wordCount >= 3 && wordCount <= 6) points += 2; else issues.push(`${wordCount} words (3-6 ideal)`);
  if (!hasStopwords) points += 2; else issues.push('contains stopwords');

  const note = issues.length === 0 ? `${wordCount} words — clean` : `Issues: ${issues.join(', ')}`;

  return { points, max, label: 'URL Handle', note };
}

function scoreImages(p) {
  const max = 10;
  const count = Array.isArray(p.images_data) ? p.images_data.length : 0;

  // Sweet: ≥4 images. Half: 2-3. None: 0-1.
  let points;
  let note;
  if (count >= 4) {
    points = max;
    note = `${count} images — good coverage`;
  } else if (count >= 2) {
    points = Math.round(max * 0.5);
    note = `${count} images — add more angles (4+ ideal)`;
  } else {
    points = 0;
    note = `${count} images — far too few`;
  }

  return { points, max, label: 'Images', note };
}

// ── Main entry point ────────────────────────────────────────────────────────
export function calculateSeoScore(productRow) {
  if (!productRow || typeof productRow !== 'object') {
    return {
      score: 0,
      tier: 'red',
      breakdown: {},
    };
  }

  const breakdown = {
    title:            scoreTitle(productRow),
    description:      scoreDescription(productRow),
    meta_title:       scoreMetaTitle(productRow),
    meta_description: scoreMetaDescription(productRow),
    alt_text:         scoreAltText(productRow),
    tags:             scoreTags(productRow),
    handle:           scoreHandle(productRow),
    images:           scoreImages(productRow),
  };

  const score = Object.values(breakdown).reduce((sum, b) => sum + (b.points || 0), 0);
  const tier = score >= 80 ? 'green' : score >= 60 ? 'yellow' : 'red';

  return { score, tier, breakdown };
}

// Helper for batch operations — returns just {score, tier} (lighter payload)
export function calculateSeoScoreLight(productRow) {
  const { score, tier } = calculateSeoScore(productRow);
  return { score, tier };
}
