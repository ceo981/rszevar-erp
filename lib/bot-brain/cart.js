// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR — lib/bot-brain/cart.js
// Turns the customer's chosen products into a Shopify checkout cart link.
// Variants live as separate rows sharing a handle; the colour is the tail of
// `title` (e.g. "Product Name - Ruby"). Each row has shopify_variant_id. We
// resolve {handle, variant, quantity} → variant id, check stock, and build
// /cart/<vid>:<qty>,... Checkout (address + payment) happens on Shopify.
// ════════════════════════════════════════════════════════════════════════════

const SITE = 'https://rszevar.com';

// Extract the variant/colour name from a variant title.
// "Gold Plated Calligraphy Zircons Pendant - Ruby" → "Ruby"
function variantLabel(row) {
  const t = String(row.title || '').trim();
  const parent = String(row.parent_title || '').trim();
  if (parent && t.toLowerCase().startsWith(parent.toLowerCase())) {
    const rest = t.slice(parent.length).replace(/^[\s\-–—|:]+/, '').trim();
    if (rest) return rest;
  }
  const idx = t.lastIndexOf(' - ');
  if (idx >= 0) return t.slice(idx + 3).trim();
  return t;
}

export async function buildCartLink(db, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'no_items', message: 'No products specified.' };
  }

  const resolved = [];
  const issues = [];

  for (const it of items) {
    const handle = String(it?.handle || '').trim();
    const qty = Math.max(1, parseInt(it?.quantity, 10) || 1);
    const wantVariant = String(it?.variant || '').trim().toLowerCase();
    if (!handle) { issues.push({ problem: 'missing_handle' }); continue; }

    let rows;
    try {
      const { data, error } = await db
        .from('products')
        .select('shopify_variant_id, title, parent_title, sku, selling_price, stock_quantity, is_active')
        .eq('handle', handle);
      if (error) throw error;
      rows = (data || []).filter((r) => r.is_active !== false);
    } catch (e) {
      issues.push({ handle, problem: 'lookup_error', detail: e.message });
      continue;
    }

    if (rows.length === 0) { issues.push({ handle, problem: 'not_found' }); continue; }

    // Pick the variant
    let chosen = null;
    if (rows.length === 1) {
      chosen = rows[0];
    } else if (wantVariant) {
      chosen = rows.find((r) => {
        const hay = [variantLabel(r), r.title, r.sku].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(wantVariant);
      }) || null;
    }

    if (!chosen) {
      // Ambiguous → return the REAL variant list so the bot asks (no guessing)
      issues.push({
        handle,
        product: rows[0].parent_title || rows[0].title,
        problem: 'needs_variant',
        variants: rows
          .filter((r) => r.shopify_variant_id)
          .map((r) => ({ variant: variantLabel(r), price: r.selling_price, in_stock: (r.stock_quantity || 0) > 0 })),
      });
      continue;
    }

    if (!chosen.shopify_variant_id) { issues.push({ handle, problem: 'no_variant_id' }); continue; }
    if ((chosen.stock_quantity || 0) <= 0) {
      issues.push({ handle, product: chosen.parent_title || chosen.title, variant: variantLabel(chosen), problem: 'out_of_stock' });
      continue;
    }

    resolved.push({
      variant_id: String(chosen.shopify_variant_id),
      qty,
      label: (chosen.parent_title || chosen.title) + ' (' + variantLabel(chosen) + ')',
      price: chosen.selling_price,
    });
  }

  if (issues.length > 0) return { ok: false, issues, resolved_count: resolved.length };
  if (resolved.length === 0) return { ok: false, error: 'nothing_resolved' };

  const path = resolved.map((r) => `${r.variant_id}:${r.qty}`).join(',');
  const total = resolved.reduce((s, r) => s + (Number(r.price) || 0) * r.qty, 0);

  return {
    ok: true,
    cart_url: `${SITE}/cart/${path}`,
    items: resolved.map((r) => ({ label: r.label, qty: r.qty, price: r.price })),
    total,
    note: 'Customer completes address & payment on this secure checkout link.',
  };
}
