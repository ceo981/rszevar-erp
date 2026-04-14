'use client';
import { useState, useEffect, useCallback } from 'react';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';

const CATEGORIES = ['Wrong Item', 'Missing Item', 'Damaged', 'Late Delivery', 'Poor Quality', 'Courier Issue', 'Refund Request', 'Other'];
const STATUSES = { open: { label: 'Open', color: '#ef4444', bg: '#ef444422' }, in_progress: { label: 'In Progress', color: '#f97316', bg: '#f9731622' }, resolved: { label: 'Resolved', color: '#22c55e', bg: '#22c55e22' }, closed: { label: 'Closed', color: '#555', bg: '#55555522' } };
const PRIORITIES = { high: { label: 'High', color: '#ef4444' }, medium: { label: 'Medium', color: '#f97316' }, low: { label: 'Low', color: '#22c55e' } };
const TEAM = ['Salman', 'Sharjeel', 'Farhan', 'Abdul Rehman'];

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

function AddModal({ onClose, onSave }) {
  const [form, setForm] = useState({ order_number: '', customer_name: '', customer_phone: '', city: '', category: 'Wrong Item', description: '', priority: 'medium', assigned_to: 'Salman' });
  const [images, setImages] = useState([]);
  const [imgLoading, setImgLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const handleImages = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 4 - images.length);
    if (!files.length) return;
    setImgLoading(true);
    const compressed = await Promise.all(files.map(f => compressImage(f)));
    setImages(prev => [...prev, ...compressed].slice(0, 4));
    setImgLoading(false);
    e.target.value = '';
  };

  const removeImg = (idx) => setImages(prev => prev.filter((_, i) => i !== idx));

  const save = async () => {
    if (!form.customer_name || !form.description) { setMsg('Customer name aur description zaroori hai'); return; }
    setSaving(true);
    const r = await fetch('/api/complaints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', ...form, image_urls: images }) });
    const d = await r.json();
    if (d.success) { onSave(); onClose(); }
    else setMsg('Error: ' + d.error);
    setSaving(false);
  };

  const inp = (label, key, type = 'text', opts = {}) => (
    <div>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>{label}</div>
      {opts.select ? (
        <select value={form[key]} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} style={{ width: '100%', background: '#1a1a1a', border: '1px solid #222', color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit' }}>
          {opts.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : opts.textarea ? (
        <textarea value={form[key]} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} rows={3} placeholder={opts.placeholder}
          style={{ width: '100%', background: '#1a1a1a', border: '1px solid #222', color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
      ) : (
        <input type={type} value={form[key] || ''} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} placeholder={opts.placeholder}
          style={{ width: '100%', background: '#1a1a1a', border: '1px solid #222', color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
      )}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f0f0f', border: '1px solid #222', borderRadius: 12, padding: 28, width: 480, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#ef4444' }}>📢 Log Complaint</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {inp('Order #', 'order_number', 'text', { placeholder: 'ZEVAR-XXXXXX' })}
            {inp('Customer Name', 'customer_name', 'text', { placeholder: 'Customer ka naam' })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {inp('Phone', 'customer_phone', 'tel', { placeholder: '03XX-XXXXXXX' })}
            {inp('City', 'city', 'text', { placeholder: 'Karachi' })}
          </div>
          {inp('Category', 'category', 'text', { select: true, options: CATEGORIES })}
          {inp('Complaint Details', 'description', 'text', { textarea: true, placeholder: 'Kya hua? Detail mein likho...' })}

          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>📷 Photos (optional — max 4)</div>
            {images.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {images.map((src, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={src} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 7, border: '1px solid #222' }} />
                    <button onClick={() => removeImg(i)} style={{ position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', border: 'none', color: '#fff', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {inp('Priority', 'priority', 'text', { select: true, options: ['high', 'medium', 'low'] })}
            {inp('Assign To', 'assigned_to', 'text', { select: true, options: TEAM })}
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

function ComplaintPanel({ complaint, onClose, onSave }) {
  const [form, setForm] = useState({ status: complaint.status, priority: complaint.priority, assigned_to: complaint.assigned_to || 'Salman', resolution_notes: complaint.resolution_notes || '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [lightbox, setLightbox] = useState(null);

  const update = async () => {
    setSaving(true);
    const r = await fetch('/api/complaints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', id: complaint.id, ...form }) });
    const d = await r.json();
    if (d.success) { setMsg('✅ Updated!'); onSave(); }
    else setMsg('❌ ' + d.error);
    setSaving(false);
  };

  const del = async () => {
    if (!confirm('Delete this complaint?')) return;
    await fetch('/api/complaints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: complaint.id }) });
    onSave(); onClose();
  };

  const sc = STATUSES[complaint.status] || STATUSES.open;
  const pc = PRIORITIES[complaint.priority] || PRIORITIES.medium;
  const imgs = Array.isArray(complaint.image_urls) ? complaint.image_urls : [];

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
          {imgs.length > 1 && (
            <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
              {imgs.map((_, i) => (
                <div key={i} onClick={e => { e.stopPropagation(); setLightbox(i); }} style={{ width: 8, height: 8, borderRadius: '50%', background: i === lightbox ? '#fff' : 'rgba(255,255,255,0.3)', cursor: 'pointer' }} />
              ))}
            </div>
          )}
        </div>
      )}
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.7)' }} />
      <div style={{ width: 440, background: '#0f0f0f', borderLeft: '1px solid #222', overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 4 }}>{complaint.category}</div>
            <div style={{ fontSize: 12, color: '#555' }}>{complaint.customer_name} · {complaint.customer_phone}</div>
            <div style={{ fontSize: 12, color: '#555' }}>{complaint.order_number || 'No order #'} · {complaint.city}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: sc.bg, color: sc.color }}>{sc.label}</span>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: pc.color+'22', color: pc.color }}>{pc.label} Priority</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: '14px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>COMPLAINT DETAILS</div>
            <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>{complaint.description}</div>
          </div>

          {imgs.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>📷 PHOTOS ({imgs.length})</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {imgs.map((src, i) => (
                  <img key={i} src={src} alt="" onClick={() => setLightbox(i)}
                    style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8, border: '1px solid #222', cursor: 'zoom-in', transition: 'opacity 0.15s' }}
                    onMouseEnter={e => e.target.style.opacity = '0.75'}
                    onMouseLeave={e => e.target.style.opacity = '1'}
                  />
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Status</div>
              <select value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))} style={{ width: '100%', background: '#1a1a1a', border: '1px solid #222', color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit' }}>
                {Object.keys(STATUSES).map(s => <option key={s} value={s}>{STATUSES[s].label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Priority</div>
              <select value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))} style={{ width: '100%', background: '#1a1a1a', border: '1px solid #222', color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit' }}>
                {Object.keys(PRIORITIES).map(p => <option key={p} value={p}>{PRIORITIES[p].label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Assigned To</div>
              <select value={form.assigned_to} onChange={e => setForm(f => ({...f, assigned_to: e.target.value}))} style={{ width: '100%', background: '#1a1a1a', border: '1px solid #222', color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit' }}>
                {TEAM.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Resolution Notes</div>
              <textarea value={form.resolution_notes} onChange={e => setForm(f => ({...f, resolution_notes: e.target.value}))} rows={3} placeholder="Kaise resolve kiya..."
                style={{ width: '100%', background: '#1a1a1a', border: '1px solid #222', color: '#fff', borderRadius: 7, padding: '9px 12px', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            </div>
            {msg && <div style={{ fontSize: 12, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={update} disabled={saving} style={{ flex: 1, background: '#c9a96e', color: '#000', border: 'none', borderRadius: 8, padding: '10px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {saving ? '...' : '✓ Update'}
              </button>
              <button onClick={del} style={{ background: '#1a0000', border: '1px solid #330000', color: '#ef4444', borderRadius: 8, padding: '10px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>🗑</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status: statusFilter, category: categoryFilter });
    if (search) params.append('search', search);
    const r = await fetch(`/api/complaints?${params}`);
    const d = await r.json();
    setComplaints(d.complaints || []);
    setSummary(d.summary || {});
    setLoading(false);
  }, [statusFilter, categoryFilter, search]);

  useEffect(() => { load(); }, [load]);

  const timeAgo = iso => {
    if (!iso) return '—';
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d === 0) return 'Today'; if (d === 1) return 'Yesterday'; return `${d}d ago`;
  };

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', color: '#fff', padding: 24 }}>
      {showAdd && <AddModal onClose={() => setShowAdd(false)} onSave={load} />}
      {selected && <ComplaintPanel complaint={selected} onClose={() => setSelected(null)} onSave={load} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Complaints</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>Customer complaints track karo aur resolve karo</p>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Log Complaint
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total', value: summary.total || 0, color: '#fff' },
          { label: 'Open', value: summary.open || 0, color: '#ef4444' },
          { label: 'In Progress', value: summary.in_progress || 0, color: '#f97316' },
          { label: 'Resolved', value: summary.resolved || 0, color: '#22c55e' },
          { label: 'Closed', value: summary.closed || 0, color: '#555' },
        ].map(s => (
          <div key={s.label} style={{ background: '#141414', border: '1px solid #222', borderRadius: 9, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {['all', 'open', 'in_progress', 'resolved', 'closed'].map(s => {
          const sc = s === 'all' ? { label: 'All', color: '#888' } : STATUSES[s];
          return (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{ padding: '6px 14px', background: statusFilter === s ? '#1e1e1e' : 'transparent', border: `1px solid ${statusFilter === s ? sc.color+'44' : '#222'}`, borderRadius: 7, fontSize: 12, color: statusFilter === s ? sc.color : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>
              {sc.label}
            </button>
          );
        })}
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ background: '#1a1a1a', border: '1px solid #222', color: '#888', borderRadius: 7, padding: '6px 12px', fontSize: 12, fontFamily: 'inherit' }}>
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ background: '#141414', border: '1px solid #222', color: '#fff', borderRadius: 7, padding: '6px 12px', fontSize: 12, minWidth: 160 }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>Loading...</div>}
        {!loading && complaints.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: '#444' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📢</div>
            <div>Koi complaint nahi — acha sign hai!</div>
          </div>
        )}
        {complaints.map((c, i) => {
          const sc = STATUSES[c.status] || STATUSES.open;
          const pc = PRIORITIES[c.priority] || PRIORITIES.medium;
          const hasPhotos = Array.isArray(c.image_urls) && c.image_urls.length > 0;
          return (
            <div key={i} onClick={() => setSelected(c)} style={{ background: '#141414', border: `1px solid ${c.status === 'open' ? '#33000088' : '#222'}`, borderRadius: 10, padding: '16px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>{c.category}</span>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: sc.bg, color: sc.color }}>{sc.label}</span>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: pc.color+'22', color: pc.color }}>{pc.label}</span>
                  {hasPhotos && <span style={{ fontSize: 10, color: '#555' }}>📷 {c.image_urls.length}</span>}
                </div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                  {c.customer_name} · {c.customer_phone} · {c.city}
                  {c.order_number && <span style={{ color: '#c9a96e' }}> · {c.order_number}</span>}
                </div>
                <div style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>{c.description}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>{timeAgo(c.created_at)}</div>
                {c.assigned_to && <div style={{ fontSize: 11, color: '#888' }}>→ {c.assigned_to}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
