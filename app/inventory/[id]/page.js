'use client';

// ============================================================================
// RS ZEVAR ERP — Single Product Editor (Phase D M2.D + M2.I — Apr 28 2026)
// Route: /inventory/[id]   (id = shopify_product_id)
// ----------------------------------------------------------------------------
// M2.D additions:
//   - Variants table is now editable (price/compare-at/SKU/stock per variant)
//   - Media card supports image upload + delete (with client-side compression)
//   - New "Google Shopping" card with age_group/gender/condition/MPN
// M2.I additions:
//   - AI Enhance button in Description card → opens modal in 'apply' mode
//   - Generated content fills draft state instead of pushing to Shopify
//   - Live SEO score card (recomputes on every keystroke)
//   - Pending AI extras banner (FAQs + product metafields queued for save)
// ============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

// Use relative imports (Next.js 16 Turbopack workaround for new files)
import { useUser } from '../../context/UserContext';
import AiEnhanceModal from '../_components/AiEnhanceModal';
import ImagePreviewModal from '../_components/ImagePreviewModal';
import { calculateSeoScore } from '../../../lib/seo-score';

// ── Theme tokens ────────────────────────────────────────────────────────────
const gold = '#c9a96e';
const card = '#141414';
const border = '#222';
const bgPage = '#080808';
const text1 = '#e5e5e5';
const text2 = '#aaa';
const text3 = '#666';

// ── UI atoms ───────────────────────────────────────────────────────────────
function Card({ title, children, right = null, padBody = true }) {
  return (
    <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
      {title && (
        <div style={{
          padding: '14px 20px',
          borderBottom: `1px solid ${border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
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

function Label({ children, hint }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: text2, letterSpacing: 0.3 }}>{children}</span>
      {hint && <span style={{ fontSize: 11, color: text3, marginLeft: 8 }}>{hint}</span>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, mono, disabled }) {
  return (
    <input
      type="text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '9px 12px',
        background: bgPage,
        border: `1px solid ${border}`,
        borderRadius: 6,
        color: text1,
        fontSize: 13,
        fontFamily: mono ? 'monospace' : 'inherit',
        outline: 'none',
        transition: 'border-color 0.15s',
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
        width: '100%',
        padding: '10px 12px',
        background: bgPage,
        border: `1px solid ${border}`,
        borderRadius: 6,
        color: text1,
        fontSize: 13,
        fontFamily: mono ? 'monospace' : 'inherit',
        outline: 'none',
        resize: 'vertical',
        lineHeight: 1.5,
      }}
      onFocus={e => e.target.style.borderColor = gold}
      onBlur={e => e.target.style.borderColor = border}
    />
  );
}

function Select({ value, onChange, options, disabled }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '9px 12px',
        background: bgPage,
        border: `1px solid ${border}`,
        borderRadius: 6,
        color: text1,
        fontSize: 13,
        fontFamily: 'inherit',
        outline: 'none',
        cursor: 'pointer',
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
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: primary ? 600 : 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    textDecoration: 'none',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
    opacity: disabled ? 0.5 : 1,
  };
  if (href) return <a href={href} target={target} rel="noopener noreferrer" style={style} title={title}>{children}</a>;
  return <button onClick={onClick} disabled={disabled} style={style} title={title}>{children}</button>;
}

// ── Tags chip input ─────────────────────────────────────────────────────────
function TagsInput({ tags, onChange }) {
  const [input, setInput] = useState('');

  const addTag = (t) => {
    const trimmed = String(t || '').trim();
    if (!trimmed) return;
    if (tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setInput('');
  };

  const removeTag = (t) => onChange(tags.filter(x => x !== t));

  return (
    <div style={{
      background: bgPage,
      border: `1px solid ${border}`,
      borderRadius: 6,
      padding: '6px 8px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      alignItems: 'center',
      minHeight: 38,
    }}>
      {tags.map(t => (
        <span key={t} style={{
          background: 'rgba(201,169,110,0.12)',
          border: `1px solid rgba(201,169,110,0.3)`,
          color: gold,
          fontSize: 12,
          padding: '3px 8px 3px 10px',
          borderRadius: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}>
          {t}
          <button onClick={() => removeTag(t)} style={{
            background: 'none', border: 'none', color: gold, cursor: 'pointer',
            fontSize: 14, padding: 0, lineHeight: 1, opacity: 0.7,
          }} title="Remove">×</button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(input);
          } else if (e.key === 'Backspace' && !input && tags.length > 0) {
            removeTag(tags[tags.length - 1]);
          }
        }}
        onBlur={() => { if (input.trim()) addTag(input); }}
        placeholder={tags.length === 0 ? 'Type and press Enter' : ''}
        style={{
          flex: 1,
          minWidth: 100,
          background: 'transparent',
          border: 'none',
          color: text1,
          fontSize: 13,
          fontFamily: 'inherit',
          outline: 'none',
          padding: '4px',
        }}
      />
    </div>
  );
}

// ── Collections multi-select (M2.B) ────────────────────────────────────────
// selected: [{id?, handle, title}, ...]   ← current product collections
// available: [{id, handle, title, type}]  ← master list from /api/collections
function CollectionsPicker({ selected, available, onChange, loading }) {
  const [query, setQuery] = useState('');

  const selectedHandles = useMemo(() => new Set(selected.map(c => c.handle)), [selected]);

  // Filter available list: not already selected + matches query
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return available
      .filter(c => !selectedHandles.has(c.handle))
      .filter(c => !q || c.title.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q))
      .slice(0, 30); // cap results
  }, [available, selectedHandles, query]);

  const addCollection = (c) => {
    if (selectedHandles.has(c.handle)) return;
    onChange([...selected, { id: c.id, handle: c.handle, title: c.title }]);
    setQuery('');
  };

  const removeCollection = (handle) => {
    onChange(selected.filter(c => c.handle !== handle));
  };

  return (
    <div>
      {/* Selected chips */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 5,
        padding: '8px 10px',
        background: bgPage,
        border: `1px solid ${border}`,
        borderRadius: 6,
        minHeight: 38,
        marginBottom: 8,
      }}>
        {selected.length === 0 ? (
          <span style={{ color: text3, fontSize: 12 }}>Not in any collection</span>
        ) : (
          selected.map(c => (
            <span key={c.handle} style={{
              background: 'rgba(96,165,250,0.12)',
              border: '1px solid rgba(96,165,250,0.3)',
              color: '#60a5fa',
              fontSize: 11,
              padding: '3px 6px 3px 10px',
              borderRadius: 4,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}>
              {c.title || c.handle}
              <button
                onClick={() => removeCollection(c.handle)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#60a5fa',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: 0,
                  lineHeight: 1,
                  opacity: 0.7,
                }}
                title="Remove from collection"
              >×</button>
            </span>
          ))
        )}
      </div>

      {/* Search input */}
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={loading ? 'Loading collections...' : 'Add to collection — type to search'}
        disabled={loading}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: bgPage,
          border: `1px solid ${border}`,
          borderRadius: 6,
          color: text1,
          fontSize: 12,
          fontFamily: 'inherit',
          outline: 'none',
          opacity: loading ? 0.5 : 1,
        }}
        onFocus={e => e.target.style.borderColor = gold}
        onBlur={e => e.target.style.borderColor = border}
      />

      {/* Filtered dropdown — only shown while typing */}
      {query.trim() && (
        <div style={{
          marginTop: 4,
          background: bgPage,
          border: `1px solid ${border}`,
          borderRadius: 6,
          maxHeight: 220,
          overflowY: 'auto',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', color: text3, fontSize: 12 }}>
              No matches. {available.length === 0 ? 'No collections loaded.' : ''}
            </div>
          ) : filtered.map(c => (
            <button
              key={c.handle}
              onClick={() => addCollection(c)}
              style={{
                display: 'flex',
                width: '100%',
                padding: '7px 12px',
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${border}`,
                color: text1,
                fontSize: 12,
                fontFamily: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
                alignItems: 'center',
                gap: 8,
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

// ── Numeric input (M2.D — for variant prices/stock) ────────────────────────
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
        width: '100%',
        padding: '6px 8px',
        background: bgPage,
        border: `1px solid ${border}`,
        borderRadius: 4,
        color: text1,
        fontSize: 12,
        fontFamily: 'monospace',
        outline: 'none',
      }}
      onFocus={e => e.target.style.borderColor = gold}
      onBlur={e => e.target.style.borderColor = border}
    />
  );
}

// ── Image compression for upload (M2.D) ─────────────────────────────────────
const MAX_DIMENSION_EDIT = 2000;
const JPEG_QUALITY_EDIT  = 0.85;
const MAX_NEW_IMAGES     = 10;

async function compressImageEdit(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION_EDIT || height > MAX_DIMENSION_EDIT) {
          if (width >= height) {
            height = Math.round(height * (MAX_DIMENSION_EDIT / width));
            width = MAX_DIMENSION_EDIT;
          } else {
            width = Math.round(width * (MAX_DIMENSION_EDIT / height));
            height = MAX_DIMENSION_EDIT;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY_EDIT);
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

// ── Status badge ────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const config = {
    active:   { color: '#4ade80', bg: 'rgba(74,222,128,0.12)',  label: 'Active' },
    draft:    { color: '#888',    bg: 'rgba(136,136,136,0.12)', label: 'Draft' },
    archived: { color: '#f87171', bg: 'rgba(248,113,113,0.12)', label: 'Archived' },
  };
  const c = config[status] || config.draft;
  return (
    <span style={{
      padding: '3px 10px',
      borderRadius: 4,
      background: c.bg,
      color: c.color,
      fontSize: 11,
      fontWeight: 600,
    }}>{c.label}</span>
  );
}

// ── SEO Score badge ─────────────────────────────────────────────────────────
function SeoBadge({ score, tier }) {
  if (score === null || score === undefined) {
    return <span style={{ color: text3, fontSize: 12 }}>Not scored</span>;
  }
  const tiers = {
    green:  { color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
    yellow: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
    red:    { color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
  };
  const t = tiers[tier] || tiers.red;
  return (
    <span style={{
      padding: '4px 10px',
      borderRadius: 4,
      background: t.bg,
      color: t.color,
      fontSize: 13,
      fontWeight: 700,
      fontFamily: 'monospace',
    }}>{score}/100</span>
  );
}

// ── Diff helper ─────────────────────────────────────────────────────────────
function isEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!isEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!isEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function buildDiff(original, draft) {
  const diff = {};
  const fields = [
    'title', 'description_html', 'vendor', 'product_type', 'tags',
    'handle', 'shopify_status', 'seo_meta_title', 'seo_meta_description',
    // M2.D — Google Shopping metafields
    'google_age_group', 'google_gender', 'google_condition', 'google_mpn',
  ];
  for (const f of fields) {
    if (!isEqual(original[f], draft[f])) {
      diff[f] = draft[f];
    }
  }
  // M2.B — Collections (compare by sorted handles, ignore title/id changes)
  const origHandles  = (original.collections || []).map(c => c.handle).filter(Boolean).sort();
  const draftHandles = (draft.collections    || []).map(c => c.handle).filter(Boolean).sort();
  if (JSON.stringify(origHandles) !== JSON.stringify(draftHandles)) {
    diff.collections = (draft.collections || []).map(c => ({
      id: c.id || null,
      handle: c.handle,
      title: c.title || c.handle,
    }));
  }
  // Alt texts: collect changed images only
  const altChanges = [];
  if (Array.isArray(draft.images_data)) {
    const origMap = new Map((original.images_data || []).map(i => [String(i.id), i.alt || '']));
    for (const img of draft.images_data) {
      const origAlt = origMap.get(String(img.id)) || '';
      const newAlt = img.alt || '';
      if (origAlt !== newAlt) altChanges.push({ image_id: img.id, alt: newAlt });
    }
  }
  if (altChanges.length > 0) diff.alt_texts = altChanges;

  // M2.D — Variants update: detect any variant with changed price/compare/sku/stock
  if (Array.isArray(draft.variants) && Array.isArray(original.variants)) {
    const origVarMap = new Map(original.variants.map(v => [String(v.shopify_variant_id), v]));
    const variantsUpdate = [];
    for (const v of draft.variants) {
      const orig = origVarMap.get(String(v.shopify_variant_id));
      if (!orig) continue;
      const change = {
        shopify_variant_id: v.shopify_variant_id,
        shopify_inventory_item_id: v.shopify_inventory_item_id,
        // Phase 2 — snapshot of OLD values + parent product title.
        // Backend uses this to compute diff for inventory_adjustments log + to
        // verify stock change is REAL (so reason validation only fires when needed).
        product_title: draft.parent_title || '',
        previous: {
          selling_price:    orig.selling_price ?? '',
          compare_at_price: orig.compare_at_price ?? '',
          sku:              orig.sku ?? '',
          barcode:          orig.barcode ?? '',
          stock_quantity:   orig.stock_quantity ?? 0,
          weight:           orig.weight ?? '',
          variant_label:    orig.variant_label || '',
        },
      };
      let changed = false;
      // Compare numerics — coerce both sides to numbers, treat null/undefined/empty as null
      const num = (x) => (x === '' || x === null || x === undefined) ? null : Number(x);
      if (num(v.selling_price) !== num(orig.selling_price)) {
        change.price = v.selling_price === '' ? null : v.selling_price;
        changed = true;
      }
      if (num(v.compare_at_price) !== num(orig.compare_at_price)) {
        change.compare_at_price = v.compare_at_price === '' ? '' : v.compare_at_price;
        changed = true;
      }
      if ((v.sku || '') !== (orig.sku || '')) {
        change.sku = v.sku || '';
        changed = true;
      }
      if (num(v.stock_quantity) !== num(orig.stock_quantity)) {
        change.stock = v.stock_quantity === '' ? 0 : v.stock_quantity;
        changed = true;
      }
      // M2.K — weight diff (frontend value is in grams; backend converts to/from)
      if (num(v.weight) !== num(orig.weight)) {
        change.grams = v.weight === '' ? 0 : v.weight;   // value is already in grams (column header says "Weight (g)")
        changed = true;
      }
      // M2.K — image_id diff (per-variant image assignment)
      // Note: orig.image_id is computed from URL match on load (see loadProduct).
      const origImgId = (orig.image_id == null || orig.image_id === '') ? null : Number(orig.image_id);
      const newImgId  = (v.image_id == null || v.image_id === '')       ? null : Number(v.image_id);
      if (origImgId !== newImgId) {
        change.image_id = newImgId;   // null means detach
        changed = true;
      }
      if (changed) variantsUpdate.push(change);
    }
    if (variantsUpdate.length > 0) diff.variants_update = variantsUpdate;
  }

  // M2.D — Image add (new uploads not yet in original)
  if (Array.isArray(draft.images_to_add) && draft.images_to_add.length > 0) {
    diff.images_to_add = draft.images_to_add.map(img => ({
      filename: img.filename,
      attachment: img.base64,
      alt: img.alt || '',
    }));
  }

  // M2.D — Image remove (ids from original.images_data not in draft.images_data)
  const draftImgIds = new Set((draft.images_data || []).map(i => String(i.id)));
  const removed = (original.images_data || [])
    .filter(i => !draftImgIds.has(String(i.id)))
    .map(i => i.id);
  if (removed.length > 0) diff.images_to_remove = removed;

  // May 2026 — Image reorder. If draft images_data IDs in draft order differ
  // from the original ordered IDs (after accounting for removals), send a
  // reorder array. Order in draft.images_data IS the desired order.
  const origOrdered = (original.images_data || [])
    .map(i => String(i.id))
    .filter(id => draftImgIds.has(id)); // exclude removed ones
  const draftOrdered = (draft.images_data || [])
    .map(i => String(i.id));
  const sameOrder =
    origOrdered.length === draftOrdered.length &&
    origOrdered.every((id, i) => id === draftOrdered[i]);
  if (!sameOrder && draftOrdered.length > 0) {
    diff.image_reorder = draftOrdered;
  }

  return diff;
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
// M2.K — VariantImagePicker (editor page)
// Shows a circular thumbnail of the current variant image. Clicking opens a
// modal with all product images; user picks one (or "no image"). Selection
// updates parent via onSelect(imageId | null).
//
// Props:
//   images        — draft.images_data (array of { id, src, alt })
//   selectedId    — currently assigned image id (number/string) or null
//   onSelect      — (imageId | null) => void
//   size          — circle px (default 36)
//   variantLabel  — for modal header
// ────────────────────────────────────────────────────────────────────────────
function VariantImagePicker({ images, selectedId, onSelect, size = 36, variantLabel }) {
  const [open, setOpen] = useState(false);
  const selected = (images || []).find(i => String(i.id) === String(selectedId));

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);

  const circleStyle = {
    width: size, height: size, borderRadius: '50%',
    border: `1.5px solid ${selectedId ? gold : border}`,
    background: bgPage, overflow: 'hidden', flexShrink: 0,
    cursor: (images && images.length > 0) ? 'pointer' : 'not-allowed',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, color: text3,
    transition: 'border-color 0.15s, transform 0.1s',
    padding: 0,
  };

  return (
    <>
      <button
        type="button"
        onClick={() => images && images.length > 0 && setOpen(true)}
        title={images?.length ? 'Click to pick image' : 'No images uploaded yet'}
        style={circleStyle}
        onMouseDown={e => e.preventDefault()}
      >
        {selected ? (
          <img src={selected.src} alt={selected.alt || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <span>+</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 320,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div style={{
            background: card, border: `1px solid ${border}`, borderRadius: 10,
            width: '100%', maxWidth: 560, maxHeight: '85vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
          }}>
            <div style={{
              padding: '12px 18px', borderBottom: `1px solid ${border}`,
              background: 'rgba(201,169,110,0.04)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: gold, textTransform: 'uppercase', letterSpacing: 2 }}>Variant Image</div>
                <div style={{ fontSize: 13, color: text1, marginTop: 2 }}>{variantLabel || 'Pick an image'}</div>
              </div>
              <button onClick={() => setOpen(false)} style={{
                background: 'none', border: 'none', color: text3, fontSize: 24, cursor: 'pointer', padding: '0 6px',
              }}>×</button>
            </div>
            <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
              {/* No image option */}
              <button
                type="button"
                onClick={() => { onSelect(null); setOpen(false); }}
                style={{
                  width: '100%', padding: '10px 14px', marginBottom: 12,
                  background: !selectedId ? 'rgba(201,169,110,0.1)' : bgPage,
                  border: `1px solid ${!selectedId ? gold : border}`,
                  borderRadius: 6,
                  color: !selectedId ? gold : text2,
                  fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <span style={{
                  width: 36, height: 36, borderRadius: '50%',
                  border: `1px dashed ${border}`, background: bgPage,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, color: text3,
                }}>×</span>
                <span style={{ flex: 1, textAlign: 'left' }}>No image (use product default)</span>
                {!selectedId && <span style={{ fontSize: 14 }}>✓</span>}
              </button>
              {/* Image grid */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10,
              }}>
                {(images || []).map(img => {
                  const isSelected = String(img.id) === String(selectedId);
                  return (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => { onSelect(img.id); setOpen(false); }}
                      title={img.alt || `Image ${img.position || ''}`}
                      style={{
                        width: '100%', aspectRatio: '1 / 1',
                        border: `2px solid ${isSelected ? gold : border}`,
                        borderRadius: 8, overflow: 'hidden',
                        background: bgPage, padding: 0, cursor: 'pointer',
                        position: 'relative',
                        boxShadow: isSelected ? `0 0 0 3px rgba(201,169,110,0.2)` : 'none',
                      }}
                    >
                      <img src={img.src} alt={img.alt || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      {isSelected && (
                        <div style={{
                          position: 'absolute', top: 4, right: 4,
                          background: gold, color: '#080808', borderRadius: '50%',
                          width: 20, height: 20, fontSize: 12, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>✓</div>
                      )}
                    </button>
                  );
                })}
              </div>
              {(images?.length || 0) === 0 && (
                <div style={{ padding: 30, color: text3, fontSize: 13, textAlign: 'center' }}>
                  No images uploaded yet. Upload images first via the Media card.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ────────────────────────────────────────────────────────────────────────────
export default function ProductEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;
  const { canViewFinancial, performer, userEmail, can } = useUser();

  // ── Granular permission gates (May 2 2026) ──
  const canEdit       = can('inventory.edit');
  const canEditCost   = can('inventory.edit_cost');
  const canAiEnhance  = can('inventory.ai_enhance');

  const [product, setProduct]   = useState(null);   // loaded from server (immutable snapshot)
  const [draft, setDraft]       = useState(null);   // editable copy
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [saving, setSaving]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  // Phase 2.1 — Reason for stock changes (anti-theft control). Required when
  // any variant's stock_quantity is being changed via this page's bulk/inline edits.
  const [reason, setReason] = useState('');
  const [descMode, setDescMode] = useState('edit'); // 'edit' | 'preview'

  // Apr 2026 — Smart back navigation: if user came from an order page, label
  // changes to "Back to order" and click uses router.back() to return there.
  // Otherwise default "Inventory" label + push to /inventory.
  const [backLabel, setBackLabel] = useState('← Inventory');
  const [cameFromOrder, setCameFromOrder] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.referrer) return;
    try {
      const ref = new URL(document.referrer);
      if (ref.origin === window.location.origin && ref.pathname.startsWith('/orders/')) {
        setBackLabel('← Back to order');
        setCameFromOrder(true);
      }
    } catch {}
  }, []);

  const handleSmartBack = () => {
    if (cameFromOrder && typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/inventory');
    }
  };

  // M2.B — master collections list (loaded once, used by CollectionsPicker)
  const [allCollections, setAllCollections] = useState([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);

  // M2.I — AI Enhance state
  const [aiEnhanceOpen, setAiEnhanceOpen] = useState(false);
  // FAQs + 5 product metafields generated by AI but not yet supported by the
  // /api/products/[id] PATCH route. Stored locally so user sees them; they will
  // flow into save when the API gains metafield write support (next phase).
  const [aiPendingExtras, setAiPendingExtras] = useState(null);
  const [aiAppliedFlash, setAiAppliedFlash] = useState(null); // { fields: string[] } | null
  // M2.J — track enhancement_id from modal so we can mark the DB record as
  // "pushed" once the user saves. Mirrors the inventory-list push flow's tracking.
  const [aiEnhancementId, setAiEnhancementId] = useState(null);

  // M2.K — Bulk Edit modal state
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  // M2.K — Expanded color groups (for 2+ option products' grouped variants UI)
  const [expandedGroups, setExpandedGroups] = useState({});

  // M2.K — Detect if product has 2+ options (any variant with option2 set)
  // Used to switch between flat table and grouped view in variants section.
  const hasMultiOptions = useMemo(() => {
    return Array.isArray(draft?.variants) && draft.variants.some(v => v.option2 != null && v.option2 !== '');
  }, [draft?.variants]);

  // M2.K — Group variants by option1 (preserves first-seen order)
  const variantGroups = useMemo(() => {
    if (!hasMultiOptions || !draft?.variants) return [];
    const order = [];
    const map = new Map();
    for (const v of draft.variants) {
      const key = v.option1 ?? '';
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key).push(v);
    }
    return order.map(k => ({ key: k, label: k || '—', variants: map.get(k) }));
  }, [draft?.variants, hasMultiOptions]);

  // M2.K — Helpers for group operations
  const toggleGroupExpanded = (groupKey) => {
    setExpandedGroups(g => ({ ...g, [groupKey]: !g[groupKey] }));
  };

  // Broadcast a field's value to all variants in a group
  const setGroupField = (groupKey, fieldName, value) => {
    setDraft(d => ({
      ...d,
      variants: (d.variants || []).map(v =>
        v.option1 === groupKey ? { ...v, [fieldName]: value } : v
      ),
    }));
  };

  // Set image_id for whole group (broadcast to all sub-variants)
  const setGroupImageId = (groupKey, imageId) => {
    setDraft(d => ({
      ...d,
      variants: (d.variants || []).map(v =>
        v.option1 === groupKey ? { ...v, image_id: imageId } : v
      ),
    }));
  };

  // Returns common value if all variants share it, else '__MIXED__'
  const getGroupCommonValue = (variants, field) => {
    if (!variants || variants.length === 0) return '';
    const first = variants[0][field] ?? '';
    return variants.every(v => (v[field] ?? '') === first) ? first : '__MIXED__';
  };

  // Sum stock across group (treat empty as 0)
  const getGroupTotalStock = (variants) => {
    return (variants || []).reduce((sum, v) => sum + (Number(v.stock_quantity) || 0), 0);
  };

  // M2.I — Live SEO score (recomputes on every draft change, no DB call)
  const liveSeo = useMemo(() => {
    if (!draft) return null;
    try {
      return calculateSeoScore({
        parent_title: draft.title || '',
        description_html: draft.description_html || '',
        tags: draft.tags || [],
        handle: draft.handle || '',
        seo_meta_title: draft.seo_meta_title || '',
        seo_meta_description: draft.seo_meta_description || '',
        images_data: draft.images_data || [],
      });
    } catch (e) {
      return null;
    }
  }, [draft]);

  // ── Load product ──────────────────────────────────────────────────────────
  const loadProduct = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${id}`);
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to load product');
      } else {
        // M2.K — derive each variant's image_id by matching image_url against images_data[].src
        // and parse variant_label (e.g. "Black / 2.4") into option1/option2/option3
        // for the grouped UI. CRITICAL: apply these derived fields to BOTH `product`
        // (original) and `draft` so buildDiff sees them as equal on initial load —
        // otherwise every product appears to have "1 field changed" the moment it opens.
        const imgs = data.product.images_data || [];
        const urlToId = new Map(imgs.map(i => [String(i.src || ''), String(i.id)]));
        const variantsEnriched = (data.product.variants || []).map(v => {
          const matched = v.image_url ? urlToId.get(String(v.image_url)) : null;
          const parts = String(v.variant_label || '').split(' / ').map(s => s.trim()).filter(Boolean);
          return {
            ...v,
            image_id: matched ? Number(matched) : null,
            option1: parts[0] ?? null,
            option2: parts[1] ?? null,
            option3: parts[2] ?? null,
          };
        });
        const enrichedProduct = {
          ...data.product,
          variants: variantsEnriched,
        };
        setProduct(enrichedProduct);
        setDraft({
          ...enrichedProduct,
          images_data: [...imgs],
          variants: variantsEnriched.map(v => ({ ...v })),    // shallow clone so edits don't mutate original
          images_to_add: [],   // M2.D — staged uploads
        });
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { loadProduct(); }, [loadProduct]);

  // M2.B — load master collections list once on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setCollectionsLoading(true);
        const res = await fetch('/api/collections');
        const data = await res.json();
        if (alive && data.success) {
          setAllCollections(data.collections || []);
        }
      } catch (e) {
        // Non-fatal — picker shows empty state
        console.error('[editor] failed to load collections:', e);
      } finally {
        if (alive) setCollectionsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // ── Track unsaved changes ─────────────────────────────────────────────────
  const diff = useMemo(() => {
    if (!product || !draft) return {};
    return buildDiff(product, draft);
  }, [product, draft]);

  const hasChanges = Object.keys(diff).length > 0 || !!aiPendingExtras || !!aiEnhancementId;

  // Phase 2.1 — Anti-theft: detect how many variants are getting a stock change.
  // If any, reason field becomes REQUIRED before save. Backend also enforces.
  const stockChangedCount = useMemo(() => {
    if (!Array.isArray(diff.variants_update)) return 0;
    return diff.variants_update.filter(v => v.stock !== undefined).length;
  }, [diff]);

  const reasonRequired = stockChangedCount > 0;
  const reasonMissing  = reasonRequired && !reason.trim();

  // ── Warn on navigation if unsaved ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  // ── Save handler ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!hasChanges) return;

    // Phase 2.1 — Block save when stock is changing without a reason (anti-theft).
    // Backend also rejects this, but frontend short-circuits with a friendly message.
    if (reasonMissing) {
      setSaveResult({
        success: false,
        error: `${stockChangedCount} variant${stockChangedCount === 1 ? '' : 's'} ka stock change ho raha hai — reason likhna zaroori hai (e.g. Restocked, Damaged, Manual count).`,
      });
      return;
    }

    setSaving(true);
    setSaveResult(null);
    try {
      // Build payload from diff
      const body = { ...diff };

      // Phase 2 — top-level metadata for inventory_adjustments log rows.
      // Applied uniformly to every variant change in this save batch.
      body.performed_by       = performer || 'Staff';
      body.performed_by_email = userEmail || null;
      body.reason             = reason.trim() || null;

      // ── May 2026 — Per-image upload to bypass Vercel 4.5 MB body limit ──
      // Pehle saari nayi images base64 mein PATCH body ke andar bheji jati
      // thi. 3-4 large images add karne pe body 4.5MB cross hota tha aur
      // Vercel proxy "Request Entity Too Large" plain text return karta tha,
      // jo "Unexpected token 'R'..." JSON parse error banti thi.
      //
      // Ab: pehle har image ko alag /upload-image POST se Shopify pe push
      // karte hain (each request ~600-900KB max), phir PATCH body se
      // images_to_add hata dete hain. Reorder bhi adjust hota hai — agar
      // user ne new images ko specific position pe rakha tha, woh order
      // upload ke baad image_reorder mein update ho jata.
      let uploadedImageIds = []; // newly created Shopify image IDs (in upload order)
      if (Array.isArray(body.images_to_add) && body.images_to_add.length > 0) {
        const imgsToUpload = body.images_to_add;
        setSaveResult({
          success: true,
          partial: false,
          in_progress: true,
          message: `Uploading 0 / ${imgsToUpload.length} images…`,
        });

        const uploadResults = [];
        for (let i = 0; i < imgsToUpload.length; i++) {
          const img = imgsToUpload[i];
          try {
            const r = await fetch(`/api/products/${id}/upload-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filename: img.filename,
                attachment: img.attachment,
                alt: img.alt || '',
              }),
            });
            const text = await r.text();
            let d;
            try { d = JSON.parse(text); }
            catch { throw new Error(`Server returned non-JSON during upload ${i + 1}: ${text.slice(0, 100)}`); }

            if (!d.success) throw new Error(d.error || `Upload ${i + 1} failed`);
            uploadResults.push({ filename: img.filename, success: true, id: d.image_id });
            uploadedImageIds.push(String(d.image_id));
          } catch (e) {
            uploadResults.push({ filename: img.filename, success: false, error: e.message });
            // Stop on first failure — partial uploads are confusing for the user
            throw new Error(`Image upload ${i + 1}/${imgsToUpload.length} failed: ${e.message}`);
          }

          // Live progress
          setSaveResult({
            success: true,
            partial: false,
            in_progress: true,
            message: `Uploaded ${i + 1} / ${imgsToUpload.length} images…`,
          });
        }

        // Drop images_to_add from PATCH body — Shopify already has them
        delete body.images_to_add;

        // If user also reordered, append the new image IDs at the END of
        // the reorder list (they always go last since they were just added).
        // Without this, the reorder PATCH step would only reorder old images
        // and the new ones would land in default Shopify order.
        if (Array.isArray(body.image_reorder) && uploadedImageIds.length > 0) {
          const existingInReorder = new Set(body.image_reorder.map(String));
          for (const newId of uploadedImageIds) {
            if (!existingInReorder.has(newId)) {
              body.image_reorder.push(newId);
            }
          }
        }
      }

      // M2.B — if collections changed, resolve join/leave numeric IDs from
      // master list and strip ids from collections array (server stores
      // {handle, title} only)
      if (Array.isArray(body.collections)) {
        const origColls  = product.collections || [];
        const newColls   = body.collections;
        const origHandles = new Set(origColls.map(c => c.handle));
        const newHandles  = new Set(newColls.map(c => c.handle));
        const masterByHandle = new Map(allCollections.map(c => [c.handle, c.id]));

        const joinIds = newColls
          .filter(c => !origHandles.has(c.handle))
          .map(c => c.id || masterByHandle.get(c.handle))
          .filter(Boolean);

        const leaveIds = origColls
          .filter(c => !newHandles.has(c.handle))
          .map(c => masterByHandle.get(c.handle))
          .filter(Boolean);

        body.collections_join_ids  = joinIds;
        body.collections_leave_ids = leaveIds;
        body.collections = newColls.map(c => ({ handle: c.handle, title: c.title || c.handle }));
      }

      // M2.J — Inject AI Enhance extras into save payload.
      // These were applied via the AI Enhance modal (apply mode) and stored
      // in aiPendingExtras until the user clicks Save.
      if (aiPendingExtras) {
        if (Array.isArray(aiPendingExtras.faqs))           body.ai_faqs           = aiPendingExtras.faqs;
        if (Array.isArray(aiPendingExtras.mf_occasion))    body.ai_mf_occasion    = aiPendingExtras.mf_occasion;
        if (Array.isArray(aiPendingExtras.mf_set_contents))body.ai_mf_set_contents= aiPendingExtras.mf_set_contents;
        if (Array.isArray(aiPendingExtras.mf_stone_type))  body.ai_mf_stone_type  = aiPendingExtras.mf_stone_type;
        if (typeof aiPendingExtras.mf_material === 'string')     body.ai_mf_material     = aiPendingExtras.mf_material;
        if (typeof aiPendingExtras.mf_color_finish === 'string') body.ai_mf_color_finish = aiPendingExtras.mf_color_finish;
      }

      // M2.J — pass enhancement_id so server can mark ai_enhancements row pushed
      if (aiEnhancementId) {
        body.ai_enhancement_id = aiEnhancementId;
      }

      // Edge case: only images_to_add changed (no other diff). After uploads
      // body has nothing meaningful left — skip PATCH to avoid empty round-trip.
      const hasMeaningfulChange =
        Object.keys(body).some(k =>
          !['performed_by', 'performed_by_email', 'reason'].includes(k) &&
          body[k] !== null &&
          body[k] !== undefined &&
          !(Array.isArray(body[k]) && body[k].length === 0)
        );

      let data;
      if (hasMeaningfulChange) {
        const res = await fetch(`/api/products/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        try { data = JSON.parse(text); }
        catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 120)}`); }
      } else {
        // Only images were uploaded — synthesize a success response
        data = {
          success: true,
          message: uploadedImageIds.length > 0
            ? `${uploadedImageIds.length} image(s) uploaded successfully`
            : 'Saved',
          results: { images_added: uploadedImageIds.map(id => ({ id, success: true })) },
        };
      }

      setSaveResult(data);
      if (data.success || data.partial) {
        // Clear AI state now that it's been written to Shopify + DB
        setAiPendingExtras(null);
        setAiEnhancementId(null);
        // Clear reason (it applied only to this save batch)
        setReason('');
        // Reload fresh data from DB (which now reflects Shopify)
        await loadProduct();
      }
    } catch (e) {
      setSaveResult({ success: false, error: e.message });
    }
    setSaving(false);
  };

  const handleDiscard = () => {
    if (!confirm('Discard all changes?')) return;
    // M2.K — `product` is already enriched with image_id + option1/2/3 from loadProduct,
    // so we just clone it back into draft. No re-derivation needed.
    setDraft({
      ...product,
      images_data: [...(product.images_data || [])],
      variants: (product.variants || []).map(v => ({ ...v })),
      images_to_add: [],
    });
    setSaveResult(null);
    // M2.J — discard AI Enhance state along with form changes
    setAiPendingExtras(null);
    setAiEnhancementId(null);
    setAiAppliedFlash(null);
    // M2.K — also discard expanded group state
    setExpandedGroups({});
  };

  // Pull fresh data from Shopify (safety net for missed webhooks)
  const handleRefresh = async () => {
    if (hasChanges) {
      if (!confirm('Discard your unsaved changes and refresh from Shopify?')) return;
    }
    setRefreshing(true);
    setSaveResult(null);
    try {
      const res = await fetch(`/api/products/${id}/refresh`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSaveResult({
          success: true,
          message: `🔄 ${data.message}`,
          duration_ms: data.duration_ms,
        });
        await loadProduct();
      } else {
        setSaveResult({ success: false, error: data.error || 'Refresh failed' });
      }
    } catch (e) {
      setSaveResult({ success: false, error: e.message });
    }
    setRefreshing(false);
  };

  // ── Field setters ─────────────────────────────────────────────────────────
  const setField = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  const setImageAlt = (imageId, alt) => {
    setDraft(d => ({
      ...d,
      images_data: (d.images_data || []).map(img =>
        String(img.id) === String(imageId) ? { ...img, alt } : img
      ),
    }));
  };

  // M2.I — Apply AI-generated content to draft (single-page workflow)
  // Fills the form fields the editor knows about. FAQs + 5 metafields are
  // queued in aiPendingExtras for a future save (API support pending).
  const handleAiApply = (payload) => {
    if (!payload || !payload.fields) return;
    const f = payload.fields;
    const applied = [];

    setDraft(d => {
      if (!d) return d;
      const next = { ...d };

      if (typeof f.title === 'string')                  { next.title = f.title; applied.push('Title'); }
      if (typeof f.description_html === 'string')       { next.description_html = f.description_html; applied.push('Description'); }
      if (typeof f.seo_meta_title === 'string')         { next.seo_meta_title = f.seo_meta_title; applied.push('Meta Title'); }
      if (typeof f.seo_meta_description === 'string')   { next.seo_meta_description = f.seo_meta_description; applied.push('Meta Description'); }
      if (typeof f.handle === 'string' && f.handle)     { next.handle = f.handle; applied.push('URL Handle'); }
      if (Array.isArray(f.tags))                        { next.tags = f.tags; applied.push('Tags'); }

      // Image alt texts — match by 1-based position to images_data
      if (Array.isArray(f.alt_texts) && f.alt_texts.length > 0) {
        const imgs = [...(d.images_data || [])];
        let touched = 0;
        for (const at of f.alt_texts) {
          const i = (at.position || 0) - 1;
          if (i >= 0 && i < imgs.length) {
            imgs[i] = { ...imgs[i], alt: at.alt || '' };
            touched++;
          }
        }
        if (touched > 0) {
          next.images_data = imgs;
          applied.push(`${touched} Image Alt${touched !== 1 ? 's' : ''}`);
        }
      }
      return next;
    });

    // Queue extras (FAQs + metafields) for save once API supports them
    if (payload.extras && Object.keys(payload.extras).length > 0) {
      setAiPendingExtras(payload.extras);
    }

    // M2.J — capture enhancement_id so save handler can mark DB record
    if (payload.enhancement_id) {
      setAiEnhancementId(payload.enhancement_id);
    }

    // Brief flash notification
    setAiAppliedFlash({ fields: applied, ts: Date.now() });
    setTimeout(() => setAiAppliedFlash(null), 4500);
  };

  // M2.D — variant edit
  const setVariantField = (variantId, field, value) => {
    setDraft(d => ({
      ...d,
      variants: (d.variants || []).map(v =>
        String(v.shopify_variant_id) === String(variantId) ? { ...v, [field]: value } : v
      ),
    }));
  };

  // M2.K — Bulk Edit apply: stamps the same value (or transformation) onto
  // every selected variant. Receives payload from BulkEditModal:
  //   { variantIds, field, value, skuMode? }
  // field is the modal's display name ('price'|'compare_at_price'|'sku'|
  // 'stock'|'weight'), translated to draft's local field via FIELD_MAP.
  // skuMode is 'replace'|'prefix'|'suffix' (only for sku field).
  const handleBulkApply = ({ variantIds, field, value, skuMode }) => {
    const idSet = new Set((variantIds || []).map(String));
    // Modal field name → draft field name
    const FIELD_MAP = {
      price:            'selling_price',
      compare_at_price: 'compare_at_price',
      sku:              'sku',
      stock:            'stock_quantity',
      weight:           'weight',
    };
    const draftField = FIELD_MAP[field] || field;

    setDraft(d => ({
      ...d,
      variants: (d.variants || []).map(v => {
        if (!idSet.has(String(v.shopify_variant_id))) return v;
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

  // M2.D — image upload (compress + stage)
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const remaining = MAX_NEW_IMAGES - (draft.images_to_add?.length || 0);
    if (remaining <= 0) {
      alert(`Maximum ${MAX_NEW_IMAGES} new images per save. Save first, then upload more.`);
      return;
    }
    const toProcess = files.slice(0, remaining);
    const newImgs = [];
    for (const file of toProcess) {
      try {
        const c = await compressImageEdit(file);
        newImgs.push({
          filename: file.name,
          previewUrl: c.dataUrl,
          base64: c.base64,
          alt: '',
          width: c.width,
          height: c.height,
          sizeKb: Math.round(c.base64.length * 3 / 4 / 1024),
        });
      } catch (err) {
        alert(`Failed to process ${file.name}: ${err.message}`);
      }
    }
    setDraft(d => ({ ...d, images_to_add: [...(d.images_to_add || []), ...newImgs] }));
  };

  const removeStagedImage = (idx) => {
    setDraft(d => ({ ...d, images_to_add: (d.images_to_add || []).filter((_, i) => i !== idx) }));
  };
  const setStagedImageAlt = (idx, alt) => {
    setDraft(d => ({ ...d, images_to_add: (d.images_to_add || []).map((img, i) => i === idx ? { ...img, alt } : img) }));
  };

  // May 2026 — Drag-drop reorder for existing Shopify images
  // May 2026 — Image preview modal state. When user clicks an image in the
  // Media card, this opens the Shopify-style fullscreen preview with download
  // button (which proxies to /api/images/download to force original PNG/JPG
  // instead of Shopify's WebP).
  const [previewIdx, setPreviewIdx] = useState(null);  // null = closed; number = open at this index

  // Native HTML5 drag-drop. Order in draft.images_data IS the desired order.
  // buildDiff detects when this order differs from original and emits
  // image_reorder array, which the PATCH route uses to PUT new positions.
  const [draggedImgId, setDraggedImgId] = useState(null);
  const handleImgDragStart = (imgId) => (e) => {
    setDraggedImgId(String(imgId));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(imgId));
  };
  const handleImgDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleImgDrop = (targetImgId) => (e) => {
    e.preventDefault();
    const sourceId = draggedImgId || e.dataTransfer.getData('text/plain');
    if (!sourceId || String(sourceId) === String(targetImgId)) {
      setDraggedImgId(null);
      return;
    }
    setDraft(d => {
      const arr = [...(d.images_data || [])];
      const fromIdx = arr.findIndex(i => String(i.id) === String(sourceId));
      const toIdx   = arr.findIndex(i => String(i.id) === String(targetImgId));
      if (fromIdx === -1 || toIdx === -1) return d;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      // Update display positions to match new order (visual only — server is
      // source of truth; PATCH will persist actual position values).
      return {
        ...d,
        images_data: arr.map((img, i) => ({ ...img, position: i + 1 })),
      };
    });
    setDraggedImgId(null);
  };
  const handleImgDragEnd = () => setDraggedImgId(null);

  // Move image left / right via buttons (for users who can't drag-drop on touch
  // devices, and as a backup for keyboard users).
  const moveImageLeft = (imgId) => {
    setDraft(d => {
      const arr = [...(d.images_data || [])];
      const idx = arr.findIndex(i => String(i.id) === String(imgId));
      if (idx <= 0) return d;
      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
      return { ...d, images_data: arr.map((img, i) => ({ ...img, position: i + 1 })) };
    });
  };
  const moveImageRight = (imgId) => {
    setDraft(d => {
      const arr = [...(d.images_data || [])];
      const idx = arr.findIndex(i => String(i.id) === String(imgId));
      if (idx === -1 || idx >= arr.length - 1) return d;
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      return { ...d, images_data: arr.map((img, i) => ({ ...img, position: i + 1 })) };
    });
  };
  const setAsFirstImage = (imgId) => {
    setDraft(d => {
      const arr = [...(d.images_data || [])];
      const idx = arr.findIndex(i => String(i.id) === String(imgId));
      if (idx <= 0) return d;
      const [moved] = arr.splice(idx, 1);
      arr.unshift(moved);
      return { ...d, images_data: arr.map((img, i) => ({ ...img, position: i + 1 })) };
    });
  };

  // M2.D — delete existing image (stage by removing from images_data)
  const deleteExistingImage = (imageId) => {
    if (!confirm('Delete this image? Will be removed from Shopify on Save.')) return;
    setDraft(d => ({
      ...d,
      images_data: (d.images_data || []).filter(img => String(img.id) !== String(imageId)),
    }));
  };

  // ── Render guards ─────────────────────────────────────────────────────────

  // Access denied (no inventory.edit permission)
  if (!canEdit) {
    return (
      <div style={{ padding: 60, maxWidth: 600, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, color: '#fff', fontWeight: 600, marginBottom: 8 }}>Permission denied</div>
        <div style={{ fontSize: 13, color: text3, marginBottom: 18, lineHeight: 1.5 }}>
          Product edit karne ki ijazat tumhe nahi hai. CEO se{' '}
          <code style={{ background: '#1a1a1a', padding: '2px 6px', borderRadius: 4 }}>inventory.edit</code>{' '}
          permission grant karwane ko bolo.
        </div>
        <Btn onClick={() => router.push('/inventory')}>← Back to Inventory</Btn>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: text3 }}>
        <div style={{ fontSize: 24, marginBottom: 12, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</div>
        <div>Loading product...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div style={{ color: '#f87171', marginBottom: 16 }}>{error}</div>
        <Btn onClick={() => router.push('/inventory')}>← Back to Inventory</Btn>
      </div>
    );
  }

  if (!draft) return null;

  const shopifyAdminUrl = `https://admin.shopify.com/store/${(process.env.NEXT_PUBLIC_SHOPIFY_STORE_HANDLE || 'rszevar')}/products/${id}`;
  const storefrontUrl = draft.handle ? `https://rszevar.com/products/${draft.handle}` : null;

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto', position: 'relative' }}>
      {/* ─── Sticky Save Bar (only when unsaved changes) ────────────────────── */}
      {hasChanges && (
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: '#1a1408',
          border: `1px solid ${gold}`,
          borderRadius: 10,
          padding: '12px 18px',
          marginBottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: gold, fontSize: 13, fontWeight: 600 }}>
              <span>● Unsaved changes</span>
              <span style={{ color: text3, fontWeight: 400, fontSize: 12 }}>
                ({Object.keys(diff).length} field{Object.keys(diff).length !== 1 ? 's' : ''} changed
                {stockChangedCount > 0 ? `, including stock for ${stockChangedCount} variant${stockChangedCount === 1 ? '' : 's'}` : ''})
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={handleDiscard} disabled={saving}>Discard</Btn>
              <Btn
                onClick={handleSave}
                primary
                disabled={saving || reasonMissing}
                title={reasonMissing ? 'Stock change ke liye reason likhna zaroori hai' : ''}
              >
                {saving ? 'Saving...' : 'Save'}
              </Btn>
            </div>
          </div>

          {/* Phase 2.1 — Reason input. Shown when stock has changed (anti-theft).
              Hidden when only non-stock fields (price/SKU/etc.) changed. */}
          {reasonRequired && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#f87171', whiteSpace: 'nowrap', fontWeight: 600 }}>
                  Reason (REQUIRED for stock change):
                </span>
                <input
                  type="text"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Stock kyun change kiya? e.g. Restocked, Damaged, Manual count, Theft, Promotion..."
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    background: bgPage,
                    border: `1px solid ${reasonMissing ? '#f87171' : border}`,
                    borderRadius: 5,
                    color: text1,
                    fontSize: 12,
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                  onFocus={e => e.target.style.borderColor = reasonMissing ? '#f87171' : gold}
                  onBlur={e => e.target.style.borderColor = reasonMissing ? '#f87171' : border}
                />
                <span style={{ fontSize: 10, color: text3 }}>by {performer || 'Staff'}</span>
              </div>
              {reasonMissing && (
                <div style={{ fontSize: 11, color: '#f87171' }}>
                  ⚠️ Stock change save karne ke liye reason zaroori hai
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            type="button"
            onClick={handleSmartBack}
            style={{ background: 'transparent', border: 'none', color: text3, fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}
          >
            {backLabel}
          </button>
          <h1 style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 24, fontWeight: 600,
            color: gold, marginTop: 6,
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <span>{draft.title || 'Untitled'}</span>
            <StatusBadge status={draft.shopify_status} />
          </h1>
          <div style={{ fontSize: 12, color: text3, marginTop: 4 }}>
            ID: {id} · {draft.variants?.length || 0} variant{draft.variants?.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn
            onClick={handleRefresh}
            disabled={refreshing || saving}
            title="Pull latest data from Shopify (use if recent edits in Shopify aren't showing here)"
          >
            {refreshing ? '⟳ Refreshing...' : '🔄 Refresh'}
          </Btn>
          {storefrontUrl && (
            <Btn href={storefrontUrl} target="_blank" title="View on storefront">🌐 View</Btn>
          )}
          <Btn href={shopifyAdminUrl} target="_blank" title="Open in Shopify admin">🔗 Shopify</Btn>
        </div>
      </div>

      {/* ─── Save result alert ──────────────────────────────────────────────── */}
      {saveResult && (
        <div style={{
          padding: '10px 14px',
          marginBottom: 14,
          borderRadius: 8,
          background: saveResult.success ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
          border: `1px solid ${saveResult.success ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
          color: saveResult.success ? '#4ade80' : '#f87171',
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>
            {saveResult.success ? `✅ ${saveResult.message || 'Saved'}` :
             saveResult.partial ? `⚠️ ${saveResult.message}` :
             `❌ ${saveResult.error || saveResult.message}`}
            {saveResult.duration_ms && <span style={{ opacity: 0.6, marginLeft: 8 }}>({(saveResult.duration_ms/1000).toFixed(1)}s)</span>}
          </span>
          <button onClick={() => setSaveResult(null)} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* M2.I — AI Applied flash */}
      {aiAppliedFlash && (
        <div style={{
          padding: '10px 14px',
          marginBottom: 14,
          borderRadius: 8,
          background: 'rgba(201,169,110,0.08)',
          border: `1px solid ${gold}`,
          color: gold,
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>
            ✨ AI applied to form: <span style={{ color: text1, fontWeight: 600 }}>
              {aiAppliedFlash.fields.length > 0 ? aiAppliedFlash.fields.join(', ') : 'no fields'}
            </span>
            <span style={{ marginLeft: 8, color: text3, fontSize: 11 }}>
              · Click "Save" to push to Shopify
            </span>
          </span>
          <button onClick={() => setAiAppliedFlash(null)} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* M2.I/M2.J — AI pending extras (FAQs + product metafields) */}
      {aiPendingExtras && (
        <div style={{
          padding: '10px 14px',
          marginBottom: 14,
          borderRadius: 8,
          background: 'rgba(251,191,36,0.06)',
          border: '1px solid rgba(251,191,36,0.3)',
          color: '#fbbf24',
          fontSize: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>
            ⏳ AI also generated extras (will save with Save button):
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

      {/* ─── Two-column layout ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 20 }}>
        {/* ═══════ LEFT COLUMN ═══════ */}
        <div>
          {/* Title */}
          <Card title="Title">
            <TextInput
              value={draft.title}
              onChange={v => setField('title', v)}
              placeholder="Product title"
            />
            <div style={{ fontSize: 11, color: text3, marginTop: 6 }}>
              {(draft.title || '').length} characters · ideal 50-70 for SEO
            </div>
          </Card>

          {/* Description */}
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
                    <button
                      key={t.v}
                      onClick={() => setDescMode(t.v)}
                      style={{
                        padding: '4px 10px',
                        background: descMode === t.v ? 'rgba(201,169,110,0.15)' : 'transparent',
                        border: 'none',
                        borderRadius: 4,
                        color: descMode === t.v ? gold : text3,
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                      }}
                    >{t.l}</button>
                  ))}
                </div>
              </div>
            }
          >
            {descMode === 'edit' ? (
              <TextArea
                value={draft.description_html}
                onChange={v => setField('description_html', v)}
                placeholder="<p>Product description here...</p>"
                rows={12}
                mono
              />
            ) : (
              <div
                style={{
                  background: bgPage,
                  border: `1px solid ${border}`,
                  borderRadius: 6,
                  padding: 16,
                  minHeight: 200,
                  fontSize: 14,
                  color: text1,
                  lineHeight: 1.6,
                }}
                dangerouslySetInnerHTML={{ __html: draft.description_html || '<p style="color:#666">No description</p>' }}
              />
            )}
            <div style={{ fontSize: 11, color: text3, marginTop: 6 }}>
              {(draft.description_html || '').replace(/<[^>]+>/g, '').length} chars (visible text) · use {'<strong>'}, {'<ul>'} for SEO bonus
            </div>
          </Card>

          {/* Media */}
          <Card
            title={`Media (${(draft.images_data?.length || 0) + (draft.images_to_add?.length || 0)} images)`}
            right={
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', background: 'transparent',
                border: `1px solid ${gold}`, color: gold,
                borderRadius: 5, fontSize: 11, fontWeight: 600,
                cursor: 'pointer',
              }}>
                📷 Upload
                <input type="file" multiple accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
              </label>
            }
          >
            {((!draft.images_data || draft.images_data.length === 0) && (!draft.images_to_add || draft.images_to_add.length === 0)) ? (
              <div style={{ color: text3, fontSize: 13, textAlign: 'center', padding: 24 }}>
                No images yet. Click Upload to add.
              </div>
            ) : (
              <>
                {(draft.images_data || []).length > 1 && (
                  <div style={{
                    fontSize: 11, color: text3, marginBottom: 10,
                    padding: '6px 10px',
                    background: 'rgba(96,165,250,0.06)',
                    border: '1px solid rgba(96,165,250,0.2)',
                    borderRadius: 6,
                  }}>
                    💡 Drag karke order change karo · ya ←/→ buttons use karo · "Set first" se main image banao · Save karne pe Shopify pe sync hoga
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {/* Existing Shopify images — drag-drop reorderable */}
                  {(draft.images_data || []).map((img, imgIdx) => {
                    const isDragged = String(draggedImgId) === String(img.id);
                    const isFirst = imgIdx === 0;
                    const isLast  = imgIdx === (draft.images_data || []).length - 1;
                    return (
                      <div
                        key={img.id}
                        draggable
                        onDragStart={handleImgDragStart(img.id)}
                        onDragOver={handleImgDragOver}
                        onDrop={handleImgDrop(img.id)}
                        onDragEnd={handleImgDragEnd}
                        style={{
                          background: bgPage,
                          border: `1px solid ${isDragged ? gold : border}`,
                          borderRadius: 8,
                          padding: 10,
                          cursor: 'move',
                          opacity: isDragged ? 0.4 : 1,
                          transition: 'opacity 0.15s, border-color 0.15s',
                        }}>
                        <div style={{ position: 'relative', paddingTop: '100%', background: '#000', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
                          {/* May 2026 — Click on image opens fullscreen preview modal
                              (Shopify-style) with download button that forces original
                              PNG/JPG via /api/images/download proxy. We use a clickable
                              overlay div instead of putting onClick on <img> directly
                              because <img> draggable interferes — the parent card has
                              draggable=true for reorder, so we keep the image element
                              as just visual + add a transparent overlay that catches
                              clicks AFTER drag detection (use a small pointer cursor +
                              "🔍 Click to preview" hint on hover). */}
                          <img src={img.src} alt={img.alt || ''}
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
                          />
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewIdx(imgIdx);
                            }}
                            title="Click to preview · Drag from edges to reorder"
                            style={{
                              position: 'absolute', inset: 0,
                              cursor: 'zoom-in',
                              background: 'transparent',
                            }}
                            onMouseEnter={(e) => {
                              const hint = e.currentTarget.querySelector('.preview-hint');
                              if (hint) hint.style.opacity = '1';
                            }}
                            onMouseLeave={(e) => {
                              const hint = e.currentTarget.querySelector('.preview-hint');
                              if (hint) hint.style.opacity = '0';
                            }}
                          >
                            <div className="preview-hint" style={{
                              position: 'absolute', bottom: 8, right: 8,
                              background: 'rgba(0,0,0,0.75)', color: '#fff',
                              fontSize: 10, fontWeight: 600,
                              padding: '4px 8px', borderRadius: 4,
                              opacity: 0, transition: 'opacity 0.15s',
                              pointerEvents: 'none',
                            }}>🔍 Click to preview</div>
                          </div>
                          <div style={{
                            position: 'absolute', top: 6, left: 6,
                            background: 'rgba(0,0,0,0.7)', color: gold,
                            fontSize: 10, fontWeight: 600,
                            padding: '2px 6px', borderRadius: 3,
                            display: 'flex', alignItems: 'center', gap: 4,
                            pointerEvents: 'none',
                          }}>
                            <span style={{ fontSize: 12 }}>⋮⋮</span>
                            <span>#{imgIdx + 1}</span>
                            {isFirst && <span style={{ marginLeft: 2, color: '#4ade80' }}>★ Main</span>}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteExistingImage(img.id); }}
                            title="Delete image"
                            style={{
                              position: 'absolute', top: 6, right: 6,
                              background: 'rgba(0,0,0,0.7)', color: '#f87171',
                              border: '1px solid rgba(248,113,113,0.5)',
                              borderRadius: 4, padding: '2px 8px',
                              fontSize: 14, fontWeight: 700, cursor: 'pointer',
                              lineHeight: 1,
                              zIndex: 5,
                            }}
                          >×</button>
                        </div>

                        {/* Reorder controls — buttons for non-drag users */}
                        {(draft.images_data || []).length > 1 && (
                          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                            <button
                              onClick={() => moveImageLeft(img.id)}
                              disabled={isFirst}
                              title="Move left"
                              style={{
                                flex: '0 0 auto',
                                background: '#1a1a1a',
                                border: `1px solid ${border}`,
                                color: isFirst ? text3 : text1,
                                borderRadius: 4,
                                padding: '4px 8px',
                                fontSize: 12, fontFamily: 'inherit',
                                cursor: isFirst ? 'not-allowed' : 'pointer',
                                opacity: isFirst ? 0.4 : 1,
                              }}>←</button>
                            <button
                              onClick={() => moveImageRight(img.id)}
                              disabled={isLast}
                              title="Move right"
                              style={{
                                flex: '0 0 auto',
                                background: '#1a1a1a',
                                border: `1px solid ${border}`,
                                color: isLast ? text3 : text1,
                                borderRadius: 4,
                                padding: '4px 8px',
                                fontSize: 12, fontFamily: 'inherit',
                                cursor: isLast ? 'not-allowed' : 'pointer',
                                opacity: isLast ? 0.4 : 1,
                              }}>→</button>
                            {!isFirst && (
                              <button
                                onClick={() => setAsFirstImage(img.id)}
                                title="Set as main (first) image"
                                style={{
                                  flex: 1,
                                  background: '#1a1a1a',
                                  border: `1px solid ${border}`,
                                  color: '#4ade80',
                                  borderRadius: 4,
                                  padding: '4px 8px',
                                  fontSize: 11, fontFamily: 'inherit',
                                  cursor: 'pointer',
                                }}>★ Set as main</button>
                            )}
                          </div>
                        )}

                        <Label>Alt text</Label>
                        <TextInput
                          value={img.alt || ''}
                          onChange={v => setImageAlt(img.id, v)}
                          placeholder="Describe this image for accessibility + SEO"
                        />
                      </div>
                    );
                  })}
                  {/* Staged uploads (not yet on Shopify) — at the end, no reorder yet */}
                  {(draft.images_to_add || []).map((img, idx) => (
                    <div key={`new-${idx}`} style={{
                      background: bgPage,
                      border: `1px solid rgba(74,222,128,0.4)`,
                      borderRadius: 8, padding: 10,
                    }}>
                      <div style={{ position: 'relative', paddingTop: '100%', background: '#000', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
                        <img src={img.previewUrl} alt={img.alt || ''}
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                        <div style={{
                          position: 'absolute', top: 6, left: 6,
                          background: 'rgba(74,222,128,0.85)', color: '#080808',
                          fontSize: 10, fontWeight: 700,
                          padding: '2px 6px', borderRadius: 3,
                        }}>NEW · {img.sizeKb}KB</div>
                        <button
                          onClick={() => removeStagedImage(idx)}
                          title="Remove (not yet uploaded)"
                          style={{
                            position: 'absolute', top: 6, right: 6,
                            background: 'rgba(0,0,0,0.7)', color: '#f87171',
                            border: '1px solid rgba(248,113,113,0.5)',
                            borderRadius: 4, padding: '2px 8px',
                            fontSize: 14, fontWeight: 700, cursor: 'pointer',
                            lineHeight: 1,
                          }}
                        >×</button>
                      </div>
                      <Label>Alt text</Label>
                      <TextInput
                        value={img.alt || ''}
                        onChange={v => setStagedImageAlt(idx, v)}
                        placeholder="Describe this image"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          {/* Variants — editable (M2.D + M2.K) */}
          <Card
            title={`Variants (${draft.variants?.length || 0})`}
            right={
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {(draft.variants?.length || 0) > 1 && (
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
                <span style={{ fontSize: 11, color: text3 }}>Edit price, compare-at, SKU, stock, weight — saves to Shopify on Save</span>
              </div>
            }
            padBody={false}
          >
            {(!draft.variants || draft.variants.length === 0) ? (
              <div style={{ padding: 24, color: text3, fontSize: 13, textAlign: 'center' }}>No variants</div>
            ) : hasMultiOptions ? (
              // ═══════════════════════════════════════════════════════════
              // M2.K — GROUPED VIEW (2+ option products, e.g. Color + Size)
              // ═══════════════════════════════════════════════════════════
              <div style={{ borderTop: `1px solid ${border}` }}>
                <div style={{
                  padding: '8px 14px', fontSize: 11, color: text3,
                  background: 'rgba(201,169,110,0.02)',
                  borderBottom: `1px solid ${border}`,
                }}>
                  Grouped by <strong style={{ color: gold }}>{draft.variants[0]?.option1 ? 'Option 1' : 'Color'}</strong> · click row to expand sub-variants
                </div>
                {variantGroups.map(group => {
                  const isExpanded = !!expandedGroups[group.key];
                  const groupPrice = getGroupCommonValue(group.variants, 'selling_price');
                  const groupCompare = getGroupCommonValue(group.variants, 'compare_at_price');
                  const groupWeight = getGroupCommonValue(group.variants, 'weight');
                  const groupImageId = getGroupCommonValue(group.variants, 'image_id');
                  const totalStock = getGroupTotalStock(group.variants);
                  const isMixedPrice = groupPrice === '__MIXED__';
                  const isMixedCompare = groupCompare === '__MIXED__';
                  const isMixedWeight = groupWeight === '__MIXED__';
                  const isMixedImage = groupImageId === '__MIXED__';

                  return (
                    <div key={group.key}>
                      {/* PARENT (group) ROW */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '32px 56px 1fr 110px 110px 130px 90px 100px 50px',
                        gap: 8, padding: '10px 14px',
                        background: 'rgba(201,169,110,0.04)',
                        borderBottom: isExpanded ? `1px solid ${border}` : `1px solid ${border}`,
                        alignItems: 'center',
                      }}>
                        {/* Expand toggle */}
                        <button onClick={() => toggleGroupExpanded(group.key)}
                          title={isExpanded ? 'Collapse' : 'Expand'}
                          style={{
                            background: 'transparent', border: 'none', color: text2,
                            cursor: 'pointer', fontSize: 14, padding: 4,
                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.15s',
                          }}
                        >▶</button>

                        {/* Group image picker (broadcasts to all sub-variants) */}
                        <VariantImagePicker
                          images={draft.images_data || []}
                          selectedId={isMixedImage ? null : groupImageId}
                          onSelect={(imgId) => setGroupImageId(group.key, imgId)}
                          size={40}
                          variantLabel={`${group.label} (all ${group.variants.length})`}
                        />

                        {/* Group label */}
                        <div>
                          <div style={{ fontWeight: 600, color: text1, fontSize: 13 }}>{group.label}</div>
                          <div style={{ fontSize: 10, color: text3, marginTop: 2 }}>
                            {group.variants.length} variant{group.variants.length !== 1 ? 's' : ''} · {totalStock} in stock
                          </div>
                        </div>

                        {/* Group price (broadcast) */}
                        {canViewFinancial ? (
                          <NumInput
                            value={isMixedPrice ? '' : (groupPrice ?? '')}
                            onChange={val => setGroupField(group.key, 'selling_price', val)}
                            placeholder={isMixedPrice ? 'Mixed' : '0.00'}
                          />
                        ) : <div />}

                        {/* Group compare-at (broadcast) */}
                        {canViewFinancial ? (
                          <NumInput
                            value={isMixedCompare ? '' : (groupCompare ?? '')}
                            onChange={val => setGroupField(group.key, 'compare_at_price', val)}
                            placeholder={isMixedCompare ? 'Mixed' : '—'}
                          />
                        ) : <div />}

                        {/* Group SKU placeholder — SKUs are per sub-variant, no broadcast */}
                        <div style={{ fontSize: 10, color: text3, fontStyle: 'italic' }}>per sub-variant</div>

                        {/* Group total stock (read-only summary) */}
                        <div style={{ fontSize: 11, color: text2, fontFamily: 'monospace' }}>{totalStock}</div>

                        {/* Group weight (broadcast) */}
                        <NumInput
                          value={isMixedWeight ? '' : (groupWeight ?? '')}
                          onChange={val => setGroupField(group.key, 'weight', val)}
                          placeholder={isMixedWeight ? 'Mixed' : '0'}
                          step="0.1"
                        />

                        {/* ABC summary — show first variant's ABC for parent row */}
                        <div style={{ color: text2, fontSize: 11 }}>{group.variants[0]?.abc_90d || '—'}</div>
                      </div>

                      {/* EXPANDED SUB-VARIANT ROWS */}
                      {isExpanded && group.variants.map(v => (
                        <div key={v.id} style={{
                          display: 'grid',
                          gridTemplateColumns: '32px 56px 1fr 110px 110px 130px 90px 100px 50px',
                          gap: 8, padding: '8px 14px',
                          background: bgPage,
                          borderBottom: `1px solid ${border}`,
                          alignItems: 'center',
                        }}>
                          {/* indent column */}
                          <div />
                          {/* sub-variant image picker */}
                          <VariantImagePicker
                            images={draft.images_data || []}
                            selectedId={v.image_id}
                            onSelect={(imgId) => setVariantField(v.shopify_variant_id, 'image_id', imgId)}
                            size={36}
                            variantLabel={v.variant_label}
                          />
                          {/* sub-variant label (e.g. size value) — clickable link to variant detail */}
                          <div style={{ color: text2, fontSize: 12, paddingLeft: 4 }}>
                            <span style={{ color: text3, marginRight: 6 }}>↳</span>
                            <Link
                              href={`/inventory/${id}/variants/${v.shopify_variant_id}`}
                              style={{ color: gold, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              title="Open variant detail page"
                            >
                              {v.option2 || v.variant_label}
                              <span style={{ fontSize: 10, opacity: 0.6 }}>↗</span>
                            </Link>
                          </div>
                          {canViewFinancial && (
                            <NumInput
                              value={v.selling_price ?? ''}
                              onChange={val => setVariantField(v.shopify_variant_id, 'selling_price', val)}
                              placeholder="0.00"
                            />
                          )}
                          {!canViewFinancial && <div />}
                          {canViewFinancial && (
                            <NumInput
                              value={v.compare_at_price ?? ''}
                              onChange={val => setVariantField(v.shopify_variant_id, 'compare_at_price', val)}
                              placeholder="—"
                            />
                          )}
                          {!canViewFinancial && <div />}
                          <input
                            type="text"
                            value={v.sku || ''}
                            onChange={e => setVariantField(v.shopify_variant_id, 'sku', e.target.value)}
                            placeholder="SKU"
                            style={{
                              width: '100%', padding: '6px 8px',
                              background: card, border: `1px solid ${border}`, borderRadius: 4,
                              color: text1, fontSize: 12, fontFamily: 'monospace', outline: 'none',
                            }}
                            onFocus={e => e.target.style.borderColor = gold}
                            onBlur={e => e.target.style.borderColor = border}
                          />
                          <NumInput
                            value={v.stock_quantity ?? 0}
                            onChange={val => setVariantField(v.shopify_variant_id, 'stock_quantity', val)}
                            placeholder="0"
                            step="1"
                          />
                          <NumInput
                            value={v.weight ?? ''}
                            onChange={val => setVariantField(v.shopify_variant_id, 'weight', val)}
                            placeholder="0"
                            step="0.1"
                          />
                          <div style={{ color: text2, fontSize: 11 }}>{v.abc_90d || '—'}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              // ═══════════════════════════════════════════════════════════
              // FLAT VIEW — single-option (or no-option) products
              // ═══════════════════════════════════════════════════════════
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${border}`, background: 'rgba(201,169,110,0.03)' }}>
                      <th style={{ textAlign: 'left',  padding: '10px 8px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 56 }}>Image</th>
                      <th style={{ textAlign: 'left',  padding: '10px 12px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Variant</th>
                      {canViewFinancial && (
                        <th style={{ textAlign: 'left', padding: '10px 8px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 110 }}>Price</th>
                      )}
                      {canViewFinancial && (
                        <th style={{ textAlign: 'left', padding: '10px 8px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 110 }}>Compare-at</th>
                      )}
                      <th style={{ textAlign: 'left', padding: '10px 8px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 130 }}>SKU</th>
                      <th style={{ textAlign: 'left', padding: '10px 8px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 90 }}>Stock</th>
                      <th style={{ textAlign: 'left', padding: '10px 8px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 100 }}>Weight (g)</th>
                      <th style={{ textAlign: 'left', padding: '10px 8px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: 50 }}>ABC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.variants.map(v => (
                      <tr key={v.id} style={{ borderBottom: `1px solid ${border}` }}>
                        <td style={{ padding: '8px' }}>
                          <VariantImagePicker
                            images={draft.images_data || []}
                            selectedId={v.image_id}
                            onSelect={(imgId) => setVariantField(v.shopify_variant_id, 'image_id', imgId)}
                            size={36}
                            variantLabel={v.variant_label}
                          />
                        </td>
                        <td style={{ padding: '8px 12px', color: text1 }}>
                          <Link
                            href={`/inventory/${id}/variants/${v.shopify_variant_id}`}
                            style={{ color: gold, textDecoration: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            title="Open variant detail page"
                          >
                            {v.variant_label}
                            <span style={{ fontSize: 10, opacity: 0.6 }}>↗</span>
                          </Link>
                        </td>
                        {canViewFinancial && (
                          <td style={{ padding: '8px' }}>
                            <NumInput
                              value={v.selling_price ?? ''}
                              onChange={val => setVariantField(v.shopify_variant_id, 'selling_price', val)}
                              placeholder="0.00"
                            />
                          </td>
                        )}
                        {canViewFinancial && (
                          <td style={{ padding: '8px' }}>
                            <NumInput
                              value={v.compare_at_price ?? ''}
                              onChange={val => setVariantField(v.shopify_variant_id, 'compare_at_price', val)}
                              placeholder="—"
                            />
                          </td>
                        )}
                        <td style={{ padding: '8px' }}>
                          <input
                            type="text"
                            value={v.sku || ''}
                            onChange={e => setVariantField(v.shopify_variant_id, 'sku', e.target.value)}
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
                        <td style={{ padding: '8px' }}>
                          <NumInput
                            value={v.stock_quantity ?? 0}
                            onChange={val => setVariantField(v.shopify_variant_id, 'stock_quantity', val)}
                            placeholder="0"
                            step="1"
                          />
                        </td>
                        <td style={{ padding: '8px' }}>
                          <NumInput
                            value={v.weight ?? ''}
                            onChange={val => setVariantField(v.shopify_variant_id, 'weight', val)}
                            placeholder="0"
                            step="0.1"
                          />
                        </td>
                        <td style={{ padding: '8px', color: text2, fontSize: 11 }}>{v.abc_90d || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* ═══════ RIGHT COLUMN ═══════ */}
        <div>
          {/* M2.I — Live SEO Score (recomputes on every keystroke) */}
          {liveSeo && (
            <Card title="SEO Score (Live)" right={<SeoBadge score={liveSeo.score} tier={liveSeo.tier} />}>
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
                <div style={{
                  marginTop: 6, fontSize: 10, color: text3, textAlign: 'center',
                }}>
                  {liveSeo.score} / 100 · {liveSeo.tier === 'green' ? 'Solid SEO' : liveSeo.tier === 'yellow' ? 'Acceptable' : 'Needs work'}
                </div>
              </div>
              {/* Per-criterion breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
                {Object.entries(liveSeo.breakdown).map(([key, b]) => {
                  const pct = b.max > 0 ? (b.points / b.max) : 1;
                  const dotColor = pct >= 0.8 ? '#4ade80' : pct >= 0.5 ? '#facc15' : '#f87171';
                  return (
                    <div key={key} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      fontSize: 11, padding: '5px 8px',
                      background: bgPage, borderRadius: 4,
                      border: `1px solid ${border}`,
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

          {/* Status */}
          <Card title="Status">
            <Select
              value={draft.shopify_status || 'draft'}
              onChange={v => setField('shopify_status', v)}
              options={[
                { value: 'active',   label: '✓ Active (visible on storefront)' },
                { value: 'draft',    label: '○ Draft (not visible)' },
                { value: 'archived', label: '✕ Archived' },
              ]}
            />
          </Card>

          {/* Product Organization */}
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
                placeholder="e.g. SBH, BWP"
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <Label hint={`${(draft.collections || []).length} selected`}>Collections</Label>
              <CollectionsPicker
                selected={draft.collections || []}
                available={allCollections}
                onChange={v => setField('collections', v)}
                loading={collectionsLoading}
              />
            </div>
            <div>
              <Label>Tags</Label>
              <TagsInput
                tags={draft.tags || []}
                onChange={v => setField('tags', v)}
              />
            </div>
          </Card>

          {/* SEO */}
          <Card title="SEO" right={<SeoBadge score={draft.seo_score} tier={draft.seo_tier} />}>
            <div style={{ marginBottom: 14 }}>
              <Label hint="Ideal: 30-60 chars">Meta Title</Label>
              <TextInput
                value={draft.seo_meta_title}
                onChange={v => setField('seo_meta_title', v)}
                placeholder="Search engine title"
              />
              <div style={{ fontSize: 10, color: text3, marginTop: 4 }}>
                {(draft.seo_meta_title || '').length} / 60 chars
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
                {(draft.seo_meta_description || '').length} / 160 chars
              </div>
            </div>
            <div>
              <Label hint="URL slug — be careful, changing breaks backlinks">Handle</Label>
              <TextInput
                value={draft.handle}
                onChange={v => setField('handle', v)}
                placeholder="product-url-slug"
                mono
              />
              <div style={{ fontSize: 10, color: text3, marginTop: 4 }}>
                rszevar.com/products/<span style={{ color: gold }}>{draft.handle || '...'}</span>
              </div>
            </div>
          </Card>

          {/* Score updated time */}
          {draft.seo_score_updated_at && (
            <div style={{ fontSize: 11, color: text3, textAlign: 'center', marginTop: -8, marginBottom: 16 }}>
              SEO score updated: {new Date(draft.seo_score_updated_at).toLocaleString()}
            </div>
          )}

          {/* Google Shopping metafields (M2.D) */}
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
      {aiEnhanceOpen && draft && (
        <AiEnhanceModal
          mode="apply"
          product={{
            shopify_product_id: id,
            title: draft.title,
            parent_title: draft.title,
            image_url: draft.images_data?.[0]?.src || null,
            category: draft.product_type || '',
            vendor: draft.vendor || '',
            selling_price: draft.variants?.[0]?.selling_price || draft.variants?.[0]?.price || null,
            variants_summary: (draft.variants || []).map(v => v.variant_label || v.title).filter(Boolean).join(', '),
            image_count: (draft.images_data?.length || 0),
            current_description: draft.description_html || '',
          }}
          onClose={() => setAiEnhanceOpen(false)}
          onApply={handleAiApply}
        />
      )}

      {/* M2.K — Bulk Edit modal */}
      {bulkEditOpen && draft && draft.variants && draft.variants.length > 0 && (
        <BulkEditModal
          variants={draft.variants}
          canViewFinancial={canViewFinancial}
          onClose={() => setBulkEditOpen(false)}
          onApply={handleBulkApply}
        />
      )}

      {/* May 2026 — Image preview modal (Shopify-style fullscreen viewer with
          download button that proxies via /api/images/download to force original
          PNG/JPG instead of WebP). Click any image in the Media card to open. */}
      {previewIdx !== null && Array.isArray(draft?.images_data) && draft.images_data.length > 0 && (
        <ImagePreviewModal
          images={draft.images_data}
          startIndex={Math.max(0, Math.min(previewIdx, draft.images_data.length - 1))}
          productTitle={draft.title || ''}
          shopifyId={id}
          onClose={() => setPreviewIdx(null)}
        />
      )}
    </div>
  );
}
