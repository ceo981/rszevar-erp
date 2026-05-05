// ============================================================================
// RS ZEVAR ERP — Historical Orders Import (Server-side CSV parser)
// POST /api/historical-orders/import
// May 5 2026
// ----------------------------------------------------------------------------
// PURPOSE:
//   Reads a Shopify CSV export from Supabase Storage, parses it server-side,
//   transforms multi-row line items into JSONB, normalizes phones, and bulk-
//   inserts into historical_orders.
//
// FLOW:
//   1. Admin UI uploads CSV directly to Supabase Storage (bypasses Vercel)
//   2. UI calls this endpoint with the storage_path
//   3. Endpoint downloads CSV, parses, transforms, bulk inserts in batches of 500
//   4. Returns counts + duration
//
// AUTH: super_admin only
//
// REQUEST BODY:
//   { storage_path: "imports/orders_export_1.csv" }
//
// RESPONSE:
//   {
//     success: true,
//     total_rows_in_csv: 23198,
//     unique_orders: 10600,
//     inserted: 10595,
//     skipped_duplicates: 5,
//     errors: [],
//     duration_ms: 18420
//   }
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase';
import { getCurrentUser } from '../../../../lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET = 'historical-imports';
const BATCH_SIZE = 500;

// ──────────────────────────────────────────────────────────────────────────
// CSV Parser — state machine, RFC 4180 compliant for Shopify exports.
// Handles quoted fields, escaped quotes (""), embedded newlines, BOM.
// ──────────────────────────────────────────────────────────────────────────
function parseCSV(text) {
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const c = text[i];

    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote inside quoted field
          field += '"';
          i++; // skip second quote
        } else {
          // End of quoted field
          inQuote = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"' && field === '') {
        // Start of quoted field (only at start of field)
        inQuote = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        row.push(field);
        // Push row only if non-empty (avoid blank trailing rows)
        if (row.length > 1 || row[0] !== '') {
          rows.push(row);
        }
        row = [];
        field = '';
        // Skip \r\n combo
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else {
        field += c;
      }
    }
  }

  // Last field/row if file doesn't end with newline
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }

  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0];
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = rows[r][c] !== undefined ? rows[r][c] : '';
    }
    records.push(obj);
  }
  return { headers, records };
}

// ──────────────────────────────────────────────────────────────────────────
// Transform helpers
// ──────────────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[\s\-\(\)]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('92') && s.length >= 11) s = '0' + s.slice(2);
  if (s.startsWith('0') && s.length === 11) return s;
  if (s.length === 10 && s.startsWith('3')) return '0' + s;
  return s.length >= 8 ? s : null;
}

function parseShopifyDate(raw) {
  if (!raw || !raw.trim()) return null;
  // Shopify format: "2026-04-07 15:40:11 +0500"
  // Convert to ISO: "2026-04-07T15:40:11+05:00"
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})$/);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]}${m[8]}:${m[9]}`;
  }
  // Fallback: try Date parsing
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

function num(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const cleaned = String(raw).replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function clean(s) {
  if (s === null || s === undefined) return null;
  const trimmed = String(s).trim();
  return trimmed || null;
}

// ──────────────────────────────────────────────────────────────────────────
// Group CSV rows by Name (order number), transform each group → 1 order
// ──────────────────────────────────────────────────────────────────────────
function transformCsvRecords(records, sourceFilename) {
  // Group by Name
  const groups = new Map();
  for (const r of records) {
    const name = (r['Name'] || '').trim();
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(r);
  }

  const orders = [];
  for (const [orderNum, groupRows] of groups) {
    const head = groupRows[0];

    // Build line items
    const items = [];
    let totalQty = 0;
    for (const r of groupRows) {
      const itemName = (r['Lineitem name'] || '').trim();
      if (!itemName) continue;
      const qty = parseInt(r['Lineitem quantity'] || '0', 10) || 0;
      items.push({
        name: itemName,
        sku: clean(r['Lineitem sku']),
        qty,
        price: r['Lineitem price'] || null,
        compare_at: r['Lineitem compare at price'] || null,
      });
      totalQty += qty;
    }

    // Items summary
    let itemsSummary;
    if (items.length === 0) itemsSummary = '—';
    else if (items.length === 1) itemsSummary = items[0].name;
    else if (items.length === 2) itemsSummary = `${items[0].name}, ${items[1].name}`;
    else itemsSummary = `${items[0].name} + ${items.length - 1} more`;
    if (itemsSummary.length > 200) itemsSummary = itemsSummary.slice(0, 197) + '...';

    // Phones
    const phoneRaw = head['Phone'] || head['Shipping Phone'] || head['Billing Phone'] || '';
    const shipPhoneRaw = head['Shipping Phone'] || '';

    // Address
    const addrParts = [
      head['Shipping Street'] || head['Shipping Address1'] || '',
      head['Shipping Address2'] || '',
    ].map(p => p.trim()).filter(Boolean);

    // Date — required
    const createdAt = parseShopifyDate(head['Created at']);
    if (!createdAt) continue; // skip orders without created_at

    orders.push({
      order_number: orderNum,
      shopify_order_id: clean(head['Id']),
      customer_name: clean(head['Shipping Name']) || clean(head['Billing Name']),
      customer_email: clean(head['Email']),
      customer_phone: normalizePhone(phoneRaw),
      customer_phone_raw: clean(phoneRaw),
      financial_status: clean(head['Financial Status']),
      fulfillment_status: clean(head['Fulfillment Status']),
      created_at: createdAt,
      paid_at: parseShopifyDate(head['Paid at']),
      fulfilled_at: parseShopifyDate(head['Fulfilled at']),
      cancelled_at: parseShopifyDate(head['Cancelled at']),
      subtotal: num(head['Subtotal']),
      shipping_amount: num(head['Shipping']),
      total_amount: num(head['Total']),
      discount_amount: num(head['Discount Amount']),
      refunded_amount: num(head['Refunded Amount']),
      outstanding_balance: num(head['Outstanding Balance']),
      items,
      items_count: totalQty,
      items_summary: itemsSummary,
      shipping_name: clean(head['Shipping Name']),
      shipping_phone: normalizePhone(shipPhoneRaw),
      shipping_phone_raw: clean(shipPhoneRaw),
      shipping_address: addrParts.join(', ') || null,
      shipping_city: clean(head['Shipping City']),
      shipping_province: clean(head['Shipping Province Name']) || clean(head['Shipping Province']),
      shipping_country: clean(head['Shipping Country']),
      shipping_zip: clean(head['Shipping Zip']),
      shipping_method: clean(head['Shipping Method']),
      payment_method: clean(head['Payment Method']),
      tags: clean(head['Tags']),
      notes: clean(head['Notes']),
      source: clean(head['Source']),
      imported_from: sourceFilename,
    });
  }

  return orders;
}

// ──────────────────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request) {
  const startTime = Date.now();

  try {
    // Auth: super_admin only
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.profile.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden — only super admin can import historical orders' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const storagePath = (body.storage_path || '').trim();
    if (!storagePath) {
      return NextResponse.json({ success: false, error: 'storage_path required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 1. Download CSV from storage
    const { data: blob, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(storagePath);

    if (dlErr) {
      return NextResponse.json(
        { success: false, error: `Storage download failed: ${dlErr.message}` },
        { status: 400 },
      );
    }

    const text = await blob.text();
    if (!text || text.length < 10) {
      return NextResponse.json(
        { success: false, error: 'Downloaded file is empty or too small' },
        { status: 400 },
      );
    }

    // 2. Parse CSV
    let parsed;
    try {
      parsed = parseCSV(text);
    } catch (e) {
      return NextResponse.json(
        { success: false, error: `CSV parse failed: ${e.message}` },
        { status: 400 },
      );
    }

    if (!parsed.records || parsed.records.length === 0) {
      return NextResponse.json(
        { success: false, error: 'CSV has no data rows' },
        { status: 400 },
      );
    }

    // Validate it looks like Shopify export
    if (!parsed.headers.includes('Name') || !parsed.headers.includes('Total')) {
      return NextResponse.json(
        { success: false, error: 'Not a Shopify orders CSV export — missing required columns (Name, Total)' },
        { status: 400 },
      );
    }

    // 3. Transform CSV records → order objects
    const sourceFilename = storagePath.split('/').pop() || 'unknown.csv';
    const orders = transformCsvRecords(parsed.records, sourceFilename);

    if (orders.length === 0) {
      return NextResponse.json({
        success: true,
        total_rows_in_csv: parsed.records.length,
        unique_orders: 0,
        inserted: 0,
        skipped_duplicates: 0,
        errors: [{ stage: 'transform', error: 'No valid orders found (all skipped due to missing created_at?)' }],
        duration_ms: Date.now() - startTime,
      });
    }

    // 4. Bulk insert in batches of 500
    let inserted = 0;
    let skippedDuplicates = 0;
    const errors = [];

    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
      const batch = orders.slice(i, i + BATCH_SIZE);

      const { data, error } = await supabase
        .from('historical_orders')
        .upsert(batch, {
          onConflict: 'order_number',
          ignoreDuplicates: true,
        })
        .select('order_number');

      if (error) {
        errors.push({
          batch_start: i,
          batch_end: i + batch.length,
          error: error.message,
        });
        continue; // skip this batch, try next
      }

      const insertedInBatch = (data || []).length;
      inserted += insertedInBatch;
      skippedDuplicates += (batch.length - insertedInBatch);
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      storage_path: storagePath,
      total_rows_in_csv: parsed.records.length,
      unique_orders: orders.length,
      inserted,
      skipped_duplicates: skippedDuplicates,
      errors,
      duration_ms: duration,
    });
  } catch (e) {
    console.error('[POST /api/historical-orders/import] error:', e.message, e.stack);
    return NextResponse.json(
      { success: false, error: e.message, duration_ms: Date.now() - startTime },
      { status: 500 },
    );
  }
}
