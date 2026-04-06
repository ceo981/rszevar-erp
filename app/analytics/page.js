'use client';
import { useState, useEffect, useRef } from 'react';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';
const fmt = n => `Rs ${Number(n || 0).toLocaleString()}`;
const fmtK = n => n >= 1000000 ? `Rs ${(n/1000000).toFixed(1)}M` : n >= 1000 ? `Rs ${(n/1000).toFixed(0)}K` : fmt(n);

function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fff' }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>{sub}</div>}
        </div>
        {icon && <span style={{ fontSize: 22 }}>{icon}</span>}
      </div>
    </div>
  );
}

// ── Simple bar chart (pure CSS/SVG, no library needed) ────────
function BarChart({ data, valueKey, labelKey, color, title, formatValue }) {
  if (!data || data.length === 0) return <div style={{ color: '#444', padding: 20, textAlign: 'center' }}>No data</div>;
  const max = Math.max(...data.map(d => d[valueKey] || 0)) || 1;
  const fmt2 = formatValue || (v => v);

  return (
    <div>
      {title && <div style={{ fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 90, fontSize: 11, color: '#666', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d[labelKey]}
            </div>
            <div style={{ flex: 1, background: '#1a1a1a', borderRadius: 4, height: 22, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${(d[valueKey] / max) * 100}%`,
                background: color || gold,
                borderRadius: 4,
                transition: 'width 0.5s ease',
                minWidth: d[valueKey] > 0 ? 4 : 0,
              }} />
            </div>
            <div style={{ width: 80, fontSize: 11, color: '#888', flexShrink: 0 }}>{fmt2(d[valueKey])}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Line chart (SVG) ──────────────────────────────────────────
function LineChart({ data, title }) {
  if (!data || data.length < 2) return <div style={{ color: '#444', padding: 20, textAlign: 'center' }}>Not enough data</div>;

  const W = 600, H = 160, PAD = { t: 10, r: 20, b: 30, l: 50 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const maxRev = Math.max(...data.map(d => d.revenue)) || 1;
  const maxOrd = Math.max(...data.map(d => d.orders)) || 1;

  const revPoints = data.map((d, i) => ({
    x: PAD.l + (i / (data.length - 1)) * iW,
    y: PAD.t + iH - (d.revenue / maxRev) * iH,
    revenue: d.revenue,
    orders: d.orders,
    date: d.date,
  }));

  const revPath = revPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const fillPath = `${revPath} L ${revPoints[revPoints.length-1].x} ${PAD.t + iH} L ${revPoints[0].x} ${PAD.t + iH} Z`;

  // X axis labels — show every nth
  const step = Math.ceil(data.length / 6);
  const xLabels = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  return (
    <div>
      {title && <div style={{ fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={PAD.t + iH * (1-t)} x2={PAD.l + iW} y2={PAD.t + iH * (1-t)} stroke="#1a1a1a" strokeWidth="1" />
            <text x={PAD.l - 6} y={PAD.t + iH * (1-t) + 4} fill="#444" fontSize="10" textAnchor="end">
              {fmtK(maxRev * t)}
            </text>
          </g>
        ))}
        {/* Fill */}
        <path d={fillPath} fill={gold} opacity="0.08" />
        {/* Line */}
        <path d={revPath} fill="none" stroke={gold} strokeWidth="2" strokeLinejoin="round" />
        {/* Dots */}
        {revPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={gold} />
        ))}
        {/* X labels */}
        {xLabels.map((d, i) => {
          const idx = data.indexOf(d);
          const x = PAD.l + (idx / (data.length - 1)) * iW;
          return (
            <text key={i} x={x} y={H - 6} fill="#555" fontSize="9" textAnchor="middle">
              {d.date?.slice(5)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ── Donut chart ───────────────────────────────────────────────
function DonutChart({ data, title }) {
  if (!data || data.length === 0) return null;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const colors = [gold, '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#f97316', '#06b6d4'];
  let cumulative = 0;

  const slices = data.map((d, i) => {
    const pct = d.value / total;
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    cumulative += pct;
    const endAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    const r = 60, cx = 80, cy = 80;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = pct > 0.5 ? 1 : 0;
    return { ...d, path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`, color: colors[i % colors.length], pct };
  });

  return (
    <div>
      {title && <div style={{ fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <svg viewBox="0 0 160 160" style={{ width: 120, flexShrink: 0 }}>
          {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} opacity="0.85" />)}
          <circle cx="80" cy="80" r="35" fill="#0f0f0f" />
          <text x="80" y="76" fill="#fff" fontSize="12" fontWeight="700" textAnchor="middle">{data.length}</text>
          <text x="80" y="90" fill="#555" fontSize="9" textAnchor="middle">couriers</text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {slices.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              <span style={{ color: '#888' }}>{s.label}</span>
              <span style={{ color: '#fff', fontWeight: 600, marginLeft: 'auto' }}>{s.value}</span>
              <span style={{ color: '#555', fontSize: 11 }}>({(s.pct * 100).toFixed(0)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Analytics Page ───────────────────────────────────────
export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('30');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics?range=${range}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [range]);

  const s = data?.summary || {};

  const statusData = [
    { label: 'Delivered', value: s.delivered_count || 0, color: '#22c55e', bg: '#22c55e22' },
    { label: 'Pending', value: s.pending_count || 0, color: '#fb923c', bg: '#fb923c22' },
    { label: 'RTO', value: s.rto_count || 0, color: '#ef4444', bg: '#ef444422' },
    { label: 'Cancelled', value: s.cancelled_count || 0, color: '#555', bg: '#55555522' },
  ];

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff', padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' }}>Analytics</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>Sales performance & insights</p>
        </div>
        <div style={{ display: 'flex', gap: 4, background: '#0a0a0a', padding: 4, borderRadius: 9 }}>
          {[['7', '7 Days'], ['30', '30 Days'], ['60', '60 Days'], ['90', '90 Days']].map(([v, l]) => (
            <button key={v} onClick={() => setRange(v)}
              style={{ background: range === v ? '#1e1e1e' : 'transparent', border: `1px solid ${range === v ? '#2a2a2a' : 'transparent'}`, borderRadius: 7, padding: '6px 14px', fontSize: 12, color: range === v ? gold : '#555', fontWeight: range === v ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#444' }}>Loading analytics...</div>
      ) : (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
            <StatCard label="Total Orders" value={s.total_orders || 0} icon="📋" color={gold} />
            <StatCard label="Total Revenue" value={fmtK(s.total_revenue)} sub="COD value" icon="💰" color="#22c55e" />
            <StatCard label="Delivered" value={s.delivered_count || 0} sub={`${s.delivery_rate}% rate`} icon="✅" color="#22c55e" />
            <StatCard label="RTO" value={s.rto_count || 0} sub={`${s.rto_rate}% rate`} icon="↩️" color="#ef4444" />
            <StatCard label="Avg Order" value={fmt(s.avg_order_value)} icon="📊" color="#3b82f6" />
            <StatCard label="COD Delivered" value={fmtK(s.delivered_revenue)} sub="collected" icon="🏦" color={gold} />
          </div>

          {/* Status breakdown */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
            {statusData.map(st => (
              <div key={st.label} style={{ background: st.bg, border: `1px solid ${st.color}33`, borderRadius: 8, padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: st.color, fontWeight: 700, fontSize: 16 }}>{st.value}</span>
                <span style={{ color: st.color, fontSize: 12 }}>{st.label}</span>
              </div>
            ))}
          </div>

          {/* Revenue trend */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '20px 24px', marginBottom: 20 }}>
            <LineChart data={data?.daily || []} title={`Revenue Trend — Last ${range} Days`} />
          </div>

          {/* City + Products row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '20px 24px' }}>
              <BarChart
                data={data?.cities || []}
                valueKey="orders"
                labelKey="city"
                color={gold}
                title="Top Cities by Orders"
                formatValue={v => `${v} orders`}
              />
            </div>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '20px 24px' }}>
              <BarChart
                data={data?.cities || []}
                valueKey="revenue"
                labelKey="city"
                color="#3b82f6"
                title="Top Cities by Revenue"
                formatValue={v => fmtK(v)}
              />
            </div>
          </div>

          {/* Top Products + Couriers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '20px 24px' }}>
              <BarChart
                data={data?.top_products || []}
                valueKey="qty"
                labelKey="title"
                color="#a855f7"
                title="Top Products by Units Sold"
                formatValue={v => `${v} pcs`}
              />
            </div>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '20px 24px' }}>
              <DonutChart
                data={(data?.couriers || []).map(c => ({ label: c.courier, value: c.orders }))}
                title="Orders by Courier"
              />
              <div style={{ marginTop: 16 }}>
                {(data?.couriers || []).map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid #1a1a1a`, fontSize: 12 }}>
                    <span style={{ color: '#888' }}>{c.courier}</span>
                    <span style={{ color: '#22c55e' }}>{c.delivered} delivered</span>
                    <span style={{ color: '#ef4444' }}>{c.rto} RTO</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Daily table */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${border}`, fontWeight: 600, fontSize: 14 }}>Daily Breakdown</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${border}` }}>
                    {['Date', 'Orders', 'Revenue', 'Delivered', 'RTO'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...(data?.daily || [])].reverse().map((d, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '10px 16px', color: gold }}>{d.date}</td>
                      <td style={{ padding: '10px 16px', color: '#fff' }}>{d.orders}</td>
                      <td style={{ padding: '10px 16px', color: '#22c55e', fontWeight: 600 }}>{fmt(d.revenue)}</td>
                      <td style={{ padding: '10px 16px', color: '#22c55e' }}>{d.delivered}</td>
                      <td style={{ padding: '10px 16px', color: '#ef4444' }}>{d.rto}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
