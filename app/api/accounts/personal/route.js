import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CATEGORIES = ['Office Rent', 'Electricity', 'Internet', 'Personal Purchase', 'Food', 'Travel', 'Other'];

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    let query = supabase
      .from('personal_expenses')
      .select('*')
      .order('expense_date', { ascending: false });

    if (month) {
      query = query.gte('expense_date', `${month}-01`).lte('expense_date', `${month}-31`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const total = (data || []).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const byCategory = {};
    (data || []).forEach(e => {
      byCategory[e.category] = (byCategory[e.category] || 0) + parseFloat(e.amount || 0);
    });

    return NextResponse.json({ success: true, expenses: data || [], total, by_category: byCategory, categories: CATEGORIES });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'add') {
      const { title, amount, category, expense_date, note } = body;
      if (!title || !amount) return NextResponse.json({ success: false, error: 'Title aur amount required' });

      const { data, error } = await supabase.from('personal_expenses').insert({
        title, amount: parseFloat(amount),
        category: category || 'Other',
        expense_date: expense_date || new Date().toISOString().split('T')[0],
        note: note || '',
      }).select().single();

      if (error) throw error;
      return NextResponse.json({ success: true, expense: data });
    }

    if (action === 'delete') {
      await supabase.from('personal_expenses').delete().eq('id', body.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
