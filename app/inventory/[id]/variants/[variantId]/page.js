'use client';

// ============================================================================
// RS ZEVAR ERP — Variant Edit Page (Phase 1 — Apr 2026)
// Route: /inventory/[id]/variants/[variantId]
//   id        = shopify_product_id
//   variantId = shopify_variant_id
// ----------------------------------------------------------------------------
// Shopify-style variant detail view. Loads parent product (via existing
// /api/products/[id] GET) and filters down to one variant. Sidebar lists
// all variants for navigation. Right pane is a focused edit form for the
// selected variant.
//
// Saves via existing /api/products/[id] PATCH using `variants_update: [...]`
// — no new backend endpoint needed.
//
// Phase 3 (later) will add full adjustment history. For now, that section
// shows a deep link to Shopify admin's history page.
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '../../../../context/UserContext';

// ── Theme tokens (mirrored from /inventory/[id]/page.js) ────────────────────
const gold   = '#c9a96e';
const card   = '#141414';
const border = '#222';
const bgPage = '#080808';
const text1  = '#e5e5e5';
const text2  = '#aaa';
const text3  = '#666';

// ── UI atoms ────────────────────────────────────────────────────────────────
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

function TextInput({ value, onChange, placeholder, mono, disabled, prefix }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      background: bgPage,
      border: `1px solid ${border}`,
      borderRadius: 6,
      transition: 'border-color 0.15s',
    }}
      onFocus={e => e.currentTarget.style.borderColor = gold}
      onBlur={e => e.currentTarget.style.borderColor = border}
    >
      {prefix && (
        <span style={{ padding: '0 0 0 12px', color: text3, fontSize: 13, fontFamily: 'monospace' }}>{prefix}</span>
      )}
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          flex: 1,
          padding: '9px 12px',
          background: 'transparent',
          border: 'none',
          color: text1,
          fontSize: 13,
          fontFamily: mono ? 'monospace' : 'inherit',
          outline: 'none',
        }}
      />
    </div>
  );
}

function NumInput({ value, onChange, placeholder, step = '1', prefix, suffix }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      background: bgPage,
      border: `1px solid ${border}`,
      borderRadius: 6,
    }}>
      {prefix && (
        <span style={{ padding: '0 0 0 12px', color: text3, fontSize: 13 }}>{prefix}</span>
      )}
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        step={step}
        style={{
          flex: 1,
          padding: '9px 12px',
          background: 'transparent',
          border: 'none',
          color: text1,
          fontSize: 13,
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
      {suffix && (
        <span style={{ padding: '0 12px 0 0', color: text3, fontSize: 12 }}>{suffix}</span>
      )}
    </div>
  );
}

function Btn({ children, onClick, primary, danger, disabled, href, target, title, type }) {
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
  return <button type={type || 'button'} onClick={onClick} disabled={disabled} style={style} title={title}>{children}</button>;
}

function StatusPill({ status }) {
  const cfg = {
    active:   { label: 'Active',   color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
    draft:    { label: 'Draft',    color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
    archived: { label: 'Archived', color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
  }[status] || { label: status || '—', color: text3, bg: 'rgba(255,255,255,0.05)' };
  return (
    <span style={{
      color: cfg.color, background: cfg.bg, padding: '2px 8px', borderRadius: 4,
      fontSize: 10, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase',
    }}>{cfg.label}</span>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function VariantEditPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params?.id;
  const variantId = params?.variantId;
  const { canViewFinancial, performer, userEmail } = useUser();

  const [product, setProduct] = useState(null);   // full product with all variants
  const [draft, setDraft]     = useState(null);   // editable copy of CURRENT variant
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [reason, setReason]   = useState('');   // Phase 2 — optional adjustment reason

  // Smart back: detect if user came from an order
  const [backLabel, setBackLabel] = useState('← Back to product');
  const [backTarget, setBackTarget] = useState('product'); // 'product' | 'order' | 'inventory'

  useEffect(() => {
    if (typeof document === 'undefined' || !document.referrer) return;
    try {
      const ref = new URL(document.referrer);
      if (ref.origin !== window.location.origin) return;
      if (ref.pathname.startsWith('/orders/')) {
        setBackLabel('← Back to order');
        setBackTarget('order');
      } else if (ref.pathname === '/inventory') {
        setBackLabel('← Back to inventory');
        setBackTarget('inventory');
      } else if (ref.pathname.startsWith(`/inventory/${productId}`) && !ref.pathname.includes('/variants/')) {
        setBackLabel('← Back to product');
        setBackTarget('product');
      }
    } catch {}
  }, [productId]);

  const handleSmartBack = () => {
    if (backTarget === 'order' && typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    if (backTarget === 'inventory') {
      router.push('/inventory');
      return;
    }
    router.push(`/inventory/${productId}`);
  };

  // Load product (existing API returns ALL variants, we filter to one)
  const loadProduct = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to load product');
        setLoading(false);
        return;
      }
      setProduct(data.product);
      const v = (data.product.variants || []).find(x => String(x.shopify_variant_id) === String(variantId));
      if (!v) {
        setError(`Variant not found in this product. URL may be stale.`);
      } else {
        setDraft({ ...v });
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [productId, variantId]);

  useEffect(() => { loadProduct(); }, [loadProduct]);

  // Update a single field in the draft
  const setField = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  // Find original variant for diff comparison
  const originalVariant = useMemo(() => {
    if (!product) return null;
    return (product.variants || []).find(v => String(v.shopify_variant_id) === String(variantId)) || null;
  }, [product, variantId]);

  // Detect unsaved changes
  const isDirty = useMemo(() => {
    if (!draft || !originalVariant) return false;
    const keys = ['selling_price', 'compare_at_price', 'sku', 'barcode', 'stock_quantity', 'weight'];
    return keys.some(k => String(originalVariant[k] ?? '') !== String(draft[k] ?? ''));
  }, [draft, originalVariant]);

  // Phase 2.1 — Stock change requires a reason (prevent silent inventory theft).
  // Other field changes (price/sku/barcode/weight) don't require reason.
  const stockChanged = useMemo(() => {
    if (!draft || !originalVariant) return false;
    return String(originalVariant.stock_quantity ?? '') !== String(draft.stock_quantity ?? '');
  }, [draft, originalVariant]);

  const reasonRequired = stockChanged;
  const reasonMissing  = reasonRequired && !reason.trim();

  // Computed: profit/margin (only if cost available — Phase 1 placeholder, cost not yet loaded)
  const pricing = useMemo(() => {
    const price = parseFloat(draft?.selling_price) || 0;
    const cost  = 0; // Phase 2 will load cost from inventory_item.cost
    const profit = price - cost;
    const margin = price > 0 ? (profit / price) * 100 : 0;
    return { price, cost, profit, margin };
  }, [draft]);

  // Save handler — sends only the changed fields via existing PATCH endpoint
  const handleSave = async () => {
    if (!draft || !originalVariant || !isDirty || saving) return;

    // Phase 2.1 — Reason mandatory when stock is being adjusted (anti-theft control)
    if (reasonMissing) {
      setSaveResult({
        success: false,
        message: 'Stock change ke liye reason likhna zaroori hai (e.g. "Restocked", "Damaged", "Manual count")',
      });
      return;
    }

    setSaving(true);
    setSaveResult(null);
    try {
      const variantPatch = {
        shopify_variant_id: draft.shopify_variant_id,
        // Phase 2 — pass inventory_item_id so backend doesn't have to refetch,
        // and product_title for log row enrichment.
        shopify_inventory_item_id: draft.shopify_inventory_item_id || null,
        product_title: product.title || '',
        // Snapshot of values BEFORE this save — used by API to compute diff
        // and write per-field rows to inventory_adjustments.
        previous: {
          selling_price:    originalVariant.selling_price ?? '',
          compare_at_price: originalVariant.compare_at_price ?? '',
          sku:              originalVariant.sku ?? '',
          barcode:          originalVariant.barcode ?? '',
          stock_quantity:   originalVariant.stock_quantity ?? 0,
          weight:           originalVariant.weight ?? '',
          variant_label:    originalVariant.variant_label || '',
        },
      };

      if (String(originalVariant.selling_price ?? '') !== String(draft.selling_price ?? '')) {
        variantPatch.price = draft.selling_price === '' ? null : draft.selling_price;
      }
      if (String(originalVariant.compare_at_price ?? '') !== String(draft.compare_at_price ?? '')) {
        variantPatch.compare_at_price = draft.compare_at_price === '' ? null : draft.compare_at_price;
      }
      if (String(originalVariant.sku ?? '') !== String(draft.sku ?? '')) {
        variantPatch.sku = draft.sku || '';
      }
      if (String(originalVariant.barcode ?? '') !== String(draft.barcode ?? '')) {
        variantPatch.barcode = draft.barcode || '';
      }
      if (String(originalVariant.stock_quantity ?? '') !== String(draft.stock_quantity ?? '')) {
        variantPatch.stock = Number(draft.stock_quantity) || 0;
      }
      if (String(originalVariant.weight ?? '') !== String(draft.weight ?? '')) {
        variantPatch.grams = Number(draft.weight) || 0;
      }

      const res = await fetch(`/api/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variants_update: [variantPatch],
          // Phase 2 — top-level metadata applied to all log rows
          performed_by: performer || 'Staff',
          performed_by_email: userEmail || null,
          reason: reason.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Save failed');
      }
      const r = (data.results?.variants_update || [])[0];
      if (r && !r.success) {
        throw new Error(r.error || r.stock_error || 'Variant update failed');
      }
      setSaveResult({ success: true, message: '✓ Saved to Shopify' });
      // Clear reason after successful save (it applied only to this batch)
      setReason('');
      // Refetch to reflect any server-side adjustments (cost calc, stock normalization)
      await loadProduct();
    } catch (e) {
      setSaveResult({ success: false, message: e.message });
    }
    setSaving(false);
  };

  const handleDiscard = () => {
    if (originalVariant) setDraft({ ...originalVariant });
    setSaveResult(null);
  };

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: text2, fontSize: 13 }}>
        Loading variant...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div style={{ color: '#f87171', marginBottom: 16, fontSize: 14 }}>{error}</div>
        <Btn onClick={() => router.push(`/inventory/${productId}`)}>← Back to product</Btn>
      </div>
    );
  }

  if (!draft || !product) return null;

  const variantList = product.variants || [];
  const parentImage = (product.images_data && product.images_data[0]?.src) || draft.image_url || null;

  // Shopify admin deep link for THIS variant's adjustment history
  const shopifyAdjustmentHistoryUrl = draft.shopify_inventory_item_id
    ? `https://admin.shopify.com/store/rszevar/products/inventory/${draft.shopify_inventory_item_id}/inventory_history`
    : null;

  return (
    <div style={{ background: bgPage, minHeight: '100vh', color: text1 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 24px 60px' }}>

        {/* ─── Header ───────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <button
              type="button"
              onClick={handleSmartBack}
              style={{ background: 'transparent', border: 'none', color: text3, fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}
            >
              {backLabel}
            </button>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Link href={`/inventory/${productId}`} style={{ color: text2, fontSize: 13, textDecoration: 'none' }}>
                {product.title || 'Untitled product'}
              </Link>
              <span style={{ color: text3, fontSize: 13 }}>›</span>
              <h1 style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: 22, fontWeight: 600,
                color: gold, margin: 0,
              }}>
                {draft.variant_label || 'Default'}
              </h1>
              <StatusPill status={product.shopify_status} />
            </div>
            <div style={{ fontSize: 11, color: text3, marginTop: 4, fontFamily: 'monospace' }}>
              Variant ID: {draft.shopify_variant_id}
              {draft.shopify_inventory_item_id && <span> · Inventory item: {draft.shopify_inventory_item_id}</span>}
            </div>
          </div>

          {/* Save / Discard buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {isDirty && (
              <Btn onClick={handleDiscard} disabled={saving}>Discard</Btn>
            )}
            <Btn primary onClick={handleSave} disabled={!isDirty || saving || reasonMissing} title={reasonMissing ? 'Stock change ke liye reason likhna zaroori hai' : ''}>
              {saving ? 'Saving...' : 'Save'}
            </Btn>
            {saveResult && (
              <span style={{
                fontSize: 11,
                color: saveResult.success ? '#22c55e' : '#f87171',
                marginLeft: 4,
              }}>{saveResult.message}</span>
            )}
          </div>
        </div>

        {/* ─── 2-column grid: sidebar + main content ──────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'start' }}>

          {/* ═══ LEFT SIDEBAR ═══ */}
          <div style={{ position: 'sticky', top: 16, alignSelf: 'start', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
            {/* Parent product summary card */}
            <Card padBody={false}>
              <Link href={`/inventory/${productId}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                <div style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                  {parentImage ? (
                    <img src={parentImage} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', border: `1px solid ${border}`, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 6, background: 'rgba(201,169,110,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>📦</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: text1, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {product.title || 'Untitled'}
                    </div>
                    <div style={{ fontSize: 10, color: text3, marginTop: 2 }}>
                      {variantList.length} variant{variantList.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              </Link>
            </Card>

            {/* Variants list */}
            <Card padBody={false} title="Variants">
              <div>
                {variantList.map((v, i) => {
                  const isCurrent = String(v.shopify_variant_id) === String(variantId);
                  return (
                    <Link
                      key={v.shopify_variant_id}
                      href={`/inventory/${productId}/variants/${v.shopify_variant_id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 14px',
                        background: isCurrent ? 'rgba(201,169,110,0.08)' : 'transparent',
                        borderLeft: `3px solid ${isCurrent ? gold : 'transparent'}`,
                        borderBottom: i < variantList.length - 1 ? `1px solid ${border}` : 'none',
                        textDecoration: 'none',
                        color: isCurrent ? gold : text2,
                        fontSize: 12,
                        fontWeight: isCurrent ? 600 : 400,
                        transition: 'background 0.15s',
                      }}
                    >
                      {v.image_url ? (
                        <img src={v.image_url} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', border: `1px solid ${border}`, flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 28, height: 28, borderRadius: 4, background: 'rgba(201,169,110,0.08)', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {v.variant_label || 'Default'}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* ═══ MAIN CONTENT ═══ */}
          <div>

            {/* Title (read-only — variant labels come from product options) */}
            <Card title="Variant">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {draft.image_url ? (
                  <img src={draft.image_url} alt="" style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover', border: `1px solid ${border}`, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 60, height: 60, borderRadius: 8, background: 'rgba(201,169,110,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 24 }}>💍</div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: text1 }}>{draft.variant_label || 'Default'}</div>
                  <div style={{ fontSize: 11, color: text3, marginTop: 4 }}>
                    To change the option name (e.g. &quot;Size&quot; values), edit the parent product&apos;s options on Shopify admin.
                  </div>
                </div>
              </div>
            </Card>

            {/* Pricing — only if user has financial access */}
            {canViewFinancial && (
              <Card title="Pricing">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <Label>Price</Label>
                    <NumInput
                      value={draft.selling_price}
                      onChange={v => setField('selling_price', v)}
                      placeholder="0.00"
                      step="0.01"
                      prefix="Rs"
                    />
                  </div>
                  <div>
                    <Label hint="(optional)">Compare-at price</Label>
                    <NumInput
                      value={draft.compare_at_price}
                      onChange={v => setField('compare_at_price', v)}
                      placeholder="0.00"
                      step="0.01"
                      prefix="Rs"
                    />
                  </div>
                </div>

                {/* Profit / Margin display (cost = 0 for Phase 1, so profit = price) */}
                <div style={{
                  marginTop: 14, padding: '10px 12px',
                  background: bgPage, border: `1px solid ${border}`, borderRadius: 6,
                  display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap',
                  fontSize: 12,
                }}>
                  <div>
                    <span style={{ color: text3 }}>Cost: </span>
                    <span style={{ color: text2, fontFamily: 'monospace' }}>—</span>
                    <span style={{ color: text3, fontSize: 10, marginLeft: 6 }}>(set on Shopify)</span>
                  </div>
                  <div>
                    <span style={{ color: text3 }}>Profit: </span>
                    <span style={{ color: '#22c55e', fontFamily: 'monospace' }}>Rs {pricing.profit.toLocaleString()}</span>
                  </div>
                  <div>
                    <span style={{ color: text3 }}>Margin: </span>
                    <span style={{ color: '#22c55e', fontFamily: 'monospace' }}>
                      {pricing.price > 0 ? `${pricing.margin.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                </div>
              </Card>
            )}

            {/* Inventory */}
            <Card title="Inventory">
              <div style={{ marginBottom: 14 }}>
                <Label>Stock (on hand)</Label>
                <div style={{ maxWidth: 200 }}>
                  <NumInput
                    value={draft.stock_quantity}
                    onChange={v => setField('stock_quantity', v)}
                    placeholder="0"
                    step="1"
                  />
                </div>
                <div style={{ fontSize: 11, color: text3, marginTop: 6 }}>
                  Save karne par directly Shopify ke inventory_levels API ko sync hota hai.
                </div>
              </div>

              {/* Location table — Phase 1: single OFFICE location.
                  Phase 3 will expand if RS ZEVAR adds more locations. */}
              <div style={{ overflowX: 'auto', border: `1px solid ${border}`, borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'rgba(201,169,110,0.03)', borderBottom: `1px solid ${border}` }}>
                      <th style={{ textAlign: 'left', padding: '10px 14px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Location</th>
                      <th style={{ textAlign: 'right', padding: '10px 14px', color: text3, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>On hand</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '12px 14px', color: text1 }}>OFFICE</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: text1, fontFamily: 'monospace' }}>
                        {draft.stock_quantity ?? 0}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Identifiers */}
            <Card title="Identifiers">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <Label>SKU (Stock Keeping Unit)</Label>
                  <TextInput
                    value={draft.sku}
                    onChange={v => setField('sku', v)}
                    placeholder="e.g. B3051-26"
                    mono
                  />
                </div>
                <div>
                  <Label>Barcode</Label>
                  <TextInput
                    value={draft.barcode}
                    onChange={v => setField('barcode', v)}
                    placeholder="ISBN, UPC, GTIN..."
                    mono
                  />
                </div>
              </div>
            </Card>

            {/* Shipping */}
            <Card title="Shipping">
              <div style={{ maxWidth: 240 }}>
                <Label>Weight</Label>
                <NumInput
                  value={draft.weight}
                  onChange={v => setField('weight', v)}
                  placeholder="0"
                  step="0.1"
                  suffix="g"
                />
                <div style={{ fontSize: 11, color: text3, marginTop: 6 }}>
                  Weight grams mein. Courier slips automatically isi se calculate hote.
                </div>
              </div>
            </Card>

            {/* Sales analytics (read-only) */}
            {(draft.abc_90d || draft.units_sold_90d || draft.units_sold_180d) && (
              <Card title="Sales analytics (read-only)">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, fontSize: 12 }}>
                  <div>
                    <div style={{ color: text3, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>ABC Tier (90d)</div>
                    <div style={{ color: text1, fontFamily: 'monospace', fontSize: 14, fontWeight: 600 }}>
                      {draft.abc_90d || '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: text3, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Units sold (90d)</div>
                    <div style={{ color: text1, fontFamily: 'monospace', fontSize: 14 }}>
                      {draft.units_sold_90d ?? 0}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: text3, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Units sold (180d)</div>
                    <div style={{ color: text1, fontFamily: 'monospace', fontSize: 14 }}>
                      {draft.units_sold_180d ?? 0}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* Adjustment history — Phase 1: deep link only. Phase 3 will replace with full table. */}
            <Card
              title="Adjustment history"
              right={
                shopifyAdjustmentHistoryUrl ? (
                  <Btn href={shopifyAdjustmentHistoryUrl} target="_blank" title="Open Shopify admin's adjustment history page in new tab">
                    📋 View on Shopify ↗
                  </Btn>
                ) : null
              }
            >
              <div style={{ padding: '10px 0', fontSize: 12, color: text3, lineHeight: 1.6 }}>
                Phase 1: Shopify ke admin panel pe poori history dikhne ke liye upper button click karo.
                <br/>
                <span style={{ fontSize: 11 }}>
                  Phase 3 mein yahan inline table aayegi — order-driven changes (auto from ERP) + manual adjustments (jo tum yahan se save karoge) sab combine ho ke dikhenge.
                </span>
              </div>
            </Card>

            {/* Save bar (sticky at bottom for long forms) */}
            {isDirty && (
              <div style={{
                position: 'sticky',
                bottom: 16,
                marginTop: 16,
                background: card,
                border: `1px solid ${gold}`,
                borderRadius: 10,
                padding: '12px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, color: gold }}>
                    ⚠️ Unsaved changes — Shopify pe save karne ke liye click karo
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn onClick={handleDiscard} disabled={saving}>Discard</Btn>
                    <Btn primary onClick={handleSave} disabled={saving || reasonMissing}>
                      {saving ? 'Saving...' : 'Save changes'}
                    </Btn>
                  </div>
                </div>

                {/* Phase 2 — Reason input. REQUIRED when stock is changing (anti-theft).
                    Optional for price/SKU/barcode/weight changes. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: reasonRequired ? '#f87171' : text3, whiteSpace: 'nowrap', fontWeight: reasonRequired ? 600 : 400 }}>
                    {reasonRequired ? 'Reason (REQUIRED for stock change):' : 'Reason (optional):'}
                  </span>
                  <input
                    type="text"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder={reasonRequired
                      ? 'Stock kyun change kiya? e.g. Restocked, Damaged, Manual count, Theft, Promotion...'
                      : 'e.g. Restocked, Damaged, Manual count, Promotion...'}
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
                  <div style={{ fontSize: 11, color: '#f87171', marginTop: -4 }}>
                    ⚠️ Stock change save karne ke liye reason zaroori hai
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
