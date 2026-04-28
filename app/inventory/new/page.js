'use client';

// ============================================================================
// RS ZEVAR ERP — Add Product Page (Phase D M2.C — Apr 28 2026)
// Route: /inventory/new
// ----------------------------------------------------------------------------
// Blank-state form mirroring the editor layout. Creates product on Shopify
// (REST), uploads images (REST attachment base64), sets collections
// (GraphQL), then redirects to /inventory/{newId} for further editing.
//
// Image upload flow:
//   1. User picks files via <input type="file" multiple>
//   2. Each file is downscaled client-side via canvas (max 2000px, JPEG 0.85)
//      to keep payload under Vercel's 4.5MB body limit
//   3. Base64 sent in single POST body
//   4. Server uploads each to Shopify sequentially (250ms throttle)
// ============================================================================

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ── Theme tokens ────────────────────────────────────────────────────────────
const gold = '#c9a96e';
const card = '#141414';
const border = '#222';
const bgPage = '#080808';
const text1 = '#e5e5e5';
const text2 = '#aaa';
const text3 = '#666';

// ── UI atoms (same patterns as editor — kept inline to avoid cross-file refactor) ──
function Card({ title, children, right = null, padBody = true }) {
  return (
    <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
      {title && (
        <div style={{
          padding: '14px 20px',
          borderBottom: `1px solid ${border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'rgba(201,169,110,0.03)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: text1 }}>{title}</div>
          {right}
        </div>
      )}
      <div style={{ padding: padBody ? '18px 20px' : 0 }}>{children}</div>
    </div>
  );
}

function Label({ children, hint, required }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: text2, letterSpacing: 0.3 }}>
        {children}{required && <span style={{ color: '#f87171', marginLeft: 3 }}>*</span>}
      </span>
      {hint && <span style={{ fontSize: 11, color: text3, marginLeft: 8 }}>{hint}</span>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, mono, disabled, type = 'text' }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        width: '100%', padding: '9px 12px',
        background: bgPage, border: `1px solid ${border}`, borderRadius: 6,
        color: text1, fontSize: 13,
        fontFamily: mono ? 'monospace' : 'inherit',
        outline: 'none', transition: 'border-color 0.15s',
      }}
      onFocus={e => e.target.style.borderColor = gold}
      onBlur={e => e.target.style.borderColor = border}
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 8, mono }) {
  return (
    <textarea
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: '100%', padding: '10px 12px',
        background: bgPage, border: `1px solid ${border}`, borderRadius: 6,
        color: text1, fontSize: 13,
        fontFamily: mono ? 'monospace' : 'inherit',
        outline: 'none', resize: 'vertical', lineHeight: 1.5,
      }}
      onFocus={e => e.target.style.borderColor = gold}
      onBlur={e => e.target.style.borderColor = border}
    />
  );
}

function Select({ value, onChange, options, disabled }) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
      style={{
        width: '100%', padding: '9px 12px',
        background: bgPage, border: `1px solid ${border}`, borderRadius: 6,
        color: text1, fontSize: 13, fontFamily: 'inherit',
        outline: 'none', cursor: 'pointer',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Btn({ children, onClick, primary, danger, disabled, href, target, title }) {
  const style = {
    background: primary ? gold : 'transparent',
    color: primary ? '#080808' : danger ? '#ef4444' : text1,
    border: `1px solid ${primary ? gold : danger ? '#7f1d1d' : border}`,
    borderRadius: 6, padding: '7px 14px',
    fontSize: 12, fontWeight: primary ? 600 : 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    textDecoration: 'none', fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', gap: 6,
    whiteSpace: 'nowrap', opacity: disabled ? 0.5 : 1,
  };
  if (href) return <a href={href} target={target} rel="noopener noreferrer" style={style} title={title}>{children}</a>;
  return <button onClick={onClick} disabled={disabled} style={style} title={title}>{children}</button>;
}

// ── Tags chip input ─────────────────────────────────────────────────────────
function TagsInput({ tags, onChange }) {
  const [input, setInput] = useState('');
  const addTag = (t) => {
    const trimmed = String(t || '').trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setInput('');
  };
  const removeTag = (t) => onChange(tags.filter(x => x !== t));

  return (
    <div style={{
      background: bgPage, border: `1px solid ${border}`, borderRadius: 6,
      padding: '6px 8px', display: 'flex', flexWrap: 'wrap', gap: 6,
      alignItems: 'center', minHeight: 38,
    }}>
      {tags.map(t => (
        <span key={t} style={{
          background: 'rgba(201,169,110,0.12)', border: '1px solid rgba(201,169,110,0.3)',
          color: gold, fontSize: 12, padding: '3px 8px 3px 10px',
          borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          {t}
          <button onClick={() => removeTag(t)} style={{
            background: 'none', border: 'none', color: gold, cursor: 'pointer',
            fontSize: 14, padding: 0, lineHeight: 1, opacity: 0.7,
          }} title="Remove">×</button>
        </span>
      ))}
      <input
        type="text" value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input); }
          else if (e.key === 'Backspace' && !input && tags.length > 0) removeTag(tags[tags.length - 1]);
        }}
        onBlur={() => { if (input.trim()) addTag(input); }}
        placeholder={tags.length === 0 ? 'Type and press Enter' : ''}
        style={{
          flex: 1, minWidth: 100, background: 'transparent', border: 'none',
          color: text1, fontSize: 13, fontFamily: 'inherit', outline: 'none', padding: '4px',
        }}
      />
    </div>
  );
}

// ── Collections multi-select ────────────────────────────────────────────────
function CollectionsPicker({ selected, available, onChange, loading }) {
  const [query, setQuery] = useState('');
  const selectedHandles = useMemo(() => new Set(selected.map(c => c.handle)), [selected]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return available
      .filter(c => !selectedHandles.has(c.handle))
      .filter(c => !q || c.title.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q))
      .slice(0, 30);
  }, [available, selectedHandles, query]);

  const addCollection = (c) => {
    if (selectedHandles.has(c.handle)) return;
    onChange([...selected, { id: c.id, handle: c.handle, title: c.title }]);
    setQuery('');
  };
  const removeCollection = (handle) => onChange(selected.filter(c => c.handle !== handle));

  return (
    <div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 5,
        padding: '8px 10px', background: bgPage,
        border: `1px solid ${border}`, borderRadius: 6,
        minHeight: 38, marginBottom: 8,
      }}>
        {selected.length === 0 ? (
          <span style={{ color: text3, fontSize: 12 }}>Not in any collection</span>
        ) : (
          selected.map(c => (
            <span key={c.handle} style={{
              background: 'rgba(96,165,250,0.12)',
              border: '1px solid rgba(96,165,250,0.3)',
              color: '#60a5fa', fontSize: 11,
              padding: '3px 6px 3px 10px', borderRadius: 4,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              {c.title || c.handle}
              <button onClick={() => removeCollection(c.handle)} style={{
                background: 'none', border: 'none', color: '#60a5fa',
                cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, opacity: 0.7,
              }} title="Remove">×</button>
            </span>
          ))
        )}
      </div>

      <input
        type="text" value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={loading ? 'Loading collections...' : 'Add to collection — type to search'}
        disabled={loading}
        style={{
          width: '100%', padding: '8px 12px',
          background: bgPage, border: `1px solid ${border}`, borderRadius: 6,
          color: text1, fontSize: 12, fontFamily: 'inherit', outline: 'none',
          opacity: loading ? 0.5 : 1,
        }}
        onFocus={e => e.target.style.borderColor = gold}
        onBlur={e => e.target.style.borderColor = border}
      />

      {query.trim() && (
        <div style={{
          marginTop: 4, background: bgPage,
          border: `1px solid ${border}`, borderRadius: 6,
          maxHeight: 220, overflowY: 'auto',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', color: text3, fontSize: 12 }}>
              No matches.
            </div>
          ) : filtered.map(c => (
            <button key={c.handle} onClick={() => addCollection(c)} style={{
              display: 'flex', width: '100%', padding: '7px 12px',
              background: 'transparent', border: 'none',
              borderBottom: `1px solid ${border}`,
              color: text1, fontSize: 12, fontFamily: 'inherit',
              cursor: 'pointer', textAlign: 'left',
              alignItems: 'center', gap: 8,
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(201,169,110,0.06)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: gold, fontSize: 12 }}>+</span>
              <span style={{ flex: 1 }}>{c.title}</span>
              <span style={{ color: text3, fontSize: 10, fontFamily: 'monospace' }}>
                {c.type === 'smart' ? 'smart' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Image uploader (multi-file with client-side compression) ───────────────
// Returns array of { file, previewUrl, alt, base64?, status }
const MAX_DIMENSION = 2000;       // Largest side after compression
const JPEG_QUALITY  = 0.85;
const MAX_IMAGES    = 8;
const TOTAL_SIZE_LIMIT = 4_000_000;  // 4 MB total payload guard (Vercel 4.5MB hard limit)

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width >= height) {
            height = Math.round(height * (MAX_DIMENSION / width));
            width = MAX_DIMENSION;
          } else {
            width = Math.round(width * (MAX_DIMENSION / height));
            height = MAX_DIMENSION;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        // Strip prefix to get raw base64
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        resolve({ base64, dataUrl, width, height });
      };
      img.onerror = () => reject(new Error('Failed to read image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function ImageUploader({ images, onChange }) {
  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';   // reset so re-picking same file works
    if (files.length === 0) return;

    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      alert(`Maximum ${MAX_IMAGES} images per product create. Use editor to add more later.`);
      return;
    }
    const toProcess = files.slice(0, remaining);

    const newImages = [];
    for (const file of toProcess) {
      try {
        const compressed = await compressImage(file);
        newImages.push({
          filename: file.name,
          previewUrl: compressed.dataUrl,
          base64: compressed.base64,
          alt: '',
          width: compressed.width,
          height: compressed.height,
          sizeKb: Math.round(compressed.base64.length * 3 / 4 / 1024),  // approx
        });
      } catch (err) {
        alert(`Failed to process ${file.name}: ${err.message}`);
      }
    }
    onChange([...images, ...newImages]);
  };

  const setAlt = (idx, alt) => {
    onChange(images.map((img, i) => i === idx ? { ...img, alt } : img));
  };
  const removeImg = (idx) => onChange(images.filter((_, i) => i !== idx));
  const moveImg = (idx, dir) => {
    const next = [...images];
    const tgt = idx + dir;
    if (tgt < 0 || tgt >= next.length) return;
    [next[idx], next[tgt]] = [next[tgt], next[idx]];
    onChange(next);
  };

  const totalKb = images.reduce((s, i) => s + (i.sizeKb || 0), 0);
  const overLimit = totalKb * 1024 > TOTAL_SIZE_LIMIT;

  return (
    <div>
      {images.length === 0 ? (
        <div style={{
          border: `1px dashed ${border}`, borderRadius: 8,
          padding: 32, textAlign: 'center',
          color: text3, fontSize: 13,
        }}>
          No images yet. Click below to upload (max {MAX_IMAGES} at create time).
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {images.map((img, idx) => (
            <div key={idx} style={{
              background: bgPage, border: `1px solid ${border}`,
              borderRadius: 8, padding: 8,
            }}>
              <div style={{ position: 'relative', paddingTop: '100%', background: '#000', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
                <img src={img.previewUrl} alt={img.alt || ''}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }}
                />
                <div style={{
                  position: 'absolute', top: 6, left: 6,
                  background: 'rgba(0,0,0,0.7)', color: gold,
                  fontSize: 10, fontWeight: 600,
                  padding: '2px 6px', borderRadius: 3,
                }}>#{idx + 1}</div>
              </div>
              <input
                type="text"
                value={img.alt || ''}
                onChange={e => setAlt(idx, e.target.value)}
                placeholder="Alt text (SEO)"
                style={{
                  width: '100%', padding: '6px 8px',
                  background: card, border: `1px solid ${border}`, borderRadius: 4,
                  color: text1, fontSize: 11, fontFamily: 'inherit', outline: 'none',
                  marginBottom: 6,
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: text3 }}>
                <span>{img.width}×{img.height} · {img.sizeKb}KB</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => moveImg(idx, -1)} disabled={idx === 0} style={miniBtnStyle(idx === 0)}>↑</button>
                  <button onClick={() => moveImg(idx, +1)} disabled={idx === images.length - 1} style={miniBtnStyle(idx === images.length - 1)}>↓</button>
                  <button onClick={() => removeImg(idx)} style={{ ...miniBtnStyle(false), color: '#f87171' }}>×</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', background: 'transparent',
          border: `1px solid ${gold}`, color: gold,
          borderRadius: 6, fontSize: 12, fontWeight: 600,
          cursor: images.length >= MAX_IMAGES ? 'not-allowed' : 'pointer',
          opacity: images.length >= MAX_IMAGES ? 0.5 : 1,
        }}>
          📷 Upload images
          <input type="file" multiple accept="image/*" onChange={handleFiles}
            disabled={images.length >= MAX_IMAGES}
            style={{ display: 'none' }} />
        </label>
        <span style={{ fontSize: 11, color: overLimit ? '#f87171' : text3 }}>
          {images.length}/{MAX_IMAGES} · {totalKb}KB total
          {overLimit && ' ⚠ exceeds 4MB — remove some'}
        </span>
      </div>
    </div>
  );
}

function miniBtnStyle(disabled) {
  return {
    background: 'transparent', border: `1px solid ${border}`,
    borderRadius: 3, padding: '2px 6px',
    color: disabled ? text3 : text2,
    fontSize: 10, fontFamily: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  };
}

// ── Auto-handle generator (slugify) ────────────────────────────────────────
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 100);
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ────────────────────────────────────────────────────────────────────────────
export default function NewProductPage() {
  const router = useRouter();

  // Form state
  const [draft, setDraft] = useState({
    title: '',
    description_html: '',
    vendor: '',
    product_type: '',
    tags: [],
    handle: '',
    status: 'draft',
    price: '',
    compare_at_price: '',
    sku: '',
    seo_meta_title: '',
    seo_meta_description: '',
    collections: [],
    images: [],
  });
  const [handleManuallyEdited, setHandleManuallyEdited] = useState(false);
  const [descMode, setDescMode] = useState('edit');   // edit | preview
  const [creating, setCreating] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  // Master collections list
  const [allCollections, setAllCollections] = useState([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setCollectionsLoading(true);
        const res = await fetch('/api/collections');
        const data = await res.json();
        if (alive && data.success) setAllCollections(data.collections || []);
      } catch (e) {
        console.error('[new product] collections load failed:', e);
      } finally {
        if (alive) setCollectionsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Auto-generate handle from title until user edits it manually
  useEffect(() => {
    if (!handleManuallyEdited) {
      setDraft(d => ({ ...d, handle: slugify(d.title) }));
    }
  }, [draft.title, handleManuallyEdited]);

  const setField = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  // Warn on navigation if anything entered
  const hasContent = draft.title.trim() || draft.description_html.trim() || draft.images.length > 0;
  useEffect(() => {
    const handler = (e) => {
      if (hasContent && !creating) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasContent, creating]);

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!draft.title.trim()) {
      setSaveResult({ success: false, error: 'Title is required' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setCreating(true);
    setSaveResult(null);

    // Build payload — strip empty strings / preview URLs
    const payload = {
      title: draft.title.trim(),
      description_html: draft.description_html || undefined,
      vendor: draft.vendor || undefined,
      product_type: draft.product_type || undefined,
      tags: draft.tags.length > 0 ? draft.tags : undefined,
      handle: draft.handle || undefined,
      status: draft.status,
      price: draft.price !== '' ? draft.price : undefined,
      compare_at_price: draft.compare_at_price !== '' ? draft.compare_at_price : undefined,
      sku: draft.sku || undefined,
      seo_meta_title: draft.seo_meta_title || undefined,
      seo_meta_description: draft.seo_meta_description || undefined,
      collections: draft.collections.length > 0
        ? draft.collections.map(c => ({ id: c.id, handle: c.handle, title: c.title }))
        : undefined,
      images: draft.images.length > 0
        ? draft.images.map(img => ({
            filename: img.filename,
            attachment: img.base64,
            alt: img.alt || '',
          }))
        : undefined,
    };

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setSaveResult(data);

      if (data.success && data.shopify_product_id) {
        // Brief delay so user sees the success message, then redirect
        setTimeout(() => {
          router.push(`/inventory/${data.shopify_product_id}`);
        }, 1200);
      } else {
        setCreating(false);
      }
    } catch (e) {
      setSaveResult({ success: false, error: e.message });
      setCreating(false);
    }
  };

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Sticky create bar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#1a1408', border: `1px solid ${gold}`,
        borderRadius: 10, padding: '12px 18px', marginBottom: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: gold, fontSize: 13, fontWeight: 600 }}>
          <span>● New product</span>
          <span style={{ color: text3, fontWeight: 400, fontSize: 12 }}>
            ({draft.images.length} image{draft.images.length !== 1 ? 's' : ''} · {draft.collections.length} collection{draft.collections.length !== 1 ? 's' : ''})
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={() => {
            if (hasContent && !confirm('Discard everything and go back?')) return;
            router.push('/inventory');
          }} disabled={creating}>Cancel</Btn>
          <Btn onClick={handleCreate} primary disabled={creating || !draft.title.trim()}>
            {creating ? 'Creating...' : 'Create Product'}
          </Btn>
        </div>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/inventory" style={{ color: text3, fontSize: 12, textDecoration: 'none' }}>
          ← Inventory
        </Link>
        <h1 style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 24, fontWeight: 600,
          color: gold, marginTop: 6,
        }}>
          Add Product
        </h1>
        <div style={{ fontSize: 12, color: text3, marginTop: 4 }}>
          Create a product on Shopify and ERP at once. Default variant fields can be edited later.
        </div>
      </div>

      {/* Result alert */}
      {saveResult && (
        <div style={{
          padding: '10px 14px', marginBottom: 14, borderRadius: 8,
          background: saveResult.success ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
          border: `1px solid ${saveResult.success ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
          color: saveResult.success ? '#4ade80' : '#f87171',
          fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>
            {saveResult.success
              ? `✅ ${saveResult.message || 'Created'} — redirecting to editor...`
              : `❌ ${saveResult.error || saveResult.message}`}
            {saveResult.partial && ' (some side-tasks failed — check editor)'}
            {saveResult.duration_ms && <span style={{ opacity: 0.6, marginLeft: 8 }}>({(saveResult.duration_ms / 1000).toFixed(1)}s)</span>}
          </span>
          {!creating && (
            <button onClick={() => setSaveResult(null)} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 16 }}>×</button>
          )}
        </div>
      )}

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 20 }}>
        {/* LEFT */}
        <div>
          <Card title="Title">
            <TextInput
              value={draft.title}
              onChange={v => setField('title', v)}
              placeholder="e.g. Royal Kundan Bridal Set"
            />
            <div style={{ fontSize: 11, color: text3, marginTop: 6 }}>
              {draft.title.length} characters · ideal 50-70 for SEO
            </div>
          </Card>

          <Card
            title="Description"
            right={
              <div style={{ display: 'flex', gap: 4, background: bgPage, borderRadius: 6, padding: 2 }}>
                {[{ v: 'edit', l: 'HTML' }, { v: 'preview', l: 'Preview' }].map(t => (
                  <button key={t.v} onClick={() => setDescMode(t.v)}
                    style={{
                      padding: '4px 10px', background: descMode === t.v ? 'rgba(201,169,110,0.15)' : 'transparent',
                      border: 'none', borderRadius: 4,
                      color: descMode === t.v ? gold : text3,
                      fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                    }}>{t.l}</button>
                ))}
              </div>
            }>
            {descMode === 'edit' ? (
              <TextArea
                value={draft.description_html}
                onChange={v => setField('description_html', v)}
                placeholder="<p>Product description here...</p>"
                rows={10}
                mono
              />
            ) : (
              <div style={{
                background: bgPage, border: `1px solid ${border}`, borderRadius: 6,
                padding: 16, minHeight: 200, fontSize: 14, color: text1, lineHeight: 1.6,
              }}
                dangerouslySetInnerHTML={{ __html: draft.description_html || '<p style="color:#666">Empty description</p>' }}
              />
            )}
          </Card>

          <Card title={`Images (${draft.images.length})`}>
            <ImageUploader
              images={draft.images}
              onChange={imgs => setField('images', imgs)}
            />
          </Card>

          <Card title="Default Variant" right={<span style={{ fontSize: 11, color: text3 }}>Add more variants in Shopify after create</span>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <div>
                <Label hint="PKR">Price</Label>
                <TextInput
                  type="number"
                  value={draft.price}
                  onChange={v => setField('price', v)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label hint="strike-through">Compare at</Label>
                <TextInput
                  type="number"
                  value={draft.compare_at_price}
                  onChange={v => setField('compare_at_price', v)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>SKU</Label>
                <TextInput
                  value={draft.sku}
                  onChange={v => setField('sku', v)}
                  placeholder="optional"
                  mono
                />
              </div>
            </div>
            <div style={{ fontSize: 11, color: text3, marginTop: 10 }}>
              Stock kar later set kar sakte ho Shopify pe — naya product 0 stock se start hota hai.
            </div>
          </Card>
        </div>

        {/* RIGHT */}
        <div>
          <Card title="Status">
            <Select
              value={draft.status}
              onChange={v => setField('status', v)}
              options={[
                { value: 'draft',  label: '○ Draft (recommended for new)' },
                { value: 'active', label: '✓ Active (visible on storefront)' },
                { value: 'archived', label: '✕ Archived' },
              ]}
            />
            <div style={{ fontSize: 11, color: text3, marginTop: 8 }}>
              Tip: Draft me create karo, fir price/variants set karke Active karo.
            </div>
          </Card>

          <Card title="Product Organization">
            <div style={{ marginBottom: 14 }}>
              <Label>Type</Label>
              <TextInput
                value={draft.product_type}
                onChange={v => setField('product_type', v)}
                placeholder="e.g. Earrings, Necklace Sets"
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <Label>Vendor</Label>
              <TextInput
                value={draft.vendor}
                onChange={v => setField('vendor', v)}
                placeholder="e.g. SBH, BWP, BKB"
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <Label hint={`${draft.collections.length} selected`}>Collections</Label>
              <CollectionsPicker
                selected={draft.collections}
                available={allCollections}
                onChange={v => setField('collections', v)}
                loading={collectionsLoading}
              />
            </div>
            <div>
              <Label>Tags</Label>
              <TagsInput
                tags={draft.tags}
                onChange={v => setField('tags', v)}
              />
            </div>
          </Card>

          <Card title="SEO">
            <div style={{ marginBottom: 14 }}>
              <Label hint="Ideal: 30-60 chars">Meta Title</Label>
              <TextInput
                value={draft.seo_meta_title}
                onChange={v => setField('seo_meta_title', v)}
                placeholder="Search engine title"
              />
              <div style={{ fontSize: 10, color: text3, marginTop: 4 }}>
                {draft.seo_meta_title.length} / 60 chars
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Label hint="Ideal: 120-160 chars">Meta Description</Label>
              <TextArea
                value={draft.seo_meta_description}
                onChange={v => setField('seo_meta_description', v)}
                placeholder="Search engine description"
                rows={3}
              />
              <div style={{ fontSize: 10, color: text3, marginTop: 4 }}>
                {draft.seo_meta_description.length} / 160 chars
              </div>
            </div>
            <div>
              <Label hint="URL slug — auto from title">Handle</Label>
              <TextInput
                value={draft.handle}
                onChange={v => { setField('handle', v); setHandleManuallyEdited(true); }}
                placeholder="product-url-slug"
                mono
              />
              <div style={{ fontSize: 10, color: text3, marginTop: 4 }}>
                rszevar.com/products/<span style={{ color: gold }}>{draft.handle || '...'}</span>
                {!handleManuallyEdited && draft.title && (
                  <span style={{ marginLeft: 8, fontStyle: 'italic' }}>(auto)</span>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
