// ============================================================================
// Kangaroo — Diagnostic / Debug endpoint
// ----------------------------------------------------------------------------
// Hits all known Kangaroo API variants with a given tracking number and
// reports exactly which one works + what the response shape looks like.
//
// USAGE:
//   GET /api/courier/kangaroo/debug?tracking=KL22919545
//
// Use this to figure out:
//   1. Which env vars are set in Vercel
//   2. Which API endpoint is actually live for you
//   3. What field contains the status (so we can map correctly)
// ============================================================================

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─── Variant A: lib/kangaroo.js — api.kangaroo.pk with username/password ──
async function variantA(tracking) {
  const out = { variant: 'A', endpoint: 'api.kangaroo.pk', auth: 'username/password' };
  const username = process.env.KANGAROO_USERNAME;
  const password = process.env.KANGAROO_PASSWORD;
  out.env_vars_present = { KANGAROO_USERNAME: !!username, KANGAROO_PASSWORD: !!password };

  if (!username || !password) {
    out.error = 'KANGAROO_USERNAME / KANGAROO_PASSWORD env vars missing';
    return out;
  }

  try {
    // Step 1: auth
    const authRes = await fetch('https://api.kangaroo.pk/auth/login', {
      method: 'POST',
      headers: {
        'Client-Service': 'kangaroo',
        'Auth-Key': 'kangaroo',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });
    out.auth_http = authRes.status;
    const authText = await authRes.text();
    try { out.auth_response = JSON.parse(authText); } catch { out.auth_raw = authText.slice(0, 300); }

    if (!authRes.ok) {
      out.error = `Auth HTTP ${authRes.status}`;
      return out;
    }

    const token = out.auth_response?.key;
    const userId = out.auth_response?.id ? String(out.auth_response.id) : null;
    if (!token) {
      out.error = 'Auth response mein "key" field nahi mili';
      return out;
    }

    // Step 2: track
    const trackRes = await fetch(`https://api.kangaroo.pk/order/track/${encodeURIComponent(tracking)}`, {
      headers: {
        'Content-Type': 'application/json',
        'Client-Service': 'kangaroo',
        'Auth-Key': 'kangaroo',
        'Auth-Token': token,
        'User-ID': userId,
      },
    });
    out.track_http = trackRes.status;
    const trackText = await trackRes.text();
    try { out.track_response = JSON.parse(trackText); } catch { out.track_raw = trackText.slice(0, 500); }

    out.works = trackRes.ok && !!out.track_response;
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

// ─── Variant B: kangarologistics.pk with Bearer token ────────────────────
async function variantB(tracking) {
  const out = { variant: 'B', endpoint: 'kangarologistics.pk', auth: 'Bearer token' };
  const apiKey = process.env.KANGAROO_API_KEY;
  out.env_vars_present = { KANGAROO_API_KEY: !!apiKey };

  if (!apiKey) {
    out.error = 'KANGAROO_API_KEY env var missing';
    return out;
  }

  try {
    const res = await fetch(`https://kangarologistics.pk/api/tracking/${encodeURIComponent(tracking)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    out.http = res.status;
    const text = await res.text();
    try { out.response = JSON.parse(text); } catch { out.raw = text.slice(0, 500); }
    out.works = res.ok && !!out.response;
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

// ─── Variant C: kangaroo.pk/orderapi.php (legacy from memory) ────────────
async function variantC(tracking) {
  const out = { variant: 'C', endpoint: 'kangaroo.pk/orderapi.php', auth: 'clientid+pass' };
  const clientid = process.env.KANGAROO_CLIENT_ID;
  const pass = process.env.KANGAROO_PASS;
  out.env_vars_present = { KANGAROO_CLIENT_ID: !!clientid, KANGAROO_PASS: !!pass };

  if (!clientid || !pass) {
    out.error = 'KANGAROO_CLIENT_ID / KANGAROO_PASS env vars missing';
    return out;
  }

  try {
    // Try POST with tracking query
    const params = new URLSearchParams({ clientid, pass, trackingno: tracking, action: 'track' });
    const res = await fetch(`https://kangaroo.pk/orderapi.php?${params.toString()}`, {
      method: 'GET',
    });
    out.http = res.status;
    const text = await res.text();
    try { out.response = JSON.parse(text); } catch { out.raw = text.slice(0, 500); }
    out.works = res.ok && !!text;
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tracking = searchParams.get('tracking');

  if (!tracking) {
    return NextResponse.json({
      success: false,
      error: 'tracking query param required',
      usage: '/api/courier/kangaroo/debug?tracking=KL22919545',
    }, { status: 400 });
  }

  const [a, b, c] = await Promise.all([
    variantA(tracking),
    variantB(tracking),
    variantC(tracking),
  ]);

  // Also list all Kangaroo-related env var names (boolean presence only — no values)
  const envSnapshot = Object.fromEntries(
    Object.keys(process.env)
      .filter(k => k.startsWith('KANGAROO'))
      .map(k => [k, true])
  );

  return NextResponse.json({
    success: true,
    tracking_tested: tracking,
    env_vars_set: envSnapshot,
    results: [a, b, c],
    next_steps: 'Find the variant where "works": true. Share its full response — main us ke hisab se sync route fix kar dunga.',
  });
}
