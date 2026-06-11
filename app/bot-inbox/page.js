'use client';
import { useState, useEffect, useCallback } from 'react';
import { useUrlTab } from '@/lib/useUrlTab';
import { useUser } from '@/context/UserContext';

// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR ERP — Bot Inbox
// /bot-inbox?filter=needs|all|resolved
// Review customer chats from the storefront bot. "Needs reply" = handoffs the
// bot escalated. Use these gaps to add answers in Bot Brain so the bot improves.
// ════════════════════════════════════════════════════════════════════════════

const gold = 'var(--gold)';
const card = 'var(--bg-card)';
const border = 'var(--border)';

const sectionStyle = { background: card, border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginBottom: 10 };
const btnGhost = { background: 'transparent', border: `1px solid ${border}`, color: 'var(--text2)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };

function Badge({ children, color = '#888' }) {
  return <span style={{ display: 'inline-block', background: color + '22', color, border: `1px solid ${color}44`, padding: '2px 9px', borderRadius: 5, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>;
}
const timeAgo = (iso) => {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
};

export default function BotInboxPage() {
  const { isSuperAdmin } = useUser();
  const [filter, setFilter] = useUrlTab('filter', 'needs');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ needs: 0, resolved: 0 });
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState(null);

  const showMsg = (t, x) => { setMsg({ t, x }); setTimeout(() => setMsg(null), 3500); };

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/bot-inbox?filter=' + filter)
      .then((r) => r.json())
      .then((d) => { if (d.success) { setRows(d.conversations || []); setCounts(d.counts || { needs: 0, resolved: 0 }); } else showMsg('error', d.error); setLoading(false); })
      .catch((e) => { showMsg('error', e.message); setLoading(false); });
  }, [filter]);

  useEffect(() => { load(); setOpenId(null); }, [load]);

  const setStatus = async (id, status) => {
    try {
      const r = await fetch('/api/bot-inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
      const d = await r.json();
      if (d.success) { showMsg('success', '✓ ' + status); load(); } else showMsg('error', d.error);
    } catch (e) { showMsg('error', e.message); }
  };

  const tabs = [
    { id: 'needs', label: `🔔 Needs reply (${counts.needs})` },
    { id: 'all', label: 'All' },
    { id: 'resolved', label: `✓ Resolved (${counts.resolved})` },
  ];

  return (
    <div style={{ padding: '20px 16px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ margin: 0, fontSize: 22, color: gold, fontWeight: 800 }}>📥 Bot Inbox</h1>
      <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4, lineHeight: 1.5 }}>
        Storefront bot ki customer chats. <b>Needs reply</b> = jahan bot ne human pe bheja (complaint/order issue). In gaps ke jawab Bot Brain mein daal ke bot behtar karte jao.
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '14px 0', overflowX: 'auto', paddingBottom: 4 }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setFilter(t.id)} style={{ ...btnGhost, whiteSpace: 'nowrap', border: `1px solid ${filter === t.id ? gold : border}`, color: filter === t.id ? gold : 'var(--text2)', background: filter === t.id ? 'rgba(212,175,110,0.08)' : 'transparent' }}>{t.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={load} style={btnGhost}>↻</button>
      </div>

      {msg && <div style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, marginBottom: 12, background: msg.t === 'success' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)', border: `1px solid ${msg.t === 'success' ? '#4ade80' : '#f87171'}`, color: msg.t === 'success' ? '#4ade80' : '#f87171' }}>{msg.x}</div>}

      {loading ? (
        <div style={{ padding: 50, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 50, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Koi conversation nahi.</div>
      ) : (
        rows.map((c) => (
          <div key={c.id} style={sectionStyle}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
              {c.handoff && <Badge color="#f87171">needs reply</Badge>}
              {c.order_ref && <Badge color={gold.replace('var(--gold)', '#c6a15b')}>{c.order_ref}</Badge>}
              <Badge color="#94a3b8">{c.channel}</Badge>
              {c.status !== 'new' && <Badge color={c.status === 'resolved' ? '#4ade80' : '#60a5fa'}>{c.status}</Badge>}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{timeAgo(c.updated_at)}</span>
            </div>
            <div style={{ fontSize: 14, color: 'var(--text)', marginTop: 8, fontWeight: 600 }}>
              {c.last_message || '(no text)'}
            </div>

            {openId === c.id && (
              <div style={{ marginTop: 12 }}>
                <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                  {(c.transcript || []).map((t, i) => (
                    <div key={i} style={{ alignSelf: t.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: t.role === 'user' ? 'rgba(198,161,91,0.18)' : 'var(--bg-card)', border: `1px solid ${border}`, borderRadius: 10, padding: '7px 11px', fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {t.text}
                    </div>
                  ))}
                </div>
                {isSuperAdmin && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button onClick={() => setStatus(c.id, 'reviewed')} style={btnGhost}>Mark reviewed</button>
                    <button onClick={() => setStatus(c.id, 'resolved')} style={{ ...btnGhost, color: '#4ade80', borderColor: '#4ade8055' }}>Mark resolved</button>
                    {c.order_ref && <a href={`/orders?search=${encodeURIComponent(c.order_ref)}`} style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block' }}>Open order</a>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
