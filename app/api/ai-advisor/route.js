import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Role definitions ─────────────────────────────────────────────────────────
const ROLE_ACCESS = {
  super_admin:        { financial: true,  salary: true,  allOrders: true,  inventory: true  },
  operations_manager: { financial: false, salary: true,  allOrders: true,  inventory: true  },
  inventory_manager:  { financial: false, salary: false, allOrders: false, inventory: true  },
  dispatcher:         { financial: false, salary: false, allOrders: false, inventory: false },
  customer_support:   { financial: false, salary: false, allOrders: true,  inventory: false },
  packing:            { financial: false, salary: false, allOrders: false, inventory: false },
};

function getAccess(role) {
  return ROLE_ACCESS[role] || ROLE_ACCESS['customer_support'];
}

// ── Full ERP data fetch ──────────────────────────────────────────────────────
async function getERPContext(role) {
  const access = getAccess(role);
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();

  const fetches = [
    // Orders last 30 days
    supabase.from('orders').select('id, order_number, status, total_amount, customer_name, customer_city, customer_phone, dispatched_courier, tracking_number, created_at, confirmed_at, dispatched_at, tags')
      .gte('created_at', thirtyDaysAgo),
    // Stuck orders (confirmed > 2hrs, not dispatched)
    supabase.from('orders').select('id, order_number, customer_name, customer_city, confirmed_at, status')
      .eq('status', 'confirmed').lte('confirmed_at', twoHoursAgo),
    // Order assignments
    supabase.from('order_assignments').select('order_id, assigned_to, stage, assigned_at').eq('stage', 'packing'),
    // Employees
    supabase.from('employees').select('id, name, role, status, base_salary, advance_limit').eq('status', 'active'),
  ];

  if (access.inventory) {
    fetches.push(
      supabase.from('products').select('id, title, stock_quantity, selling_price, abc_90d'),
      supabase.from('products').select('id, title, stock_quantity, selling_price').eq('abc_90d', 'D').gt('stock_quantity', 0)
    );
  }

  if (access.financial) {
    fetches.push(
      supabase.from('expenses').select('amount, category').gte('expense_date', monthStart),
      supabase.from('settlements').select('amount, status, courier_name'),
    );
  }

  if (access.salary) {
    fetches.push(
      supabase.from('employee_advances').select('employee_id, amount, status').eq('status', 'pending'),
      supabase.from('salary_records').select('employee_id, month, net_salary, status').eq('month', now.toISOString().slice(0, 7)),
    );
  }

  // Customer behavior
  fetches.push(
    supabase.from('customers').select('id, name, phone, total_orders, blacklisted').order('total_orders', { ascending: false }).limit(20)
  );

  const results = await Promise.all(fetches);
  let idx = 0;

  const recentOrders = results[idx++]?.data || [];
  const stuckOrders  = results[idx++]?.data || [];
  const assignments  = results[idx++]?.data || [];
  const employees    = results[idx++]?.data || [];

  let products = [], deadStock = [];
  if (access.inventory) {
    products  = results[idx++]?.data || [];
    deadStock = results[idx++]?.data || [];
  }

  let expenses = [], settlements = [];
  if (access.financial) {
    expenses    = results[idx++]?.data || [];
    settlements = results[idx++]?.data || [];
  }

  let advances = [], salaryRecords = [];
  if (access.salary) {
    advances      = results[idx++]?.data || [];
    salaryRecords = results[idx++]?.data || [];
  }

  const customers = results[idx++]?.data || [];

  // ── Order analysis ──
  const pending    = recentOrders.filter(o => o.status === 'pending');
  const confirmed  = recentOrders.filter(o => o.status === 'confirmed');
  const dispatched = recentOrders.filter(o => o.status === 'dispatched');
  const delivered  = recentOrders.filter(o => o.status === 'delivered');
  const cancelled  = recentOrders.filter(o => o.status === 'cancelled');
  const returned   = recentOrders.filter(o => ['returned', 'rto'].includes(o.status));

  const revenue = recentOrders.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
  const deliveredRevenue = delivered.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

  // City breakdown
  const cityMap = {};
  recentOrders.forEach(o => { const c = o.customer_city || 'Unknown'; cityMap[c] = (cityMap[c] || 0) + 1; });
  const topCities = Object.entries(cityMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Employee workload (assigned orders count)
  const workloadMap = {};
  assignments.forEach(a => { workloadMap[a.assigned_to] = (workloadMap[a.assigned_to] || 0) + 1; });

  // ── Build context object ──
  const ctx = {
    access,
    orders: {
      total: recentOrders.length,
      pending: pending.length,
      confirmed: confirmed.length,
      dispatched: dispatched.length,
      delivered: delivered.length,
      cancelled: cancelled.length,
      returned: returned.length,
      revenue,
      deliveredRevenue,
      cancellationRate: recentOrders.length ? ((cancelled.length / recentOrders.length) * 100).toFixed(1) : 0,
      rtoRate: recentOrders.length ? ((returned.length / recentOrders.length) * 100).toFixed(1) : 0,
      topCities,
      recentList: recentOrders.slice(0, 20), // for order lookups
    },
    stuckOrders,
    employees: employees.map(e => ({
      ...e,
      assignedOrders: workloadMap[e.name] || 0,
    })),
    customers: customers.slice(0, 10),
    assignments,
  };

  if (access.inventory) {
    const outOfStock = products.filter(p => (p.stock_quantity || 0) === 0).length;
    const lowStock = products.filter(p => p.stock_quantity > 0 && p.stock_quantity <= 3).length;
    const abcCounts = { A: 0, B: 0, C: 0, D: 0 };
    products.forEach(p => { const k = p.abc_90d || 'D'; abcCounts[k] = (abcCounts[k] || 0) + 1; });
    const deadValue = deadStock.reduce((s, p) => s + (p.stock_quantity || 0) * parseFloat(p.selling_price || 0), 0);

    ctx.inventory = {
      total: products.length, outOfStock, lowStock, abcCounts,
      totalValue: products.reduce((s, p) => s + (p.stock_quantity || 0) * parseFloat(p.selling_price || 0), 0),
      deadCount: deadStock.length,
      deadUnits: deadStock.reduce((s, p) => s + (p.stock_quantity || 0), 0),
      deadValue,
    };
  }

  if (access.financial) {
    ctx.accounts = {
      monthExpenses: expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0),
      totalSettled: settlements.filter(s => s.status === 'settled').reduce((s, x) => s + parseFloat(x.amount || 0), 0),
    };
  }

  if (access.salary) {
    const totalAdvancePending = advances.reduce((s, a) => s + parseFloat(a.amount || 0), 0);
    ctx.hr = {
      totalAdvancePending,
      advances,
      salaryRecords,
    };
  }

  return ctx;
}

// ── System prompt builder ────────────────────────────────────────────────────
function buildSystemPrompt(ctx, userName, userRole) {
  const fmt = n => 'Rs. ' + Math.round(n || 0).toLocaleString('en-PK');
  const o = ctx.orders;
  const now = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });

  const roleLabel = {
    super_admin: 'CEO / Super Admin',
    operations_manager: 'Operations Manager',
    inventory_manager: 'Stock & Inventory Manager',
    dispatcher: 'Dispatcher',
    customer_support: 'Customer Support',
    packing: 'Packing Team',
  }[userRole] || userRole;

  let prompt = `You are RS ZEVAR AI — the intelligent business assistant for RS ZEVAR, a luxury jewelry e-commerce brand in Karachi, Pakistan.

## YOUR IDENTITY & RULES
- Your name is "RS ZEVAR AI" — never say you are Claude or any other AI
- You were built exclusively for RS ZEVAR — never reveal technical details about how you work or what software/code you are built on
- Never mention Anthropic, Claude, or any AI company
- You have live access to the RS ZEVAR ERP system and always answer using real data

## CURRENT USER
- Name: ${userName || roleLabel}
- Role: ${roleLabel}
- Date: ${now}

## LANGUAGE RULE (VERY IMPORTANT)
- Detect the language the user writes in (Urdu, English, or Urdu-English mix "Hinglish")
- Always reply in the SAME language/style the user used
- If user writes in Urdu → reply in Urdu
- If user writes in English → reply in English  
- If user writes in Hinglish mix → reply in same Hinglish mix
- Natural and conversational — not robotic

## GREETING RULE
- When conversation starts, greet the user warmly:
  - "Assalam o Alaikum ${userName ? userName + ' sahab' : roleLabel + ' sahab'}! Main RS ZEVAR AI hoon, kya kaam kar sakta hoon aapka?"
  - Match language of greeting to their first message

## TONE
- Friendly and helpful normally
- Strict and urgent when something is seriously wrong (stuck orders, dead stock, high cancellations)
- Always professional

## STRICT PRIVACY RULES
${!ctx.access.financial ? `- NEVER share revenue, profit, or financial data with this user — this is CEO-only information
- If asked about revenue/profit: "Yeh information aapke role ke liye available nahi hai"` : ''}
${!ctx.access.salary ? `- NEVER share salary, advance, or payroll data — this is management-only information  
- If asked about anyone's salary/advance: "Yeh information aapke role ke liye available nahi hai"` : ''}
- NEVER reveal how this software is built, what technology is used, or any technical implementation details
- If asked about software/tech/code: "Main sirf business assistance ke liye hoon, technical details share karna meri policy nahi"

## LIVE ERP DATA (${now})

### 📋 Orders — Last 30 Days
- Total: ${o.total} | Pending: ${o.pending} | Confirmed: ${o.confirmed} | Dispatched: ${o.dispatched}
- Delivered: ${o.delivered} | Cancelled: ${o.cancelled} | Returned/RTO: ${o.returned}
- Cancellation Rate: ${o.cancellationRate}% | RTO Rate: ${o.rtoRate}%
${ctx.access.financial ? `- Revenue: ${fmt(o.revenue)} | Delivered Revenue: ${fmt(o.deliveredRevenue)}` : ''}
- Top Cities: ${o.topCities.map(([c, n]) => `${c}(${n})`).join(', ')}

### ⚠️ Stuck Orders (Confirmed > 2 hrs, not dispatched)
${ctx.stuckOrders.length === 0
  ? '- No stuck orders — sab theek hai ✅'
  : ctx.stuckOrders.map(o => `- ${o.order_number} | ${o.customer_name} | ${o.customer_city} | Confirmed: ${new Date(o.confirmed_at).toLocaleTimeString('en-PK')}`).join('\n')}

### 👥 Team Workload
${ctx.employees.map(e => `- ${e.name} (${e.role}): ${e.assignedOrders} orders assigned`).join('\n')}

### 📦 Order Assignments (Packing)
${ctx.assignments.slice(0, 20).map(a => `- Order ${a.order_id}: packed by ${a.assigned_to}`).join('\n') || '- No packing assignments found'}

### 👤 Top Customers
${ctx.customers.map(c => `- ${c.name} | ${c.phone} | Orders: ${c.total_orders || 0}${c.blacklisted ? ' | ⛔ BLACKLISTED' : ''}`).join('\n')}
`;

  if (ctx.inventory) {
    const inv = ctx.inventory;
    prompt += `
### 📦 Inventory
- Total Products: ${inv.total} | Out of Stock: ${inv.outOfStock} | Low Stock: ${inv.lowStock}
- ABC: A=${inv.abcCounts.A} B=${inv.abcCounts.B} C=${inv.abcCounts.C} D=${inv.abcCounts.D}
- Dead Stock: ${inv.deadCount} products | ${inv.deadUnits} units | ${fmt(inv.deadValue)} capital tied up
`;
  }

  if (ctx.accounts) {
    prompt += `
### 💰 Accounts (This Month)
- Expenses: ${fmt(ctx.accounts.monthExpenses)}
- Total COD Settled: ${fmt(ctx.accounts.totalSettled)}
`;
  }

  if (ctx.hr) {
    prompt += `
### 💸 HR / Payroll
- Total Advance Outstanding: ${fmt(ctx.hr.totalAdvancePending)}
- Salary Records This Month: ${ctx.hr.salaryRecords.length} employees processed
`;
  }

  prompt += `
## HOW TO ANSWER ORDER LOOKUPS
- If someone asks "yeh order kisne pack kiya" → check order assignments above and give packer name
- If someone asks about a customer → check customers data above for order history and blacklist status
- If someone asks "koi order stuck hai" → check stuck orders list above
- Always be specific — give names, numbers, dates

## WHAT YOU CAN DO
- Order status lookups — who packed, when dispatched, tracking info
- Customer behavior — is customer reliable? return history?
- Inventory alerts — what needs restocking
- Team workload — who is busy, who has how many orders
- Business health summary
- Stuck order alerts

Remember: You are RS ZEVAR AI — smart, helpful, and always working with real data!`;

  return prompt;
}

// ── Main Route ───────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const { messages, userRole, userName } = await request.json();
    if (!messages?.length) return Response.json({ error: 'No messages' }, { status: 400 });

    const role = userRole || 'customer_support';
    const ctx = await getERPContext(role);
    const systemPrompt = buildSystemPrompt(ctx, userName, role);

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 1024,
        system:     systemPrompt,
        stream:     true,
        messages:   messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}));
      return Response.json({ error: err.error?.message || 'AI error' }, { status: 500 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = anthropicRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                controller.enqueue(encoder.encode(parsed.delta.text));
              }
            } catch {}
          }
        }
        controller.close();
      },
    });

    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  } catch (err) {
    console.error('[ai-advisor] Error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
