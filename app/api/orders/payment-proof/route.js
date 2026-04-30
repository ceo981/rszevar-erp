// ============================================================================
// RS ZEVAR ERP — Payment proof upload (Apr 30 2026)
// POST /api/orders/payment-proof   (multipart/form-data)
// ----------------------------------------------------------------------------
// Uploads a screenshot (typically of a bank/wallet transaction) to Supabase
// Storage and returns the public URL. Used by the order detail page's
// "Collect payment" flow when staff selects a digital payment method
// (Bank Alfalah / Meezan / Easypaisa / JazzCash) — they can attach the proof
// here before the actual mark-as-paid call.
//
// Bucket: re-uses the existing `expense-bills` public bucket (already
// configured in Supabase, 50MB limit, public read). Files go under the
// `payment-proofs/` subfolder so they're easy to filter from expense bills.
//
// Why no new bucket?
//   Adding a new bucket requires manual Supabase setup. Until that becomes a
//   priority, the existing public bucket works fine — staff already have the
//   `expense-bills` bucket configured and the access semantics are identical.
//
// Auth note: this route is open to anyone with an authenticated session in
// the ERP (same pattern as expense-bills upload). Storage policy controls
// access.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const BUCKET = 'expense-bills';   // shared with operations expense bills
const SUBFOLDER = 'payment-proofs';
const MAX_BYTES = 10 * 1024 * 1024;   // 10MB — proof screenshots are small
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const orderNumber = formData.get('order_number') || 'unknown';

    if (!file || typeof file === 'string') {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: `File too large (max ${MAX_BYTES / 1024 / 1024}MB)` },
        { status: 400 },
      );
    }

    if (file.type && !ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: `Invalid file type: ${file.type}. Use JPG/PNG/PDF.` },
        { status: 400 },
      );
    }

    const ext = (file.name?.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'bin'}`;
    // Path includes order number for easy retrieval / audit
    const safeOrderNumber = String(orderNumber).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
    const filePath = `${SUBFOLDER}/${safeOrderNumber}/${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const { data: uploadData, error: uploadErr } = await supabase
      .storage
      .from(BUCKET)
      .upload(filePath, arrayBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json({
        success: false,
        error: `Upload failed: ${uploadErr.message}. Bucket "${BUCKET}" public hai check karo.`,
      }, { status: 500 });
    }

    const { data: publicData } = supabase
      .storage
      .from(BUCKET)
      .getPublicUrl(uploadData.path);

    return NextResponse.json({
      success: true,
      url: publicData.publicUrl,
      path: uploadData.path,
    });
  } catch (e) {
    console.error('[payment-proof] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
