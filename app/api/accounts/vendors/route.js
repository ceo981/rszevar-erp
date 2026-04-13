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
    const action = searchParams.get('action');

    if (vendor_id && action === 'transactions') {
      const { data: vendor } = await supabase.from('vendors').select('*').eq('id', vendor_id).single();
      const { data: txns } = await supabase.from('vendor_payments').select('*').eq('vendor_id', vendor_id).order('payment_date', { ascending: true });
      const purchases = (txns || []).filter(t => t.payment_type === 'purchase').reduce((s, t) => s + parseFloat(t.amount || 0), 0);
      const paid = (txns || []).filter(t => t.payment_type === 'payment').reduce((s, t) => s + parseFloat(t.amount || 0), 0);
      return NextResponse.json({ success: true, vendor, transactions: txns || [], total_purchase: purchases, total_paid: paid, outstanding: purchases - paid });
    }

    const { data: vendors } = await supabase.from('vendors').select('*').order('name');
    const { data: payments } = await supabase.from('vendor_payments').select('*').order('payment_date', { ascending: false });

    const ledger = (vendors || []).map(v => {
      const vp = (payments || []).filter(p => p.vendor_id === v.id);
      const totalPurchase = vp.filter(p => p.payment_type === 'purchase').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      const totalPaid = vp.filter(p => p.payment_type === 'payment').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      return { ...v, total_purchase: totalPurchase, total_paid: totalPaid, outstanding: totalPurchase - totalPaid, transactions: vp.length, last_transaction: vp[0]?.payment_date || null };
    });

    const totalOutstanding = ledger.reduce((s, v) => s + v.outstanding, 0);
    return NextResponse.json({ success: true, ledger, total_outstanding: totalOutstanding });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'add_vendor') {
      const { name, phone, category, payment_terms, contact_person, email } = body;
      if (!name) return NextResponse.json({ success: false, error: 'Name required' });
      const { data, error } = await supabase.from('vendors').insert({ name, phone: phone || '', category: category || 'General', type: category || 'General', payment_terms: payment_terms || '', contact_person: contact_person || '', email: email || '', created_at: new Date().toISOString() }).select().single();
      if (error) throw error;
      return NextResponse.json({ success: true, vendor: data });
    }

    if (action === 'add_transaction') {
      const { vendor_id, amount, payment_type, payment_date, due_date, item_description, note, reference } = body;
      if (!vendor_id || !amount || !payment_type) return NextResponse.json({ success: false, error: 'vendor_id, amount, payment_type required' });
      const { data, error } = await supabase.from('vendor_payments').insert({ vendor_id, amount: parseFloat(amount), payment_type, payment_date: payment_date || new Date().toISOString().split('T')[0], due_date: due_date || null, item_description: item_description || '', note: note || '', reference: reference || '', created_at: new Date().toISOString() }).select().single();
      if (error) throw error;
      return NextResponse.json({ success: true, transaction: data });
    }

    if (action === 'delete_transaction') {
      await supabase.from('vendor_payments').delete().eq('id', body.id);
      return NextResponse.json({ success: true });
    }

    if (action === 'delete_vendor') {
      await supabase.from('vendor_payments').delete().eq('vendor_id', body.vendor_id);
      await supabase.from('vendors').delete().eq('id', body.vendor_id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
