import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MISTAKE_BY_OPTIONS = ['packer', 'dispatcher', 'courier', 'unknown'];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const category    = searchParams.get('category')    || 'all';
  const mistake_by  = searchParams.get('mistake_by')  || 'all';
  const search      = searchParams.get('search')       || '';

  // action=leaderboard — complaints-based negative ratings
  if (searchParams.get('action') === 'leaderboard') {
    // Fetch all complaints that have order_number + mistake_by set
    const { data: complaints } = await supabase
      .from('complaints')
      .select('order_number, mistake_by, category, created_at')
      .not('order_number', 'is', null)
      .neq('order_number', '')
      .not('mistake_by', 'is', null)
      .neq('mistake_by', 'unknown')
      .neq('mistake_by', 'courier'); // courier mistakes don't go to employee board

    const orderNumbers = [...new Set((complaints || []).map(c => c.order_number))];

    // Get packing assignments for those orders
    let assignmentMap = {}; // order_number → employee name
    if (orderNumbers.length > 0) {
      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_number')
        .in('order_number', orderNumbers);

      const orderIdMap = {}; // order_number → order id
      (orders || []).forEach(o => { orderIdMap[o.order_number] = o.id; });

      const orderIds = Object.values(orderIdMap);
      if (orderIds.length > 0) {
        const { data: assignments } = await supabase
          .from('order_assignments')
          .select('order_id, employee:assigned_to(id, name)')
          .in('order_id', orderIds);

        const orderIdToName = {}; // order uuid → emp name
        (assignments || []).forEach(a => {
          if (a.employee?.name) orderIdToName[a.order_id] = { name: a.employee.name, id: a.employee.id };
        });

        Object.entries(orderIdMap).forEach(([orderNum, orderId]) => {
          if (orderIdToName[orderId]) {
            assignmentMap[orderNum] = orderIdToName[orderId];
          }
        });
      }
    }

    // Get all active employees for leaderboard display
    const { data: allEmps } = await supabase
      .from('employees')
      .select('id, name, role')
      .eq('status', 'active')
      .in('role', ['Packing Team', 'Dispatcher', 'Operations Manager', 'Other']);

    // Build negative ratings per employee
    const negMap = {}; // emp name → { count, complaints }

    for (const c of complaints || []) {
      const mb = c.mistake_by; // 'packer' or 'dispatcher'

      if (mb === 'packer') {
        // Find who packed this order
        const emp = assignmentMap[c.order_number];
        if (emp) {
          if (!negMap[emp.name]) negMap[emp.name] = { count: 0, complaints: [], role: 'Packer', id: emp.id };
          negMap[emp.name].count++;
          negMap[emp.name].complaints.push({ order: c.order_number, category: c.category, date: c.created_at });
        }
      } else if (mb === 'dispatcher') {
        // Dispatcher = Adil or whoever has dispatcher role
        const dispatchers = (allEmps || []).filter(e => e.role === 'Dispatcher');
        for (const d of dispatchers) {
          if (!negMap[d.name]) negMap[d.name] = { count: 0, complaints: [], role: 'Dispatcher', id: d.id };
          negMap[d.name].count++;
          negMap[d.name].complaints.push({ order: c.order_number, category: c.category, date: c.created_at });
        }
      }
    }

    // Build sorted leaderboard (worst first)
    const leaderboard = Object.entries(negMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count);

    // Also include employees with 0 complaints
    const inBoard = new Set(leaderboard.map(e => e.name));
    for (const emp of (allEmps || [])) {
      if (!inBoard.has(emp.name)) {
        leaderboard.push({ name: emp.name, id: emp.id, role: emp.role, count: 0, complaints: [] });
      }
    }

    // Courier mistakes count (for display only)
    const courierMistakes = (complaints || []).filter(c => c.mistake_by === 'courier').length;
    // Wait, we excluded courier from above query - let's get them separately
    const { data: courierComplaints } = await supabase
      .from('complaints')
      .select('mistake_by, category')
      .eq('mistake_by', 'courier');

    return NextResponse.json({
      success: true,
      leaderboard,
      courier_mistakes: (courierComplaints || []).length,
      total_with_mistake: (complaints || []).length,
    });
  }

  // Normal GET — fetch complaints list
  let query = supabase
    .from('complaints')
    .select('*')
    .order('created_at', { ascending: false });

  if (category   !== 'all') query = query.eq('category', category);
  if (mistake_by !== 'all') query = query.eq('mistake_by', mistake_by);

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
    packer_mistakes:     (data || []).filter(c => c.mistake_by === 'packer').length,
    dispatcher_mistakes: (data || []).filter(c => c.mistake_by === 'dispatcher').length,
    courier_mistakes:    (data || []).filter(c => c.mistake_by === 'courier').length,
  };

  return NextResponse.json({ success: true, complaints, summary });
}

export async function POST(request) {
  const body = await request.json();
  const { action } = body;

  if (action === 'add') {
    const { data, error } = await supabase.from('complaints').insert({
      order_number:    body.order_number    || '',
      customer_name:   body.customer_name   || '',
      customer_phone:  body.customer_phone  || '',
      city:            body.city            || '',
      category:        body.category        || 'Other',
      description:     body.description     || '',
      mistake_by:      body.mistake_by      || 'unknown',
      status:          'open',
      priority:        'medium',
      assigned_to:     '',
      image_urls:      body.image_urls      || [],
      created_at:      new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    }).select().single();

    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, complaint: data });
  }

  if (action === 'delete') {
    await supabase.from('complaints').delete().eq('id', body.id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' });
}
