import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const filter = searchParams.get('filter') || 'all'; // all | repeat | blacklist | vip
  const page = parseInt(searchParams.get('page') || '1');
  const limit = 30;
  const offset = (page - 1) * limit;
  const id = searchParams.get('id');

  // Single customer detail
  if (id) {
    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .or(`customer_phone.eq.${id},id.eq.${id}`)
      .order('created_at', { ascending: false });

    const { data: complaints } = await supabase
      .from('complaints')
      .select('*')
      .eq('customer_phone', id)
      .order('created_at', { ascending: false });

    const { data: blacklist } = await supabase
      .from('customer_blacklist')
      .select('*')
      .eq('phone', id)
      .maybeSingle();

    return NextResponse.json({ orders: orders || [], complaints: complaints || [], blacklist });
  }

  // Build customer summary from orders
  const { data: allOrders } = await supabase
    .from('orders')
    .select('id, customer_name, customer_phone, customer_city, total_amount, status, created_at')
    .order('created_at', { ascending: false });

  // Group by phone
  const customerMap = {};
  for (const o of allOrders || []) {
    const phone = o.customer_phone || 'unknown';
    if (!customerMap[phone]) {
      customerMap[phone] = {
        phone,
        name: o.customer_name || 'Unknown',
        city: o.customer_city || '',
        orders: 0,
        total_spend: 0,
        delivered: 0,
        rto: 0,
        cancelled: 0,
        last_order: o.created_at,
        first_order: o.created_at,
      };
    }
    const c = customerMap[phone];
    c.orders++;
    c.total_spend += parseFloat(o.total_amount || 0);
    if (o.status === 'delivered') c.delivered++;
    if (o.status === 'rto' || o.status === 'returned') c.rto++;
    if (o.status === 'cancelled') c.cancelled++;
    if (o.created_at > c.last_order) c.last_order = o.created_at;
    if (o.created_at < c.first_order) c.first_order = o.created_at;
  }

  // Get blacklist
  const { data: blacklistAll } = await supabase
    .from('customer_blacklist')
    .select('phone');
  const blacklistSet = new Set((blacklistAll || []).map(b => b.phone));

  let customers = Object.values(customerMap).map(c => ({
    ...c,
    is_blacklisted: blacklistSet.has(c.phone),
    is_vip: c.orders >= 3 && c.delivered >= 2,
    is_repeat: c.orders >= 2,
    delivery_rate: c.orders ? ((c.delivered / c.orders) * 100).toFixed(0) : 0,
  }));

  // Filter
  if (filter === 'repeat') customers = customers.filter(c => c.is_repeat);
  if (filter === 'blacklist') customers = customers.filter(c => c.is_blacklisted);
  if (filter === 'vip') customers = customers.filter(c => c.is_vip);
  if (filter === 'rto') customers = customers.filter(c => c.rto > 0);

  // Search
  if (search) {
    const q = search.toLowerCase();
    customers = customers.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.city?.toLowerCase().includes(q)
    );
  }

  // Sort by total spend desc
  customers.sort((a, b) => b.total_spend - a.total_spend);

  const total = customers.length;
  const paginated = customers.slice(offset, offset + limit);

  const summary = {
    total: Object.keys(customerMap).length,
    repeat: Object.values(customerMap).filter(c => c.orders >= 2).length,
    vip: Object.values(customerMap).filter(c => c.orders >= 3).length,
    blacklisted: blacklistSet.size,
    rto_customers: Object.values(customerMap).filter(c => c.rto > 0).length,
  };

  return NextResponse.json({ success: true, customers: paginated, total, summary });
}

export async function POST(request) {
  const { action, phone, reason, name } = await request.json();

  if (action === 'blacklist') {
    const { error } = await supabase.from('customer_blacklist').upsert({
      phone,
      name: name || '',
      reason: reason || '',
      blacklisted_at: new Date().toISOString(),
    }, { onConflict: 'phone' });
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true });
  }

  if (action === 'unblacklist') {
    await supabase.from('customer_blacklist').delete().eq('phone', phone);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' });
}
