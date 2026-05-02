// ============================================================================
// RS ZEVAR ERP — Customer Credits — Receipt Screenshot Upload
// POST /api/credits/upload-receipt
// May 2 2026 · Step 3 of 6 · File 5 of 5
// ----------------------------------------------------------------------------
// PURPOSE:
//   Accepts a base64-encoded image from the payment record modal, uploads
//   it to Supabase Storage `payment-receipts` bucket, and returns a signed
//   URL that the caller stores on customer_payments.receipt_url.
//
// WHY BASE64 INSTEAD OF MULTIPART FORM:
//   - Matches existing pattern in this codebase (inventory image uploads,
//     expense bills) — frontend already has client-side compression utility
//     that produces base64 dataURL.
//   - Vercel 4.5MB body limit applies — frontend compresses first.
//
// REQUEST BODY:
//   {
//     filename: "receipt.jpg",         (client provides)
//     attachment: "data:image/jpeg;base64,...",   (data URL from FileReader)
//     customer_phone: "03001234567"    (used in storage path for organization)
//   }
//
// RESPONSE:
//   {
//     success: true,
//     storage_path: "saima-wholesale/2026-05-02-uuid.jpg",
//     signed_url: "https://...supabase.co/storage/v1/object/sign/...",
//     expires_at: "2026-05-02T..."   // 1 year from now
//   }
//
// NOTE:
//   Bucket is private. We return a long-lived signed URL (1 year) for
//   convenience — it can be regenerated via separate signed-url endpoint
//   if needed. Stored URL goes in customer_payments.receipt_url.
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BUCKET = 'payment-receipts';
const MAX_BYTES = 5 * 1024 * 1024;  // 5 MB

function sanitizePathSegment(s) {
  return String(s || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'customer';
}

function extFromMime(mime) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg':  'jpg',
    'image/png':  'png',
    'image/webp': 'webp',
  };
  return map[mime] || 'jpg';
}

export async function POST(request) {
  try {
    const body = await request.json();
    const filename = body.filename || 'receipt';
    const attachment = body.attachment || '';
    const phone = (body.customer_phone || 'unknown').trim();

    if (!attachment || !attachment.startsWith('data:image/')) {
      return NextResponse.json(
        { success: false, error: 'attachment must be a base64 image data URL' },
        { status: 400 },
      );
    }

    // Parse data URL: "data:image/jpeg;base64,/9j/4AAQ..."
    const match = attachment.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!match) {
      return NextResponse.json(
        { success: false, error: 'Invalid data URL format' },
        { status: 400 },
      );
    }
    const mimeType = match[1].toLowerCase();
    const base64Body = match[2];

    // Validate MIME against bucket whitelist
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mimeType)) {
      return NextResponse.json(
        { success: false, error: `Unsupported MIME type: ${mimeType}` },
        { status: 400 },
      );
    }

    // Decode + size check
    const buffer = Buffer.from(base64Body, 'base64');
    if (buffer.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Empty file' },
        { status: 400 },
      );
    }
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: `File too large (${(buffer.length / 1024 / 1024).toFixed(2)}MB > 5MB limit)` },
        { status: 413 },
      );
    }

    // Build storage path: <phone-slug>/<YYYY-MM-DD>-<short-uuid>.<ext>
    const phoneSlug = sanitizePathSegment(phone);
    const datePrefix = new Date().toISOString().slice(0, 10);  // 2026-05-02
    const uniqueId = Math.random().toString(36).slice(2, 10);
    const ext = extFromMime(mimeType);
    const storagePath = `${phoneSlug}/${datePrefix}-${uniqueId}.${ext}`;

    // Upload to Supabase Storage
    const supabase = createServerClient();
    const { error: uploadErr } = await supabase
      .storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,  // never overwrite — uniqueId guarantees fresh path
      });

    if (uploadErr) {
      throw new Error(`Storage upload failed: ${uploadErr.message}`);
    }

    // Generate signed URL (1 year — long-lived for receipt viewing)
    const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
    const { data: signedData, error: signErr } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUrl(storagePath, ONE_YEAR_SECONDS);

    if (signErr || !signedData?.signedUrl) {
      // Upload succeeded but signing failed — still return path so caller
      // can request a fresh signed URL later.
      console.warn('[upload-receipt] sign URL failed:', signErr?.message);
      return NextResponse.json({
        success: true,
        storage_path: storagePath,
        signed_url: null,
        warning: 'Upload OK but signed URL generation failed — request fresh URL via /api/credits/receipt-url',
      });
    }

    const expiresAt = new Date(Date.now() + ONE_YEAR_SECONDS * 1000).toISOString();

    return NextResponse.json({
      success: true,
      storage_path: storagePath,
      signed_url: signedData.signedUrl,
      expires_at: expiresAt,
      size_bytes: buffer.length,
    });
  } catch (e) {
    console.error('[POST /api/credits/upload-receipt] error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
