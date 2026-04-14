import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Nisab = 612.36g silver * current silver price per gram
// Approx 52.5 tola silver = ~85g gold or 595g silver
// Zakat rate = 2.5%

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year') || '2027-2028';

    // Get zakat record for this year
    const { data: record } = await supabase
      .from('zakat_records')
      .select('*')
      .eq('year', year)
      .single();

    // Get distributions for this year
    const { data: distributions } = await supabase
      .from('zakat_distributions')
      .select('*')
      .eq('zakat_year', year)
      .order('distribution_date', { ascending: false });

    const totalDistributed = (distributions || []).reduce((s, d) => s + parseFloat(d.amount || 0), 0);
    const remaining = record ? Math.max(0, parseFloat(record.zakat_due || 0) - totalDistributed) : 0;

    // Get all years
    const { data: allRecords } = await supabase
      .from('zakat_records')
      .select('year, zakat_due, shaban_date')
      .order('year', { ascending: false });

    // Get current inventory value for auto-fill
    const { data: inventory } = await supabase
      .from('products')
      .select('stock_quantity, selling_price');
    const inventoryValue = (inventory || [])
      .reduce((s, i) => s + (parseFloat(i.stock_quantity || 0) * parseFloat(i.selling_price || 0)), 0);

    return NextResponse.json({
      success: true,
      record: record || null,
      distributions: distributions || [],
      total_distributed: totalDistributed,
      remaining,
      all_years: allRecords || [],
      inventory_value: inventoryValue,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    // ── Save/Update Zakat Calculation ──
    if (action === 'save_calculation') {
      const {
        year, shaban_date, inventory_value, cash_in_hand,
        receivables, liabilities, other_assets, other_assets_note,
        nisab_amount, notes,
      } = body;

      const total_assets = parseFloat(inventory_value || 0)
        + parseFloat(cash_in_hand || 0)
        + parseFloat(receivables || 0)
        + parseFloat(other_assets || 0)
        - parseFloat(liabilities || 0);

      const zakat_due = total_assets >= parseFloat(nisab_amount || 0)
        ? total_assets * 0.025
        : 0;

      const { data, error } = await supabase.from('zakat_records').upsert({
        year, shaban_date, inventory_value: parseFloat(inventory_value || 0),
        cash_in_hand: parseFloat(cash_in_hand || 0),
        receivables: parseFloat(receivables || 0),
        liabilities: parseFloat(liabilities || 0),
        other_assets: parseFloat(other_assets || 0),
        other_assets_note: other_assets_note || '',
        total_assets, nisab_amount: parseFloat(nisab_amount || 0),
        zakat_due, notes: notes || '',
      }, { onConflict: 'year' }).select().single();

      if (error) throw error;
      return NextResponse.json({ success: true, record: data, zakat_due });
    }

    // ── Add Distribution ──
    if (action === 'add_distribution') {
      const { zakat_year, recipient, amount, distribution_date, note } = body;
      if (!recipient || !amount) return NextResponse.json({ success: false, error: 'Recipient aur amount required' });

      // Check if zakat already fully distributed
      const { data: record } = await supabase
        .from('zakat_records').select('zakat_due').eq('year', zakat_year).single();
      const { data: existing } = await supabase
        .from('zakat_distributions').select('amount').eq('zakat_year', zakat_year);

      const totalSoFar = (existing || []).reduce((s, d) => s + parseFloat(d.amount || 0), 0);
      const due = parseFloat(record?.zakat_due || 0);

      if (due > 0 && totalSoFar + parseFloat(amount) > due) {
        return NextResponse.json({
          success: false,
          error: `Zakat limit cross ho rahi hai! Remaining: Rs. ${Math.max(0, due - totalSoFar).toLocaleString()}`,
        });
      }

      const { data, error } = await supabase.from('zakat_distributions').insert({
        zakat_year, recipient, amount: parseFloat(amount),
        distribution_date: distribution_date || new Date().toISOString().split('T')[0],
        note: note || '',
      }).select().single();

      if (error) throw error;
      return NextResponse.json({ success: true, distribution: data });
    }

    // ── Delete Distribution ──
    if (action === 'delete_distribution') {
      await supabase.from('zakat_distributions').delete().eq('id', body.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
