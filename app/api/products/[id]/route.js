'use client';

// ============================================================================
// RS ZEVAR ERP — Single Product Editor (Phase D — Apr 28 2026)
// Route: /inventory/[id]   (id = shopify_product_id)
// ----------------------------------------------------------------------------
// Shopify-inspired full-page editor. Two-column layout:
//   LEFT  (wide):   Title • Description • Media • Variants
//   RIGHT (narrow): Status • Organization • Tags • SEO • Theme
//
// Save flow:
//   - Edits accumulate in `draft` state
//   - Sticky top bar shows "Unsaved changes — Discard / Save"
//   - Save → PATCH /api/products/[id] → Shopify + DB mirror → reload
//
// Note: Variant editing (price/SKU/stock) and Add Variant / Custom Options
// are scoped to Phase E. M1 just displays variants read-only.
// ============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

// Use relative imports (Next.js 16 Turbopack workaround for new files)
import { useUser } from '../../context/UserContext';

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
  ];
  for (const f of fields) {
    if (!isEqual(original[f], draft[f])) {
      diff[f] = draft[f];
    }
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
  return diff;
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ────────────────────────────────────────────────────────────────────────────
export default function ProductEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;
  const { canViewFinancial } = useUser();

  const [product, setProduct]   = useState(null);   // loaded from server (immutable snapshot)
  const [draft, setDraft]       = useState(null);   // editable copy
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [saving, setSaving]     = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [descMode, setDescMode] = useState('edit'); // 'edit' | 'preview'

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
        setProduct(data.product);
        setDraft({ ...data.product, images_data: [...(data.product.images_data || [])] });
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { loadProduct(); }, [loadProduct]);

  // ── Track unsaved changes ─────────────────────────────────────────────────
  const diff = useMemo(() => {
    if (!product || !draft) return {};
    return buildDiff(product, draft);
  }, [product, draft]);

  const hasChanges = Object.keys(diff).length > 0;

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
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diff),
      });
      const data = await res.json();
      setSaveResult(data);
      if (data.success || data.partial) {
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
    setDraft({ ...product, images_data: [...(product.images_data || [])] });
    setSaveResult(null);
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

  // ── Render guards ─────────────────────────────────────────────────────────
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
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: gold, fontSize: 13, fontWeight: 600 }}>
            <span>● Unsaved changes</span>
            <span style={{ color: text3, fontWeight: 400, fontSize: 12 }}>
              ({Object.keys(diff).length} field{Object.keys(diff).length !== 1 ? 's' : ''} changed)
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={handleDiscard} disabled={saving}>Discard</Btn>
            <Btn onClick={handleSave} primary disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Btn>
          </div>
        </div>
      )}

      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href="/inventory" style={{ color: text3, fontSize: 12, textDecoration: 'none' }}>
            ← Inventory
          </Link>
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
          <Card title={`Media (${draft.images_data?.length || 0} images)`}>
            {(!draft.images_data || draft.images_data.length === 0) ? (
              <div style={{ color: text3, fontSize: 13, textAlign: 'center', padding: 24 }}>
                No images. Upload images in Shopify admin.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {draft.images_data.map(img => (
                  <div key={img.id} style={{ background: bgPage, border: `1px solid ${border}`, borderRadius: 8, padding: 10 }}>
                    <div style={{ position: 'relative', paddingTop: '100%', background: '#000', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
                      <img
                        src={img.src}
                        alt={img.alt || ''}
                        style={{
                          position: 'absolute', top: 0, left: 0,
                          width: '100%', height: '100%',
                          objectFit: 'contain',
                        }}
                      />
                      <div style={{
                        position: 'absolute', top: 6, left: 6,
                        background: 'rgba(0,0,0,0.7)',
                        color: gold, fontSize: 10, fontWeight: 600,
                        padding: '2px 6px', borderRadius: 3,
                      }}>#{img.position}</div>
                    </div>
                    <Label>Alt text</Label>
                    <TextInput
                      value={img.alt || ''}
                      onChange={v => setImageAlt(img.id, v)}
                      placeholder="Describe this image for accessibility + SEO"
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Variants (read-only in M1) */}
          <Card
            title={`Variants (${draft.variants?.length || 0})`}
            right={<span style={{ fontSize: 11, color: text3 }}>Edit prices/SKU/stock in Shopify admin (Phase E coming)</span>}
            padBody={false}
          >
            {(!draft.variants || draft.variants.length === 0) ? (
              <div style={{ padding: 24, color: text3, fontSize: 13, textAlign: 'center' }}>No variants</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${border}`, background: 'rgba(201,169,110,0.03)' }}>
                      <th style={{ textAlign: 'left', padding: '10px 14px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Variant</th>
                      <th style={{ textAlign: 'left', padding: '10px 14px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>SKU</th>
                      {canViewFinancial && (
                        <th style={{ textAlign: 'right', padding: '10px 14px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Price</th>
                      )}
                      <th style={{ textAlign: 'right', padding: '10px 14px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Stock</th>
                      <th style={{ textAlign: 'left', padding: '10px 14px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>ABC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.variants.map(v => (
                      <tr key={v.id} style={{ borderBottom: `1px solid ${border}` }}>
                        <td style={{ padding: '10px 14px', color: text1 }}>{v.variant_label}</td>
                        <td style={{ padding: '10px 14px', color: text2, fontFamily: 'monospace', fontSize: 12 }}>{v.sku || '—'}</td>
                        {canViewFinancial && (
                          <td style={{ padding: '10px 14px', color: text1, textAlign: 'right', fontWeight: 600 }}>Rs {Number(v.selling_price || 0).toLocaleString()}</td>
                        )}
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: (v.stock_quantity || 0) === 0 ? 'rgba(248,113,113,0.12)' :
                                        (v.stock_quantity || 0) <= 3 ? 'rgba(251,146,60,0.12)' : 'rgba(74,222,128,0.12)',
                            color: (v.stock_quantity || 0) === 0 ? '#f87171' :
                                   (v.stock_quantity || 0) <= 3 ? '#fb923c' : '#4ade80',
                            fontSize: 12, fontWeight: 600,
                          }}>{v.stock_quantity ?? 0}</span>
                        </td>
                        <td style={{ padding: '10px 14px', color: text2, fontSize: 12 }}>{v.abc_90d || '—'}</td>
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
              <Label hint="Edit in Shopify (M2 ke baad direct edit milega)">Collections</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 10px', background: bgPage, border: `1px solid ${border}`, borderRadius: 6, minHeight: 38 }}>
                {(draft.collections || []).length === 0 ? (
                  <span style={{ color: text3, fontSize: 12 }}>No collections</span>
                ) : (
                  draft.collections.map(c => (
                    <span key={c.handle} style={{
                      background: 'rgba(96,165,250,0.12)',
                      border: '1px solid rgba(96,165,250,0.3)',
                      color: '#60a5fa',
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 4,
                    }}>{c.title || c.handle}</span>
                  ))
                )}
              </div>
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
        </div>
      </div>
    </div>
  );
}
