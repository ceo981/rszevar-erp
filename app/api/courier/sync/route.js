import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── PostEx Sync ───────────────────────────────────────────────
async function syncPostEx() {
  const token = process.env.POSTEX_API_TOKEN;
  const storeId = process.env.POSTEX_STORE_ID;
  if (!token) return { courier: 'PostEx', success: false, error: 'API token missing', synced: 0 };

  const results = { courier: 'PostEx', synced: 0, delivered: 0, rto: 0, in_transit: 0, cod_collected: 0, errors: [] };

  try {
    // PostEx: get all orders, paginated
    let page = 1;
    let hasMore = true;
    const allOrders = [];

    while (hasMore && page <= 10) {
      const res = await fetch(`https://api.postex.pk/services/integration/api/order/v3/get-orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': token,
        },
        body: JSON.stringify({
          orderStatus: '', // all statuses
          pageNumber: String(page),
          pageSize: '100',
          storeId: storeId || '',
        }),
      });

      const data = await res.json();
      if (!data.dist || data.dist.length === 0) { hasMore = false; break; }
      allOrders.push(...data.dist);
      if (data.dist.length < 100) hasMore = false;
      page++;
    }

    for (const order of allOrders) {
      const trackingNo = order.orderRefNumber || order.trackingNumber;
      if (!trackingNo) continue;

      const status = normalizePostExStatus(order.orderStatus || order.status || '');

      const upsertData = {
        tracking_number: trackingNo,
        courier_name: 'PostEx',
        customer_name: order.customerName || '',
        customer_phone: order.customerPhone || '',
        customer_address: order.customerAddress || '',
        city: order.cityName || order.city || '',
        cod_amount: parseFloat(order.codAmount || order.invoicePayment || 0),
        status: status,
        courier_status_raw: order.orderStatus || order.status || '',
        last_tracked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Check if exists
      const { data: existing } = await supabase
        .from('courier_bookings')
        .select('id, status')
        .eq('tracking_number', trackingNo)
        .eq('courier_name', 'PostEx')
        .maybeSingle();

      if (existing) {
        await supabase.from('courier_bookings').update(upsertData).eq('id', existing.id);
      } else {
        upsertData.created_at = new Date().toISOString();
        await supabase.from('courier_bookings').insert(upsertData);
      }

      results.synced++;
      if (status === 'delivered') { results.delivered++; results.cod_collected += upsertData.cod_amount; }
      if (status === 'rto') results.rto++;
      if (status === 'in_transit') results.in_transit++;
    }

    results.success = true;
  } catch (e) {
    results.success = false;
    results.error = e.message;
  }

  return results;
}

// ─── Leopards Sync ────────────────────────────────────────────
async function syncLeopards() {
  const apiKey = process.env.LEOPARDS_API_KEY;
  const apiPwd = process.env.LEOPARDS_API_PASSWORD;
  const shipperId = process.env.LEOPARDS_SHIPPER_ID;
  if (!apiKey || !apiPwd) return { courier: 'Leopards', success: false, error: 'API credentials missing', synced: 0 };

  const results = { courier: 'Leopards', synced: 0, delivered: 0, rto: 0, in_transit: 0, cod_collected: 0, errors: [] };

  try {
    // Leopards: get packets list
    const today = new Date();
    const fromDate = new Date(today.setDate(today.getDate() - 60)).toISOString().split('T')[0]; // last 60 days
    const toDate = new Date().toISOString().split('T')[0];

    const res = await fetch(`https://merchantapi.leopardscourier.com/api/getAllPacketsbyStatus/format/json/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        api_password: apiPwd,
        status: '0', // 0 = all
        page_no: '1',
        rows_per_page: '500',
        from_date: fromDate,
        to_date: toDate,
        shipper_id: shipperId || '',
      }),
    });

    const data = await res.json();
    const packets = data?.error === '0' ? (data?.data?.packets || []) : [];

    for (const pkt of packets) {
      const trackingNo = pkt.track_number || pkt.cn_number;
      if (!trackingNo) continue;

      const status = normalizeLeopardsStatus(pkt.status || pkt.packet_status || '');
      const codAmount = parseFloat(pkt.cod_amount || pkt.collect_amount || 0);

      const upsertData = {
        tracking_number: String(trackingNo),
        courier_name: 'Leopards',
        customer_name: pkt.consignee_name || '',
        customer_phone: pkt.consignee_phone || '',
        customer_address: pkt.consignee_address || '',
        city: pkt.destination_city || pkt.city || '',
        cod_amount: codAmount,
        status: status,
        courier_status_raw: pkt.status || pkt.packet_status || '',
        last_tracked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from('courier_bookings')
        .select('id')
        .eq('tracking_number', String(trackingNo))
        .eq('courier_name', 'Leopards')
        .maybeSingle();

      if (existing) {
        await supabase.from('courier_bookings').update(upsertData).eq('id', existing.id);
      } else {
        upsertData.created_at = new Date().toISOString();
        await supabase.from('courier_bookings').insert(upsertData);
      }

      results.synced++;
      if (status === 'delivered') { results.delivered++; results.cod_collected += codAmount; }
      if (status === 'rto') results.rto++;
      if (status === 'in_transit') results.in_transit++;
    }

    results.success = true;
  } catch (e) {
    results.success = false;
    results.error = e.message;
  }

  return results;
}

// ─── Kangaroo Sync ────────────────────────────────────────────
async function syncKangaroo() {
  const clientId = process.env.KANGAROO_CLIENT_ID || '549';
  const pass = process.env.KANGAROO_API_PASSWORD;
  if (!pass) return { courier: 'Kangaroo', success: false, error: 'API password missing', synced: 0 };

  const results = { courier: 'Kangaroo', synced: 0, delivered: 0, rto: 0, in_transit: 0, cod_collected: 0, errors: [] };

  try {
    // Kangaroo: get consignment list
    const res = await fetch(`https://kangaroo.pk/orderapi.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientid: clientId,
        pass: pass,
        request: 'orderlist',
        status: 'all',
      }),
    });

    const data = await res.json();
    const orders = data?.orders || data?.data || [];

    for (const order of orders) {
      const trackingNo = order.cn || order.tracking_no || order.consignment_no;
      if (!trackingNo) continue;

      const status = normalizeKangarooStatus(order.status || '');
      const codAmount = parseFloat(order.cod || order.cod_amount || 0);

      const upsertData = {
        tracking_number: String(trackingNo),
        courier_name: 'Kangaroo',
        customer_name: order.consignee || order.customer_name || '',
        customer_phone: order.phone || '',
        customer_address: order.address || '',
        city: order.city || '',
        cod_amount: codAmount,
        status: status,
        courier_status_raw: order.status || '',
        last_tracked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from('courier_bookings')
        .select('id')
        .eq('tracking_number', String(trackingNo))
        .eq('courier_name', 'Kangaroo')
        .maybeSingle();

      if (existing) {
        await supabase.from('courier_bookings').update(upsertData).eq('id', existing.id);
      } else {
        upsertData.created_at = new Date().toISOString();
        await supabase.from('courier_bookings').insert(upsertData);
      }

      results.synced++;
      if (status === 'delivered') { results.delivered++; results.cod_collected += codAmount; }
      if (status === 'rto') results.rto++;
      if (status === 'in_transit') results.in_transit++;
    }

    results.success = true;
  } catch (e) {
    results.success = false;
    results.error = e.message;
  }

  return results;
}

// ─── Status Normalizers ───────────────────────────────────────
function normalizePostExStatus(raw) {
  const s = raw.toLowerCase();
  if (s.includes('deliver')) return 'delivered';
  if (s.includes('return') || s.includes('rto') || s.includes('cancel')) return 'rto';
  if (s.includes('transit') || s.includes('dispatch') || s.includes('out for') || s.includes('pickup')) return 'in_transit';
  if (s.includes('book') || s.includes('created') || s.includes('pending')) return 'booked';
  return 'in_transit';
}

function normalizeLeopardsStatus(raw) {
  const s = raw.toLowerCase();
  if (s.includes('deliver')) return 'delivered';
  if (s.includes('return') || s.includes('rto') || s.includes('undeliver') || s.includes('cancel')) return 'rto';
  if (s.includes('transit') || s.includes('dispatch') || s.includes('out for delivery') || s.includes('pickup')) return 'in_transit';
  if (s.includes('book') || s.includes('created') || s.includes('collect')) return 'booked';
  return 'in_transit';
}

function normalizeKangarooStatus(raw) {
  const s = raw.toLowerCase();
  if (s.includes('deliver')) return 'delivered';
  if (s.includes('return') || s.includes('rto') || s.includes('cancel')) return 'rto';
  if (s.includes('transit') || s.includes('dispatch') || s.includes('out')) return 'in_transit';
  return 'booked';
}

// ─── Auto-settle in Accounts ──────────────────────────────────
async function autoSettle(syncResults) {
  // Mark delivered bookings as COD collected in accounts
  const { data: delivered } = await supabase
    .from('courier_bookings')
    .select('tracking_number, cod_amount, courier_name, order_id, updated_at')
    .eq('status', 'delivered')
    .eq('cod_settled', false);

  let settledCount = 0;
  for (const booking of delivered || []) {
    // Insert into settlements table
    await supabase.from('settlements').upsert({
      tracking_number: booking.tracking_number,
      courier_name: booking.courier_name,
      cod_amount: booking.cod_amount,
      status: 'pending_disbursement',
      settled_at: booking.updated_at,
      source: 'auto_sync',
      created_at: new Date().toISOString(),
    }, { onConflict: 'tracking_number' });

    settledCount++;
  }

  // Log sync run
  await supabase.from('sync_logs').insert({
    sync_type: 'courier_full',
    result: JSON.stringify(syncResults),
    synced_at: new Date().toISOString(),
  });

  return settledCount;
}

// ─── Main Route ───────────────────────────────────────────────
export async function POST(request) {
  const { courier } = await request.json().catch(() => ({}));

  let results = [];

  if (!courier || courier === 'PostEx') results.push(await syncPostEx());
  if (!courier || courier === 'Leopards') results.push(await syncLeopards());
  if (!courier || courier === 'Kangaroo') results.push(await syncKangaroo());

  const autoSettled = await autoSettle(results);

  const summary = {
    synced: results.reduce((a, r) => a + (r.synced || 0), 0),
    delivered: results.reduce((a, r) => a + (r.delivered || 0), 0),
    rto: results.reduce((a, r) => a + (r.rto || 0), 0),
    in_transit: results.reduce((a, r) => a + (r.in_transit || 0), 0),
    cod_collected: results.reduce((a, r) => a + (r.cod_collected || 0), 0),
    auto_settled: autoSettled,
  };

  return NextResponse.json({ success: true, results, summary });
}

export async function GET() {
  // Get last sync log
  const { data: lastSync } = await supabase
    .from('sync_logs')
    .select('*')
    .eq('sync_type', 'courier_full')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Today's stats from DB
  const today = new Date().toISOString().split('T')[0];

  const { data: todayDelivered } = await supabase
    .from('courier_bookings')
    .select('courier_name, cod_amount')
    .eq('status', 'delivered')
    .gte('updated_at', today);

  const { data: todayRTO } = await supabase
    .from('courier_bookings')
    .select('courier_name, cod_amount')
    .eq('status', 'rto')
    .gte('updated_at', today);

  const { data: allActive } = await supabase
    .from('courier_bookings')
    .select('courier_name, status, cod_amount, city, updated_at, tracking_number, customer_name, courier_status_raw')
    .in('status', ['booked', 'in_transit'])
    .order('updated_at', { ascending: false });

  const { data: recentRTO } = await supabase
    .from('courier_bookings')
    .select('*')
    .eq('status', 'rto')
    .order('updated_at', { ascending: false })
    .limit(50);

  return NextResponse.json({
    lastSync: lastSync?.synced_at || null,
    todayDelivered: todayDelivered || [],
    todayRTO: todayRTO || [],
    activeShipments: allActive || [],
    recentRTO: recentRTO || [],
  });
}
