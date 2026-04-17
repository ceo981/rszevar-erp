import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BILL_BUCKET = 'expense-bills'; // Supabase Storage bucket name

// ─── GET ──────────────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

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

    const { data: employees } = await supabase
      .from('employees')
      .select('id, name, advance_limit')
      .eq('is_active', true)
      .order('name');

    const allLogs = logs || [];
    const totalIn = allLogs
      .filter(l => l.type === 'cash_in' && l.status === 'approved')
      .reduce((s, l) => s + parseFloat(l.amount || 0), 0);

    const totalOut = allLogs
      .filter(l => l.type !== 'cash_in' && l.status === 'approved')
      .reduce((s, l) => s + parseFloat(l.amount || 0), 0);

    const balance = totalIn - totalOut;
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
    const { searchParams } = new URL(request.url);
    const urlAction = searchParams.get('action');

    // ── FORM-DATA path: bill file upload ──
    // Frontend sends multipart/form-data when uploading bill.
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data') || urlAction === 'upload_bill') {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
      }

      const ext = (file.name?.split('.').pop() || 'bin').toLowerCase();
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = `bills/${safeName}`;

      const arrayBuffer = await file.arrayBuffer();
      const { data: uploadData, error: uploadErr } = await supabase
        .storage
        .from(BILL_BUCKET)
        .upload(filePath, arrayBuffer, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });

      if (uploadErr) {
        return NextResponse.json({
          success: false,
          error: `Upload failed: ${uploadErr.message}. Make sure Supabase Storage bucket "${BILL_BUCKET}" exists and is public.`,
        }, { status: 500 });
      }

      const { data: publicData } = supabase
        .storage
        .from(BILL_BUCKET)
        .getPublicUrl(uploadData.path);

      return NextResponse.json({
        success: true,
        url: publicData.publicUrl,
        path: uploadData.path,
      });
    }

    // ── JSON path: all other actions ──
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
        requested_by: requested_by || 'Unknown',
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

    // ── Add expense ──
    if (action === 'add_expense') {
      const { amount, description, category, notes, date, added_by, bill_url } = body;
      if (!amount || !description) {
        return NextResponse.json({ success: false, error: 'Amount aur description required hai' });
      }

      const { data: log, error: logErr } = await supabase.from('operations_cash_log').insert({
        type: 'expense',
        amount: parseFloat(amount),
        description,
        category: category || 'Operations',
        notes: notes || '',
        requested_by: added_by || 'Unknown',
        status: 'approved',
        date: date || new Date().toISOString().split('T')[0],
        bill_url: bill_url || null,
        edit_history: [],
      }).select().single();

      if (logErr) throw logErr;

      // Accounts backward compat
      await supabase.from('expenses').insert({
        title: description,
        amount: parseFloat(amount),
        category: category || 'Operations',
        expense_date: date || new Date().toISOString().split('T')[0],
        note: notes || '',
        paid_by: added_by || 'Unknown',
      });

      return NextResponse.json({ success: true, log });
    }

    // ── UPDATE expense (NEW) ──
    // Permissions:
    //   - Creator can edit own entries (matched by requested_by === edited_by)
    //   - CEO (is_ceo=true) can edit any
    if (action === 'update_expense') {
      const { id, edited_by, is_ceo, description, amount, category, notes, date, bill_url } = body;
      if (!id || !edited_by) {
        return NextResponse.json({ success: false, error: 'id aur edited_by required' });
      }

      // Fetch current row
      const { data: existing, error: fetchErr } = await supabase
        .from('operations_cash_log')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchErr || !existing) {
        return NextResponse.json({ success: false, error: 'Entry nahi mili' }, { status: 404 });
      }

      // Permission check
      const isCreator = existing.requested_by === edited_by;
      if (!isCreator && !is_ceo) {
        return NextResponse.json({
          success: false,
          error: 'Tumhari permission nahi hai ye edit karne ki. Sirf CEO ya jisne banai hai wo edit kar sake.',
        }, { status: 403 });
      }

      // Compute diff — only track fields that actually changed
      const changes = {};
      const checkField = (name, newVal) => {
        if (newVal === undefined) return; // not sent — skip
        const oldVal = existing[name];
        const oldNorm = oldVal === null ? '' : String(oldVal);
        const newNorm = newVal === null ? '' : String(newVal);
        if (oldNorm !== newNorm) {
          changes[name] = { from: oldVal, to: newVal };
        }
      };

      checkField('description', description);
      if (amount !== undefined && amount !== null && amount !== '') {
        const newAmt = parseFloat(amount);
        if (!isNaN(newAmt) && newAmt !== parseFloat(existing.amount)) {
          changes.amount = { from: parseFloat(existing.amount), to: newAmt };
        }
      }
      checkField('category', category);
      checkField('notes', notes);
      checkField('date', date);
      checkField('bill_url', bill_url);

      if (Object.keys(changes).length === 0) {
        return NextResponse.json({ success: false, error: 'Kuch change nahi — save karne ki zaroorat nahi' });
      }

      // Append to edit_history
      const historyEntry = {
        edited_by,
        edited_at: new Date().toISOString(),
        changes,
      };
      const newHistory = [ ...(existing.edit_history || []), historyEntry ];

      // Build update payload
      const updatePayload = { edit_history: newHistory };
      if (description !== undefined) updatePayload.description = description;
      if (amount !== undefined && amount !== null && amount !== '') updatePayload.amount = parseFloat(amount);
      if (category !== undefined) updatePayload.category = category;
      if (notes !== undefined) updatePayload.notes = notes;
      if (date !== undefined) updatePayload.date = date;
      if (bill_url !== undefined) updatePayload.bill_url = bill_url;

      const { data: updated, error: updErr } = await supabase
        .from('operations_cash_log')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();

      if (updErr) throw updErr;

      return NextResponse.json({ success: true, log: updated, changes });
    }

    // ── Give advance ──
    if (action === 'give_advance') {
      const { employee_id, amount, notes, date, given_by } = body;
      if (!employee_id || !amount) {
        return NextResponse.json({ success: false, error: 'Employee aur amount required hai' });
      }

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

      const { data: adv, error: advErr } = await supabase.from('employee_advances').insert({
        employee_id: parseInt(employee_id),
        amount: parseFloat(amount),
        given_date: advanceDate,
        given_by: given_by || 'Unknown',
        status: 'pending',
        notes: notes || '',
      }).select().single();

      if (advErr) throw advErr;

      await supabase.from('operations_cash_log').insert({
        type: 'advance',
        amount: parseFloat(amount),
        description: `Advance — ${emp?.name || 'Employee'}`,
        employee_id: parseInt(employee_id),
        notes: notes || '',
        requested_by: given_by || 'Unknown',
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
