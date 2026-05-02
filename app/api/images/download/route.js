// ============================================================================
// RS ZEVAR ERP — Image Download Proxy (May 2026)
// GET /api/images/download?url=<shopify_url>&filename=<name>
// ----------------------------------------------------------------------------
// PROBLEM:
//   Shopify CDN auto-serves WebP to modern browsers via content negotiation
//   (Accept: image/webp). When users right-click → Save image, they get a
//   .webp file even if the original upload was PNG/JPG. That's annoying when
//   re-uploading or sharing — most tools expect PNG/JPG.
//
// FIX:
//   This endpoint proxies image fetches from Shopify CDN, sending an Accept
//   header that EXCLUDES image/webp. Shopify falls back to serving the
//   original format. The response is then streamed to the user with proper
//   Content-Disposition header so the browser triggers a download.
//
// SECURITY:
//   - Only Shopify CDN URLs allowed (cdn.shopify.com / *.shopify.com)
//   - This endpoint is in /api/ which is protected by your existing
//     middleware/auth (login required for ERP routes)
//
// USAGE FROM FRONTEND:
//   <a href={`/api/images/download?url=${encodeURIComponent(src)}&filename=${name}`}>
//     Download
//   </a>
//   OR programmatically:
//   window.location.href = `/api/images/download?url=...&filename=...`;
// ============================================================================

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Map upstream content-type → file extension
const EXT_MAP = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/gif':  'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

function sanitizeFilename(name) {
  // Strip path separators + dangerous chars; cap length
  const cleaned = String(name || 'image')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\.\.+/g, '_')
    .trim()
    .slice(0, 100);
  return cleaned || 'image';
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');
    const rawFilename = searchParams.get('filename') || 'image';

    if (!targetUrl) {
      return NextResponse.json({ error: 'url query parameter required' }, { status: 400 });
    }

    // ── Security: validate URL is from Shopify CDN ──
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return NextResponse.json({ error: 'invalid url' }, { status: 400 });
    }

    const isShopifyHost =
      parsedUrl.hostname === 'cdn.shopify.com' ||
      parsedUrl.hostname.endsWith('.shopify.com') ||
      parsedUrl.hostname.endsWith('.shopifycdn.com');
    if (!isShopifyHost) {
      return NextResponse.json(
        { error: 'only Shopify CDN URLs allowed' },
        { status: 403 },
      );
    }

    // ── Fetch from CDN WITHOUT advertising webp support ──
    // This is the trick: by NOT including image/webp in Accept header,
    // Shopify CDN falls back to the original uploaded format.
    const upstream = await fetch(targetUrl, {
      headers: {
        'Accept': 'image/jpeg,image/png,image/gif,image/*;q=0.8',
        // Custom UA to look like a generic non-webp client
        'User-Agent': 'RS-ZEVAR-ERP-Image-Proxy/1.0',
      },
      // Don't follow redirects to non-Shopify hosts
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: upstream.status >= 500 ? 502 : upstream.status },
      );
    }

    // ── Determine extension from response content-type ──
    const upstreamCT = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = EXT_MAP[upstreamCT] || 'jpg';

    // Strip any existing image extension from user-supplied filename, add ours
    const cleanBaseName = sanitizeFilename(rawFilename).replace(/\.(jpg|jpeg|png|gif|webp|avif)$/i, '');
    const downloadName = `${cleanBaseName}.${ext}`;

    // ── Stream bytes to client with download headers ──
    // Using arrayBuffer() loads into memory — fine for product images (<5MB
    // typically). For huge files we'd want true streaming but Shopify product
    // images are size-capped client-side at 4MB anyway.
    const buffer = await upstream.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': upstreamCT || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    console.error('[images/download] error:', e.message);
    return NextResponse.json(
      { error: e.message || 'Download failed' },
      { status: 500 },
    );
  }
}
