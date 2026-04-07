'use client';
import { useState, useRef } from 'react';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';
const fmt = n => `Rs ${Number(n || 0).toLocaleString()}`;

export default function ReportsPage() {
  const [type, setType] = useState('daily');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const reportRef = useRef();

  const generate = async () => {
    setLoading(true);
    setData(null);
    const r = await fetch(`/api/reports?type=${type}&date=${date}`);
    const d = await r.json();
    setData(d);
    setLoading(false);
  };

  const printPDF = () => {
    const content = reportRef.current?.innerHTML;
    if (!content) return;
    const win = window.open('', '_blank');
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${data?.label}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #111; padding: 32px; }
          h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; color: #1a1a1a; }
          .subtitle { font-size: 12px; color: #888; margin-bottom: 24px; }
          .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
          .stat { background: #f8f8f8; border-radius: 8px; padding: 14px 16px; border: 1px solid #e5e5e5; }
          .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 4px; }
          .stat-value { font-size: 20px; font-weight: 700; color: #111; }
          .stat-value.green { color: #16a34a; }
          .stat-value.red { color: #dc2626; }
          .stat-value.gold { color: #b8860b; }
          h2 { font-size: 14px; font-weight: 600; margin: 20px 0 10px; color: #333; border-bottom: 1px solid #e5e5e5; padding-bottom: 6px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px; }
          th { background: #f3f3f3; padding: 8px 10px; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
          td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }
          tr:last-child td { border-bottom: none; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
          .badge-green { background: #dcfce7; color: #16a34a; }
          .badge-red { background: #fee2e2; color: #dc2626; }
          .badge-orange { background: #ffedd5; color: #ea580c; }
          .badge-gray { background: #f3f4f6; color: #6b7280; }
          .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e5e5; font-size: 11px; color: #aaa; text-align: center; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <h1>RS ZEVAR — ${data?.label}</h1>
        <div class="subtitle">Generated: ${new Date().toLocaleString('en-PK')} · rszevar-erp.vercel.app</div>
        ${content}
        <div class="footer">RS ZEVAR ERP System · Confidential</div>
      </body>
      </html>
    `);
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
  };

  const s = data?.summary || {};

  const statusBadge = status => {
    const map = { delivered: 'badge-green', pending: 'badge-orange', rto: 'badge-red', returned: 'badge-red', dispatched: 'badge-orange', cancelled: 'badge-gray', confirmed: 'badge-gray' };
    return `<span class="badge ${map[status] || 'badge-gray'}">${status}</span>`;
  };

  const reportHTML = data ? `
    <div class="grid">
      <div class="stat"><div class="stat-label">Total Orders</div><div class="stat-value">${s.total_orders}</div></div>
      <div class="stat"><div class="stat-label">Total COD Value</div><div class="stat-value gold">${fmt(s.total_cod)}</div></div>
      <div class="stat"><div class="stat-label">Delivered</div><div class="stat-value green">${s.delivered} (${s.delivery_rate}%)</div></div>
      <div class="stat"><div class="stat-label">RTO</div><div class="stat-value red">${s.rto} (${s.rto_rate}%)</div></div>
      <div class="stat"><div class="stat-label">Pending</div><div class="stat-value">${s.pending}</div></div>
      <div class="stat"><div class="stat-label">Dispatched</div><div class="stat-value">${s.dispatched}</div></div>
      <div class="stat"><div class="stat-label">Delivered COD</div><div class="stat-value green">${fmt(s.delivered_cod)}</div></div>
      <div class="stat"><div class="stat-label">RTO COD Lost</div><div class="stat-value red">${fmt(s.rto_cod)}</div></div>
    </div>

    <h2>City Breakdown</h2>
    <table>
      <thead><tr><th>City</th><th>Orders</th><th>COD Value</th></tr></thead>
      <tbody>
        ${(data.city_breakdown || []).map(c => `<tr><td>${c.city}</td><td>${c.orders}</td><td>${fmt(c.cod)}</td></tr>`).join('')}
      </tbody>
    </table>

    <h2>Courier Breakdown</h2>
    <table>
      <thead><tr><th>Courier</th><th>Orders</th><th>Delivered</th><th>RTO</th></tr></thead>
      <tbody>
        ${(data.courier_breakdown || []).map(c => `<tr><td>${c.courier}</td><td>${c.orders}</td><td style="color:#16a34a">${c.delivered}</td><td style="color:#dc2626">${c.rto}</td></tr>`).join('')}
      </tbody>
    </table>

    <h2>All Orders (${(data.orders || []).length})</h2>
    <table>
      <thead><tr><th>#</th><th>Order</th><th>Customer</th><th>Phone</th><th>City</th><th>Amount</th><th>Courier</th><th>Status</th></tr></thead>
      <tbody>
        ${(data.orders || []).map((o, i) => `
          <tr>
            <td>${i+1}</td>
            <td>${o.order_number || o.shopify_order_name || o.id}</td>
            <td>${o.customer_name || '—'}</td>
            <td>${o.customer_phone || '—'}</td>
            <td>${o.customer_city || '—'}</td>
            <td>${fmt(o.total_amount)}</td>
            <td>${o.dispatched_courier || '—'}</td>
            <td>${statusBadge(o.status)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '';

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff', padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Reports</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>Daily, weekly, monthly reports — PDF download karo</p>
      </div>

      {/* Generator */}
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>Report Type</div>
            <div style={{ display: 'flex', gap: 4, background: '#0a0a0a', padding: 4, borderRadius: 8 }}>
              {['daily', 'weekly', 'monthly'].map(t => (
                <button key={t} onClick={() => setType(t)}
                  style={{ background: type === t ? '#1e1e1e' : 'transparent', border: `1px solid ${type === t ? '#333' : 'transparent'}`, borderRadius: 6, padding: '7px 16px', fontSize: 12, color: type === t ? gold : '#555', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>Date</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13 }} />
          </div>
          <button onClick={generate} disabled={loading}
            style={{ background: gold, color: '#000', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Generating...' : '📊 Generate Report'}
          </button>
          {data && (
            <button onClick={printPDF}
              style={{ background: '#1e1e1e', border: `1px solid ${border}`, color: '#fff', borderRadius: 8, padding: '10px 24px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              🖨️ Download PDF
            </button>
          )}
        </div>
      </div>

      {/* Report Preview */}
      {loading && <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>Generating report...</div>}

      {data && (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: gold }}>{data.label}</div>
            <button onClick={printPDF} style={{ background: '#22c55e22', border: '1px solid #22c55e44', color: '#22c55e', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              🖨️ Download / Print PDF
            </button>
          </div>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total Orders', value: s.total_orders, color: '#fff' },
              { label: 'Total COD', value: fmt(s.total_cod), color: gold },
              { label: 'Delivered', value: `${s.delivered} (${s.delivery_rate}%)`, color: '#22c55e' },
              { label: 'RTO', value: `${s.rto} (${s.rto_rate}%)`, color: '#ef4444' },
              { label: 'Pending', value: s.pending, color: '#fb923c' },
              { label: 'Delivered COD', value: fmt(s.delivered_cod), color: '#22c55e' },
              { label: 'RTO COD Lost', value: fmt(s.rto_cod), color: '#ef4444' },
              { label: 'Avg Order', value: fmt(s.avg_order), color: '#3b82f6' },
            ].map(st => (
              <div key={st.label} style={{ background: card, border: `1px solid ${border}`, borderRadius: 9, padding: '14px 16px' }}>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{st.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: st.color }}>{st.value}</div>
              </div>
            ))}
          </div>

          {/* City + Courier tables */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, fontWeight: 600, fontSize: 13 }}>City Breakdown</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ borderBottom: `1px solid ${border}` }}>{['City', 'Orders', 'COD'].map(h => <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#555' }}>{h}</th>)}</tr></thead>
                <tbody>{(data.city_breakdown || []).map((c, i) => <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}><td style={{ padding: '8px 12px', color: '#ccc' }}>{c.city}</td><td style={{ padding: '8px 12px', color: '#fff' }}>{c.orders}</td><td style={{ padding: '8px 12px', color: gold }}>{fmt(c.cod)}</td></tr>)}</tbody>
              </table>
            </div>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, fontWeight: 600, fontSize: 13 }}>Courier Breakdown</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ borderBottom: `1px solid ${border}` }}>{['Courier', 'Orders', 'Delivered', 'RTO'].map(h => <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#555' }}>{h}</th>)}</tr></thead>
                <tbody>{(data.courier_breakdown || []).map((c, i) => <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}><td style={{ padding: '8px 12px', color: '#ccc' }}>{c.courier}</td><td style={{ padding: '8px 12px' }}>{c.orders}</td><td style={{ padding: '8px 12px', color: '#22c55e' }}>{c.delivered}</td><td style={{ padding: '8px 12px', color: '#ef4444' }}>{c.rto}</td></tr>)}</tbody>
              </table>
            </div>
          </div>

          {/* Orders table preview */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, fontWeight: 600, fontSize: 13 }}>All Orders ({(data.orders || []).length})</div>
            <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0 }}>
                  <tr style={{ borderBottom: `1px solid ${border}`, background: '#0a0a0a' }}>
                    {['Order', 'Customer', 'Phone', 'City', 'Amount', 'Courier', 'Status'].map(h => <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#555' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(data.orders || []).map((o, i) => {
                    const sc = { delivered: '#22c55e', pending: '#fb923c', rto: '#ef4444', returned: '#ef4444', dispatched: '#a855f7', cancelled: '#555' };
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <td style={{ padding: '8px 12px', color: gold }}>{o.order_number || o.shopify_order_name || o.id}</td>
                        <td style={{ padding: '8px 12px', color: '#ccc' }}>{o.customer_name}</td>
                        <td style={{ padding: '8px 12px', color: '#666' }}>{o.customer_phone}</td>
                        <td style={{ padding: '8px 12px', color: '#888' }}>{o.customer_city}</td>
                        <td style={{ padding: '8px 12px', color: '#fff', fontWeight: 600 }}>{fmt(o.total_amount)}</td>
                        <td style={{ padding: '8px 12px', color: '#666' }}>{o.dispatched_courier || '—'}</td>
                        <td style={{ padding: '8px 12px' }}><span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: (sc[o.status] || '#555')+'22', color: sc[o.status] || '#555' }}>{o.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Hidden HTML for PDF */}
          <div ref={reportRef} style={{ display: 'none' }} dangerouslySetInnerHTML={{ __html: reportHTML }} />
        </>
      )}
    </div>
  );
}
