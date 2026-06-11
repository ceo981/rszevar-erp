'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useUrlTab } from '@/lib/useUrlTab';
import { useUser } from '@/context/UserContext';

// ════════════════════════════════════════════════════════════════════════════
// RS ZEVAR ERP — Bot Brain (Knowledge Base manager)
// /bot-knowledge?tab=responses | ?tab=knowledge   (shareable via useUrlTab)
// Edit the bot's tone templates + business knowledge WITHOUT redeploy.
// Mobile-first: cards stack, tab bar scrolls, forms use auto-fit grids.
// ════════════════════════════════════════════════════════════════════════════

const gold = 'var(--gold)';
const card = 'var(--bg-card)';
const border = 'var(--border)';

const RESPONSE_CATEGORIES = ['Order', 'Delivery', 'Payment', 'Complaint', 'Return', 'Refund', 'Product', 'Packaging', 'Address', 'Logistics', 'Support'];
const KNOWLEDGE_CATEGORIES = ['behaviour', 'policy', 'shipping', 'payment', 'product', 'packaging', 'company', 'collection_link'];
const TONES = ['Calm', 'Neutral', 'Friendly', 'Soft', 'Firm', 'Helpful', 'Informative'];

const CAT_COLOR = {
  behaviour: '#c084fc', policy: '#f87171', shipping: '#60a5fa', payment: '#4ade80',
  product: '#fbbf24', packaging: '#f472b6', company: '#94a3b8', collection_link: '#34d399',
  Order: '#60a5fa', Delivery: '#fbbf24', Payment: '#4ade80', Complaint: '#f87171',
  Return: '#f472b6', Refund: '#fb923c', Product: '#fbbf24', Packaging: '#f472b6',
  Address: '#94a3b8', Logistics: '#34d399', Support: '#c084fc',
};

const inputStyle = { width: '100%', background: 'var(--bg)', border: `1px solid ${border}`, color: 'var(--text)', borderRadius: 8, padding: '10px 14px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' };
const labelStyle = { display: 'block', fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontWeight: 600 };
const sectionStyle = { background: card, border: `1px solid ${border}`, borderRadius: 12, padding: 20, marginBottom: 16 };
const btnGold = { background: 'linear-gradient(135deg, var(--gold) 0%, #b8975d 100%)', border: `1px solid ${gold}`, color: 'var(--text)', borderRadius: 8, padding: '9px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost = { background: 'transparent', border: `1px solid ${border}`, color: 'var(--text2)', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };

function Badge({ children, color = '#888' }) {
  return <span style={{ display: 'inline-block', background: color + '22', color, border: `1px solid ${color}44`, padding: '2px 9px', borderRadius: 5, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>;
}

function Toggle({ value, onChange, disabled }) {
  return (
    <div onClick={() => !disabled && onChange(!value)} style={{ width: 40, height: 22, borderRadius: 11, background: value ? '#22c55e' : '#444', position: 'relative', transition: 'all 0.2s', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 2, left: value ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'all 0.2s' }} />
    </div>
  );
}

const EMPTY_RESPONSE = { kind: 'response', category: 'Order', situation: '', trigger_keywords: '', reply_en: '', reply_ru: '', tone: 'Friendly', notes: '', is_active: true };
const EMPTY_KNOWLEDGE = { kind: 'knowledge', category: 'policy', title: '', content: '', keywords: '', priority: 50, is_active: true };

export default function BotKnowledgePage() {
  const { isSuperAdmin } = useUser();
  const [tab, setTab] = useUrlTab('tab', 'responses');

  const [responses, setResponses] = useState([]);
  const [knowledge, setKnowledge] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');

  const [form, setForm] = useState(null);     // null = closed; else the editing object
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const showMsg = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/bot-knowledge')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) { setResponses(d.responses || []); setKnowledge(d.knowledge || []); }
        else showMsg('error', d.error || 'Load failed');
        setLoading(false);
      })
      .catch((e) => { showMsg('error', e.message); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  // reset filters/form when switching tab
  useEffect(() => { setSearch(''); setCatFilter('all'); setForm(null); setEditingId(null); }, [tab]);

  const isResp = tab === 'responses';
  const rows = isResp ? responses : knowledge;
  const cats = isResp ? RESPONSE_CATEGORIES : KNOWLEDGE_CATEGORIES;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter((r) => {
      if (catFilter !== 'all' && r.category !== catFilter) return false;
      if (!q) return true;
      const hay = isResp
        ? `${r.situation} ${r.trigger_keywords} ${r.reply_en} ${r.reply_ru} ${r.notes}`
        : `${r.title} ${r.content} ${r.keywords}`;
      return hay.toLowerCase().includes(q);
    });
  }, [rows, search, catFilter, isResp]);

  const openNew = () => { setEditingId(null); setForm(isResp ? { ...EMPTY_RESPONSE } : { ...EMPTY_KNOWLEDGE }); };
  const openEdit = (row) => { setEditingId(row.id); setForm({ ...row, kind: isResp ? 'response' : 'knowledge' }); };

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/bot-knowledge', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { ...form, id: editingId } : form),
      });
      const d = await r.json();
      if (d.success) { showMsg('success', `✓ ${editingId ? 'Updated' : 'Added'}`); setForm(null); setEditingId(null); load(); }
      else showMsg('error', `✗ ${d.error}`);
    } catch (e) { showMsg('error', `✗ ${e.message}`); }
    setSaving(false);
  };

  const toggleActive = async (row) => {
    try {
      const r = await fetch('/api/bot-knowledge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: isResp ? 'response' : 'knowledge', id: row.id, is_active: !row.is_active }),
      });
      const d = await r.json();
      if (d.success) load(); else showMsg('error', `✗ ${d.error}`);
    } catch (e) { showMsg('error', `✗ ${e.message}`); }
  };

  const del = async (row) => {
    const label = isResp ? row.situation : row.title;
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/bot-knowledge?kind=${isResp ? 'response' : 'knowledge'}&id=${row.id}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) { showMsg('success', '✓ Deleted'); load(); } else showMsg('error', `✗ ${d.error}`);
    } catch (e) { showMsg('error', `✗ ${e.message}`); }
  };

  return (
    <div style={{ padding: '20px 16px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: gold, fontWeight: 800 }}>🤖 Bot Brain</h1>
        <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4, lineHeight: 1.5 }}>
          Customer chatbot ka dimaag. Yahan se replies + business rules edit karo — bina deploy ke. Yehi knowledge website chat aur ERP WhatsApp dono ko chalayegi.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
        {[{ id: 'responses', label: `💬 Responses (${responses.length})` }, { id: 'knowledge', label: `📚 Knowledge (${knowledge.length})` }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            ...btnGhost, whiteSpace: 'nowrap',
            border: `1px solid ${tab === t.id ? gold : border}`,
            color: tab === t.id ? gold : 'var(--text2)',
            background: tab === t.id ? 'rgba(212,175,110,0.08)' : 'transparent',
          }}>{t.label}</button>
        ))}
      </div>

      {msg && (
        <div style={{ padding: '9px 14px', borderRadius: 8, fontSize: 12, marginBottom: 12, background: msg.type === 'success' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)', border: `1px solid ${msg.type === 'success' ? '#4ade80' : '#f87171'}`, color: msg.type === 'success' ? '#4ade80' : '#f87171' }}>
          {msg.text}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search..." style={{ ...inputStyle, flex: '1 1 180px', minWidth: 0 }} />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ ...inputStyle, width: 'auto', flex: '0 0 auto' }}>
          <option value="all">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {isSuperAdmin && <button onClick={openNew} style={btnGold}>+ Add</button>}
      </div>

      {/* Editor form */}
      {form && (
        <div style={{ ...sectionStyle, border: `1px solid ${gold}` }}>
          <div style={{ fontSize: 13, color: gold, fontWeight: 700, marginBottom: 14 }}>{editingId ? 'Edit' : 'New'} {isResp ? 'Response' : 'Knowledge'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div>
              <label style={labelStyle}>Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inputStyle}>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {isResp ? (
              <>
                <div>
                  <label style={labelStyle}>Tone</label>
                  <select value={form.tone || ''} onChange={(e) => setForm({ ...form, tone: e.target.value })} style={inputStyle}>
                    {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Situation</label>
                  <input value={form.situation || ''} onChange={(e) => setForm({ ...form, situation: e.target.value })} placeholder="e.g. COD inquiry" style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Trigger keywords (comma / slash separated)</label>
                  <input value={form.trigger_keywords || ''} onChange={(e) => setForm({ ...form, trigger_keywords: e.target.value })} placeholder="cod available / cash on delivery" style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Reply — English</label>
                  <textarea value={form.reply_en || ''} onChange={(e) => setForm({ ...form, reply_en: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Reply — Roman Urdu</label>
                  <textarea value={form.reply_ru || ''} onChange={(e) => setForm({ ...form, reply_ru: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Notes (internal)</label>
                  <input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. First-time buyer reassurance" style={inputStyle} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label style={labelStyle}>Priority (higher = more important)</label>
                  <input type="number" value={form.priority ?? 0} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Title</label>
                  <input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Return & Exchange policy" style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Content</label>
                  <textarea value={form.content || ''} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Keywords</label>
                  <input value={form.keywords || ''} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="return exchange refund 10 days" style={inputStyle} />
                </div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)' }}>
              <Toggle value={!!form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
              {form.is_active ? 'Active' : 'Inactive'}
            </label>
            <div style={{ flex: 1 }} />
            <button onClick={() => { setForm(null); setEditingId(null); }} style={btnGhost}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ ...btnGold, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : (editingId ? 'Save' : 'Add')}</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 50, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Kuch nahi mila.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((row) => (
            <div key={row.id} style={{ ...sectionStyle, padding: 14, marginBottom: 0, opacity: row.is_active ? 1 : 0.55 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 8 }}>
                <Badge color={CAT_COLOR[row.category] || '#888'}>{row.category}</Badge>
                {isResp && row.tone && <Badge color="#94a3b8">{row.tone}</Badge>}
                {!isResp && <Badge color="#94a3b8">P{row.priority}</Badge>}
                {!row.is_active && <Badge color="#f87171">inactive</Badge>}
                <div style={{ flex: 1 }} />
                {isSuperAdmin && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Toggle value={!!row.is_active} onChange={() => toggleActive(row)} />
                    <button onClick={() => openEdit(row)} style={{ ...btnGhost, padding: '5px 10px' }}>Edit</button>
                    <button onClick={() => del(row)} style={{ ...btnGhost, padding: '5px 10px', color: '#f87171', borderColor: '#f8717155' }}>✕</button>
                  </div>
                )}
              </div>

              {isResp ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{row.situation}</div>
                  {row.trigger_keywords && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>🔑 {row.trigger_keywords}</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
                    <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text2)' }}><b style={{ color: gold, fontSize: 10 }}>EN</b><br />{row.reply_en}</div>
                    <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text2)' }}><b style={{ color: gold, fontSize: 10 }}>RU</b><br />{row.reply_ru}</div>
                  </div>
                  {row.notes && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8, fontStyle: 'italic' }}>📝 {row.notes}</div>}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{row.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{row.content}</div>
                  {row.keywords && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>🔑 {row.keywords}</div>}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {!isSuperAdmin && (
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>Sirf super admin edit kar sakta hai. Aap view-only mode mein hain.</div>
      )}
    </div>
  );
}
