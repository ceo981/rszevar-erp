/**
 * POST /api/whatsapp/inbox/send-media
 * ===================================
 * Send an image / video / audio (incl. voice note) / document to a customer.
 * Accepts multipart/form-data with these fields:
 *   file                — the binary file (required)
 *   conversation_id     — target conversation UUID (required, or phone)
 *   phone               — alternative to conversation_id
 *   caption             — optional caption (image/video/document only)
 *   voice               — 'true' for voice note (audio only; renders as PTT on WhatsApp)
 *
 * SECURITY (May 2026):
 *   /api/whatsapp/* is exempted from middleware auth (Meta webhook needs that).
 *   Lekin yeh send route admin-only honi chahiye. Pehle koi bhi attacker
 *   multipart POST karke arbitrary images/videos customers ko bhej sakta tha
 *   RS ZEVAR ke business number se. Ab session-based auth check enforced hai,
 *   aur sent_by_user_id session se aata hai (impersonation-proof).
 *
 * Flow:
 *   0. Auth check (NEW)
 *   1. Validate file & size (per-type limits).
 *   2. Infer `type` from mime (image/video/audio/document).
 *   3. Upload file to Meta /media → get media_id.
 *   4. Send message via Meta /messages using that media_id.
 *   5. Cache file in Supabase Storage so our UI renders it immediately.
 *   6. Save outgoing message row with media_url + media_id in metadata.
 *
 * Note: Meta still enforces the 24hr customer-service window. Outside
 * that window, media sends will fail with error (131047 / 131026-ish).
 * For first-contact media, use templates instead (not this endpoint).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createAuthClient } from '@/lib/supabase/server';
import { sendMedia } from '../../../../../lib/whatsapp';
import { uploadMediaToMeta, cacheOutboundMediaBuffer } from '../../../../../lib/whatsapp-media';
import { handleOutgoingMessage } from '../../../../../lib/whatsapp-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Vercel body limit default 4.5MB — bump where needed. For safety we cap at 16MB.
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// WhatsApp Meta's per-type size limits (approximate, Meta publishes these)
const SIZE_LIMITS = {
  image:    5 * 1024 * 1024,     // 5 MB
  video:   16 * 1024 * 1024,     // 16 MB
  audio:   16 * 1024 * 1024,     // 16 MB
  document:16 * 1024 * 1024,     // 16 MB (Meta allows 100 MB but Vercel FnReq body limit is much lower)
  sticker:  0.5 * 1024 * 1024,   // 500 KB (animated is 500 KB, static 100 KB)
};

// Allowed mime types per WhatsApp spec (abridged but covers 99% of cases)
const MIME_TO_TYPE = (mime) => {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  if (m.startsWith('image/')) {
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(m)) return 'image';
    return null;
  }
  if (m.startsWith('video/')) {
    if (['video/mp4', 'video/3gpp'].includes(m)) return 'video';
    return null;
  }
  if (m.startsWith('audio/')) {
    // Meta accepts aac / mp4 / mpeg / amr / ogg (codecs=opus) / opus
    // Voice recordings in the browser usually come as audio/webm;codecs=opus.
    // Meta doesn't officially list webm. We'll remap to audio/ogg with opus
    // if needed — but for now accept webm and let Meta try.
    return 'audio';
  }
  // Everything else → document
  return 'document';
};

export async function POST(request) {
  try {
    // ── SECURITY FIX (May 2026) — Explicit auth check ─────────────────────
    // Mirror of the same check on /api/whatsapp/inbox/send. Middleware bypass
    // /api/whatsapp/* ke liye legitimate hai (Meta webhook), but media send
    // ko bhi anonymous nahi hona chahiye. Session se logged-in user uthate
    // hain, profile is_active verify karte hain, aur sent_by_user_id session
    // se derive karte hain (form fields se nahi).
    const authClient = await createAuthClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || profile.is_active === false) {
      return NextResponse.json(
        { success: false, error: 'Account not active' },
        { status: 403 }
      );
    }

    const sentByUserId = user.id;
    const sentByEmail  = profile.email || user.email || null;

    const form = await request.formData();
    const file = form.get('file');
    const conversation_id = form.get('conversation_id');
    const phoneRaw = form.get('phone');
    const caption = (form.get('caption') || '').toString().slice(0, 1024);
    const isVoice = String(form.get('voice') || '').toLowerCase() === 'true';
    // SECURITY: form ke user_id / user_email IGNORE karte hain — session se
    // derive karte hain. Frontend galti se bhi bheje to no impact.

    if (!file || typeof file === 'string') {
      return NextResponse.json({ success: false, error: 'file is required (multipart/form-data)' }, { status: 400 });
    }

    const originalName = file.name || 'upload';
    let mimeType = file.type || 'application/octet-stream';
    const size = file.size || 0;

    // Infer type
    const type = MIME_TO_TYPE(mimeType);
    if (!type) {
      return NextResponse.json({ success: false, error: `Unsupported file type: ${mimeType}` }, { status: 400 });
    }

    // Size check
    const limit = SIZE_LIMITS[type] || 5 * 1024 * 1024;
    if (size > limit) {
      return NextResponse.json({
        success: false,
        error: `File too large (${Math.round(size / 1024 / 1024)}MB). Max for ${type}: ${Math.round(limit / 1024 / 1024)}MB`,
      }, { status: 413 });
    }

    // For voice notes recorded in browser as audio/webm;codecs=opus,
    // Meta is picky — re-label as audio/ogg to increase acceptance odds.
    let effectiveMime = mimeType;
    if (isVoice && mimeType.includes('webm')) {
      effectiveMime = 'audio/ogg; codecs=opus';
    }

    // Resolve phone
    let phone = phoneRaw;
    if (!phone && conversation_id) {
      const { data: conv } = await supabase
        .from('whatsapp_conversations')
        .select('customer_phone')
        .eq('id', conversation_id)
        .maybeSingle();
      phone = conv?.customer_phone;
    }
    if (!phone) {
      return NextResponse.json({ success: false, error: 'No recipient (provide conversation_id or phone)' }, { status: 400 });
    }

    // Read file into buffer
    const arrayBuf = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    // ── 1) Upload to Meta to get media_id ──
    const uploadResult = await uploadMediaToMeta(buffer, {
      filename: originalName,
      mimeType: effectiveMime,
    });
    if (!uploadResult.ok) {
      return NextResponse.json({
        success: false,
        error: `Meta media upload failed: ${uploadResult.reason}`,
      }, { status: 502 });
    }

    // ── 2) Send message referencing media_id ──
    const sendResult = await sendMedia(phone, {
      type,
      media_id: uploadResult.media_id,
      caption: (type === 'image' || type === 'video' || type === 'document') ? caption || undefined : undefined,
      filename: type === 'document' ? originalName : undefined,
      voice: type === 'audio' ? isVoice : undefined,
    });

    if (!sendResult.sent) {
      return NextResponse.json({
        success: false,
        error: sendResult.reason || 'WhatsApp send failed',
        hint: 'Most likely outside 24hr customer-service window — use a template instead.',
      }, { status: 502 });
    }

    // ── 3) Cache file in Supabase Storage for our UI ──
    const cached = await cacheOutboundMediaBuffer(buffer, {
      conversationId: conversation_id || null,
      filename: originalName,
      mimeType,
      messageType: type,
    });

    // ── 4) Save outgoing message row ──
    const savedMetadata = {
      media_id: uploadResult.media_id,
      media_url: cached?.public_url || null,
      storage_path: cached?.storage_path || null,
      mime_type: mimeType,
      filename: originalName,
      size,
      ...(isVoice ? { voice: true } : {}),
      ...(caption ? { caption } : {}),
      ...(sentByEmail ? { sent_by_email: sentByEmail } : {}),
    };

    const saved = await handleOutgoingMessage({
      phone,
      message_type: type,
      body: caption || null,
      wa_message_id: sendResult.message_id,
      sent_by_user_id: sentByUserId,
      sent_by_system: false,
      metadata: savedMetadata,
    });

    return NextResponse.json({
      success: true,
      message_id: sendResult.message_id,
      conversation_id: saved?.conversationId || conversation_id,
      media_url: cached?.public_url || null,
      type,
    });
  } catch (e) {
    console.error('[inbox/send-media] error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
