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

// ─── RAW PDF TEXT EXTRACTOR (fallback when pdf-parse fails) ─────────────────
function extractRawPDFText(buffer) {
  try {
    const str = buffer.toString('latin1');
    let text = '';
    // Extract text from BT...ET blocks (PDF text objects)
    const btBlocks = str.match(/BT[\s\S]*?ET/g) || [];
    for (const block of btBlocks) {
      // Extract strings in parentheses
      const strings = block.match(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g) || [];
      for (const s of strings) {
        const clean = s.slice(1, -1)
          .replace(/\\n/g, '\n').replace(/\\r/g, '')
          .replace(/\\t/g, ' ').replace(/\\\\/g, '\\')
          .replace(/\\'/g, "'");
        text += clean + ' ';
      }
      text += '\n';
    }
    // Also try to find ZEVAR patterns directly in raw buffer
    const zevarMatches = str.match(/ZEVAR[-\s]?\d{6}/gi) || [];
    if (zevarMatches.length > 0 && text.length < 100) {
      // If BT/ET extraction failed, try direct string extraction
      text = str.replace(/[^\x20-\x7E\n]/g, ' ');
    }
    return text;
  } catch (e) {
    return '';
  }
}

// ─── LEOPARDS PDF PARSER ─────────────────────────────────────────────────────
function parseLeopardsPDF(text) {
  // Legacy text-based parser (fallback)
  return parseLeopardsPDFRows(text.split('\n'));
}

function parseLeopardsPDFRows(rows) {
  const orders = [];

  for (const line of rows) {
    if (!line || line.includes('RSZEVAR.COM') || line.includes('RS ZEVAR')) continue;

    const zevarMatch = line.match(/ZEVAR[-\s]?(\d{4,7})/i);
    if (!zevarMatch) continue;

    const orderNumber = 'ZEVAR-' + zevarMatch[1];
    const parts = line.split('\t').map(p => p.trim()).filter(p => p);
    const numParts = parts.filter(p => /^[\d,]+\.?\d*$/.test(p.replace(/,/g, '')));
    const nums = numParts.map(p => parseFloat(p.replace(/,/g, ''))).filter(n => n > 0);

    if (nums.length >= 2 && nums[0] > 200) {
      const cod = nums[0];
      const grossCollected = nums[nums.length - 1];
      const whtIt = nums.length >= 3 ? nums[1] : 0;
      const whtSt = nums.length >= 4 ? nums[2] : 0;
      orders.push({
        order_number: orderNumber,
        cod_amount: cod,
        wht_it: whtIt,
        wht_st: whtSt,
        net_amount: grossCollected,
        status: 'delivered',
      });
    }
  }

  // Deduplicate — keep first occurrence
  const seen = new Set();
  const uniqueOrders = orders.filter(o => {
    if (seen.has(o.order_number)) return false;
    seen.add(o.order_number);
    return true;
  });

  return { orders: uniqueOrders, meta: { grandTotalCOD: 0, totalWHT: 0, totalDeliveryCharges: 0 } };
}


// ─── LEOPARDS XLS (HTML) PARSER ──────────────────────────────────────────────
// Format: Date | ZEVAR-ID | KI... | City | COD | WHT.IT | WHT.ST | GrossCollected
function parseLeopardsXLS(htmlContent) {
  const orders = [];
  const rowMatches = htmlContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  for (const rowHtml of rowMatches) {
    const cells = (rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
      .map(td => td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/&amp;/g, '&').trim());
    // Must have exactly 8 columns: Date, ZEVAR-ID, KI#, City, COD, WHT.IT, WHT.ST, Gross
    if (cells.length !== 8) continue;
    const zevarMatch = cells[1] && cells[1].match(/ZEVAR[-]?(\d{4,7})/i);
    if (!zevarMatch) continue;
    const orderNumber = 'ZEVAR-' + zevarMatch[1];
    const cod = parseFloat((cells[4] || '').replace(/,/g, '')) || 0;
    const whtIt = parseFloat((cells[5] || '').replace(/,/g, '')) || 0;
    const whtSt = parseFloat((cells[6] || '').replace(/,/g, '')) || 0;
    const grossCollected = parseFloat((cells[7] || '').replace(/,/g, '')) || 0;
    if (cod > 0) {
      orders.push({
        order_number: orderNumber,
        cod_amount: cod,
        wht_it: whtIt,
        wht_st: whtSt,
        net_amount: grossCollected,
        status: 'delivered',
      });
    }
  }
  const seen = new Set();
  const unique = orders.filter(o => { if (seen.has(o.order_number)) return false; seen.add(o.order_number); return true; });
  return { orders: unique, meta: { grandTotalCOD: 0, totalWHT: 0, totalDeliveryCharges: 0 } };
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
      if (courier !== 'Leopards') {
        return NextResponse.json({ success: false, error: 'PDF sirf Leopards ke liye. PostEx = CSV, Kangaroo = XLSX.' }, { status: 400 });
      }
      // pdfjs-dist legacy — Node.js compatible, no browser APIs needed
      // Group items by Y coordinate to reconstruct rows accurately
      let pdfRows = [];
      try {
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
        const pdfDoc = await loadingTask.promise;
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const tc = await page.getTextContent();
          // Group items by Y position (same row = same line)
          const rowMap = {};
          for (const item of tc.items) {
            if (!item.str.trim()) continue;
            const y = Math.round(item.transform[5] / 2) * 2;
            if (!rowMap[y]) rowMap[y] = [];
            rowMap[y].push({ x: item.transform[4], str: item.str });
          }
          // Sort rows top-to-bottom, items left-to-right, join with tab
          const sortedRows = Object.entries(rowMap)
            .sort(([ya], [yb]) => Number(yb) - Number(ya))
            .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.str).join('\t'));
          pdfRows.push(...sortedRows);
        }
      } catch (pdfErr) {
        console.error('[pdfjs-dist]', pdfErr.message);
      }
      parsed = parseLeopardsPDFRows(pdfRows);
      parsed._rawText = pdfRows.join('\n');

    // ── EXCEL PARSING ──
    } else if ((fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) && courier === 'Leopards') {
      // Leopards XLS is actually HTML disguised as XLS
      const htmlContent = buffer.toString('utf-8');
      if (htmlContent.includes('<!DOCTYPE') || htmlContent.includes('<html')) {
        parsed = parseLeopardsXLS(htmlContent);
      } else {
        // Real XLSX fallback
        const XLSXMod = await import('xlsx');
        const XLSX = XLSXMod.default || XLSXMod;
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });
        parsed = parseLeopardsPDFRows(rows.map(r => r.join('\t')));
      }
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const XLSXMod = await import('xlsx');
      const XLSX = XLSXMod.default || XLSXMod;
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });

      // Find header row — look for row containing 'Invoice'
      let headerRowIdx = 4; // default row 5 (index 4) for Kangaroo
      for (let i = 0; i < Math.min(allRows.length, 10); i++) {
        const rowStr = Array.isArray(allRows[i]) ? allRows[i].join(' ') : '';
        if (rowStr.includes('Invoice')) { headerRowIdx = i; break; }
      }

      const headers = allRows[headerRowIdx];
      if (!headers) {
        return NextResponse.json({ success: false, error: 'XLSX format galat hai — header row nahi mila' }, { status: 400 });
      }

      const dataRows = allRows.slice(headerRowIdx + 1)
        .filter(row => Array.isArray(row) && row.some(cell => cell !== null && cell !== '' && cell !== undefined))
        .map(row => {
          const obj = {};
          headers.forEach((h, i) => { obj[String(h || '')] = row[i] ?? ''; });
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
      const rawSample = parsed._rawText ? parsed._rawText.substring(0, 300) : '';
      const zevarCount = (parsed._rawText || '').match(/ZEVAR/gi)?.length || 0;
      return NextResponse.json({
        success: false,
        error: `File mein koi order nahi mila.${zevarCount > 0 ? ` PDF mein ${zevarCount} ZEVAR refs mili hain — parsing issue hai.` : ' Sahi courier select karo.'}`,
        debug_sample: rawSample || undefined,
      }, { status: 400 });
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
    const netSettlement = totalCOD - totalDeliveryCharges - totalTaxes;

    // Map to actual courier_settlements schema columns
    const { error: settlementErr } = await supabase.from('courier_settlements').insert({
      courier,
      invoice_number: referenceNo || null,
      invoice_date: settledAt || null,
      settlement_period_start: settledAt || null,
      settlement_period_end: settledAt || null,
      total_parcels: parsed.orders.length,
      total_cod_collected: totalCOD,
      courier_charges: totalDeliveryCharges,
      net_amount: netSettlement,
      payment_status: 'pending',
      payment_received: 0,
      is_reconciled: true,
      reconciled_at: now,
      discrepancy_amount: 0,
      discrepancy_notes: [
        `Orders paid: ${paidCount}`,
        `Orders RTO: ${rtoCount}`,
        `Not found: ${notFound.length}`,
        `Skipped: ${skipped.length}`,
        `Taxes: Rs ${totalTaxes.toFixed(0)}`,
        `File: ${file.name}`,
      ].join(' | '),
      created_at: now,
      updated_at: now,
    });

    if (settlementErr) {
      console.error('[settlement-upload] courier_settlements insert error:', settlementErr.message);
    }

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
      message: `✅ ${paidCount} orders paid marked, ${rtoCount} RTO marked — ${courier} settlement complete!${errors.length > 0 ? ` ⚠️ ${errors[0]}` : ''}`,
    });

  } catch (err) {
    console.error('[settlement-upload]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
