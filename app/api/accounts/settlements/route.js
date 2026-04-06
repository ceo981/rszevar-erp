import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Extract ZEVAR-XXXXXX order IDs from text ──────────────────
function extractZevarOrderIds(text) {
  const matches = text.match(/ZEVAR[-\s]?(\d{6})/gi) || [];
  return [...new Set(matches.map(m => 'ZEVAR-' + m.replace(/ZEVAR[-\s]?/i, '')))];
}

// ── Extract amounts per order from Leopards text ──────────────
function parseLeopardsPDF(text) {
  const lines = text.split('\n');
  const orders = [];
  for (const line of lines) {
    const zevarMatch = line.match(/ZEVAR[-\s]?(\d{6})/i);
    if (zevarMatch) {
      const orderId = 'ZEVAR-' + zevarMatch[1];
      // Extract gross collected amount (last number in line)
      const numbers = line.match(/[\d,]+\.?\d*/g) || [];
      const amounts = numbers.map(n => parseFloat(n.replace(/,/g, ''))).filter(n => n > 0);
      const grossAmount = amounts[amounts.length - 1] || 0;
      const codAmount = amounts[0] || 0;
      orders.push({ order_id: orderId, cod_amount: codAmount, settled_amount: grossAmount });
    }
  }
  return orders;
}

// ── Parse PostEx PDF (tracking numbers) ──────────────────────
function parsePostExPDF(text) {
  const lines = text.split('\n');
  const orders = [];
  for (const line of lines) {
    // PostEx tracking numbers: 11-digit or similar numeric
    const trackingMatch = line.match(/\b(\d{15,17})\b/);
    if (trackingMatch) {
      const tracking = trackingMatch[1];
      const numbers = line.match(/[\d,]+\.?\d*/g) || [];
      const amounts = numbers
        .map(n => parseFloat(n.replace(/,/g, '')))
        .filter(n => n > 10 && n < 100000);
      const codAmount = amounts[0] || 0;
      if (codAmount > 0) {
        orders.push({ tracking_number: tracking, cod_amount: codAmount });
      }
    }
  }
  return orders;
}

// ── Parse Kangaroo Excel ──────────────────────────────────────
function parseKangarooExcel(rows) {
  const orders = [];
  for (const row of rows) {
    const rowStr = Object.values(row).join(' ');
    const zevarMatch = rowStr.match(/ZEVAR[-\s]?(\d{6})/i);
    if (zevarMatch) {
      const orderId = 'ZEVAR-' + zevarMatch[1];
      // Find numeric values in row
      const amounts = Object.values(row)
        .map(v => parseFloat(String(v).replace(/,/g, '')))
        .filter(n => !isNaN(n) && n > 0 && n < 200000);
      const codAmount = amounts[0] || 0;
      orders.push({ order_id: orderId, cod_amount: codAmount, settled_amount: codAmount });
    }
  }
  return orders;
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const courier = formData.get('courier'); // 'Leopards' | 'PostEx' | 'Kangaroo'
    const settlementRef = formData.get('settlement_ref') || '';
    const settledAt = formData.get('settled_at') || new Date().toISOString().split('T')[0];

    if (!file || !courier) {
      return NextResponse.json({ success: false, error: 'file and courier required' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const fileName = file.name.toLowerCase();

    let parsedOrders = [];
    let totalAmount = 0;
    let rawText = '';

    // ── PDF PARSING ───────────────────────────────────────────
    if (fileName.endsWith('.pdf')) {
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
      const pdfData = await pdfParse(buffer);
      rawText = pdfData.text;

      if (courier === 'Leopards') {
        parsedOrders = parseLeopardsPDF(rawText);
        // Also try to get grand total
        const grandMatch = rawText.match(/Grand Total[\s\S]*?([\d,]+\.?\d*)\s*$/m);
        if (grandMatch) totalAmount = parseFloat(grandMatch[1].replace(/,/g, ''));
      } else if (courier === 'PostEx') {
        parsedOrders = parsePostExPDF(rawText);
        // Net total from PostEx
        const netMatch = rawText.match(/Net Total\s*([\d,]+\.?\d*)/i);
        if (netMatch) totalAmount = parseFloat(netMatch[1].replace(/,/g, ''));
      } else {
        // Generic PDF: extract ZEVAR IDs
        const ids = extractZevarOrderIds(rawText);
        parsedOrders = ids.map(id => ({ order_id: id, cod_amount: 0, settled_amount: 0 }));
      }

    // ── EXCEL PARSING ─────────────────────────────────────────
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const XLSX = (await import('xlsx')).default;
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      parsedOrders = parseKangarooExcel(rows);
    }

    if (parsedOrders.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No orders found in file. Check courier selection and file format.',
      }, { status: 400 });
    }

    // ── MATCH ORDERS IN SUPABASE ──────────────────────────────
    let matched = [];
    let unmatched = [];

    if (courier === 'PostEx') {
      // Match by tracking number
      const trackingNums = parsedOrders.map(o => o.tracking_number).filter(Boolean);
      const { data: dbOrders } = await supabase
        .from('orders')
        .select('id, shopify_order_id, name, courier_tracking_number, total_price')
        .in('courier_tracking_number', trackingNums);

      for (const parsed of parsedOrders) {
        const found = dbOrders?.find(o => o.courier_tracking_number === parsed.tracking_number);
        if (found) {
          matched.push({ ...found, settled_amount: parsed.cod_amount });
        } else {
          unmatched.push({ tracking: parsed.tracking_number, cod_amount: parsed.cod_amount });
        }
      }
    } else {
      // Match by order name/ID
      const orderIds = parsedOrders.map(o => o.order_id).filter(Boolean);
      const { data: dbOrders } = await supabase
        .from('orders')
        .select('id, shopify_order_id, name, total_price')
        .in('name', orderIds);

      for (const parsed of parsedOrders) {
        const found = dbOrders?.find(o => o.name === parsed.order_id);
        if (found) {
          matched.push({ ...found, settled_amount: parsed.settled_amount || parsed.cod_amount });
        } else {
          unmatched.push({ order_id: parsed.order_id, cod_amount: parsed.cod_amount });
        }
      }
    }

    // ── MARK MATCHED ORDERS AS SETTLED ───────────────────────
    if (matched.length > 0) {
      const matchedIds = matched.map(o => o.id);
      await supabase
        .from('orders')
        .update({ cod_settled: true, cod_settled_at: settledAt })
        .in('id', matchedIds);
    }

    // ── TOTAL AMOUNT ──────────────────────────────────────────
    if (!totalAmount) {
      totalAmount = matched.reduce((s, o) => s + parseFloat(o.settled_amount || o.total_price || 0), 0);
    }

    // ── CREATE SETTLEMENT RECORD ──────────────────────────────
    const { data: settlement } = await supabase
      .from('settlements')
      .insert([{
        courier_name: courier,
        settlement_ref: settlementRef,
        amount: totalAmount,
        orders_count: matched.length,
        status: 'settled',
        settled_at: settledAt,
        note: `Auto-parsed from ${file.name}. ${unmatched.length} unmatched.`,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    return NextResponse.json({
      success: true,
      summary: {
        total_parsed: parsedOrders.length,
        matched: matched.length,
        unmatched: unmatched.length,
        total_amount: totalAmount,
        courier,
        settlement_ref: settlementRef,
      },
      matched_orders: matched.map(o => ({ name: o.name, amount: o.settled_amount })),
      unmatched_orders: unmatched,
      settlement,
    });

  } catch (error) {
    console.error('Settlement upload error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
