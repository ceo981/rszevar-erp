// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR — lib/bot-brain/cart.js
// Turns the customer's chosen products into a Shopify checkout cart link.
// Resolves each {handle, variant, quantity} → real shopify_variant_id from the
// live catalog, checks stock, and builds /cart/<vid>:<qty>,... so the customer
// completes address + payment on the secure Shopify checkout. No price/stock
// guessing — everything comes from the catalog; checkout is the source of truth.
// ════════════════════════════════════════════════════════════════════════════

const SITE = 'https://rszevar.com';

function variantLabel(row) {
  const opts = [row.option1, row.option2, row.option3].filter(Boolean);
  return opts.length ? opts.join(' / ') : (row.title || '');
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
        .select('shopify_variant_id, title, parent_title, option1, option2, option3, selling_price, stock_quantity, is_active')
        .eq('handle', handle)
        .eq('is_active', true);
      if (error) throw error;
      rows = data || [];
    } catch (e) {
      issues.push({ handle, problem: 'lookup_error' });
      continue;
    }

    if (rows.length === 0) { issues.push({ handle, problem: 'not_found' }); continue; }

    // Pick the variant
    let chosen = null;
    if (rows.length === 1) {
      chosen = rows[0];
    } else if (wantVariant) {
      chosen = rows.find((r) => {
        const hay = [variantLabel(r), r.option1, r.option2, r.option3, r.title]
          .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(wantVariant);
      }) || null;
    }

    if (!chosen) {
      // Ambiguous → return choices so the bot can ask
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
      issues.push({ handle, product: chosen.parent_title || chosen.title, problem: 'out_of_stock' });
      continue;
    }

    const lbl = variantLabel(chosen);
    resolved.push({
      variant_id: String(chosen.shopify_variant_id),
      qty,
      label: (chosen.parent_title || chosen.title) + (lbl && rows.length > 1 ? ` (${lbl})` : ''),
      price: chosen.selling_price,
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues, resolved_count: resolved.length };
  }
  if (resolved.length === 0) {
    return { ok: false, error: 'nothing_resolved' };
  }

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
