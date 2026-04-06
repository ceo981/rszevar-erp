import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '30');
    const offset = (page - 1) * limit;

    let query = supabase
      .from('expenses')
      .select('*', { count: 'exact' })
      .order('expense_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) query = query.eq('category', category);
    if (from) query = query.gte('expense_date', from);
    if (to) query = query.lte('expense_date', to);

    const { data, count, error } = await query;
    if (error) throw error;

    // Category totals
    const { data: allExpenses } = await supabase.from('expenses').select('amount, category');
    const byCategory = {};
    for (const e of allExpenses || []) {
      byCategory[e.category] = (byCategory[e.category] || 0) + parseFloat(e.amount || 0);
    }

    return NextResponse.json({
      success: true,
      expenses: data || [],
      total: count || 0,
      page,
      total_pages: Math.ceil((count || 0) / limit),
      by_category: byCategory,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { title, amount, category, expense_date, note, paid_by } = body;

    if (!title || !amount || !category) {
      return NextResponse.json({ success: false, error: 'title, amount, category required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('expenses')
      .insert([{
        title,
        amount: parseFloat(amount),
        category,
        expense_date: expense_date || new Date().toISOString().split('T')[0],
        note,
        paid_by,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, expense: data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
