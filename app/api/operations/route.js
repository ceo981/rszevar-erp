import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── GET ──────────────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // YYYY-MM

    // Fetch cash log
    let query = supabase
      .from('operations_cash_log')
      .select('*, employees(name)')
      .order('created_at', { ascending: false });

    if (month) {
      query = query
        .gte('date', `${month}-01`)
        .lte('date', `${month}-31`);
    }

    const { data: logs, error } = await query;
    if (error) throw error;

    // Fetch employees for advance dropdown
    const { data: employees } = await supabase
      .from('employees')
      .select('id, name, advance_limit')
      .eq('is_active', true)
      .order('name');

    // Calculate balance
    const allLogs = logs || [];
    const totalIn = allLogs
      .filter(l => l.type === 'cash_in' && l.status === 'approved')
      .reduce((s, l) => s + parseFloat(l.amount || 0), 0);

    const totalOut = allLogs
      .filter(l => l.type !== 'cash_in' && l.status === 'approved')
      .reduce((s, l) => s + parseFloat(l.amount || 0), 0);

    const balance = totalIn - totalOut;

    // Pending count
    const pendingCount = allLogs.filter(l => l.status === 'pending').length;

    return NextResponse.json({
      success: true,
      logs: allLogs,
      balance,
      total_in: totalIn,
      total_out: totalOut,
      pending_count: pendingCount,
      employees: employees || [],
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    // ── Request cash (Sharjeel → CEO approves) ──
    if (action === 'request_cash') {
      const { amount, notes, requested_by } = body;
      if (!amount) return NextResponse.json({ success: false, error: 'Amount required' });

      const { data, error } = await supabase.from('operations_cash_log').insert({
        type: 'cash_in',
        amount: parseFloat(amount),
        description: 'Cash Request',
        notes: notes || '',
        requested_by: requested_by || 'Sharjeel',
        status: 'pending',
        date: new Date().toISOString().split('T')[0],
      }).select().single();

      if (error) throw error;
      return NextResponse.json({ success: true, log: data });
    }

    // ── CEO approves cash ──
    if (action === 'approve_cash') {
      const { id, approved_by } = body;
      const { error } = await supabase.from('operations_cash_log').update({
        status: 'approved',
        approved_by: approved_by || 'CEO',
      }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ── CEO rejects cash ──
    if (action === 'reject_cash') {
      const { id } = body;
      const { error } = await supabase.from('operations_cash_log').update({
        status: 'rejected',
      }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ── Add expense (Sharjeel → direct, no approval) ──
    if (action === 'add_expense') {
      const { amount, description, category, notes, date, added_by } = body;
      if (!amount || !description) {
        return NextResponse.json({ success: false, error: 'Amount aur description required hai' });
      }

      // Insert into operations_cash_log
      const { data: log, error: logErr } = await supabase.from('operations_cash_log').insert({
        type: 'expense',
        amount: parseFloat(amount),
        description,
        category: category || 'Operations',
        notes: notes || '',
        requested_by: added_by || 'Sharjeel',
        status: 'approved',
        date: date || new Date().toISOString().split('T')[0],
      }).select().single();

      if (logErr) throw logErr;

      // Also insert into expenses table (for Accounts backward compat)
      await supabase.from('expenses').insert({
        title: description,
        amount: parseFloat(amount),
        category: category || 'Operations',
        expense_date: date || new Date().toISOString().split('T')[0],
        note: notes || '',
        paid_by: added_by || 'Sharjeel',
      });

      return NextResponse.json({ success: true, log });
    }

    // ── Give advance (Sharjeel → HR linked) ──
    if (action === 'give_advance') {
      const { employee_id, amount, notes, date, given_by } = body;
      if (!employee_id || !amount) {
        return NextResponse.json({ success: false, error: 'Employee aur amount required hai' });
      }

      // Check advance limit
      const { data: emp } = await supabase
        .from('employees')
        .select('advance_limit, name')
        .eq('id', employee_id)
        .single();

      const { data: existing } = await supabase
        .from('employee_advances')
        .select('amount')
        .eq('employee_id', employee_id)
        .eq('status', 'pending');

      const outstanding = (existing || []).reduce((s, a) => s + Number(a.amount), 0);
      const limit = Number(emp?.advance_limit || 0);

      if (limit > 0 && (outstanding + Number(amount)) > limit) {
        return NextResponse.json({
          success: false,
          error: `Advance limit cross ho raha hai! Outstanding: Rs. ${outstanding.toLocaleString()} | Limit: Rs. ${limit.toLocaleString()}`,
        });
      }

      const advanceDate = date || new Date().toISOString().split('T')[0];

      // Insert into employee_advances (HR linked)
      const { data: adv, error: advErr } = await supabase.from('employee_advances').insert({
        employee_id: parseInt(employee_id),
        amount: parseFloat(amount),
        given_date: advanceDate,
        given_by: given_by || 'Sharjeel',
        status: 'pending',
        notes: notes || '',
      }).select().single();

      if (advErr) throw advErr;

      // Insert into operations_cash_log (deduct from wallet)
      await supabase.from('operations_cash_log').insert({
        type: 'advance',
        amount: parseFloat(amount),
        description: `Advance — ${emp?.name || 'Employee'}`,
        employee_id: parseInt(employee_id),
        notes: notes || '',
        requested_by: given_by || 'Sharjeel',
        status: 'approved',
        date: advanceDate,
        reference_id: adv.id,
      });

      return NextResponse.json({ success: true, advance: adv });
    }

    // ── Delete entry ──
    if (action === 'delete') {
      const { id } = body;
      await supabase.from('operations_cash_log').delete().eq('id', id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
