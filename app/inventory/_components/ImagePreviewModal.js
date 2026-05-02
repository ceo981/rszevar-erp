'use client';

// ============================================================================
// RS ZEVAR ERP — Image Preview Modal (May 2026)
// File: app/inventory/_components/ImagePreviewModal.js
//
// Shopify-style fullscreen image preview popup. Click on any product image
// in the editor → this modal opens with:
//   - Large image view (with backdrop click + ESC to close)
//   - Header showing position (#3 of 18) + product name
//   - Right sidebar with details: alt text, dimensions, file size, upload date
//   - Download button — fetches from /api/images/download which proxies the
//     Shopify CDN and forces original PNG/JPG (not WebP)
//   - "Open in Shopify" external link
//   - Prev/Next arrows + thumbnail strip for browsing
//
// Props:
//   images       — array of { id, src, alt, position, width, height, ... }
//   startIndex   — initial image to show (default 0)
//   productTitle — shown in header
//   shopifyId    — optional, for "Open in Shopify" link
//   onClose      — () => void
// ============================================================================

import { useState, useEffect, useCallback } from 'react';

const gold   = '#c9a96e';
const border = '#222';
const bg     = '#0a0a0a';

export default function ImagePreviewModal({
  images,
  startIndex = 0,
  productTitle = '',
  shopifyId = null,
  onClose,
}) {
  const [idx, setIdx] = useState(startIndex);
  const total = images?.length || 0;
  const current = images?.[idx];

  const goPrev = useCallback(() => {
    setIdx(i => (i - 1 + total) % total);
  }, [total]);

  const goNext = useCallback(() => {
    setIdx(i => (i + 1) % total);
  }, [total]);

  // ── Keyboard navigation ──
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && total > 1) goPrev();
      else if (e.key === 'ArrowRight' && total > 1) goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext, total]);

  // Reset to startIndex if it changes externally
  useEffect(() => { setIdx(startIndex); }, [startIndex]);

  if (!current) return null;

  // Build a sensible filename: prefer product title slug + position
  const slug = (productTitle || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const filename = `${slug}-${current.position || (idx + 1)}`;

  const downloadHref = `/api/images/download?url=${encodeURIComponent(current.src)}&filename=${encodeURIComponent(filename)}`;
  const shopifyAdminUrl = shopifyId
    ? `https://admin.shopify.com/store/rszevar/products/${shopifyId}`
    : null;

  // Estimate file size from width/height — not exact, just useful
  const dims = (current.width && current.height)
    ? `${current.width} × ${current.height} px`
    : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column',
      }}>
      {/* Header bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: '14px 22px',
          background: '#0a0a0a',
          borderBottom: `1px solid ${border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 16, flexWrap: 'wrap',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={onClose}
            title="Close (ESC)"
            style={{
              background: 'transparent', border: `1px solid ${border}`,
              color: '#888', borderRadius: 6, padding: '6px 12px',
              fontSize: 16, cursor: 'pointer', fontFamily: 'inherit',
              lineHeight: 1,
            }}>←</button>
          <div>
            <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
              {productTitle || 'Image preview'}
            </div>
            <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
              {idx + 1} of {total}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Download button — forces original PNG/JPG via proxy */}
          <a
            href={downloadHref}
            download={filename}
            onClick={(e) => e.stopPropagation()}
            title="Download original (PNG/JPG, not WebP)"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: gold, color: '#000',
              border: `1px solid ${gold}`, borderRadius: 6,
              padding: '7px 14px', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit',
            }}>
            ⬇ Download
          </a>

          {/* Open in Shopify */}
          {shopifyAdminUrl && (
            <a
              href={shopifyAdminUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open product in Shopify admin"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'transparent', color: '#888',
                border: `1px solid ${border}`, borderRadius: 6,
                padding: '7px 12px', fontSize: 11, fontWeight: 600,
                textDecoration: 'none', fontFamily: 'inherit',
              }}>
              🔗 Shopify
            </a>
          )}

          {/* Close X */}
          <button onClick={onClose}
            title="Close (ESC)"
            style={{
              background: 'transparent', border: 'none',
              color: '#888', fontSize: 24, cursor: 'pointer',
              lineHeight: 1, padding: '0 4px', marginLeft: 4,
            }}>×</button>
        </div>
      </div>

      {/* Body — image viewport + sidebar */}
      <div style={{
        flex: 1, display: 'flex', overflow: 'hidden',
      }}>
        {/* Image viewport */}
        <div
          onClick={onClose}
          style={{
            flex: 1, position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24, overflow: 'hidden',
          }}>
          {total > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); goPrev(); }}
                title="Previous (←)"
                style={{
                  position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(0,0,0,0.6)', border: `1px solid ${border}`,
                  color: '#fff', borderRadius: '50%',
                  width: 44, height: 44, fontSize: 22,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 10,
                }}>‹</button>
              <button
                onClick={(e) => { e.stopPropagation(); goNext(); }}
                title="Next (→)"
                style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(0,0,0,0.6)', border: `1px solid ${border}`,
                  color: '#fff', borderRadius: '50%',
                  width: 44, height: 44, fontSize: 22,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 10,
                }}>›</button>
            </>
          )}

          <img
            src={current.src}
            alt={current.alt || ''}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '100%', maxHeight: '100%',
              objectFit: 'contain',
              boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
              cursor: 'default',
            }}
          />
        </div>

        {/* Right sidebar — image details */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 280, flexShrink: 0,
            background: '#0a0a0a',
            borderLeft: `1px solid ${border}`,
            padding: 20, overflowY: 'auto',
            fontSize: 12,
          }}>
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Image Details
          </div>

          {current.alt && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: '#888', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Alt text
              </div>
              <div style={{ color: '#ddd', fontSize: 12, lineHeight: 1.5 }}>
                {current.alt}
              </div>
            </div>
          )}

          {dims && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: '#888', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Dimensions
              </div>
              <div style={{ color: '#ddd', fontSize: 12 }}>{dims}</div>
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <div style={{ color: '#888', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Position
            </div>
            <div style={{ color: '#ddd', fontSize: 12 }}>
              #{current.position || (idx + 1)}
              {idx === 0 && <span style={{ color: '#4ade80', marginLeft: 6 }}>★ Main</span>}
            </div>
          </div>

          {current.id && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: '#888', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Image ID
              </div>
              <div style={{ color: '#666', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {current.id}
              </div>
            </div>
          )}

          <div style={{
            marginTop: 18, padding: '10px 12px',
            background: 'rgba(201,169,110,0.05)',
            border: '1px solid rgba(201,169,110,0.15)',
            borderRadius: 6, fontSize: 11, color: '#888', lineHeight: 1.5,
          }}>
            💡 <strong style={{ color: gold }}>Download</strong> button asli format mein file deta hai (PNG/JPG) — Shopify ka WebP nahi.
          </div>
        </div>
      </div>

      {/* Bottom thumbnail strip */}
      {total > 1 && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: '#0a0a0a',
            borderTop: `1px solid ${border}`,
            padding: '10px 14px',
            display: 'flex', gap: 6, overflowX: 'auto',
          }}>
          {images.map((img, i) => (
            <button
              key={img.id || i}
              onClick={() => setIdx(i)}
              style={{
                flex: '0 0 auto',
                width: 48, height: 48,
                background: '#000',
                border: `2px solid ${i === idx ? gold : 'transparent'}`,
                borderRadius: 4, padding: 0,
                cursor: 'pointer', overflow: 'hidden',
                opacity: i === idx ? 1 : 0.6,
                transition: 'opacity 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = 1}
              onMouseLeave={e => e.currentTarget.style.opacity = i === idx ? 1 : 0.6}
            >
              <img src={img.src} alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
