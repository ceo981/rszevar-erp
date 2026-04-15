// ============================================================================
// RS ZEVAR ERP — Settlement Upload Route
// POST /api/courier/settlements/upload
// Handles: Leopards PDF, Kangaroo XLSX, PostEx CSV
// Actions: mark paid (Delivered), mark RTO (Return/Cancelled)
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── LEOPARDS PDF PARSER ─────────────────────────────────────────────────────
function parseLeopardsPDF(text) {
  const orders = [];
  const lines = text.split('\n');

  // Payable Details section: each line with ZEVAR-XXXXXX
  // Format: Date ZEVAR-XXXXX KI... City COD WHT.IT WHT.ST GrossCollected
  for (const line of lines) {
    const zevarMatch = line.match(/ZEVAR[-\s]?(\d{6})/i);
    if (!zevarMatch) continue;

    const orderNumber = 'ZEVAR-' + zevarMatch[1];
    // Extract all numbers from line
    const nums = [...line.matchAll(/([\d,]+\.?\d*)/g)]
      .map(m => parseFloat(m[1].replace(/,/g, '')))
      .filter(n => n > 0);

    if (nums.length >= 4) {
      const cod = nums[0];
      const whtIt = nums[1];
      const whtSt = nums[2];
      const grossCollected = nums[nums.length - 1];
      orders.push({
        order_number: orderNumber,
        cod_amount: cod,
        wht_it: whtIt,
        wht_st: whtSt,
        net_amount: grossCollected,
        status: 'delivered', // Section 1 = all delivered/paid
      });
    } else if (nums.length > 0) {
      orders.push({
        order_number: orderNumber,
        cod_amount: nums[0],
        wht_it: 0, wht_st: 0,
        net_amount: nums[nums.length - 1] || nums[0],
        status: 'delivered',
      });
    }
  }

  // Extract summary totals
  const deliveryChargesMatch = text.match(/Grand Total[\s\S]{0,200}?([\d,]+\.?\d*)\s*\n/m);
  const totalDeliveryCharges = deliveryChargesMatch
    ? parseFloat(deliveryChargesMatch[1].replace(/,/g, ''))
    : 0;

  // Grand total from Section 1 last line
  const grandTotalMatch = text.match(/Grand Total\s+([\d,]+\.?\d*)\s+([\d.]+)\s+([\d.]+)\s+([\d,]+\.?\d*)/);
  const grandTotalCOD = grandTotalMatch ? parseFloat(grandTotalMatch[1].replace(/,/g, '')) : 0;
  const totalWHT = grandTotalMatch ? parseFloat(grandTotalMatch[2]) + parseFloat(grandTotalMatch[3]) : 0;

  return { orders, meta: { totalDeliveryCharges, grandTotalCOD, totalWHT } };
}

// ─── KANGAROO XLSX PARSER ────────────────────────────────────────────────────
function parseKangarooXLSX(rows) {
  const orders = [];
  let totalDeliveryCharges = 0;

  for (const row of rows) {
    // Invoice # column = ZEVAR-XXXXX
    const invoiceCol = row['Invoice #'] || row['Invoice#'] || row['Invoice'] || '';
    const zevarMatch = String(invoiceCol).match(/ZEVAR[-\s]?(\d{6})/i);
    if (!zevarMatch) continue;

    const orderNumber = 'ZEVAR-' + zevarMatch[1];
    const statusRaw = String(row['Status'] || '').trim().toLowerCase();
    const orderAmount = parseFloat(String(row['Order Amount'] || '0').replace(/,/g, '')) || 0;
    const deliveryCharge = parseFloat(String(row['COD Amount'] || '180').replace(/,/g, '')) || 0; // COD Amount = delivery fee

    // Status mapping
    let status = 'unknown';
    if (statusRaw === 'delivered') status = 'delivered';
    else if (statusRaw === 'cancelled') status = 'rto'; // Kangaroo Cancelled = RTO

    // 0 amount delivered = skip paid marking (no COD collected)
    const skipPaid = orderAmount <= 0 && status === 'delivered';

    orders.push({
      order_number: orderNumber,
      cod_amount: orderAmount,
      delivery_charge: deliveryCharge,
      net_amount: orderAmount > 0 ? orderAmount - deliveryCharge : 0,
      status: skipPaid ? 'skip' : status,
    });

    totalDeliveryCharges += deliveryCharge;
  }

  return { orders, meta: { totalDeliveryCharges, grandTotalCOD: 0, totalWHT: 0 } };
}

// ─── POSTEX CSV PARSER ───────────────────────────────────────────────────────
function parsePostExCSV(text) {
  const orders = [];
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { orders, meta: {} };

  // Parse header
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

  let totalDeliveryCharges = 0;
  let totalGST = 0;
  let totalWHT = 0;

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (vals.length < headers.length) continue;

    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx]?.trim() || ''; });

    const orderRef = row['ORDER_REF_NUMBER'] || '';
    const zevarMatch = orderRef.match(/ZEVAR[-\s]?(\d{6})/i);
    if (!zevarMatch) continue;

    const orderNumber = 'ZEVAR-' + zevarMatch[1];
    const statusRaw = (row['STATUS'] || '').trim().toLowerCase();
    const codAmount = parseFloat(row['COD_AMOUNT'] || '0') || 0;
    const netAmount = parseFloat(row['NET_AMOUNT'] || '0') || 0;
    const shippingCharges = parseFloat(row['SHIPPING_CHARGES'] || '0') || 0;
    const gst = parseFloat(row['GST'] || '0') || 0;
    const whtIt = parseFloat(row['WH_INCOME_TAX (2%)'] || '0') || 0;
    const whtSt = parseFloat(row['WH_SALES_TAX (2%)'] || '0') || 0;

    let status = 'unknown';
    if (statusRaw === 'delivered') status = netAmount <= 0 ? 'skip' : 'delivered';
    else if (statusRaw === 'return') status = 'rto';

    orders.push({
      order_number: orderNumber,
      tracking_number: row['TRACKING_NUMBER'] || '',
      cod_amount: codAmount,
      delivery_charge: shippingCharges,
      gst,
      wht_it: whtIt,
      wht_st: whtSt,
      net_amount: netAmount,
      status,
    });

    totalDeliveryCharges += shippingCharges;
    totalGST += gst;
    totalWHT += whtIt + whtSt;
  }

  return { orders, meta: { totalDeliveryCharges, totalGST, totalWHT } };
}

// ─── CSV LINE PARSER (handles quoted fields) ─────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; continue; }
    if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += line[i];
  }
  result.push(current);
  return result;
}

// ─── MAIN ROUTE ──────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const courier = formData.get('courier'); // Leopards | Kangaroo | PostEx
    const referenceNo = formData.get('reference_no') || '';
    const settledAt = formData.get('settled_at') || new Date().toISOString().split('T')[0];
    const applyChanges = formData.get('apply') === 'true'; // false = preview only

    if (!file || !courier) {
      return NextResponse.json({ success: false, error: 'file and courier required' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const fileName = file.name.toLowerCase();

    let parsed = { orders: [], meta: {} };

    // ── PARSE FILE ──
    if (fileName.endsWith('.pdf')) {
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
      const pdfData = await pdfParse(buffer);
      if (courier === 'Leopards') {
        parsed = parseLeopardsPDF(pdfData.text);
      } else {
        return NextResponse.json({ success: false, error: `PDF format sirf Leopards ke liye. PostEx ke liye CSV upload karo, Kangaroo ke liye XLSX.` }, { status: 400 });
      }
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const XLSX = (await import('xlsx')).default;
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // Kangaroo headers are on row 5 (index 4)
      const allRows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });
      // Find header row
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(allRows.length, 10); i++) {
        if (String(allRows[i]).includes('Invoice') || allRows[i].includes('Invoice #')) {
          headerRowIdx = i; break;
        }
      }
      if (headerRowIdx === -1) headerRowIdx = 4; // default row 5
      const headers = allRows[headerRowIdx];
      const dataRows = allRows.slice(headerRowIdx + 1)
        .filter(row => row.some(cell => cell !== null && cell !== ''))
        .map(row => {
          const obj = {};
          headers.forEach((h, i) => { obj[String(h)] = row[i]; });
          return obj;
        });
      parsed = parseKangarooXLSX(dataRows);
    } else if (fileName.endsWith('.csv')) {
      const text = buffer.toString('utf-8');
      parsed = parsePostExCSV(text);
    } else {
      return NextResponse.json({ success: false, error: 'Unsupported file format. PDF, XLSX ya CSV upload karo.' }, { status: 400 });
    }

    if (parsed.orders.length === 0) {
      return NextResponse.json({ success: false, error: 'File mein koi order nahi mila. Sahi courier select karo.' }, { status: 400 });
    }

    // ── MATCH ORDERS IN DB ──
    const allOrderNumbers = [...new Set(parsed.orders.map(o => o.order_number).filter(Boolean))];

    const { data: dbOrders } = await supabase
      .from('orders')
      .select('id, order_number, status, payment_status, total_amount')
      .in('order_number', allOrderNumbers);

    const dbMap = {};
    (dbOrders || []).forEach(o => { dbMap[o.order_number] = o; });

    // ── BUILD RESULT ──
    const toMarkPaid = [];
    const toMarkRTO = [];
    const alreadyPaid = [];
    const alreadyRTO = [];
    const notFound = [];
    const skipped = [];

    for (const o of parsed.orders) {
      const db = dbMap[o.order_number];
      if (!db) { notFound.push(o.order_number); continue; }

      if (o.status === 'delivered') {
        if (db.payment_status === 'paid') {
          alreadyPaid.push(o.order_number);
        } else {
          toMarkPaid.push({ id: db.id, order_number: o.order_number, amount: o.net_amount });
        }
      } else if (o.status === 'rto') {
        const locked = ['delivered', 'paid', 'rto', 'cancelled', 'refunded'];
        if (locked.includes(db.status)) {
          alreadyRTO.push(o.order_number);
        } else {
          toMarkRTO.push({ id: db.id, order_number: o.order_number });
        }
      } else {
        skipped.push(o.order_number); // 0-amount or unknown
      }
    }

    // ── PREVIEW MODE — return without applying ──
    if (!applyChanges) {
      return NextResponse.json({
        success: true,
        preview: true,
        courier,
        file_name: file.name,
        total_parsed: parsed.orders.length,
        to_mark_paid: toMarkPaid.length,
        to_mark_rto: toMarkRTO.length,
        already_paid: alreadyPaid.length,
        already_rto: alreadyRTO.length,
        not_found: notFound.length,
        skipped: skipped.length,
        meta: parsed.meta,
        sample_paid: toMarkPaid.slice(0, 5).map(o => o.order_number),
        sample_rto: toMarkRTO.slice(0, 5).map(o => o.order_number),
        sample_not_found: notFound.slice(0, 5),
      });
    }

    // ── APPLY CHANGES ──
    let paidCount = 0;
    let rtoCount = 0;
    const errors = [];
    const now = new Date().toISOString();

    // Mark paid — batch
    if (toMarkPaid.length > 0) {
      const ids = toMarkPaid.map(o => o.id);
      const { error } = await supabase
        .from('orders')
        .update({
          payment_status: 'paid',
          paid_at: now,
          updated_at: now,
        })
        .in('id', ids);

      if (error) {
        errors.push('Paid marking error: ' + error.message);
      } else {
        paidCount = ids.length;
        // Activity log for each
        const logs = toMarkPaid.map(o => ({
          order_id: o.id,
          action: 'payment_settled',
          notes: `${courier} settlement se paid mark kiya — Rs ${Number(o.amount || 0).toLocaleString()}`,
          performed_by: 'Settlement Upload',
          performed_at: now,
        }));
        await supabase.from('order_activity_log').insert(logs);
      }
    }

    // Mark RTO — batch
    if (toMarkRTO.length > 0) {
      const ids = toMarkRTO.map(o => o.id);
      const { error } = await supabase
        .from('orders')
        .update({ status: 'rto', updated_at: now })
        .in('id', ids);

      if (error) {
        errors.push('RTO marking error: ' + error.message);
      } else {
        rtoCount = ids.length;
        const logs = toMarkRTO.map(o => ({
          order_id: o.id,
          action: 'status_changed_to_rto',
          notes: `${courier} settlement file mein Return/Cancelled mila`,
          performed_by: 'Settlement Upload',
          performed_at: now,
        }));
        await supabase.from('order_activity_log').insert(logs);
      }
    }

    // ── SAVE SETTLEMENT RECORD ──
    const totalDeliveryCharges = parsed.meta.totalDeliveryCharges || 0;
    const totalTaxes = (parsed.meta.totalWHT || 0) + (parsed.meta.totalGST || 0);
    const totalCOD = parsed.orders.reduce((s, o) => s + (o.cod_amount || 0), 0);

    await supabase.from('courier_settlements').insert({
      courier,
      reference_no: referenceNo,
      file_name: file.name,
      settled_at: settledAt,
      total_cod: totalCOD,
      total_delivery_charges: totalDeliveryCharges,
      total_taxes: totalTaxes,
      net_amount: totalCOD - totalDeliveryCharges - totalTaxes,
      orders_paid: paidCount,
      orders_rto: rtoCount,
      orders_skipped: skipped.length,
      orders_not_found: notFound.length,
      created_at: now,
    }).select().single();

    return NextResponse.json({
      success: true,
      applied: true,
      courier,
      file_name: file.name,
      orders_paid: paidCount,
      orders_rto: rtoCount,
      already_paid: alreadyPaid.length,
      already_rto: alreadyRTO.length,
      not_found: notFound.length,
      skipped: skipped.length,
      total_parsed: parsed.orders.length,
      meta: parsed.meta,
      errors: errors.length > 0 ? errors : undefined,
      message: `✅ ${paidCount} orders paid marked, ${rtoCount} RTO marked — ${courier} settlement complete!`,
    });

  } catch (err) {
    console.error('[settlement-upload]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
