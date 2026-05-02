'use client';
import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@/context/UserContext';

const gold  = '#c9a96e';
const card  = '#141414';
const border = '#222';

const CATEGORIES = [
  'Wrong Item', 'Missing Item', 'Damaged', 'Late Delivery',
  'Poor Quality', 'Courier Issue', 'Refund Request', 'Packing Error', 'Other'
];

const MISTAKE_BY = [
  { value: 'packer',     label: '📦 Packer',     color: '#f59e0b', desc: 'Packing team ne galti ki' },
  { value: 'dispatcher', label: '🚚 Dispatcher',  color: '#a855f7', desc: 'Dispatch mein galti hui' },
  { value: 'courier',    label: '🐆 Courier',     color: '#3b82f6', desc: 'Courier company ki galti' },
  { value: 'unknown',    label: '❓ Unknown',     color: '#555',    desc: 'Pata nahi kiski galti' },
];

const mistakeColor = v => MISTAKE_BY.find(m => m.value === v)?.color || '#555';
const mistakeLabel = v => MISTAKE_BY.find(m => m.value === v)?.label || v;

const compressImage = (file) => new Promise((resolve) => {
  const MAX = 900;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

// ── Add Complaint Modal ───────────────────────────────────────
function AddModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    order_number: '', customer_name: '', customer_phone: '',
    city: '', category: 'Wrong Item', description: '', mistake_by: 'unknown',
  });
  const [images, setImages]     = useState([]);
  const [imgLoading, setImgL]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState('');

  const handleImages = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 4 - images.length);
    if (!files.length) return;
    setImgL(true);
    const compressed = await Promise.all(files.map(f => compressImage(f)));
    setImages(prev => [...prev, ...compressed].slice(0, 4));
    setImgL(false);
    e.target.value = '';
  };

  const save = async () => {
    if (!form.customer_name || !form.description) {
      setMsg('Customer name aur description zaroori hai');
      return;
    }
    setSaving(true);
    const r = await fetch('/api/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', ...form, image_urls: images }),
    });
    const d = await r.json();
    if (d.success) { onSave(); onClose(); }
    else setMsg('Error: ' + d.error);
    setSaving(false);
  };

  const inp = { background: '#1a1a1a', border: '1px solid #222', color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none', width: '100%' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: '1px solid #222', borderRadius: 12, padding: 28, width: 480, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#ef4444' }}>📢 Log Complaint</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Order #</div>
              <input value={form.order_number} onChange={e => setForm(f => ({...f, order_number: e.target.value}))} placeholder="ZEVAR-XXXXXX" style={inp} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Customer Name</div>
              <input value={form.customer_name} onChange={e => setForm(f => ({...f, customer_name: e.target.value}))} placeholder="Customer ka naam" style={inp} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Phone</div>
              <input value={form.customer_phone} onChange={e => setForm(f => ({...f, customer_phone: e.target.value}))} placeholder="03XX-XXXXXXX" style={inp} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>City</div>
              <input value={form.city} onChange={e => setForm(f => ({...f, city: e.target.value}))} placeholder="Karachi" style={inp} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Category</div>
            <select value={form.category} onChange={e => setForm(f => ({...f, category: e.target.value}))} style={inp}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Complaint Details</div>
            <textarea value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))}
              rows={3} placeholder="Kya hua? Detail mein likho..."
              style={{ ...inp, resize: 'vertical' }} />
          </div>

          {/* Photos */}
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>📷 Photos (optional — max 4)</div>
            {images.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {images.map((src, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={src} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 7, border: '1px solid #222' }} />
                    <button onClick={() => setImages(p => p.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', border: 'none', color: '#fff', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {images.length < 4 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1a1a1a', border: '1px dashed #333', borderRadius: 8, padding: '10px 14px', cursor: imgLoading ? 'not-allowed' : 'pointer', fontSize: 13, color: imgLoading ? '#555' : '#888' }}>
                <span style={{ fontSize: 18 }}>{imgLoading ? '⟳' : '📷'}</span>
                <span>{imgLoading ? 'Compressing...' : `Photo add karo (${images.length}/4)`}</span>
                <input type="file" accept="image/*" multiple onChange={handleImages} disabled={imgLoading} style={{ display: 'none' }} />
              </label>
            )}
          </div>

          {/* Mistake By — strict rule: packer only when you are sure */}
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>⚠️ Mistake Kiski Hai? <span style={{ color: '#333', fontWeight: 400 }}>(Packer select karne se uski negative rating jayegi)</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {MISTAKE_BY.map(m => (
                <button key={m.value} onClick={() => setForm(f => ({...f, mistake_by: m.value}))} style={{
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: form.mistake_by === m.value ? 700 : 400,
                  textAlign: 'left',
                  background: form.mistake_by === m.value ? m.color + '18' : '#0a0a0a',
                  border: `1px solid ${form.mistake_by === m.value ? m.color + '66' : border}`,
                  color: form.mistake_by === m.value ? m.color : '#555',
                }}>
                  <div>{m.label}</div>
                  <div style={{ fontSize: 10, marginTop: 2, opacity: 0.7 }}>{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {msg && <div style={{ color: '#ef4444', fontSize: 12 }}>{msg}</div>}

          <button onClick={save} disabled={saving || imgLoading} style={{ background: saving ? '#7f2222' : '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving...' : '+ Log Complaint'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Complaint Detail Panel ────────────────────────────────────
function ComplaintPanel({ complaint, onClose, onSave }) {
  const { can } = useUser();
  const canDelete = can('complaints.delete');

  const [lightbox, setLightbox] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const imgs = Array.isArray(complaint.image_urls) ? complaint.image_urls : [];

  const del = async () => {
    if (!confirm('Delete this complaint?')) return;
    setDeleting(true);
    await fetch('/api/complaints', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: complaint.id }),
    });
    onSave(); onClose();
  };

  const openOrder = () => {
    if (!complaint.order_number) return;
    // Dispatch event to open this order in orders page
    window.dispatchEvent(new CustomEvent('openOrderByNumber', { detail: complaint.order_number }));
    onClose();
  };

  const mc = mistakeColor(complaint.mistake_by);
  const ml = mistakeLabel(complaint.mistake_by);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex' }}>
      {lightbox !== null && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.94)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={imgs[lightbox]} alt="" style={{ maxWidth: '90vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 8 }} />
          <div style={{ position: 'absolute', top: 18, right: 20, display: 'flex', gap: 8 }}>
            {imgs.length > 1 && (
              <>
                <button onClick={e => { e.stopPropagation(); setLightbox(l => (l - 1 + imgs.length) % imgs.length); }} style={{ background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: 18 }}>‹</button>
                <button onClick={e => { e.stopPropagation(); setLightbox(l => (l + 1) % imgs.length); }} style={{ background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: 18 }}>›</button>
              </>
            )}
            <button onClick={() => setLightbox(null)} style={{ background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
        </div>
      )}

      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.7)' }} />
      <div style={{ width: 420, background: '#0f0f0f', borderLeft: '1px solid #222', overflowY: 'auto' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 4 }}>{complaint.category}</div>
            <div style={{ fontSize: 12, color: '#555' }}>{complaint.customer_name} · {complaint.customer_phone}</div>
            {complaint.order_number && (
              <div
                onClick={openOrder}
                style={{ fontSize: 12, color: gold, marginTop: 4, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                title="Orders page mein kholo"
              >
                {complaint.order_number} ↗
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: mc + '22', color: mc, fontWeight: 600 }}>{ml}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: '20px 22px' }}>
          <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>COMPLAINT DETAILS</div>
            <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>{complaint.description}</div>
          </div>

          {complaint.city && <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>📍 {complaint.city}</div>}

          {imgs.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>📷 PHOTOS ({imgs.length})</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {imgs.map((src, i) => (
                  <img key={i} src={src} alt="" onClick={() => setLightbox(i)}
                    style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8, border: '1px solid #222', cursor: 'zoom-in' }}
                    onMouseEnter={e => e.target.style.opacity = '0.75'}
                    onMouseLeave={e => e.target.style.opacity = '1'}
                  />
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: '#444', marginBottom: 20 }}>
            Logged: {new Date(complaint.created_at).toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>

          {canDelete && (
          <button onClick={del} disabled={deleting} style={{ width: '100%', background: '#1a0000', border: '1px solid #330000', color: '#ef4444', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {deleting ? '...' : '🗑️ Delete Complaint'}
          </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Leaderboard Tab ───────────────────────────────────────────
function LeaderboardTab() {
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(true);

  useEffect(() => {
    fetch('/api/complaints?action=leaderboard')
      .then(r => r.json())
      .then(d => { setData(d); setLoad(false); })
      .catch(() => setLoad(false));
  }, []);

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#444' }}>Loading...</div>;

  const board = data?.leaderboard || [];
  const withComplaints = board.filter(e => e.count > 0);
  const clean = board.filter(e => e.count === 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          ['Total Logged', data?.total_with_mistake || 0, '#fff'],
          ['Packer Mistakes', board.filter(e => e.role === 'Packer' && e.count > 0).reduce((s, e) => s + e.count, 0), '#f59e0b'],
          ['Dispatcher Mistakes', board.filter(e => e.role === 'Dispatcher' && e.count > 0).reduce((s, e) => s + e.count, 0), '#a855f7'],
          ['Courier Mistakes', data?.courier_mistakes || 0, '#3b82f6'],
        ].map(([label, val, color]) => (
          <div key={label} style={{ background: card, border: '1px solid #222', borderRadius: 9, padding: '12px 16px', minWidth: 120 }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{val}</div>
          </div>
        ))}
      </div>

      {withComplaints.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>⚠️ Mistakes Found</div>
          {withComplaints.map((emp, i) => (
            <div key={emp.name} style={{ background: card, border: `1px solid ${i === 0 ? '#ef444433' : '#222'}`, borderRadius: 10, padding: '14px 18px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: i === 0 ? '#ef4444' : '#ccc' }}>{emp.name}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#555' }}>{emp.role}</span>
                </div>
                <div style={{ background: '#ef444422', border: '1px solid #ef444433', color: '#ef4444', borderRadius: 20, padding: '3px 12px', fontSize: 13, fontWeight: 700 }}>
                  -{emp.count} ⚠️
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {emp.complaints.slice(0, 8).map((c, j) => (
                  <span key={j} style={{ fontSize: 10, background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#666', padding: '2px 8px', borderRadius: 4 }}>
                    {c.order} · {c.category}
                  </span>
                ))}
                {emp.complaints.length > 8 && <span style={{ fontSize: 10, color: '#444' }}>+{emp.complaints.length - 8} more</span>}
              </div>
            </div>
          ))}
        </>
      )}

      {clean.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: '#22c55e', marginBottom: 10, marginTop: 20, textTransform: 'uppercase', letterSpacing: 1 }}>✅ Clean Record</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {clean.map(emp => (
              <div key={emp.name} style={{ background: '#001a0a', border: '1px solid #003300', borderRadius: 8, padding: '8px 14px', fontSize: 12 }}>
                <span style={{ color: '#22c55e', fontWeight: 600 }}>{emp.name}</span>
                <span style={{ color: '#555', marginLeft: 6, fontSize: 11 }}>{emp.role}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {board.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🏆</div>
          <div>Koi complaint-based negative rating abhi tak nahi</div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function ComplaintsPage() {
  const { can } = useUser();
  const canCreate = can('complaints.create');

  const [complaints, setComplaints] = useState([]);
  const [summary, setSummary]       = useState({});
  const [loading, setLoading]       = useState(true);
  const [showAdd, setShowAdd]       = useState(false);
  const [selected, setSelected]     = useState(null);
  const [tab, setTab]               = useState('complaints');
  const [categoryFilter, setCatF]   = useState('all');
  const [mistakeFilter, setMistF]   = useState('all');
  const [search, setSearch]         = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ category: categoryFilter, mistake_by: mistakeFilter });
    if (search) params.append('search', search);
    const r = await fetch(`/api/complaints?${params}`);
    const d = await r.json();
    setComplaints(d.complaints || []);
    setSummary(d.summary || {});
    setLoading(false);
  }, [categoryFilter, mistakeFilter, search]);

  useEffect(() => { load(); }, [load]);

  const timeAgo = iso => {
    if (!iso) return '—';
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d === 0) return 'Today'; if (d === 1) return 'Yesterday'; return `${d}d ago`;
  };

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff' }}>
      {showAdd && <AddModal onClose={() => setShowAdd(false)} onSave={load} />}
      {selected && <ComplaintPanel complaint={selected} onClose={() => setSelected(null)} onSave={load} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Complaints</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>Customer complaints record karo</p>
        </div>
        {canCreate && (
        <button onClick={() => setShowAdd(true)} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Log Complaint
        </button>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Total',             value: summary.total || 0,              color: '#fff' },
          { label: 'Packer Mistakes',   value: summary.packer_mistakes || 0,    color: '#f59e0b' },
          { label: 'Dispatcher',        value: summary.dispatcher_mistakes || 0,color: '#a855f7' },
          { label: 'Courier',           value: summary.courier_mistakes || 0,   color: '#3b82f6' },
        ].map(s => (
          <div key={s.label} style={{ background: card, border: '1px solid #222', borderRadius: 9, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #222', paddingBottom: 0 }}>
        {[['complaints', '📋 All Complaints'], ['leaderboard', '⚠️ Mistake Leaderboard']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            background: 'transparent', border: 'none', borderBottom: tab === id ? `2px solid ${gold}` : '2px solid transparent',
            color: tab === id ? gold : '#555', padding: '8px 16px', fontSize: 13,
            fontWeight: tab === id ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'leaderboard' && <LeaderboardTab />}

      {tab === 'complaints' && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <select value={categoryFilter} onChange={e => setCatF(e.target.value)} style={{ background: '#1a1a1a', border: '1px solid #222', color: '#888', borderRadius: 7, padding: '7px 12px', fontSize: 12, fontFamily: 'inherit' }}>
              <option value="all">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={mistakeFilter} onChange={e => setMistF(e.target.value)} style={{ background: '#1a1a1a', border: '1px solid #222', color: '#888', borderRadius: 7, padding: '7px 12px', fontSize: 12, fontFamily: 'inherit' }}>
              <option value="all">All Mistakes</option>
              {MISTAKE_BY.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order, customer, phone..." style={{ background: card, border: '1px solid #222', color: '#fff', borderRadius: 7, padding: '7px 12px', fontSize: 12, minWidth: 200, flex: 1 }} />
          </div>

          {/* List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading && <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>Loading...</div>}
            {!loading && complaints.length === 0 && (
              <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📢</div>
                <div>Koi complaint nahi — acha sign hai!</div>
              </div>
            )}
            {complaints.map((c, i) => {
              const mc = mistakeColor(c.mistake_by);
              const hasPhotos = Array.isArray(c.image_urls) && c.image_urls.length > 0;
              return (
                <div key={i} onClick={() => setSelected(c)}
                  style={{ background: card, border: `1px solid ${c.mistake_by === 'packer' ? '#f59e0b22' : '#222'}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>{c.category}</span>
                      {c.mistake_by && c.mistake_by !== 'unknown' && (
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: mc + '22', color: mc, fontWeight: 600 }}>
                          {mistakeLabel(c.mistake_by)}
                        </span>
                      )}
                      {hasPhotos && <span style={{ fontSize: 10, color: '#555' }}>📷 {c.image_urls.length}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                      {c.customer_name} · {c.customer_phone} · {c.city}
                      {c.order_number && <span style={{ color: gold }}> · {c.order_number}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>{c.description}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: '#555' }}>{timeAgo(c.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
