/**
 * RS ZEVAR ERP — WhatsApp Media Helpers
 * =====================================
 * Download inbound media from Meta (auth-required, URL expires ~5 min)
 * and cache it in Supabase Storage (public bucket: `whatsapp-media`).
 *
 * Also uploads OUTGOING media to Meta for sending via the Cloud API
 * (Meta ka /PHONE_NUMBER_ID/media endpoint).
 *
 * Setup required once (run in Supabase SQL editor):
 * ------------------------------------------------------------
 *   -- 1) Create the bucket (public so rendering <img>/<audio> works)
 *   insert into storage.buckets (id, name, public)
 *   values ('whatsapp-media', 'whatsapp-media', true)
 *   on conflict (id) do update set public = true;
 *
 *   -- 2) Allow service role full access (it already is, but explicit)
 *   --    and allow anonymous SELECT so the URL works without auth
 *   create policy "WA media public read"
 *     on storage.objects for select
 *     using (bucket_id = 'whatsapp-media');
 * ------------------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js';

const META_API_VERSION = 'v20.0';
const BUCKET = 'whatsapp-media';

// Server-side supabase client (service role)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Extension helper ───────────────────────────────────────────────────────
function extensionForMime(mime = '') {
  if (!mime) return 'bin';
  const m = mime.split(';')[0].trim().toLowerCase();
  const map = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/aac': 'aac',
    'audio/ogg': 'ogg', 'audio/opus': 'opus',
    'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/mp4': 'm4a',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'application/zip': 'zip',
  };
  return map[m] || (m.split('/')[1] || 'bin');
}

function sanitizeFilename(name = 'file') {
  return String(name)
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 80) || 'file';
}

// ─── Download inbound media from Meta ───────────────────────────────────────
/**
 * Takes a Meta media_id, fetches its temp URL + binary, uploads to Supabase
 * Storage, returns { public_url, storage_path, mime_type, size }.
 * Returns null on any failure (non-throwing).
 */
export async function fetchAndCacheInboundMedia(mediaId, { conversationId, messageType, filenameHint } = {}) {
  try {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) {
      console.warn('[wa-media] WHATSAPP_ACCESS_TOKEN not set — cannot fetch media');
      return null;
    }
    if (!mediaId) return null;

    // Step 1: Get media metadata (temp URL + mime + sha + size)
    const metaRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      console.error('[wa-media] Meta metadata fetch failed:', metaRes.status, await metaRes.text().catch(() => ''));
      return null;
    }
    const metaJson = await metaRes.json();
    const mediaUrl = metaJson.url;
    const mimeType = metaJson.mime_type || 'application/octet-stream';

    if (!mediaUrl) {
      console.error('[wa-media] No URL in Meta response', metaJson);
      return null;
    }

    // Step 2: Download the actual binary (needs Bearer too)
    const binRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!binRes.ok) {
      console.error('[wa-media] Binary download failed:', binRes.status);
      return null;
    }
    const arrayBuf = await binRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const size = buffer.byteLength;

    // Step 3: Upload to Supabase Storage
    const ext = extensionForMime(mimeType);
    const baseName = filenameHint ? sanitizeFilename(filenameHint.replace(/\.[^.]+$/, '')) : (messageType || 'media');
    const path = `inbound/${conversationId || 'misc'}/${Date.now()}_${baseName}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (upErr) {
      console.error('[wa-media] Storage upload error:', upErr.message);
      return null;
    }

    // Step 4: Public URL
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

    return {
      public_url: pub?.publicUrl || null,
      storage_path: path,
      mime_type: mimeType,
      size,
    };
  } catch (e) {
    console.error('[wa-media] fetchAndCacheInboundMedia error:', e?.message);
    return null;
  }
}

/**
 * After an inbound media message is already inserted, call this to
 * enrich the message with a public URL. Updates `metadata` JSONB in place.
 * Safe to call multiple times — it skips if media_url already present.
 */
export async function enrichInboundMessageMedia(messageRowId) {
  try {
    const { data: msg, error } = await supabase
      .from('whatsapp_messages')
      .select('id, conversation_id, message_type, metadata')
      .eq('id', messageRowId)
      .single();

    if (error || !msg) return null;
    if (!['image', 'video', 'audio', 'document', 'sticker'].includes(msg.message_type)) return null;

    const meta = msg.metadata || {};
    if (meta.media_url) return { already_cached: true, media_url: meta.media_url };
    if (!meta.media_id) return null;

    const cached = await fetchAndCacheInboundMedia(meta.media_id, {
      conversationId: msg.conversation_id,
      messageType: msg.message_type,
      filenameHint: meta.filename,
    });

    if (!cached) return null;

    const newMeta = {
      ...meta,
      media_url: cached.public_url,
      storage_path: cached.storage_path,
      mime_type: cached.mime_type || meta.mime_type,
      size: cached.size,
    };

    await supabase
      .from('whatsapp_messages')
      .update({ metadata: newMeta })
      .eq('id', messageRowId);

    return { media_url: cached.public_url };
  } catch (e) {
    console.error('[wa-media] enrichInboundMessageMedia error:', e?.message);
    return null;
  }
}

// ─── Upload OUTGOING media to Meta (for sending) ────────────────────────────
/**
 * Upload a file buffer to Meta's /media endpoint, returns { media_id }.
 * Need this before we can send a media message referencing the id.
 */
export async function uploadMediaToMeta(buffer, { filename = 'file', mimeType = 'application/octet-stream' } = {}) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    return { ok: false, reason: 'not_configured' };
  }

  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    // Node 18+ has global File/Blob. Use Blob for broad compat.
    const blob = new Blob([buffer], { type: mimeType });
    form.append('file', blob, filename);

    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      }
    );
    const data = await res.json();
    if (data.error || !data.id) {
      return { ok: false, reason: data?.error?.message || 'upload_failed', raw: data };
    }
    return { ok: true, media_id: data.id };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * After we've sent an outbound media message, cache the file in Supabase
 * Storage (so our inbox UI can render the preview instantly + permanently).
 * Returns { public_url, storage_path } or null.
 */
export async function cacheOutboundMediaBuffer(buffer, { conversationId, filename, mimeType, messageType }) {
  try {
    const ext = extensionForMime(mimeType) || (filename?.split('.').pop() || 'bin');
    const baseName = filename ? sanitizeFilename(filename.replace(/\.[^.]+$/, '')) : (messageType || 'media');
    const path = `outbound/${conversationId || 'misc'}/${Date.now()}_${baseName}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (upErr) {
      console.error('[wa-media] outbound cache upload error:', upErr.message);
      return null;
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { public_url: pub?.publicUrl || null, storage_path: path };
  } catch (e) {
    console.error('[wa-media] cacheOutboundMediaBuffer error:', e?.message);
    return null;
  }
}
