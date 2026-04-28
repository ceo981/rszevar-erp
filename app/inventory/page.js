'use client';

// ============================================================================
// RS ZEVAR ERP — Add Product Page (Phase D M2.C + M2.D — Apr 28 2026)
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
    // M2.D — inventory tracking
    track_inventory: true,
    initial_stock: '',
    // M2.D — variant options
    use_variant_options: false,
    options: [],                  // [{name, values: []}] up to 2
    variants_generated: [],       // generated from options
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
      images: draft.images.length > 0
        ? draft.images.map(img => ({
            filename: img.filename,
            attachment: img.base64,
            alt: img.alt || '',
          }))
        : undefined,
      // M2.D — inventory tracking
      track_inventory: draft.track_inventory,
      initial_stock: draft.initial_stock !== '' ? Number(draft.initial_stock) : undefined,
      // M2.D — Google Shopping metafields (only send if non-empty)
      google_age_group: draft.google_age_group || undefined,
      google_gender:    draft.google_gender    || undefined,
      google_condition: draft.google_condition || undefined,
      google_mpn:       draft.google_mpn       || undefined,
    };

    if (usingVariantOptions) {
      // Multi-variant flow
      payload.options = draft.options.map(o => ({ name: o.name, values: o.values }));
      payload.variants_input = draft.variants_generated.map(v => ({
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        price: v.price,
        compare_at_price: v.compare_at_price,
        sku: v.sku,
        stock: v.stock,
      }));
    } else {
      // Default-variant flow — include single price/sku/compare-at if provided
      payload.price = draft.price !== '' ? draft.price : undefined;
      payload.compare_at_price = draft.compare_at_price !== '' ? draft.compare_at_price : undefined;
      payload.sku = draft.sku || undefined;
    }

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

          {/* Variants & Inventory (M2.D) */}
          <Card
            title="Variants & Inventory"
            right={
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: text2, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={draft.use_variant_options}
                  onChange={e => toggleVariantOptions(e.target.checked)}
                  style={{ accentColor: gold }}
                />
                This product has variants (size/color/etc)
              </label>
            }
          >
            {/* Inventory tracking — applies to both single + multi variant flows */}
            <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${border}` }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
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
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 12 }}>
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
                    <Label hint="strike-through">Compare-at</Label>
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
                <div style={{ fontSize: 11, color: text3 }}>
                  Single variant create. Add more variants in Shopify or toggle "has variants" above.
                </div>
              </>
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

                {/* Variants matrix */}
                {draft.variants_generated.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <Label hint={`${draft.variants_generated.length} variant${draft.variants_generated.length !== 1 ? 's' : ''}`}>Variants</Label>
                    <div style={{ overflowX: 'auto', border: `1px solid ${border}`, borderRadius: 6 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: 'rgba(201,169,110,0.03)', borderBottom: `1px solid ${border}` }}>
                            <th style={{ padding: '8px 10px', textAlign: 'left', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>Variant</th>
                            <th style={{ padding: '8px', textAlign: 'left', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', width: 100 }}>Price</th>
                            <th style={{ padding: '8px', textAlign: 'left', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', width: 100 }}>Compare</th>
                            <th style={{ padding: '8px', textAlign: 'left', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', width: 110 }}>SKU</th>
                            {draft.track_inventory && (
                              <th style={{ padding: '8px', textAlign: 'left', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', width: 80 }}>Stock</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {draft.variants_generated.map((v, idx) => (
                            <tr key={idx} style={{ borderBottom: `1px solid ${border}` }}>
                              <td style={{ padding: '8px 10px', color: text1 }}>{v.title}</td>
                              <td style={{ padding: '8px' }}>
                                <NumInput value={v.price} onChange={val => updateGeneratedVariant(idx, 'price', val)} placeholder="0.00" />
                              </td>
                              <td style={{ padding: '8px' }}>
                                <NumInput value={v.compare_at_price} onChange={val => updateGeneratedVariant(idx, 'compare_at_price', val)} placeholder="—" />
                              </td>
                              <td style={{ padding: '8px' }}>
                                <input
                                  type="text"
                                  value={v.sku}
                                  onChange={e => updateGeneratedVariant(idx, 'sku', e.target.value)}
                                  placeholder="SKU"
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
                                  <NumInput value={v.stock} onChange={val => updateGeneratedVariant(idx, 'stock', val)} placeholder="0" step="1" />
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
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
    </div>
  );
}
