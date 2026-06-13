// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR — lib/bot-brain/cart.js
// ────────────────────────────────────────────────────────────────────────────
// JUN 2026 REDESIGN — cart-permalink flow HATA DIYA (links "Link no longer
// exists" de rahe the + payment/checkout link approach nahi chahiye).
//
// Ab: bot order CHAT mein le leta hai (product + variant + qty + customer
// naam/phone/address/city), hum yahan items validate karte hain (real variant,
// stock, price) aur ek ready WhatsApp order-message banate hain. Widget us se
// "Order WhatsApp pe bhejein" button prefill karta hai → order team ke WhatsApp
// pe pahunchta hai → team confirm karke place karti hai (existing flow).
//
// NOTE: yeh function ab cart_url NAHI banata. Sirf validated order + whatsapp_text.
// ════════════════════════════════════════════════════════════════════════════

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

// Resolve {handle, variant, quantity} items → validated lines (label, qty, price).
async function resolveItems(db, items) {
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

    if ((chosen.stock_quantity || 0) <= 0) {
      issues.push({ handle, product: chosen.parent_title || chosen.title, variant: variantLabel(chosen), problem: 'out_of_stock' });
      continue;
    }

    const isMulti = rows.length > 1;
    resolved.push({
      qty,
      label: (chosen.parent_title || chosen.title) + (isMulti ? ` (${variantLabel(chosen)})` : ''),
      price: Number(chosen.selling_price) || 0,
      sku: chosen.sku ? String(chosen.sku).trim() : null,
      handle,
    });
  }

  return { resolved, issues };
}

// ─── Main: validate order + build WhatsApp order message ─────────────────────
// Returns one of:
//   { ok:true, order_summary, whatsapp_text, total }
//   { ok:false, issues:[...] }   ← bot asks for variant / stock / missing details
export async function buildOrderHandoff(db, items, customer) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'no_items', message: 'No products specified.' };
  }

  const { resolved, issues } = await resolveItems(db, items);

  if (issues.length > 0) return { ok: false, issues, resolved_count: resolved.length };
  if (resolved.length === 0) return { ok: false, error: 'nothing_resolved' };

  // Validate customer delivery details
  const c = customer || {};
  const name = String(c.name || '').trim();
  const phone = String(c.phone || '').trim();
  const address = String(c.address || '').trim();
  const city = String(c.city || '').trim();

  const missing = [];
  if (!name) missing.push('name');
  if (!phone) missing.push('phone');
  if (!address) missing.push('address');
  if (!city) missing.push('city');
  if (missing.length > 0) {
    return { ok: false, issues: [{ problem: 'missing_customer_details', missing }] };
  }

  const SITE = 'https://rszevar.com';
  const total = resolved.reduce((s, r) => s + (Number(r.price) || 0) * r.qty, 0);
  // Each line carries the SKU (so the team can find the exact product fast).
  // If a SKU is missing, fall back to the product link.
  const itemLines = resolved.map((r) => {
    const ref = r.sku
      ? `SKU: ${r.sku}`
      : (r.handle ? `${SITE}/products/${r.handle}` : '');
    return `• ${r.label} x${r.qty} — Rs.${r.price}${ref ? `\n   ${ref}` : ''}`;
  }).join('\n');

  // Message that lands in the TEAM's WhatsApp (Roman Urdu, internal-facing).
  const whatsapp_text =
    `🛍️ *Naya Order* — RS ZEVAR website chat\n\n` +
    `${itemLines}\n` +
    `*Total: Rs.${total}*\n\n` +
    `*Customer details*\n` +
    `Naam: ${name}\n` +
    `Phone: ${phone}\n` +
    `Address: ${address}, ${city}\n\n` +
    `(Website chat order — please confirm & place. Delivery charges as per policy.)`;

  return {
    ok: true,
    order_summary: {
      items: resolved.map((r) => ({ label: r.label, qty: r.qty, price: r.price, sku: r.sku, handle: r.handle })),
      total,
      customer: { name, phone, address, city },
    },
    whatsapp_text,
    total,
  };
}
