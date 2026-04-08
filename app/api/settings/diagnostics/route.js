// ============================================================================
// RS ZEVAR ERP — Settings Diagnostics API
// GET /api/settings/diagnostics?check=shopify|leopards|system|all
// Returns read-only health info for integrations. Super admin only.
//
// Does NOT expose secret values — only masked hints ("****abcd") and
// booleans like `configured: true/false`.
// ============================================================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/permissions';
import { createServerClient } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── Helpers ───────────────────────────────────────────────────────────────

function mask(value) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 8) return '****';
  return `****${s.slice(-4)}`;
}

function present(envVar) {
  return !!(process.env[envVar] && process.env[envVar].length > 0);
}

// ─── Shopify health check ─────────────────────────────────────────────────
async function checkShopify() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;

  const result = {
    configured: !!(domain && token),
    store_domain: domain || null,
    access_token: mask(token),
    webhook_secret: mask(webhookSecret),
    connection: { status: 'not_tested', error: null, latency_ms: null },
    shop_info: null,
    webhooks: { registered: 0, list: [] },
    last_sync: null,
    order_counts: null,
  };

  if (!result.configured) return result;

  // Test connection + fetch shop info
  try {
    const t0 = Date.now();
    const res = await fetch(
      `https://${domain}/admin/api/2024-01/shop.json`,
      {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
      }
    );
    result.connection.latency_ms = Date.now() - t0;

    if (res.ok) {
      const data = await res.json();
      result.connection.status = 'ok';
      result.shop_info = {
        name: data.shop?.name,
        email: data.shop?.email,
        domain: data.shop?.domain,
        country: data.shop?.country_name,
        currency: data.shop?.currency,
        plan: data.shop?.plan_display_name,
        timezone: data.shop?.iana_timezone,
      };
    } else {
      result.connection.status = 'error';
      result.connection.error = `HTTP ${res.status}`;
    }
  } catch (e) {
    result.connection.status = 'error';
    result.connection.error = e.message;
  }

  // Fetch registered webhooks
  try {
    const res = await fetch(
      `https://${domain}/admin/api/2024-01/webhooks.json`,
      {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
      }
    );
    if (res.ok) {
      const data = await res.json();
      const hooks = (data.webhooks || []).map(w => ({
        topic: w.topic,
        address: w.address,
        format: w.format,
        created_at: w.created_at,
      }));
      result.webhooks.registered = hooks.length;
      result.webhooks.list = hooks;
    }
  } catch {}

  // Last sync from DB
  try {
    const supabase = createServerClient();
    const { data: lastSynced } = await supabase
      .from('orders')
      .select('shopify_synced_at, order_number')
      .not('shopify_synced_at', 'is', null)
      .order('shopify_synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { count: totalOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    result.last_sync = lastSynced?.shopify_synced_at || null;
    result.order_counts = { total: totalOrders || 0 };
  } catch {}

  return result;
}

// ─── Leopards health check ────────────────────────────────────────────────
async function checkLeopards() {
  const apiKey = process.env.LEOPARDS_API_KEY;
  const apiPassword = process.env.LEOPARDS_API_PASSWORD;

  const result = {
    configured: !!(apiKey && apiPassword),
    api_key: mask(apiKey),
    api_password: apiPassword ? '****' : null,
    connection: { status: 'not_tested', error: null, latency_ms: null },
    last_status_sync: null,
    last_payment_sync: null,
    counts: null,
  };

  if (!result.configured) return result;

  // Test connection with a narrow date range (1 day)
  try {
    const url = new URL('https://merchantapi.leopardscourier.com/api/getBookedPacketLastStatus/format/json/');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('api_password', apiPassword);
    const today = new Date().toISOString().slice(0, 10);
    url.searchParams.set('from_date', today);
    url.searchParams.set('to_date', today);

    const t0 = Date.now();
    const res = await fetch(url.toString(), { method: 'GET' });
    result.connection.latency_ms = Date.now() - t0;

    if (res.ok) {
      const data = await res.json();
      if (data.status === 1 || data.status === '1') {
        result.connection.status = 'ok';
        result.connection.today_packets = (data.packet_list || []).length;
      } else {
        result.connection.status = 'error';
        result.connection.error = data.error || 'Unknown API error';
      }
    } else {
      result.connection.status = 'error';
      result.connection.error = `HTTP ${res.status}`;
    }
  } catch (e) {
    result.connection.status = 'error';
    result.connection.error = e.message;
  }

  // Last syncs from courier_sync_log
  try {
    const supabase = createServerClient();
    const [statusLog, paymentLog] = await Promise.all([
      supabase
        .from('courier_sync_log')
        .select('*')
        .eq('courier', 'Leopards')
        .eq('sync_type', 'status')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('courier_sync_log')
        .select('*')
        .eq('courier', 'Leopards')
        .eq('sync_type', 'payments')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    result.last_status_sync = statusLog.data || null;
    result.last_payment_sync = paymentLog.data || null;

    // Order counts for Leopards
    const [{ count: total }, { count: delivered }, { count: paid }, { count: unpaid }] = await Promise.all([
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('dispatched_courier', 'Leopards'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('dispatched_courier', 'Leopards').eq('status', 'delivered'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('dispatched_courier', 'Leopards').eq('payment_status', 'paid'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('dispatched_courier', 'Leopards').eq('payment_status', 'unpaid'),
    ]);
    result.counts = {
      total: total || 0,
      delivered: delivered || 0,
      paid: paid || 0,
      unpaid: unpaid || 0,
    };
  } catch {}

  return result;
}

// ─── PostEx — just env check, deprecated ──────────────────────────────────
async function checkPostEx() {
  const supabase = createServerClient();
  let count = 0;
  try {
    const { count: c } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'PostEx');
    count = c || 0;
  } catch {}

  return {
    deprecated: true,
    configured: present('POSTEX_API_TOKEN'),
    api_token: mask(process.env.POSTEX_API_TOKEN),
    store_id: process.env.POSTEX_STORE_ID || null,
    note: 'PostEx is deprecated. Kept only for replacement shipments tracking.',
    order_count: count,
  };
}

// ─── Kangaroo — placeholder, waiting for API doc ──────────────────────────
async function checkKangaroo() {
  const supabase = createServerClient();
  let count = 0;
  try {
    const { count: c } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('dispatched_courier', 'Kangaroo');
    count = c || 0;
  } catch {}

  return {
    configured: present('KANGAROO_API_PASSWORD'),
    client_id: process.env.KANGAROO_CLIENT_ID || null,
    api_password: process.env.KANGAROO_API_PASSWORD ? '****' : null,
    endpoint: 'https://kangaroo.pk/orderapi.php',
    note: 'Awaiting API documentation from Kangaroo team. Tracking/payment endpoints not implemented yet. Orders are tagged manually.',
    order_count: count,
  };
}

// ─── System Health ─────────────────────────────────────────────────────────
async function checkSystem() {
  const result = {
    supabase: { configured: false, connection: 'not_tested', latency_ms: null, error: null },
    env_vars: {
      NEXT_PUBLIC_SUPABASE_URL: present('NEXT_PUBLIC_SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: present('SUPABASE_SERVICE_ROLE_KEY'),
      SHOPIFY_STORE_DOMAIN: present('SHOPIFY_STORE_DOMAIN'),
      SHOPIFY_ACCESS_TOKEN: present('SHOPIFY_ACCESS_TOKEN'),
      SHOPIFY_WEBHOOK_SECRET: present('SHOPIFY_WEBHOOK_SECRET'),
      LEOPARDS_API_KEY: present('LEOPARDS_API_KEY'),
      LEOPARDS_API_PASSWORD: present('LEOPARDS_API_PASSWORD'),
      POSTEX_API_TOKEN: present('POSTEX_API_TOKEN'),
      KANGAROO_API_PASSWORD: present('KANGAROO_API_PASSWORD'),
    },
    recent_syncs: [],
    recent_errors: [],
    db_stats: null,
  };

  // Supabase connection check
  try {
    const supabase = createServerClient();
    result.supabase.configured = true;

    const t0 = Date.now();
    const { error } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true });
    result.supabase.latency_ms = Date.now() - t0;

    if (error) {
      result.supabase.connection = 'error';
      result.supabase.error = error.message;
    } else {
      result.supabase.connection = 'ok';
    }

    // Recent sync runs
    const { data: syncs } = await supabase
      .from('courier_sync_log')
      .select('courier, sync_type, total_fetched, matched_orders, updated_orders, marked_paid, duration_ms, triggered_by, errors, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    result.recent_syncs = syncs || [];

    // Count of syncs with errors
    result.recent_errors = (syncs || []).filter(s => s.errors && (Array.isArray(s.errors) ? s.errors.length > 0 : true));

    // DB stats
    const [
      { count: ordersTotal },
      { count: productsTotal },
      { count: customersTotal },
    ] = await Promise.all([
      supabase.from('orders').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('customers').select('*', { count: 'exact', head: true }),
    ]);

    result.db_stats = {
      orders: ordersTotal || 0,
      products: productsTotal || 0,
      customers: customersTotal || 0,
    };
  } catch (e) {
    result.supabase.connection = 'error';
    result.supabase.error = e.message;
  }

  return result;
}

// ─── Main handler ─────────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.profile.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Only super admin can view diagnostics' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const check = searchParams.get('check') || 'all';

    const result = { success: true, checked_at: new Date().toISOString() };

    if (check === 'shopify' || check === 'all') result.shopify = await checkShopify();
    if (check === 'leopards' || check === 'all') result.leopards = await checkLeopards();
    if (check === 'postex' || check === 'all') result.postex = await checkPostEx();
    if (check === 'kangaroo' || check === 'all') result.kangaroo = await checkKangaroo();
    if (check === 'system' || check === 'all') result.system = await checkSystem();

    return NextResponse.json(result);
  } catch (error) {
    console.error('[diagnostics] error:', error);
    return NextResponse.json(
      { success: false, error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}
