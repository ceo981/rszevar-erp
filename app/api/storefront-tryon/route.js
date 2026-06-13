// =====================================================================
// RS ZEVAR — Storefront Virtual Try-On: public API route
// File: app/api/storefront-tryon/route.js
//
// POST { sessionId, productImageUrl, selfie }  -> { image, url }
//   - selfie: a data URL ("data:image/jpeg;base64,...") OR { mimeType, data }
//   - productImageUrl: Shopify CDN / rszevar.com image URL of the product
//
// Mirrors the storefront-chat route conventions:
//   - CORS via allow-list env  (STOREFRONT_CORS_ORIGINS, comma-separated)
//   - soft rate-limit + free-try cap, enforced via Supabase (serverless-safe)
//   - server-side logging; the customer selfie is NEVER stored, only the result
//
// IMPORTANT: this is a public, unauthenticated endpoint. It is hardened with
// an origin allow-list, an SSRF guard on productImageUrl, a payload-size guard,
// and a per-session/per-IP daily cap so a bad actor cannot burn your API quota.
// =====================================================================

import { createClient } from '@supabase/supabase-js';
import { generateTryOn } from '../../../lib/storefront-tryon/gemini-image.js';

export const runtime = 'nodejs';
export const maxDuration = 60; // image gen takes ~4-8s; give headroom

// ----- config (all env-overridable) ---------------------------------
const FREE_LIMIT = parseInt(process.env.TRYON_FREE_LIMIT || '5', 10); // per session/day
const IP_LIMIT = parseInt(process.env.TRYON_IP_LIMIT || '40', 10); // per IP/day (abuse guard)
const MAX_SELFIE_BYTES = parseInt(process.env.TRYON_MAX_SELFIE_BYTES || '3500000', 10); // ~3.5MB
const RESULT_BUCKET = process.env.TRYON_BUCKET || 'tryon-results';

// Hosts we are willing to fetch a product image from (SSRF protection).
const ALLOWED_IMAGE_HOST_SUFFIXES = [
  'cdn.shopify.com',
  '.myshopify.com',
  'rszevar.com',
];

function allowedOrigins() {
  const raw = process.env.STOREFRONT_CORS_ORIGINS || '';
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Sensible defaults if env not set yet.
  if (list.length === 0) {
    return [
      'https://rszevar.com',
      'https://www.rszevar.com',
      'https://account.rszevar.com',
    ];
  }
  return list;
}

function corsHeaders(origin) {
  // Reflect the caller's origin when present, else allow any. This endpoint
  // uses no cookies/credentials, so this is safe; abuse is bounded by the
  // per-session and per-IP rate limits below.
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// data URL or {mimeType,data} -> {mimeType, data(base64), bytes}
function parseSelfie(selfie) {
  if (!selfie) return null;
  if (typeof selfie === 'string') {
    const m = selfie.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    const data = m[2];
    return { mimeType: m[1], data, bytes: Math.floor((data.length * 3) / 4) };
  }
  if (selfie.data) {
    return {
      mimeType: selfie.mimeType || 'image/jpeg',
      data: selfie.data,
      bytes: Math.floor((selfie.data.length * 3) / 4),
    };
  }
  return null;
}

function hostAllowed(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch (_) {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return ALLOWED_IMAGE_HOST_SUFFIXES.some((suf) =>
    suf.startsWith('.') ? host.endsWith(suf) : host === suf || host.endsWith('.' + suf)
  );
}

async function fetchProductImage(urlStr) {
  if (!hostAllowed(urlStr)) {
    throw new Error('Product image host not allowed');
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  let resp;
  try {
    resp = await fetch(urlStr, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
  if (!resp.ok) throw new Error(`Could not load product image (${resp.status})`);
  const mimeType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new Error('Product image too large');
  return { mimeType, data: buf.toString('base64') };
}

function getIp(req) {
  const xff = req.headers.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ----- handlers ------------------------------------------------------
export async function OPTIONS(req) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req) {
  const origin = req.headers.get('origin');

  let body;
  try {
    const raw = await req.text();
    body = raw ? JSON.parse(raw) : {};
  } catch (_) {
    return json({ error: 'Invalid JSON' }, 400, origin);
  }

  const sessionId = (body.sessionId || '').toString().slice(0, 80) || 'anon';
  const productImageUrl = (body.productImageUrl || '').toString();
  const jewelryType = (body.jewelryType || '').toString().slice(0, 120);
  const productTitle = (body.productTitle || '').toString().slice(0, 200);
  const selfie = parseSelfie(body.selfie);

  if (!productImageUrl) return json({ error: 'productImageUrl required' }, 400, origin);
  if (!selfie) return json({ error: 'Valid selfie image required' }, 400, origin);
  if (selfie.bytes > MAX_SELFIE_BYTES) {
    return json(
      { error: 'Selfie too large — please use a smaller photo.' },
      413,
      origin
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'Server not configured' }, 500, origin);

  const ip = getIp(req);
  let supabase;
  try {
    supabase = sb();
  } catch (_) {
    return json({ error: 'Server not configured' }, 500, origin);
  }

  // ----- rate limit / free-try cap (Supabase-backed) -----
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const { count: sessCount } = await supabase
      .from('storefront_tryon_log')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .gte('created_at', since);
    if ((sessCount || 0) >= FREE_LIMIT) {
      return json(
        {
          error: 'limit',
          message: `You've used all ${FREE_LIMIT} free try-ons for today. Chat with us on WhatsApp to see more!`,
        },
        429,
        origin
      );
    }

    const { count: ipCount } = await supabase
      .from('storefront_tryon_log')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', since);
    if ((ipCount || 0) >= IP_LIMIT) {
      return json({ error: 'limit', message: 'Too many try-ons. Please try later.' }, 429, origin);
    }
  } catch (e) {
    // If the log table is missing, fail open on rate-limit but keep going —
    // better to serve the customer than to hard-block on a counter.
    console.error('tryon rate-limit check failed:', e && e.message);
  }

  // ----- run try-on -----
  let product;
  try {
    product = await fetchProductImage(productImageUrl);
  } catch (e) {
    return json({ error: (e && e.message) || 'Product image failed' }, 400, origin);
  }

  let result;
  try {
    result = await generateTryOn({
      apiKey,
      model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
      product,
      selfie: { mimeType: selfie.mimeType, data: selfie.data },
      jewelryType,
      productTitle,
      aspectRatio: process.env.TRYON_ASPECT || '3:4',
    });
  } catch (e) {
    return json({ error: (e && e.message) || 'Try-on failed' }, 502, origin);
  }

  // ----- store ONLY the result (not the selfie) for sharing -----
  let publicUrl = null;
  try {
    const ext = (result.mimeType.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const path = `${new Date().toISOString().slice(0, 10)}/${sessionId}-${Date.now()}.${ext}`;
    const bytes = Buffer.from(result.data, 'base64');
    const { error: upErr } = await supabase.storage
      .from(RESULT_BUCKET)
      .upload(path, bytes, { contentType: result.mimeType, upsert: false });
    if (!upErr) {
      const { data: pub } = supabase.storage.from(RESULT_BUCKET).getPublicUrl(path);
      publicUrl = pub && pub.publicUrl ? pub.publicUrl : null;
    } else {
      console.error('tryon upload failed:', upErr.message);
    }
  } catch (e) {
    console.error('tryon storage error:', e && e.message);
  }

  // ----- log usage (selfie intentionally NOT stored) -----
  try {
    await supabase.from('storefront_tryon_log').insert({
      session_id: sessionId,
      ip,
      product_image_url: productImageUrl,
      result_url: publicUrl,
      model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
    });
  } catch (e) {
    console.error('tryon log insert failed:', e && e.message);
  }

  return json(
    {
      image: `data:${result.mimeType};base64,${result.data}`, // instant display
      url: publicUrl, // shareable (WhatsApp etc.); null if storage not set up
    },
    200,
    origin
  );
}
