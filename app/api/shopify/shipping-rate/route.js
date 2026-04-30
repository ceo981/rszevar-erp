// ============================================================================
// RS ZEVAR ERP — Shipping rate matcher (Apr 30 2026)
// GET /api/shopify/shipping-rate?country=Pakistan&city=Karachi
// ----------------------------------------------------------------------------
// Returns the Shopify-configured shipping rate that would apply to an order
// shipping to the given country/city. Used by /orders/create to auto-fill the
// shipping input instead of always defaulting to a hardcoded Rs 250.
//
// Uses Shopify Admin REST: GET /shipping_zones.json (cached 1hr in module
// memory). Country name → ISO code mapping handled inline (Pakistan → PK +
// a few common ones; falls back to checking whether the zone has any non-PK
// country which we treat as "international").
//
// Match logic:
//   1) Country PK → find zone whose countries[].code includes 'PK', return
//      first applicable rate (price-based or weight-based)
//   2) Country !PK → find zone with at least one non-PK country
//   3) No match → return rate=null (frontend leaves input untouched)
// ============================================================================

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION    = '2024-01';

// ── Module-scope cache (per-instance, persists across requests) ──
let cachedZones = null;
let cachedAt = 0;
const CACHE_MS = 60 * 60 * 1000;     // 1 hour

async function getShippingZones() {
  const now = Date.now();
  if (cachedZones && (now - cachedAt) < CACHE_MS) return cachedZones;
  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) return [];

  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/shipping_zones.json`;
  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    // Don't kill the cache on transient failure — return whatever we last had.
    if (cachedZones) return cachedZones;
    return [];
  }
  const data = await res.json();
  cachedZones = Array.isArray(data.shipping_zones) ? data.shipping_zones : [];
  cachedAt = now;
  return cachedZones;
}

// Country name (free-text from frontend) → ISO 2-char code.
// Only the common neighbours we ship to are mapped; rest fall back to
// "non-PK / international" handling.
function nameToCode(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  if (n === 'pakistan' || n === 'pk') return 'PK';
  if (n === 'india' || n === 'in') return 'IN';
  if (n === 'united states' || n === 'usa' || n === 'us') return 'US';
  if (n === 'united kingdom' || n === 'uk' || n === 'gb') return 'GB';
  if (n === 'uae' || n === 'united arab emirates' || n === 'ae') return 'AE';
  if (n === 'saudi arabia' || n === 'sa') return 'SA';
  if (n === 'canada' || n === 'ca') return 'CA';
  if (n === 'australia' || n === 'au') return 'AU';
  // Fallback: treat as unknown — caller's logic decides international vs not.
  return null;
}

function pickRateFromZone(zone, subtotal) {
  if (!zone) return null;

  // Price-based rates: pick the FIRST whose [min, max] (cents in Shopify
  // shipping_zones — actually it's just numbers in store currency) covers
  // the subtotal. If subtotal not given, just pick the first rate present.
  const priceRates = zone.price_based_shipping_rates || [];
  if (priceRates.length > 0) {
    if (subtotal !== null && Number.isFinite(subtotal)) {
      const matched = priceRates.find(r => {
        const min = parseFloat(r.min_order_subtotal ?? 0);
        const max = r.max_order_subtotal !== null && r.max_order_subtotal !== undefined
          ? parseFloat(r.max_order_subtotal)
          : Infinity;
        return subtotal >= min && subtotal <= max;
      });
      if (matched) {
        return { price: parseFloat(matched.price) || 0, title: matched.name, kind: 'price' };
      }
    }
    // Fall back to first rate
    const first = priceRates[0];
    return { price: parseFloat(first.price) || 0, title: first.name, kind: 'price' };
  }

  // Weight-based: just pick the first as a hint (real total weight unknown yet).
  const weightRates = zone.weight_based_shipping_rates || [];
  if (weightRates.length > 0) {
    const first = weightRates[0];
    return { price: parseFloat(first.price) || 0, title: first.name, kind: 'weight' };
  }

  return null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const country = searchParams.get('country') || 'Pakistan';
    const city    = searchParams.get('city') || '';
    const subtotalRaw = searchParams.get('subtotal');
    const subtotal = subtotalRaw !== null ? parseFloat(subtotalRaw) : null;

    const code = nameToCode(country);
    const zones = await getShippingZones();
    if (!zones || zones.length === 0) {
      return NextResponse.json({ success: true, rate: null, source: 'no_zones' });
    }

    let zone;
    if (code === 'PK') {
      // Domestic — find zone that includes PK
      zone = zones.find(z => (z.countries || []).some(c => String(c.code).toUpperCase() === 'PK'));
    } else if (code) {
      // Specific other country
      zone = zones.find(z => (z.countries || []).some(c => String(c.code).toUpperCase() === code));
      // Else fall through to the "any non-PK" zone (international catch-all)
      if (!zone) {
        zone = zones.find(z => (z.countries || []).some(c => String(c.code).toUpperCase() !== 'PK'));
      }
    } else {
      // Unknown country name — treat as international (any non-PK zone)
      zone = zones.find(z => (z.countries || []).some(c => String(c.code).toUpperCase() !== 'PK'));
    }

    if (!zone) {
      return NextResponse.json({ success: true, rate: null, source: 'no_zone_match' });
    }

    const rate = pickRateFromZone(zone, subtotal);
    if (!rate) {
      return NextResponse.json({ success: true, rate: null, source: 'no_rate_in_zone', zone: zone.name });
    }

    return NextResponse.json({
      success: true,
      rate: rate.price,
      title: rate.title,
      kind:  rate.kind,
      zone:  zone.name,
      country,
      city,
    });
  } catch (e) {
    console.error('[shipping-rate]', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
