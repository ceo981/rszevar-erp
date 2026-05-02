'use client';

// ============================================================================
// RS ZEVAR ERP — Add Product Page (Phase D M2.C + M2.D + M2.I — Apr 28 2026)
// Route: /inventory/new
// ----------------------------------------------------------------------------
// Blank-state form mirroring the editor layout. Creates product on Shopify
// (REST), uploads images (REST attachment base64), sets collections
// (GraphQL), then redirects to /inventory/{newId} for further editing.
//
// M2.D additions:
//   - Inventory tracking toggle + initial stock for default variant
//   - Variant options builder (up to 2 options, auto-generated variants matrix)
//   - Google Shopping metafields card
// M2.I additions:
//   - AI Enhance button in Description card → opens modal in 'apply' mode
//   - Generated content fills the new-product draft (no separate Shopify push)
//   - Live SEO score card (recomputes on every keystroke)
//   - Pending AI extras banner (FAQs + product metafields queued for save)
// ============================================================================

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AiEnhanceModal from '../_components/AiEnhanceModal';
import { calculateSeoScore } from '../../../lib/seo-score';
import { useUser } from '@/context/UserContext';

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
  // May 2026 — Drag-drop reorder state (mirrors the existing-product editor)
  const [draggedIdx, setDraggedIdx] = useState(null);

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
          _id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,  // M2.F — stable ref for variant assignment
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
  // May 2026 — Set as main (move to position 0, becomes Shopify's primary image)
  const setAsFirst = (idx) => {
    if (idx === 0) return;
    const next = [...images];
    const [moved] = next.splice(idx, 1);
    next.unshift(moved);
    onChange(next);
  };

  // ── Drag-drop handlers ──
  const handleDragStart = (idx) => (e) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (targetIdx) => (e) => {
    e.preventDefault();
    const sourceIdx = draggedIdx ?? parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (sourceIdx === null || isNaN(sourceIdx) || sourceIdx === targetIdx) {
      setDraggedIdx(null);
      return;
    }
    const next = [...images];
    const [moved] = next.splice(sourceIdx, 1);
    next.splice(targetIdx, 0, moved);
    onChange(next);
    setDraggedIdx(null);
  };
  const handleDragEnd = () => setDraggedIdx(null);

  const totalKb = images.reduce((s, i) => s + (i.sizeKb || 0), 0);
  const overLimit = totalKb * 1024 > TOTAL_SIZE_LIMIT;

  return (
    <div>
      {images.length > 1 && (
        <div style={{
          fontSize: 10, color: '#60a5fa', marginBottom: 10,
          padding: '6px 10px', background: 'rgba(96,165,250,0.05)',
          border: '1px solid rgba(96,165,250,0.2)', borderRadius: 6,
        }}>
          💡 Drag karke order change karo · ya ↑/↓ buttons use karo · "★ Set first" se main image banao
        </div>
      )}
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
          {images.map((img, idx) => {
            const isDragged = draggedIdx === idx;
            const isFirst   = idx === 0;
            return (
              <div
                key={img._id || idx}
                draggable
                onDragStart={handleDragStart(idx)}
                onDragOver={handleDragOver}
                onDrop={handleDrop(idx)}
                onDragEnd={handleDragEnd}
                style={{
                  background: bgPage,
                  border: `1px solid ${isDragged ? gold : border}`,
                  borderRadius: 8, padding: 8,
                  cursor: 'move',
                  opacity: isDragged ? 0.4 : 1,
                  transition: 'opacity 0.15s, border-color 0.15s',
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
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <span style={{ fontSize: 12 }}>⋮⋮</span>
                    <span>#{idx + 1}</span>
                    {isFirst && <span style={{ marginLeft: 2, color: '#4ade80' }}>★ Main</span>}
                  </div>
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
                    marginBottom: 6, boxSizing: 'border-box',
                  }}
                />
                {!isFirst && images.length > 1 && (
                  <button onClick={() => setAsFirst(idx)}
                    style={{
                      width: '100%', marginBottom: 6,
                      background: '#1a1a1a', border: `1px solid ${border}`,
                      color: '#4ade80', borderRadius: 4, padding: '4px 8px',
                      fontSize: 10, fontFamily: 'inherit', cursor: 'pointer',
                    }}>★ Set as main</button>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: text3 }}>
                  <span>{img.width}×{img.height} · {img.sizeKb}KB</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => moveImg(idx, -1)} disabled={idx === 0} style={miniBtnStyle(idx === 0)}>↑</button>
                    <button onClick={() => moveImg(idx, +1)} disabled={idx === images.length - 1} style={miniBtnStyle(idx === images.length - 1)}>↓</button>
                    <button onClick={() => removeImg(idx)} style={{ ...miniBtnStyle(false), color: '#f87171' }}>×</button>
                  </div>
                </div>
              </div>
            );
          })}
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
        <span style={{ fontSize: 11, color: overLimit ? '#fbbf24' : text3 }}>
          {images.length}/{MAX_IMAGES} · {totalKb}KB total
          {overLimit && ' · large payload — uploads will run sequentially'}
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

// ── Numeric input (M2.D) ────────────────────────────────────────────────────
function NumInput({ value, onChange, placeholder, disabled, step = '0.01' }) {
  return (
    <input
      type="number"
      value={value === null || value === undefined ? '' : value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      step={step}
      style={{
        width: '100%', padding: '6px 8px',
        background: bgPage, border: `1px solid ${border}`, borderRadius: 4,
        color: text1, fontSize: 12, fontFamily: 'monospace', outline: 'none',
      }}
      onFocus={e => e.target.style.borderColor = gold}
      onBlur={e => e.target.style.borderColor = border}
    />
  );
}

// ── Variant options builder (M2.D) ──────────────────────────────────────────
// Cartesian product generator with field preservation across regenerations.
// options = [{ name, values: [v1, v2, ...] }, ...]
// existingVariants = [{ option1, option2?, price, compare_at_price, sku, stock }]
function generateVariantMatrix(options, existingVariants) {
  const cleanOpts = options.filter(o => o && o.name && Array.isArray(o.values) && o.values.length > 0);
  if (cleanOpts.length === 0) return [];

  // Build cartesian product
  let combos = [[]];
  for (const opt of cleanOpts) {
    const next = [];
    for (const combo of combos) {
      for (const val of opt.values) next.push([...combo, val]);
    }
    combos = next;
  }

  const existingByKey = new Map(
    (existingVariants || []).map(v => [`${v.option1 ?? ''}|${v.option2 ?? ''}|${v.option3 ?? ''}`, v])
  );

  return combos.map(combo => {
    const row = {
      option1: combo[0] ?? null,
      option2: combo[1] ?? null,
      option3: combo[2] ?? null,
      title: combo.join(' / '),
    };
    const key = `${row.option1 ?? ''}|${row.option2 ?? ''}|${row.option3 ?? ''}`;
    const prev = existingByKey.get(key);
    row.price            = prev?.price            ?? '';
    row.compare_at_price = prev?.compare_at_price ?? '';
    row.sku              = prev?.sku              ?? '';
    row.stock            = prev?.stock            ?? '';
    row.weight           = prev?.weight           ?? '';     // M2.K — per-variant weight (in product weight_unit)
    return row;
  });
}

// Option chip (with remove button)
function ValueChip({ value, onRemove }) {
  return (
    <span style={{
      background: 'rgba(201,169,110,0.12)',
      border: '1px solid rgba(201,169,110,0.3)',
      color: gold, fontSize: 12,
      padding: '3px 6px 3px 10px', borderRadius: 4,
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      {value}
      <button onClick={onRemove} style={{
        background: 'none', border: 'none', color: gold,
        cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, opacity: 0.7,
      }}>×</button>
    </span>
  );
}

// Option row — name + values input
function OptionRow({ option, onChange, onRemove }) {
  const [valueInput, setValueInput] = useState('');

  const addValue = () => {
    const v = valueInput.trim();
    if (!v || option.values.includes(v)) return;
    onChange({ ...option, values: [...option.values, v] });
    setValueInput('');
  };
  const removeValue = (v) => onChange({ ...option, values: option.values.filter(x => x !== v) });

  return (
    <div style={{
      background: bgPage, border: `1px solid ${border}`,
      borderRadius: 8, padding: 12, marginBottom: 10,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ flex: '0 0 140px' }}>
          <Label>Option name</Label>
          <TextInput
            value={option.name}
            onChange={v => onChange({ ...option, name: v })}
            placeholder="e.g. Size"
          />
        </div>
        <button onClick={onRemove} title="Remove option" style={{
          marginTop: 26, background: 'transparent', border: `1px solid ${border}`,
          color: '#f87171', borderRadius: 5, padding: '5px 10px',
          fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
        }}>Remove</button>
      </div>
      <div>
        <Label hint="Press Enter to add">Values</Label>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 5,
          padding: '6px 8px', background: card,
          border: `1px solid ${border}`, borderRadius: 6,
          minHeight: 38, alignItems: 'center',
        }}>
          {option.values.map(v => (
            <ValueChip key={v} value={v} onRemove={() => removeValue(v)} />
          ))}
          <input
            type="text"
            value={valueInput}
            onChange={e => setValueInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addValue(); }
              else if (e.key === 'Backspace' && !valueInput && option.values.length > 0) {
                removeValue(option.values[option.values.length - 1]);
              }
            }}
            onBlur={() => { if (valueInput.trim()) addValue(); }}
            placeholder={option.values.length === 0 ? 'e.g. Small, Medium, Large' : ''}
            style={{
              flex: 1, minWidth: 100, background: 'transparent',
              border: 'none', color: text1, fontSize: 13,
              fontFamily: 'inherit', outline: 'none', padding: '4px',
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Variant grouping helpers (M2.F) ─────────────────────────────────────────
// Groups variants by option1 value. Returns array of { key, label, variants }
// preserving the order from options[0].values.
function groupVariantsByOption1(variants, options) {
  if (!options || options.length === 0) return [];
  const order = options[0]?.values || [];
  const map = new Map();
  for (const v of variants) {
    const key = v.option1 ?? '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  }
  // Preserve options order
  return order
    .filter(val => map.has(val))
    .map(val => ({ key: val, label: val, variants: map.get(val) }));
}

// Returns "Mixed" indicator if values differ, else the single value
function getGroupCommonValue(variants, field) {
  if (!variants || variants.length === 0) return '';
  const first = variants[0][field] ?? '';
  return variants.every(v => (v[field] ?? '') === first) ? first : '__MIXED__';
}

// Sum stock across group (treat empty as 0)
function getGroupTotalStock(variants) {
  return variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
}

// ── Image picker for variant groups (M2.F + M2.H — modal-style, supports inheritance) ─
// `selectedId`   = own assignment (null/undefined if not set)
// `inheritedId`  = parent group's image (sub-variants inherit from group when not own-set)
// Display priority: selectedId → inheritedId → null (show "+")
// Modal opens at viewport center (escapes any overflow/clipping issues)
function VariantImagePicker({ images, selectedId, inheritedId, onSelect, onClear, size = 44, groupLabel }) {
  const [open, setOpen] = useState(false);

  const displayId = selectedId ?? inheritedId;
  const displayImg = images.find(i => i._id === displayId);
  const isInheriting = !selectedId && !!inheritedId;

  const titleText = isInheriting
    ? `Inherited from group — click to override`
    : (displayImg ? 'Click to change image' : 'Click to pick image');

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={titleText}
        style={{
          width: size, height: size, padding: 0,
          background: bgPage,
          border: `1px ${isInheriting ? 'dashed' : 'solid'} ${displayImg ? gold : border}`,
          borderRadius: 6, cursor: 'pointer', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: isInheriting ? 0.85 : 1,
          flex: '0 0 auto',
        }}
      >
        {displayImg ? (
          <img src={displayImg.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <span style={{ color: text3, fontSize: size > 30 ? 18 : 14, fontWeight: 300 }}>+</span>
        )}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: card,
              border: `1px solid ${border}`,
              borderRadius: 10,
              padding: 20,
              maxWidth: 540, width: '100%',
              maxHeight: '85vh', overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.7)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: text1, fontWeight: 600 }}>
                Select image{groupLabel ? ` — ${groupLabel}` : ''}
              </h3>
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'transparent', border: 'none', color: text3, fontSize: 22, cursor: 'pointer', padding: 4, lineHeight: 1 }}
              >×</button>
            </div>

            {images.length === 0 ? (
              <div style={{ color: text3, fontSize: 13, padding: 30, textAlign: 'center' }}>
                Pehle Media card me images upload karo, phir yahan select kar sakoge.
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                  {images.map(img => {
                    const isSelected     = img._id === selectedId;
                    const isInheritedImg = !selectedId && img._id === inheritedId;
                    return (
                      <button
                        key={img._id}
                        onClick={() => { onSelect(img._id); setOpen(false); }}
                        title={img.filename}
                        style={{
                          padding: 0, background: 'none',
                          border: `2px solid ${isSelected ? gold : (isInheritedImg ? 'rgba(201,169,110,0.45)' : 'transparent')}`,
                          borderRadius: 6, cursor: 'pointer', overflow: 'hidden',
                          aspectRatio: '1/1', position: 'relative',
                        }}
                      >
                        <img src={img.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        {isSelected && (
                          <div style={{ position: 'absolute', top: 4, right: 4, background: gold, color: '#080808', borderRadius: 3, padding: '2px 5px', fontSize: 9, fontWeight: 700, letterSpacing: 0.3 }}>SELECTED</div>
                        )}
                        {isInheritedImg && (
                          <div style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(255,255,255,0.92)', color: '#080808', borderRadius: 3, padding: '2px 5px', fontSize: 9, fontWeight: 600, letterSpacing: 0.3 }}>INHERITED</div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  {selectedId && (
                    <button
                      onClick={() => { onClear(); setOpen(false); }}
                      style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${border}`, color: '#f87171', borderRadius: 5, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      {inheritedId ? '↺ Reset to group default' : 'Clear'}
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${border}`, color: text2, borderRadius: 5, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// M2.K — Bulk Edit Modal
// Apply a single field value to multiple variants at once.
// Props:
//   variants    — array of variant objects
//   idKey       — which field to use as variant id (default 'shopify_variant_id')
//   labelKey    — which field to display as variant label (default 'variant_label')
//   onApply     — ({ variantIds, field, value, skuMode }) => void
//   onClose     — () => void
//   canViewFinancial — boolean (hides price/compare-at if false)
// ────────────────────────────────────────────────────────────────────────────
function BulkEditModal({
  variants,
  onApply,
  onClose,
  canViewFinancial,
  idKey = 'shopify_variant_id',
  labelKey = 'variant_label',
  valueGetter,                          // optional (v, fieldKey) => current display value
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(variants.map(v => String(v[idKey]))));
  const [field, setField] = useState(canViewFinancial ? 'price' : 'sku');
  const [value, setValue] = useState('');
  const [skuMode, setSkuMode] = useState('replace'); // replace | prefix | suffix

  const fieldOptions = [
    ...(canViewFinancial ? [
      { value: 'price', label: 'Price' },
      { value: 'compare_at_price', label: 'Compare-at price' },
    ] : []),
    { value: 'sku',    label: 'SKU' },
    { value: 'stock',  label: 'Stock quantity' },
    { value: 'weight', label: 'Weight (g)' },
  ];

  const isAllSelected = selectedIds.size === variants.length && variants.length > 0;
  const toggleAll = () => {
    if (isAllSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(variants.map(v => String(v[idKey]))));
  };
  const toggleOne = (vid) => {
    const next = new Set(selectedIds);
    if (next.has(String(vid))) next.delete(String(vid));
    else next.add(String(vid));
    setSelectedIds(next);
  };

  const handleApply = () => {
    if (selectedIds.size === 0) {
      alert('Select at least one variant');
      return;
    }
    if (field !== 'sku' && (value === '' || value === null || value === undefined)) {
      alert('Enter a value to apply');
      return;
    }
    if (field === 'sku' && skuMode === 'replace' && value === '') {
      // allow empty replace — clears SKU on all selected
    }
    onApply({
      variantIds: Array.from(selectedIds),
      field,
      value,
      skuMode: field === 'sku' ? skuMode : null,
    });
  };

  // Esc to close
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const labelByField = {
    price: 'Price',
    compare_at_price: 'Compare-at',
    sku: 'SKU',
    stock: 'Stock',
    weight: 'Weight',
  };
  const currentValueOf = valueGetter || ((v, fieldKey) => {
    switch (fieldKey) {
      case 'price':            return v.selling_price ?? '';
      case 'compare_at_price': return v.compare_at_price ?? '';
      case 'sku':              return v.sku ?? '';
      case 'stock':            return v.stock_quantity ?? 0;
      case 'weight':           return v.weight ?? 0;
      default:                 return '';
    }
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: card, border: `1px solid ${border}`, borderRadius: 10,
        width: '100%', maxWidth: 720, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'rgba(201,169,110,0.03)',
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: gold, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 2 }}>
              ✎ Bulk Edit
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: text1 }}>
              {selectedIds.size} of {variants.length} variant{variants.length !== 1 ? 's' : ''} selected
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: text3,
            fontSize: 26, cursor: 'pointer', padding: '0 8px',
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {/* Field selector + value input */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <Label>Field to update</Label>
              <Select value={field} onChange={v => { setField(v); setValue(''); }} options={fieldOptions} />
            </div>
            {field === 'sku' && (
              <div style={{ width: 140 }}>
                <Label>Mode</Label>
                <Select
                  value={skuMode}
                  onChange={setSkuMode}
                  options={[
                    { value: 'replace', label: 'Replace' },
                    { value: 'prefix',  label: 'Prepend' },
                    { value: 'suffix',  label: 'Append' },
                  ]}
                />
              </div>
            )}
            <div style={{ flex: 1.5 }}>
              <Label>{field === 'sku' && skuMode !== 'replace' ? `Text to ${skuMode === 'prefix' ? 'prepend' : 'append'}` : 'New value'}</Label>
              {field === 'sku' ? (
                <input
                  type="text"
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder={skuMode === 'prefix' ? 'e.g. RSZ-' : skuMode === 'suffix' ? 'e.g. -2026' : 'Full SKU'}
                  style={{
                    width: '100%', padding: '9px 12px',
                    background: bgPage, border: `1px solid ${border}`, borderRadius: 6,
                    color: text1, fontSize: 13, fontFamily: 'monospace', outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              ) : (
                <NumInput
                  value={value}
                  onChange={setValue}
                  placeholder="0"
                  step={field === 'stock' || field === 'weight' ? '1' : '0.01'}
                />
              )}
            </div>
          </div>

          {/* Select all toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderRadius: 6,
            background: 'rgba(201,169,110,0.04)',
            border: `1px solid ${border}`, marginBottom: 8,
          }}>
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={toggleAll}
              style={{ cursor: 'pointer' }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: text2 }}>
              {isAllSelected ? 'Deselect all' : 'Select all'}
            </span>
          </div>

          {/* Variant list */}
          <div style={{
            border: `1px solid ${border}`, borderRadius: 6, overflow: 'hidden',
          }}>
            {variants.map((v, i) => {
              const sid = String(v[idKey]);
              const checked = selectedIds.has(sid);
              return (
                <label
                  key={sid}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px',
                    borderBottom: i < variants.length - 1 ? `1px solid ${border}` : 'none',
                    cursor: 'pointer',
                    background: checked ? 'rgba(201,169,110,0.05)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOne(sid)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ flex: 1, fontSize: 13, color: text1 }}>{v[labelKey]}</span>
                  <span style={{
                    fontSize: 11, color: text3, fontFamily: 'monospace',
                    background: bgPage, padding: '2px 6px', borderRadius: 3,
                  }}>
                    {labelByField[field]}: {currentValueOf(v, field) || '—'}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px',
          borderTop: `1px solid ${border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'rgba(201,169,110,0.03)',
        }}>
          <div style={{ fontSize: 12, color: text3 }}>
            Click <strong>Apply</strong>, then <strong>Save</strong> on page to push to Shopify
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn onClick={handleApply} primary disabled={selectedIds.size === 0}>
              Apply to {selectedIds.size}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ────────────────────────────────────────────────────────────────────────────
export default function NewProductPage() {
  const router = useRouter();
  const { can } = useUser();

  // ── Route-level permission guard (May 2 2026) ──
  // Sidebar link inventory/page.js mein already gated, but direct URL access
  // bhi block karna chahiye. Actual guard return main render se pehle hai.
  const canCreate = can('inventory.create');

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
    cost_per_item: '',           // M2.E — cost (Shopify inventory_item.cost)
    sku: '',
    seo_meta_title: '',
    seo_meta_description: '',
    collections: [],
    images: [],
    // M2.D — inventory tracking
    track_inventory: true,
    initial_stock: '',
    // M2.D — variant options
    use_variant_options: false,
    options: [],                  // [{name, values: []}] up to 2
    variants_generated: [],       // generated from options
    variant_image_assignments: {}, // M2.F — { option1Value: imageId } - per-color image
    expanded_groups: {},          // M2.F — { option1Value: bool } - which groups are expanded
    // M2.K — Weight (defaults applied to all variants; per-variant overrides via variant table)
    weight: '',                   // number string (in weight_unit)
    weight_unit: 'g',             // 'g' | 'kg' | 'oz' | 'lb'
    // M2.D — Google Shopping metafields
    google_age_group: '',
    google_gender: '',
    google_condition: '',
    google_mpn: '',
  });
  const [handleManuallyEdited, setHandleManuallyEdited] = useState(false);
  const [descMode, setDescMode] = useState('edit');   // edit | preview
  const [creating, setCreating] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  // Master collections list
  const [allCollections, setAllCollections] = useState([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);

  // M2.I — AI Enhance state
  const [aiEnhanceOpen, setAiEnhanceOpen] = useState(false);
  const [aiPendingExtras, setAiPendingExtras] = useState(null);
  const [aiAppliedFlash, setAiAppliedFlash] = useState(null);
  // M2.J — track enhancement_id from modal so server marks ai_enhancements row pushed
  const [aiEnhancementId, setAiEnhancementId] = useState(null);

  // M2.K — Bulk Edit modal state
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  // M2.I — Live SEO Score (recomputes on every draft change)
  const liveSeo = useMemo(() => {
    try {
      return calculateSeoScore({
        parent_title: draft.title || '',
        description_html: draft.description_html || '',
        tags: draft.tags || [],
        handle: draft.handle || '',
        seo_meta_title: draft.seo_meta_title || '',
        seo_meta_description: draft.seo_meta_description || '',
        // For new products, images_data uses the previewUrl/alt fields from staged uploads
        images_data: (draft.images || []).map((img, i) => ({
          id: img.id || `staged-${i}`,
          src: img.previewUrl || img.src || '',
          alt: img.alt || '',
          position: i + 1,
        })),
      });
    } catch (e) {
      return null;
    }
  }, [draft]);

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

  // M2.I — Apply AI-generated content into the new-product draft
  const handleAiApply = (payload) => {
    if (!payload || !payload.fields) return;
    const f = payload.fields;
    const applied = [];

    setDraft(d => {
      const next = { ...d };
      if (typeof f.title === 'string')                  { next.title = f.title; applied.push('Title'); }
      if (typeof f.description_html === 'string')       { next.description_html = f.description_html; applied.push('Description'); }
      if (typeof f.seo_meta_title === 'string')         { next.seo_meta_title = f.seo_meta_title; applied.push('Meta Title'); }
      if (typeof f.seo_meta_description === 'string')   { next.seo_meta_description = f.seo_meta_description; applied.push('Meta Description'); }
      if (typeof f.handle === 'string' && f.handle)     { next.handle = f.handle; applied.push('URL Handle'); }
      if (Array.isArray(f.tags))                        { next.tags = f.tags; applied.push('Tags'); }

      // Image alt texts — match by 1-based position to draft.images
      if (Array.isArray(f.alt_texts) && f.alt_texts.length > 0 && Array.isArray(d.images)) {
        const imgs = [...d.images];
        let touched = 0;
        for (const at of f.alt_texts) {
          const i = (at.position || 0) - 1;
          if (i >= 0 && i < imgs.length) {
            imgs[i] = { ...imgs[i], alt: at.alt || '' };
            touched++;
          }
        }
        if (touched > 0) {
          next.images = imgs;
          applied.push(`${touched} Image Alt${touched !== 1 ? 's' : ''}`);
        }
      }
      return next;
    });

    if (payload.extras && Object.keys(payload.extras).length > 0) {
      setAiPendingExtras(payload.extras);
    }
    // M2.J — capture enhancement_id so create handler can mark DB record
    if (payload.enhancement_id) {
      setAiEnhancementId(payload.enhancement_id);
    }
    setAiAppliedFlash({ fields: applied, ts: Date.now() });
    setTimeout(() => setAiAppliedFlash(null), 4500);
  };

  // M2.D — option/variant helpers
  const addOption = () => {
    if (draft.options.length >= 2) {
      alert('Maximum 2 options supported (e.g. Size + Color).');
      return;
    }
    setDraft(d => {
      const newOpts = [...d.options, { name: '', values: [] }];
      return { ...d, options: newOpts, variants_generated: generateVariantMatrix(newOpts, d.variants_generated) };
    });
  };
  const updateOption = (idx, newOpt) => {
    setDraft(d => {
      const newOpts = d.options.map((o, i) => i === idx ? newOpt : o);
      return { ...d, options: newOpts, variants_generated: generateVariantMatrix(newOpts, d.variants_generated) };
    });
  };
  const removeOption = (idx) => {
    setDraft(d => {
      const newOpts = d.options.filter((_, i) => i !== idx);
      return { ...d, options: newOpts, variants_generated: generateVariantMatrix(newOpts, d.variants_generated) };
    });
  };
  const updateGeneratedVariant = (idx, field, value) => {
    setDraft(d => ({
      ...d,
      variants_generated: d.variants_generated.map((v, i) => i === idx ? { ...v, [field]: value } : v),
    }));
  };

  // M2.K — Bulk Edit apply for new product variants.
  // Modal sends back stringified indices (since variants don't have shopify_variant_id yet).
  // Field mapping: 'price'→'price', 'compare_at_price'→same, 'sku'→same,
  // 'stock'→'stock', 'weight'→'weight'. (No selling_price translation needed
  // since new-page variant rows already use 'price'.)
  const handleBulkApply = ({ variantIds, field, value, skuMode }) => {
    const idxSet = new Set((variantIds || []).map(s => Number(s)));
    const FIELD_MAP = {
      price:            'price',
      compare_at_price: 'compare_at_price',
      sku:              'sku',
      stock:            'stock',
      weight:           'weight',
    };
    const draftField = FIELD_MAP[field] || field;
    setDraft(d => ({
      ...d,
      variants_generated: (d.variants_generated || []).map((v, i) => {
        if (!idxSet.has(i)) return v;
        let nextVal;
        if (draftField === 'sku') {
          const cur = v.sku || '';
          if (skuMode === 'prefix')      nextVal = `${value}${cur}`;
          else if (skuMode === 'suffix') nextVal = `${cur}${value}`;
          else                           nextVal = value;
        } else {
          nextVal = value;
        }
        return { ...v, [draftField]: nextVal };
      }),
    }));
    setBulkEditOpen(false);
  };

  // M2.F — broadcast a field's value to all variants in a group (by option1 value)
  const setGroupField = (groupKey, field, value) => {
    setDraft(d => ({
      ...d,
      variants_generated: d.variants_generated.map(v =>
        v.option1 === groupKey ? { ...v, [field]: value } : v
      ),
    }));
  };

  // M2.F — toggle expanded/collapsed for a group
  const toggleGroupExpanded = (groupKey) => {
    setDraft(d => ({
      ...d,
      expanded_groups: { ...d.expanded_groups, [groupKey]: !d.expanded_groups[groupKey] },
    }));
  };

  // M2.F + M2.H — assign an image to a variant key (group key like "Black"
  // OR composite sub-variant key like "Black|2.4"). Sub-variants without an
  // own assignment inherit from their group's assignment at render/save time.
  const setVariantAssignment = (key, imageId) => {
    setDraft(d => ({
      ...d,
      variant_image_assignments: { ...d.variant_image_assignments, [key]: imageId },
    }));
  };
  const clearVariantAssignment = (key) => {
    setDraft(d => {
      const next = { ...d.variant_image_assignments };
      delete next[key];
      return { ...d, variant_image_assignments: next };
    });
  };
  const toggleVariantOptions = (on) => {
    setDraft(d => ({
      ...d,
      use_variant_options: on,
      // when enabling, seed with one empty option to give user something to fill
      options: on ? (d.options.length > 0 ? d.options : [{ name: '', values: [] }]) : d.options,
    }));
  };

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
    const usingVariantOptions = draft.use_variant_options
      && draft.options.length > 0
      && draft.options.every(o => o.name && o.values.length > 0)
      && draft.variants_generated.length > 0;

    // ─── May 2026 — Per-image upload pattern ───────────────────────────────
    // Pehle saari images base64 ke saath ek POST body mein bhej rahe thay,
    // 6+ heavy images Vercel ki 4.5MB limit cross kar sakti thi → "Request
    // Entity Too Large" error (same root cause as Issue 6 reported on edit
    // page). Ab create flow split karte hain:
    //   1. POST /api/products without images (just metadata + variants)
    //   2. Sequential POST /api/products/[id]/upload-image (one at a time)
    //   3. POST /api/products/[id]/assign-variant-images (if assignments)
    // ───────────────────────────────────────────────────────────────────────

    const payload = {
      title: draft.title.trim(),
      description_html: draft.description_html || undefined,
      vendor: draft.vendor || undefined,
      product_type: draft.product_type || undefined,
      tags: draft.tags.length > 0 ? draft.tags : undefined,
      handle: draft.handle || undefined,
      status: draft.status,
      seo_meta_title: draft.seo_meta_title || undefined,
      seo_meta_description: draft.seo_meta_description || undefined,
      collections: draft.collections.length > 0
        ? draft.collections.map(c => ({ id: c.id, handle: c.handle, title: c.title }))
        : undefined,
      // ⚠️ Images intentionally NOT in initial POST — uploaded separately below
      // M2.D — inventory tracking
      track_inventory: draft.track_inventory,
      initial_stock: draft.initial_stock !== '' ? Number(draft.initial_stock) : undefined,
      // M2.E — Cost per item (applied to all variants via inventory_item.cost)
      cost_per_item: draft.cost_per_item !== '' ? draft.cost_per_item : undefined,
      // M2.D — Google Shopping metafields (only send if non-empty)
      google_age_group: draft.google_age_group || undefined,
      google_gender:    draft.google_gender    || undefined,
      google_condition: draft.google_condition || undefined,
      google_mpn:       draft.google_mpn       || undefined,
    };

    // M2.J — Inject AI Enhance extras into payload
    if (aiPendingExtras) {
      if (Array.isArray(aiPendingExtras.faqs))            payload.ai_faqs            = aiPendingExtras.faqs;
      if (Array.isArray(aiPendingExtras.mf_occasion))     payload.ai_mf_occasion     = aiPendingExtras.mf_occasion;
      if (Array.isArray(aiPendingExtras.mf_set_contents)) payload.ai_mf_set_contents = aiPendingExtras.mf_set_contents;
      if (Array.isArray(aiPendingExtras.mf_stone_type))   payload.ai_mf_stone_type   = aiPendingExtras.mf_stone_type;
      if (typeof aiPendingExtras.mf_material === 'string')     payload.ai_mf_material     = aiPendingExtras.mf_material;
      if (typeof aiPendingExtras.mf_color_finish === 'string') payload.ai_mf_color_finish = aiPendingExtras.mf_color_finish;
    }
    // M2.J — pass enhancement_id so server can mark ai_enhancements row pushed
    if (aiEnhancementId) {
      payload.ai_enhancement_id = aiEnhancementId;
    }

    if (usingVariantOptions) {
      // Multi-variant flow — variant fields fall back to main values when empty
      payload.options = draft.options.map(o => ({ name: o.name, values: o.values }));
      payload.variants_input = draft.variants_generated.map(v => ({
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        // Variant-specific OR fall back to main
        price: (v.price !== '' && v.price !== null && v.price !== undefined) ? v.price : (draft.price || undefined),
        compare_at_price: (v.compare_at_price !== '' && v.compare_at_price !== null && v.compare_at_price !== undefined) ? v.compare_at_price : (draft.compare_at_price || undefined),
        sku: v.sku || undefined,
        stock: v.stock,
        // M2.K — variant-specific weight OR fall back to main weight
        weight: (v.weight !== '' && v.weight !== null && v.weight !== undefined) ? v.weight : (draft.weight || undefined),
        weight_unit: draft.weight_unit || 'g',
      }));

      // Note: variant_image_assignments handled AFTER image uploads below.
      // Frontend builds resolvedAssignments using the actual Shopify image
      // IDs returned from /upload-image, then calls /assign-variant-images.
    } else {
      // Default-variant flow — single price/compare/sku
      payload.price = draft.price !== '' ? draft.price : undefined;
      payload.compare_at_price = draft.compare_at_price !== '' ? draft.compare_at_price : undefined;
      payload.sku = draft.sku || undefined;
    }

    // M2.K — Top-level weight (applies to default variant OR feeds variants_input fallback)
    payload.weight      = draft.weight !== '' ? draft.weight : undefined;
    payload.weight_unit = draft.weight_unit || 'g';

    try {
      // ── Step 1: Create product (no images) ──
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // Defensive parse — Vercel can return plain text on infra errors
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 120)}`); }

      if (!data.success || !data.shopify_product_id) {
        setSaveResult(data);
        setCreating(false);
        return;
      }

      const newProductId = data.shopify_product_id;

      // ── Step 2: Upload images sequentially (avoids body-size limit) ──
      // Map _id (frontend ref) → Shopify image id (real after upload), so
      // variant assignments can be resolved in Step 3.
      const idMap = {};
      const uploadResults = [];
      if (Array.isArray(draft.images) && draft.images.length > 0) {
        setSaveResult({
          success: true,
          partial: false,
          in_progress: true,
          message: `Product created. Uploading 0 / ${draft.images.length} images…`,
          shopify_product_id: newProductId,
        });

        for (let i = 0; i < draft.images.length; i++) {
          const img = draft.images[i];
          try {
            const ur = await fetch(`/api/products/${newProductId}/upload-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filename: img.filename,
                attachment: img.base64,
                alt: img.alt || '',
              }),
            });
            const utext = await ur.text();
            let ud;
            try { ud = JSON.parse(utext); }
            catch { throw new Error(`Upload ${i + 1} returned non-JSON: ${utext.slice(0, 80)}`); }

            if (!ud.success) throw new Error(ud.error || `Upload ${i + 1} failed`);
            uploadResults.push({ filename: img.filename, success: true, id: ud.image_id });
            if (img._id) idMap[img._id] = String(ud.image_id);
          } catch (e) {
            uploadResults.push({ filename: img.filename, success: false, error: e.message });
            // Don't abort entire create — product already exists. Surface
            // partial result so user knows which images failed.
            console.error(`[create] image ${i + 1} upload failed:`, e.message);
          }

          setSaveResult({
            success: true,
            partial: false,
            in_progress: true,
            message: `Uploaded ${i + 1} / ${draft.images.length} images…`,
            shopify_product_id: newProductId,
          });
        }
      }

      // ── Step 3: Apply variant_image_assignments if any ──
      // draft.variant_image_assignments stores values as image _id (frontend
      // ref). We translate to actual Shopify image ID using idMap.
      let assignResult = null;
      if (
        usingVariantOptions
        && draft.variant_image_assignments
        && Object.keys(draft.variant_image_assignments).length > 0
        && Object.keys(idMap).length > 0
      ) {
        const resolvedAssignments = {};
        for (const [key, frontendId] of Object.entries(draft.variant_image_assignments)) {
          if (!frontendId) continue;
          const shopifyImgId = idMap[frontendId];
          if (shopifyImgId) resolvedAssignments[key] = shopifyImgId;
        }

        if (Object.keys(resolvedAssignments).length > 0) {
          try {
            const ar = await fetch(`/api/products/${newProductId}/assign-variant-images`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ assignments: resolvedAssignments }),
            });
            const atext = await ar.text();
            try { assignResult = JSON.parse(atext); }
            catch { assignResult = { success: false, error: `non-JSON: ${atext.slice(0, 80)}` }; }
          } catch (e) {
            assignResult = { success: false, error: e.message };
          }
        }
      }

      // ── Final result aggregation ──
      const allUploadsOk = uploadResults.every(r => r.success);
      const finalResult = {
        ...data,
        in_progress: false,
        images_uploaded: uploadResults.filter(r => r.success).length,
        images_total: draft.images.length,
        upload_results: uploadResults,
        variant_assignments: assignResult,
        partial: !allUploadsOk || (assignResult && assignResult.success === false),
      };
      setSaveResult(finalResult);

      // Redirect to the editor regardless — product exists. User can re-try
      // failed uploads from the editor's Media card.
      setTimeout(() => {
        router.push(`/inventory/${newProductId}`);
      }, 1200);
    } catch (e) {
      setSaveResult({ success: false, error: e.message });
      setCreating(false);
    }
  };

  // ── Access denied (no inventory.create permission) ──
  if (!canCreate) {
    return (
      <div style={{ padding: 60, maxWidth: 600, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, color: '#fff', fontWeight: 600, marginBottom: 8 }}>Permission denied</div>
        <div style={{ fontSize: 13, color: text3, marginBottom: 18, lineHeight: 1.5 }}>
          Naya product create karne ki ijazat tumhe nahi hai. CEO se{' '}
          <code style={{ background: '#1a1a1a', padding: '2px 6px', borderRadius: 4 }}>inventory.create</code>{' '}
          permission grant karwane ko bolo.
        </div>
        <Link href="/inventory" style={{ background: 'transparent', border: `1px solid ${border}`, color: '#ccc', borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-block' }}>
          ← Inventory list pe wapas
        </Link>
      </div>
    );
  }

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

      {/* M2.I — AI Applied flash */}
      {aiAppliedFlash && (
        <div style={{
          padding: '10px 14px', marginBottom: 14, borderRadius: 8,
          background: 'rgba(201,169,110,0.08)',
          border: `1px solid ${gold}`,
          color: gold, fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>
            ✨ AI applied to form: <span style={{ color: text1, fontWeight: 600 }}>
              {aiAppliedFlash.fields.length > 0 ? aiAppliedFlash.fields.join(', ') : 'no fields'}
            </span>
            <span style={{ marginLeft: 8, color: text3, fontSize: 11 }}>
              · Click "Create Product" to push to Shopify
            </span>
          </span>
          <button onClick={() => setAiAppliedFlash(null)} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* M2.I/M2.J — AI pending extras */}
      {aiPendingExtras && (
        <div style={{
          padding: '10px 14px', marginBottom: 14, borderRadius: 8,
          background: 'rgba(251,191,36,0.06)',
          border: '1px solid rgba(251,191,36,0.3)',
          color: '#fbbf24', fontSize: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>
            ⏳ AI also generated extras (will save with Create Product):
            {Array.isArray(aiPendingExtras.faqs) && aiPendingExtras.faqs.length > 0 &&
              <span style={{ marginLeft: 6 }}>{aiPendingExtras.faqs.length} FAQ{aiPendingExtras.faqs.length !== 1 ? 's' : ''}</span>}
            {Array.isArray(aiPendingExtras.mf_occasion) && aiPendingExtras.mf_occasion.length > 0 &&
              <span style={{ marginLeft: 6 }}>· Occasion ({aiPendingExtras.mf_occasion.length})</span>}
            {Array.isArray(aiPendingExtras.mf_set_contents) && aiPendingExtras.mf_set_contents.length > 0 &&
              <span style={{ marginLeft: 6 }}>· Set Contents ({aiPendingExtras.mf_set_contents.length})</span>}
            {Array.isArray(aiPendingExtras.mf_stone_type) && aiPendingExtras.mf_stone_type.length > 0 &&
              <span style={{ marginLeft: 6 }}>· Stone Type ({aiPendingExtras.mf_stone_type.length})</span>}
            {aiPendingExtras.mf_material && <span style={{ marginLeft: 6 }}>· Material</span>}
            {aiPendingExtras.mf_color_finish && <span style={{ marginLeft: 6 }}>· Color/Finish</span>}
          </span>
          <button onClick={() => setAiPendingExtras(null)} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 16 }}>×</button>
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => setAiEnhanceOpen(true)}
                  title="Generate description, meta tags, alt texts, FAQs with AI"
                  style={{
                    padding: '5px 11px',
                    background: 'linear-gradient(135deg, rgba(201,169,110,0.18), rgba(201,169,110,0.06))',
                    border: `1px solid ${gold}`,
                    borderRadius: 6,
                    color: gold,
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    letterSpacing: 0.3,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <span>✨</span><span>AI Enhance</span>
                </button>
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

          {/* Pricing (M2.E — dedicated card, Shopify-style) */}
          <Card title="Pricing">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <Label hint="PKR — what customer pays">Price</Label>
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 10, top: '50%',
                    transform: 'translateY(-50%)', color: text3,
                    fontSize: 13, pointerEvents: 'none',
                  }}>Rs</span>
                  <input
                    type="number"
                    value={draft.price}
                    onChange={e => setField('price', e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    style={{
                      width: '100%', padding: '8px 10px 8px 32px',
                      background: bgPage, border: `1px solid ${border}`, borderRadius: 5,
                      color: text1, fontSize: 14, fontFamily: 'monospace', outline: 'none',
                    }}
                    onFocus={e => e.target.style.borderColor = gold}
                    onBlur={e => e.target.style.borderColor = border}
                  />
                </div>
              </div>
              <div>
                <Label hint="Strike-through price — show discount">Compare-at price</Label>
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 10, top: '50%',
                    transform: 'translateY(-50%)', color: text3,
                    fontSize: 13, pointerEvents: 'none',
                  }}>Rs</span>
                  <input
                    type="number"
                    value={draft.compare_at_price}
                    onChange={e => setField('compare_at_price', e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    style={{
                      width: '100%', padding: '8px 10px 8px 32px',
                      background: bgPage, border: `1px solid ${border}`, borderRadius: 5,
                      color: text1, fontSize: 14, fontFamily: 'monospace', outline: 'none',
                    }}
                    onFocus={e => e.target.style.borderColor = gold}
                    onBlur={e => e.target.style.borderColor = border}
                  />
                </div>
              </div>
            </div>

            {/* Cost per item */}
            <div>
              <Label hint="Customer-side mai nahi dikhta — sirf aapke margin ke liye">Cost per item</Label>
              <div style={{ position: 'relative', maxWidth: 240 }}>
                <span style={{
                  position: 'absolute', left: 10, top: '50%',
                  transform: 'translateY(-50%)', color: text3,
                  fontSize: 13, pointerEvents: 'none',
                }}>Rs</span>
                <input
                  type="number"
                  value={draft.cost_per_item}
                  onChange={e => setField('cost_per_item', e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  style={{
                    width: '100%', padding: '8px 10px 8px 32px',
                    background: bgPage, border: `1px solid ${border}`, borderRadius: 5,
                    color: text1, fontSize: 14, fontFamily: 'monospace', outline: 'none',
                  }}
                  onFocus={e => e.target.style.borderColor = gold}
                  onBlur={e => e.target.style.borderColor = border}
                />
              </div>
            </div>

            {/* Profit + Margin (computed) */}
            {(() => {
              const p = Number(draft.price) || 0;
              const c = Number(draft.cost_per_item) || 0;
              if (p <= 0 || c <= 0) return null;
              const profit = p - c;
              const margin = p > 0 ? (profit / p) * 100 : 0;
              const profitColor = profit >= 0 ? '#4ade80' : '#f87171';
              return (
                <div style={{
                  marginTop: 14, padding: '10px 12px',
                  background: 'rgba(74,222,128,0.05)',
                  border: '1px solid rgba(74,222,128,0.2)',
                  borderRadius: 6,
                  display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
                  fontSize: 13,
                }}>
                  <div>
                    <span style={{ color: text3, fontSize: 11 }}>Profit</span>{' '}
                    <span style={{ color: profitColor, fontWeight: 600, fontFamily: 'monospace' }}>
                      Rs {profit >= 0 ? '+' : ''}{profit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div style={{ width: 1, height: 16, background: border }} />
                  <div>
                    <span style={{ color: text3, fontSize: 11 }}>Margin</span>{' '}
                    <span style={{ color: profitColor, fontWeight: 600, fontFamily: 'monospace' }}>
                      {margin >= 0 ? '+' : ''}{margin.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })()}

            {draft.use_variant_options && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(201,169,110,0.05)', borderRadius: 5, fontSize: 11, color: text2 }}>
                💡 Yeh values <strong style={{ color: gold }}>default</strong> hain saare variants ke liye. Neeche variant table me individual variant ka price override kar sakte ho.
              </div>
            )}
          </Card>

          {/* M2.K — Shipping / Weight */}
          <Card title="Shipping">
            <Label hint="Default for all variants. Per-variant override possible in variants table.">Weight</Label>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <NumInput
                  value={draft.weight}
                  onChange={v => setField('weight', v)}
                  placeholder="0.0"
                />
              </div>
              <div style={{ width: 100 }}>
                <Select
                  value={draft.weight_unit || 'g'}
                  onChange={v => setField('weight_unit', v)}
                  options={[
                    { value: 'g',  label: 'g' },
                    { value: 'kg', label: 'kg' },
                    { value: 'oz', label: 'oz' },
                    { value: 'lb', label: 'lb' },
                  ]}
                />
              </div>
            </div>
            {draft.use_variant_options && (
              <div style={{ marginTop: 10, padding: 10, background: 'rgba(201,169,110,0.05)', borderRadius: 5, fontSize: 11, color: text2 }}>
                💡 Yeh weight <strong style={{ color: gold }}>default</strong> hai saare variants ke liye. Variant table me Weight column se individual override karen.
              </div>
            )}
          </Card>

          {/* Variants & Inventory (M2.D — simplified, autofills from Pricing) */}
          <Card
            title="Variants & Inventory"
            right={
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {draft.use_variant_options && (draft.variants_generated?.length || 0) > 1 && (
                  <button
                    onClick={() => setBulkEditOpen(true)}
                    title="Edit a single field across multiple variants at once"
                    style={{
                      padding: '5px 11px',
                      background: 'rgba(201,169,110,0.08)',
                      border: `1px solid ${gold}`,
                      borderRadius: 6,
                      color: gold,
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      letterSpacing: 0.3,
                    }}
                  >
                    ✎ Bulk Edit
                  </button>
                )}
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: text2, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={draft.use_variant_options}
                    onChange={e => toggleVariantOptions(e.target.checked)}
                    style={{ accentColor: gold }}
                  />
                  This product has variants (size/color/etc)
                </label>
              </div>
            }
          >
            {/* Inventory tracking — applies to both single + multi variant flows */}
            <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${border}` }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 6 }}>
                <input
                  type="checkbox"
                  checked={draft.track_inventory}
                  onChange={e => setField('track_inventory', e.target.checked)}
                  style={{ accentColor: gold }}
                />
                <span style={{ fontSize: 13, color: text1 }}>Track inventory in Shopify</span>
              </label>
              <div style={{ fontSize: 11, color: text3 }}>
                Recommended ON — storefront will block out-of-stock orders.
              </div>
            </div>

            {!draft.use_variant_options ? (
              // ── Single default variant ──
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <Label>SKU</Label>
                  <TextInput
                    value={draft.sku}
                    onChange={v => setField('sku', v)}
                    placeholder="optional — e.g. RSZ-EAR-001"
                    mono
                  />
                </div>
                {draft.track_inventory && (
                  <div>
                    <Label>Initial stock</Label>
                    <TextInput
                      type="number"
                      value={draft.initial_stock}
                      onChange={v => setField('initial_stock', v)}
                      placeholder="0"
                    />
                  </div>
                )}
              </div>
            ) : (
              // ── Variant options builder ──
              <>
                <div style={{ marginBottom: 14 }}>
                  {draft.options.map((opt, idx) => (
                    <OptionRow
                      key={idx}
                      option={opt}
                      onChange={newOpt => updateOption(idx, newOpt)}
                      onRemove={() => removeOption(idx)}
                    />
                  ))}
                  {draft.options.length < 2 && (
                    <button onClick={addOption} style={{
                      width: '100%', padding: '8px', background: 'transparent',
                      border: `1px dashed ${border}`, color: text2,
                      borderRadius: 6, fontSize: 12, fontFamily: 'inherit',
                      cursor: 'pointer',
                    }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = gold}
                      onMouseLeave={e => e.currentTarget.style.borderColor = border}
                    >
                      + Add another option {draft.options.length === 0 ? '(e.g. Size)' : '(e.g. Color)'}
                    </button>
                  )}
                </div>

                {/* Variants matrix — grouped by option1 when 2+ options (M2.F) */}
                {draft.variants_generated.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <Label hint={`${draft.variants_generated.length} variants — empty fields = use main pricing`}>
                      Variants
                      {draft.options.length >= 2 && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: text3, fontWeight: 400 }}>
                          · grouped by {draft.options[0]?.name || 'Option 1'}
                        </span>
                      )}
                    </Label>

                    {draft.options.length >= 2 ? (
                      // ── GROUPED VIEW (Color → Sizes nested) ──
                      <div style={{ border: `1px solid ${border}`, borderRadius: 6, overflow: 'hidden' }}>
                        {groupVariantsByOption1(draft.variants_generated, draft.options).map(group => {
                          const isExpanded = !!draft.expanded_groups[group.key];
                          const groupPrice = getGroupCommonValue(group.variants, 'price');
                          const totalStock = getGroupTotalStock(group.variants);
                          const isMixedPrice = groupPrice === '__MIXED__';

                          return (
                            <div key={group.key}>
                              {/* PARENT ROW */}
                              <div style={{
                                display: 'grid',
                                gridTemplateColumns: '44px 44px 1fr 110px 90px 32px',
                                gap: 8, padding: '10px 10px',
                                background: 'rgba(201,169,110,0.04)',
                                borderBottom: isExpanded ? `1px solid ${border}` : 'none',
                                alignItems: 'center',
                              }}>
                                {/* Expand toggle */}
                                <button onClick={() => toggleGroupExpanded(group.key)}
                                  style={{
                                    background: 'transparent', border: 'none', color: text2,
                                    cursor: 'pointer', fontSize: 14, padding: 4,
                                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.15s',
                                  }}
                                  title={isExpanded ? 'Collapse' : 'Expand'}
                                >▶</button>

                                {/* Image picker for this group */}
                                <VariantImagePicker
                                  size={44}
                                  images={draft.images}
                                  selectedId={draft.variant_image_assignments[group.key]}
                                  inheritedId={null}
                                  onSelect={(imgId) => setVariantAssignment(group.key, imgId)}
                                  onClear={() => clearVariantAssignment(group.key)}
                                  groupLabel={group.label}
                                />

                                {/* Group label */}
                                <div>
                                  <div style={{ fontWeight: 600, color: text1, fontSize: 13 }}>{group.label}</div>
                                  <div style={{ fontSize: 11, color: text3 }}>
                                    {group.variants.length} {draft.options[1]?.name?.toLowerCase() || 'sub'}-variant{group.variants.length !== 1 ? 's' : ''}
                                  </div>
                                </div>

                                {/* Group price (broadcast) */}
                                <input
                                  type="number"
                                  value={isMixedPrice ? '' : (groupPrice || '')}
                                  onChange={e => setGroupField(group.key, 'price', e.target.value)}
                                  placeholder={isMixedPrice ? 'Mixed' : (draft.price || '0.00')}
                                  step="0.01"
                                  title={isMixedPrice ? 'Sub-variants have different prices — type to broadcast' : 'Applies to all sizes'}
                                  style={{
                                    padding: '6px 8px',
                                    background: bgPage,
                                    border: `1px solid ${isMixedPrice ? '#fb923c' : border}`,
                                    borderRadius: 4, color: text1, fontSize: 12,
                                    fontFamily: 'monospace', outline: 'none',
                                  }}
                                  onFocus={e => e.target.style.borderColor = gold}
                                  onBlur={e => e.target.style.borderColor = isMixedPrice ? '#fb923c' : border}
                                />

                                {/* Total stock (read-only sum) */}
                                {draft.track_inventory ? (
                                  <div style={{
                                    padding: '6px 8px', background: bgPage,
                                    border: `1px solid ${border}`, borderRadius: 4,
                                    color: text2, fontSize: 12, fontFamily: 'monospace',
                                    textAlign: 'right',
                                  }} title="Sum of sub-variant stocks (edit per-size below)">
                                    {totalStock}
                                  </div>
                                ) : <div />}

                                <div />
                              </div>

                              {/* SUB-VARIANT ROWS (when expanded) */}
                              {isExpanded && (
                                <div style={{ background: bgPage }}>
                                  {group.variants.map((sv) => {
                                    // Find this sub-variant's index in the FULL array
                                    const fullIdx = draft.variants_generated.findIndex(
                                      v => v.option1 === sv.option1 && v.option2 === sv.option2 && v.option3 === sv.option3
                                    );
                                    const mainPrice = draft.price || '';
                                    // M2.H — composite key for sub-variant image override
                                    const subKey = `${sv.option1 ?? ''}|${sv.option2 ?? ''}|${sv.option3 ?? ''}`;
                                    const ownImg       = draft.variant_image_assignments[subKey];
                                    const inheritedImg = draft.variant_image_assignments[group.key];
                                    return (
                                      <div key={sv.title} style={{
                                        display: 'grid',
                                        gridTemplateColumns: '44px 36px 1fr 110px 90px 130px',
                                        gap: 8, padding: '8px 10px',
                                        borderBottom: `1px solid ${border}`,
                                        alignItems: 'center',
                                        fontSize: 12,
                                      }}>
                                        <div /> {/* indent */}
                                        <VariantImagePicker
                                          size={32}
                                          images={draft.images}
                                          selectedId={ownImg}
                                          inheritedId={inheritedImg}
                                          onSelect={(imgId) => setVariantAssignment(subKey, imgId)}
                                          onClear={() => clearVariantAssignment(subKey)}
                                          groupLabel={`${group.label} / ${sv.option2 || ''}`}
                                        />
                                        <div style={{ color: text2, paddingLeft: 4 }}>
                                          <span style={{ color: text3, fontSize: 10, marginRight: 4 }}>
                                            {draft.options[1]?.name || 'Size'}:
                                          </span>
                                          {sv.option2 || '—'}
                                        </div>
                                        <input
                                          type="number"
                                          value={sv.price || ''}
                                          onChange={e => updateGeneratedVariant(fullIdx, 'price', e.target.value)}
                                          placeholder={mainPrice || '0.00'}
                                          step="0.01"
                                          style={{
                                            padding: '6px 8px', background: card,
                                            border: `1px solid ${border}`, borderRadius: 4,
                                            color: text1, fontSize: 12, fontFamily: 'monospace', outline: 'none',
                                          }}
                                          onFocus={e => e.target.style.borderColor = gold}
                                          onBlur={e => e.target.style.borderColor = border}
                                        />
                                        {draft.track_inventory ? (
                                          <input
                                            type="number"
                                            value={sv.stock || ''}
                                            onChange={e => updateGeneratedVariant(fullIdx, 'stock', e.target.value)}
                                            placeholder="0"
                                            step="1"
                                            style={{
                                              padding: '6px 8px', background: card,
                                              border: `1px solid ${border}`, borderRadius: 4,
                                              color: text1, fontSize: 12, fontFamily: 'monospace', outline: 'none',
                                            }}
                                            onFocus={e => e.target.style.borderColor = gold}
                                            onBlur={e => e.target.style.borderColor = border}
                                          />
                                        ) : <div />}
                                        <input
                                          type="text"
                                          value={sv.sku || ''}
                                          onChange={e => updateGeneratedVariant(fullIdx, 'sku', e.target.value)}
                                          placeholder={`${group.label.slice(0,3).toUpperCase()}-${sv.option2 || ''}`}
                                          style={{
                                            padding: '6px 8px', background: card,
                                            border: `1px solid ${border}`, borderRadius: 4,
                                            color: text1, fontSize: 12, fontFamily: 'monospace', outline: 'none',
                                          }}
                                          onFocus={e => e.target.style.borderColor = gold}
                                          onBlur={e => e.target.style.borderColor = border}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      // ── FLAT VIEW (single option) — original table ──
                      <div style={{ overflowX: 'auto', border: `1px solid ${border}`, borderRadius: 6 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: 'rgba(201,169,110,0.03)', borderBottom: `1px solid ${border}` }}>
                              <th style={{ padding: '8px 10px', textAlign: 'left', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>Variant</th>
                              <th style={{ padding: '8px', textAlign: 'left', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', width: 110 }}>Price</th>
                              <th style={{ padding: '8px', textAlign: 'left', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', width: 130 }}>SKU</th>
                              {draft.track_inventory && (
                                <th style={{ padding: '8px', textAlign: 'left', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', width: 80 }}>Stock</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {draft.variants_generated.map((v, idx) => {
                              const mainPrice = draft.price || '';
                              return (
                                <tr key={idx} style={{ borderBottom: `1px solid ${border}` }}>
                                  <td style={{ padding: '8px 10px', color: text1, fontWeight: 500 }}>{v.title}</td>
                                  <td style={{ padding: '8px' }}>
                                    <input
                                      type="number"
                                      value={v.price || ''}
                                      onChange={e => updateGeneratedVariant(idx, 'price', e.target.value)}
                                      placeholder={mainPrice || '0.00'}
                                      step="0.01"
                                      style={{
                                        width: '100%', padding: '6px 8px',
                                        background: bgPage, border: `1px solid ${border}`, borderRadius: 4,
                                        color: text1, fontSize: 12, fontFamily: 'monospace', outline: 'none',
                                      }}
                                      onFocus={e => e.target.style.borderColor = gold}
                                      onBlur={e => e.target.style.borderColor = border}
                                    />
                                  </td>
                                  <td style={{ padding: '8px' }}>
                                    <input
                                      type="text"
                                      value={v.sku || ''}
                                      onChange={e => updateGeneratedVariant(idx, 'sku', e.target.value)}
                                      placeholder={`SKU-${(idx+1).toString().padStart(2,'0')}`}
                                      style={{
                                        width: '100%', padding: '6px 8px',
                                        background: bgPage, border: `1px solid ${border}`, borderRadius: 4,
                                        color: text1, fontSize: 12, fontFamily: 'monospace', outline: 'none',
                                      }}
                                      onFocus={e => e.target.style.borderColor = gold}
                                      onBlur={e => e.target.style.borderColor = border}
                                    />
                                  </td>
                                  {draft.track_inventory && (
                                    <td style={{ padding: '8px' }}>
                                      <NumInput value={v.stock || ''} onChange={val => updateGeneratedVariant(idx, 'stock', val)} placeholder="0" step="1" />
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {draft.price && (
                      <div style={{ marginTop: 8, fontSize: 11, color: text3 }}>
                        Empty Price field = <strong style={{ color: gold }}>Rs {draft.price}</strong> (main price)
                        {draft.compare_at_price && <> · Compare-at = <strong style={{ color: gold }}>Rs {draft.compare_at_price}</strong></>}
                        {draft.cost_per_item && <> · Cost = <strong style={{ color: gold }}>Rs {draft.cost_per_item}</strong></>}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* RIGHT */}
        <div>
          {/* M2.I — Live SEO Score (recomputes on every keystroke) */}
          {liveSeo && (
            <Card
              title="SEO Score (Live)"
              right={
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12,
                  background: liveSeo.tier === 'green' ? 'rgba(74,222,128,0.15)' :
                              liveSeo.tier === 'yellow' ? 'rgba(250,204,21,0.15)' :
                                                          'rgba(248,113,113,0.15)',
                  color: liveSeo.tier === 'green' ? '#4ade80' :
                         liveSeo.tier === 'yellow' ? '#facc15' : '#f87171',
                }}>
                  {liveSeo.score}
                </span>
              }
            >
              <div style={{ marginBottom: 12 }}>
                <div style={{
                  height: 8, background: bgPage, borderRadius: 4, overflow: 'hidden',
                  border: `1px solid ${border}`,
                }}>
                  <div style={{
                    height: '100%',
                    width: `${liveSeo.score}%`,
                    background: liveSeo.tier === 'green' ? '#4ade80' :
                                liveSeo.tier === 'yellow' ? '#facc15' : '#f87171',
                    transition: 'width 0.25s, background 0.25s',
                  }} />
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: text3, textAlign: 'center' }}>
                  {liveSeo.score} / 100 · {liveSeo.tier === 'green' ? 'Solid SEO' :
                                            liveSeo.tier === 'yellow' ? 'Acceptable' : 'Needs work'}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
                {Object.entries(liveSeo.breakdown).map(([key, b]) => {
                  const pct = b.max > 0 ? (b.points / b.max) : 1;
                  const dotColor = pct >= 0.8 ? '#4ade80' : pct >= 0.5 ? '#facc15' : '#f87171';
                  return (
                    <div key={key} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      fontSize: 11, padding: '5px 8px',
                      background: bgPage, borderRadius: 4, border: `1px solid ${border}`,
                    }}
                      title={b.note || ''}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor }} />
                        <span style={{ color: text2 }}>{b.label}</span>
                      </span>
                      <span style={{ color: text3, fontFamily: 'monospace', fontSize: 10 }}>
                        {b.points}/{b.max}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

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

          {/* Google Shopping (M2.D) */}
          <Card title="Google Shopping" right={<span style={{ fontSize: 10, color: text3 }}>For Google Merchant feed</span>}>
            <div style={{ marginBottom: 12 }}>
              <Label>Age Group</Label>
              <Select
                value={draft.google_age_group || ''}
                onChange={v => setField('google_age_group', v)}
                options={[
                  { value: '',         label: '— not set —' },
                  { value: 'adult',    label: 'Adult' },
                  { value: 'all ages', label: 'All ages' },
                  { value: 'kids',     label: 'Kids' },
                  { value: 'newborn',  label: 'Newborn' },
                  { value: 'infant',   label: 'Infant' },
                  { value: 'toddler',  label: 'Toddler' },
                ]}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <Label>Gender</Label>
              <Select
                value={draft.google_gender || ''}
                onChange={v => setField('google_gender', v)}
                options={[
                  { value: '',        label: '— not set —' },
                  { value: 'female',  label: 'Female' },
                  { value: 'male',    label: 'Male' },
                  { value: 'unisex',  label: 'Unisex' },
                ]}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <Label>Condition</Label>
              <Select
                value={draft.google_condition || ''}
                onChange={v => setField('google_condition', v)}
                options={[
                  { value: '',             label: '— not set —' },
                  { value: 'new',          label: 'New' },
                  { value: 'refurbished',  label: 'Refurbished' },
                  { value: 'used',         label: 'Used' },
                ]}
              />
            </div>
            <div>
              <Label hint="Manufacturer Part Number">MPN</Label>
              <TextInput
                value={draft.google_mpn || ''}
                onChange={v => setField('google_mpn', v)}
                placeholder="optional — e.g. RSZ-KS-001"
                mono
              />
            </div>
          </Card>
        </div>
      </div>

      {/* M2.I — AI Enhance modal (apply mode) */}
      {aiEnhanceOpen && (
        <AiEnhanceModal
          mode="apply"
          product={{
            shopify_product_id: null,                    // new product — no id yet
            title: draft.title || 'New Product',
            parent_title: draft.title || 'New Product',
            image_url: draft.images?.[0]?.previewUrl || null,
            category: draft.product_type || '',
            vendor: draft.vendor || '',
            selling_price: draft.price || null,
            variants_summary: draft.use_variant_options
              ? (draft.variants_generated || []).map(v => v.title).filter(Boolean).join(', ')
              : '',
            image_count: (draft.images?.length || 0),
            current_description: draft.description_html || '',
          }}
          onClose={() => setAiEnhanceOpen(false)}
          onApply={handleAiApply}
        />
      )}

      {/* M2.K — Bulk Edit modal for new product variants */}
      {bulkEditOpen && draft.use_variant_options && (draft.variants_generated?.length || 0) > 1 && (
        <BulkEditModal
          variants={draft.variants_generated.map((v, i) => ({ ...v, _idx: String(i), _label: v.title || `Variant ${i + 1}` }))}
          idKey="_idx"
          labelKey="_label"
          canViewFinancial={true}
          onClose={() => setBulkEditOpen(false)}
          onApply={handleBulkApply}
          valueGetter={(v, fieldKey) => {
            // Map modal field names → variants_generated field names
            switch (fieldKey) {
              case 'price':            return v.price ?? '';
              case 'compare_at_price': return v.compare_at_price ?? '';
              case 'sku':              return v.sku ?? '';
              case 'stock':            return v.stock ?? 0;
              case 'weight':           return v.weight ?? 0;
              default:                 return '';
            }
          }}
        />
      )}
    </div>
  );
}
