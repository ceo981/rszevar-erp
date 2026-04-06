import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'all';
  const category = searchParams.get('category') || 'all';
  const search = searchParams.get('search') || '';

  let query = supabase
    .from('complaints')
    .select('*')
    .order('created_at', { ascending: false });

  if (status !== 'all') query = query.eq('status', status);
  if (category !== 'all') query = query.eq('category', category);

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message });

  let complaints = data || [];
  if (search) {
    const q = search.toLowerCase();
    complaints = complaints.filter(c =>
      c.customer_name?.toLowerCase().includes(q) ||
      c.customer_phone?.includes(q) ||
      c.order_number?.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q)
    );
  }

  const summary = {
    total: (data || []).length,
    open: (data || []).filter(c => c.status === 'open').length,
    in_progress: (data || []).filter(c => c.status === 'in_progress').length,
    resolved: (data || []).filter(c => c.status === 'resolved').length,
    closed: (data || []).filter(c => c.status === 'closed').length,
  };

  return NextResponse.json({ success: true, complaints, summary });
}

export async function POST(request) {
  const body = await request.json();
  const { action } = body;

  if (action === 'add') {
    const { data, error } = await supabase.from('complaints').insert({
      order_number: body.order_number || '',
      customer_name: body.customer_name || '',
      customer_phone: body.customer_phone || '',
      city: body.city || '',
      category: body.category || 'other',
      description: body.description || '',
      status: 'open',
      priority: body.priority || 'medium',
      assigned_to: body.assigned_to || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select().single();

    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, complaint: data });
  }

  if (action === 'update') {
    const { error } = await supabase.from('complaints').update({
      status: body.status,
      priority: body.priority,
      assigned_to: body.assigned_to,
      resolution_notes: body.resolution_notes || '',
      resolved_at: body.status === 'resolved' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', body.id);

    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true });
  }

  if (action === 'delete') {
    await supabase.from('complaints').delete().eq('id', body.id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' });
}
