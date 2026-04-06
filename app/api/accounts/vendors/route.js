import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const vendor_id = searchParams.get('vendor_id');

    // Get all vendors with their ledger balance
    const { data: vendors } = await supabase
      .from('vendors')
      .select('id, name, phone, category');

    const { data: payments } = await supabase
      .from('vendor_payments')
      .select('*')
      .order('payment_date', { ascending: false });

    // Build vendor ledger
    const ledger = (vendors || []).map(v => {
      const vPayments = (payments || []).filter(p => p.vendor_id === v.id);
      const totalPurchase = vPayments
        .filter(p => p.payment_type === 'purchase')
        .reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      const totalPaid = vPayments
        .filter(p => p.payment_type === 'payment')
        .reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      return {
        ...v,
        total_purchase: totalPurchase,
        total_paid: totalPaid,
        outstanding: totalPurchase - totalPaid,
        transactions: vPayments.length,
        last_transaction: vPayments[0]?.payment_date || null,
      };
    });

    // If vendor_id, return transactions for that vendor
    if (vendor_id) {
      const txns = (payments || []).filter(p => p.vendor_id === vendor_id);
      return NextResponse.json({ success: true, transactions: txns });
    }

    return NextResponse.json({ success: true, ledger });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { vendor_id, vendor_name, amount, payment_type, payment_date, note, reference } = body;

    if (!amount || !payment_type) {
      return NextResponse.json({ success: false, error: 'amount and payment_type required' }, { status: 400 });
    }

    // If vendor doesn't exist, create it
    let vid = vendor_id;
    if (!vid && vendor_name) {
      const { data: newVendor } = await supabase
        .from('vendors')
        .insert([{ name: vendor_name, category: 'General', created_at: new Date().toISOString() }])
        .select()
        .single();
      vid = newVendor?.id;
    }

    const { data, error } = await supabase
      .from('vendor_payments')
      .insert([{
        vendor_id: vid,
        amount: parseFloat(amount),
        payment_type, // 'purchase' or 'payment'
        payment_date: payment_date || new Date().toISOString().split('T')[0],
        note,
        reference,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, transaction: data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
