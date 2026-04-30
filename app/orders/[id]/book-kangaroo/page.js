'use client';

// ============================================================================
// RS ZEVAR ERP — Kangaroo Booking Helper
// Route: /orders/[id]/book-kangaroo
// ----------------------------------------------------------------------------
// PURPOSE: Kangaroo ka koi Shopify embedded app nahi hai — booking manually
// kangaroo.pk/order par karni padti hai. Yeh page sab data pre-format kar ke
// dikhata hai with one-click copy buttons. Workflow:
//   1) "Open Kangaroo" button click → kangaroo.pk/order new tab pe khulta
//   2) Har field ke saamne 📋 Copy click → Kangaroo tab pe Ctrl+V
//   3) ~9 fields, ~30 sec per order
//
// FIELDS (order matches Kangaroo form):
//   Order Type      → COD (default, static)
//   Invoice #       → order_number
//   Amount          → rounded total (0 if already paid)
//   Customer Name   → customer_name
//   Customer Addr   → customer_address
//   Customer Number → customer_phone (digits only)
//   Product Name    → SKU + variant + (xN) for each item, comma-separated
//   Product Code    → empty (skip)
//   City            → customer_city (default Karachi)
//   Comment         → empty (skip)
//
// VARIANT EXTRACTION (priority order):
//   1) item.variant_title (if not "Default Title")
//   2) shopify_raw.line_items match by id/sku → variant_title
//   3) Extract from item.title after last " - " (since sync concatenates)
//   4) null
//
// IMPORTS: Relative paths used due to turbopack @/ alias issue for new files
// ============================================================================

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ─── Style constants (matches OrderDrawer palette) ──────────────────────────
const gold   = '#c9a96e';
const card   = '#141414';
const border = '#222';
const bg     = '#0a0a0a';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract variant (size/color) for a single item.
 * Multiple fallbacks because db sync history is inconsistent.
 */
function getItemVariant(item, shopifyRaw) {
  // Priority 1: dedicated db column
  if (item.variant_title && item.variant_title !== 'Default Title') {
    return item.variant_title.trim();
  }

  // Priority 2: match raw line_items by id or sku
  const rawLines = shopifyRaw?.line_items || [];
  const match = rawLines.find(li =>
    (item.shopify_line_item_id && String(li.id) === String(item.shopify_line_item_id)) ||
    (item.sku && li.sku === item.sku)
  );
  if (match?.variant_title && match.variant_title !== 'Default Title') {
    return match.variant_title.trim();
  }

  // Priority 3: title was concatenated as "Product - Variant"
  // We only do this if title contains " - " AND raw match has no variant
  // (avoid false-positive for products with " - " in actual title)
  if (item.title && item.title.includes(' - ') && match && !match.variant_title) {
    const idx = item.title.lastIndexOf(' - ');
    const candidate = item.title.substring(idx + 3).trim();
    if (candidate.length > 0 && candidate.length < 80) return candidate;
  }

  return null;
}

/**
 * Format full product list as Kangaroo Product Name field value.
 * Format: "SKU - variant (xN), SKU2 - variant (x2), SKU3"
 *  - Variant only if exists
 *  - (xN) only if quantity > 1
 *  - "(no SKU)" placeholder if SKU missing
 */
function formatProductsForKangaroo(items, shopifyRaw) {
  if (!items || items.length === 0) return '';
  return items.map(item => {
    const sku = (item.sku || '').trim() || '(no SKU)';
    const variant = getItemVariant(item, shopifyRaw);
    const qty = parseInt(item.quantity, 10) || 1;

    let str = sku;
    if (variant) str += ` - ${variant}`;
    if (qty > 1) str += ` (x${qty})`;
    return str;
  }).join(', ');
}

/**
 * Normalize phone number for Kangaroo Customer Number field.
 * Strip everything except digits.
 *  +92 300 1234567 → 923001234567
 *  0301-1234567    → 03011234567
 */
function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/[^0-9]/g, '');
}

/** Round amount to integer string (no decimals/commas). Kangaroo expects plain number. */
function formatAmount(amount, paymentStatus) {
  // Already paid orders: amount = 0 (Kangaroo collects nothing)
  if (paymentStatus === 'paid') return '0';
  const num = Math.round(parseFloat(amount || 0));
  return String(num);
}

// ─── Copy Field component ──────────────────────────────────────────────────
function CopyField({ label, value, multiline = false, warning, sublabel, isStatic }) {
  const [copied, setCopied] = useState(false);
  const isEmpty = !value || value === '';

  const handleCopy = async () => {
    if (isEmpty) return;
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      alert('Copy failed — try selecting text manually');
    }
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label style={{ fontSize: 12, color: '#888', fontWeight: 500, letterSpacing: 0.3 }}>
          {label}
          {sublabel && <span style={{ color: '#555', marginLeft: 6, fontWeight: 400 }}>{sublabel}</span>}
        </label>
        {isStatic && (
          <span style={{ fontSize: 10, color: '#666', background: '#1a1a1a', padding: '1px 6px', borderRadius: 3 }}>
            static
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{
          flex: 1,
          background: isEmpty ? '#0d0d0d' : '#181818',
          border: `1px solid ${warning ? '#7c2d12' : (isEmpty ? '#222' : '#2a2a2a')}`,
          borderRadius: 6,
          padding: multiline ? '10px 12px' : '9px 12px',
          color: isEmpty ? '#555' : '#e8e8e8',
          fontSize: 14,
          fontFamily: multiline ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
          whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
          overflow: multiline ? 'visible' : 'hidden',
          textOverflow: 'ellipsis',
          minHeight: multiline ? 'auto' : 38,
          lineHeight: 1.5,
          fontStyle: isEmpty ? 'italic' : 'normal',
        }}>
          {isEmpty ? '— empty —' : String(value)}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          disabled={isEmpty || isStatic}
          title={isStatic ? 'Static value — type manually in Kangaroo' : 'Copy to clipboard'}
          style={{
            background: copied ? '#15803d' : (isEmpty || isStatic ? '#1a1a1a' : gold),
            color: copied ? '#fff' : (isEmpty || isStatic ? '#555' : '#000'),
            border: `1px solid ${copied ? '#15803d' : (isEmpty || isStatic ? border : gold)}`,
            borderRadius: 6,
            padding: '0 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: (isEmpty || isStatic) ? 'not-allowed' : 'pointer',
            minWidth: 90,
            transition: 'all 0.15s',
            fontFamily: 'inherit',
          }}
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      {warning && (
        <div style={{ fontSize: 11, color: '#f87171', marginTop: 5 }}>
          ⚠ {warning}
        </div>
      )}
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function BookKangarooPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    fetch(`/api/orders/${id}`)
      .then(r => r.json())
      .then(d => {
        if (!active) return;
        if (d.success) setOrder(d.order);
        else setError(d.error || 'Order not found');
      })
      .catch(e => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id]);

  // ─── Loading / Error states ─────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: bg, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
        Loading order...
      </div>
    );
  }

  if (error || !order) {
    return (
      <div style={{ minHeight: '100vh', background: bg, color: '#fff', padding: 24 }}>
        <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
          <div style={{ color: '#f87171', fontSize: 16, marginBottom: 16 }}>
            {error || 'Order not found'}
          </div>
          <Link href={`/orders/${id}`} style={{
            background: gold, color: '#000', padding: '8px 18px',
            borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none',
          }}>
            ← Back to Order
          </Link>
        </div>
      </div>
    );
  }

  // ─── Compute formatted fields ───────────────────────────────────────────
  const items = order.order_items || [];
  const productList = formatProductsForKangaroo(items, order.shopify_raw);
  const phone = normalizePhone(order.customer_phone);
  const amount = formatAmount(order.total_amount, order.payment_status);
  const isPaid = order.payment_status === 'paid';
  const cityRaw = (order.customer_city || '').trim();
  const isKarachi = cityRaw.toLowerCase() === 'karachi';

  // Warnings per field
  const warnings = {
    name:    !order.customer_name ? 'No customer name on order' : null,
    address: !order.customer_address ? 'No address on order' : null,
    phone:   !phone ? 'No phone number' : (phone.length < 10 ? 'Phone seems incomplete' : null),
    amount:  isPaid ? 'Order already paid — Kangaroo will collect nothing' : null,
    city:    !cityRaw ? 'No city set' : (!isKarachi ? `City "${cityRaw}" is not Karachi — Kangaroo serves Karachi only` : null),
    products: items.length === 0 ? 'No items found on order' : null,
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: bg, color: '#e8e8e8', padding: '24px 16px 60px' }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>

        {/* Top bar — back link */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <Link href={`/orders/${id}`} style={{
            color: '#888', fontSize: 13, textDecoration: 'none',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            ← Back to order
          </Link>
          <div style={{ fontSize: 12, color: '#555' }}>
            Order: <span style={{ color: '#aaa' }}>{order.order_number || id}</span>
          </div>
        </div>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, color: gold, margin: '0 0 6px 0', fontWeight: 600 }}>
            🦘 Kangaroo Booking Helper
          </h1>
          <p style={{ fontSize: 13, color: '#888', margin: 0, lineHeight: 1.5 }}>
            Open Kangaroo neeche button se, phir har field ke saamne <strong style={{ color: '#aaa' }}>📋 Copy</strong> click kar ke Kangaroo form mein paste karte jao.
          </p>
        </div>

        {/* Karachi-only warning banner */}
        {!isKarachi && cityRaw && (
          <div style={{
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid #7c2d12',
            color: '#fca5a5',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 18,
            lineHeight: 1.5,
          }}>
            ⚠ <strong>Heads up:</strong> Yeh order <strong>{cityRaw}</strong> ka hai. Kangaroo sirf Karachi serve karta hai — out-of-Karachi orders Leopards ya PostEx pe book karna behtar hai.
          </div>
        )}

        {/* Open Kangaroo button — sticky-ish prominence */}
        <a
          href="https://kangaroo.pk/order"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            background: gold,
            color: '#000',
            padding: '14px 18px',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            textDecoration: 'none',
            textAlign: 'center',
            marginBottom: 24,
            border: '1px solid #d4b87f',
            boxShadow: '0 4px 14px rgba(201,169,110,0.25)',
          }}
        >
          🌐 Open kangaroo.pk/order ↗
        </a>

        {/* Fields card */}
        <div style={{
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 10,
          padding: 20,
        }}>
          <div style={{
            fontSize: 11, color: '#666', textTransform: 'uppercase',
            letterSpacing: 1, fontWeight: 600, marginBottom: 14,
          }}>
            Form fields (top to bottom — same order as Kangaroo form)
          </div>

          <CopyField
            label="Order Type"
            value="COD"
            isStatic
            sublabel="(Kangaroo default — just verify dropdown is on COD)"
          />

          <CopyField
            label="Invoice #"
            value={order.order_number || String(order.id || '')}
          />

          <CopyField
            label="Amount"
            value={amount}
            sublabel={isPaid ? '(prepaid — set 0)' : '(COD amount)'}
            warning={warnings.amount}
          />

          <CopyField
            label="Customer Name"
            value={order.customer_name || ''}
            warning={warnings.name}
          />

          <CopyField
            label="Customer Address"
            value={order.customer_address || ''}
            warning={warnings.address}
            multiline
          />

          <CopyField
            label="Customer Number"
            value={phone}
            sublabel="(digits only, no +92 / spaces)"
            warning={warnings.phone}
          />

          <CopyField
            label="Product Name"
            value={productList}
            sublabel={`(${items.length} item${items.length === 1 ? '' : 's'} — SKU + variant + qty)`}
            warning={warnings.products}
            multiline
          />

          <CopyField
            label="Product Code"
            value=""
            sublabel="(skip — leave empty)"
          />

          <CopyField
            label="City"
            value={isKarachi ? 'Karachi' : cityRaw}
            sublabel="(select from dropdown)"
            warning={warnings.city}
          />

          <CopyField
            label="Comment"
            value=""
            sublabel="(skip — leave empty)"
          />
        </div>

        {/* After-booking reminder */}
        <div style={{
          marginTop: 20,
          background: 'rgba(201,169,110,0.06)',
          border: `1px solid ${gold}33`,
          borderRadius: 8,
          padding: '12px 16px',
          fontSize: 12,
          color: '#aaa',
          lineHeight: 1.6,
        }}>
          <strong style={{ color: gold }}>📌 Booking ke baad:</strong> Kangaroo se tracking number copy kar ke Shopify order mein fulfillment add karna mat bhoolna — ERP usse pakar ke order auto-dispatched mark karega.
        </div>

      </div>
    </div>
  );
}
