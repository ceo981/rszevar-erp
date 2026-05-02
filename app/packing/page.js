'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';

const gold = '#c9a96e';

export default function PackingPage() {
  const { profile, activeUser, can } = useUser();
  // ── Granular perm gates (May 2 2026) ──
  const canView   = can('packing.view');
  const canSubmit = can('packing.submit');

  // With shared login, activeUser.name is the specific packer selected
  // ("Hassan"). Without it, profile.full_name is the login's name
  // ("Packing Team A"). Either way we want the sharpest label in logs.
  const performer = activeUser?.name || profile?.full_name || 'Packing Staff';
  const [orderNum, setOrderNum]     = useState('ZEVAR-');
  const [order, setOrder]           = useState(null);
  const [items, setItems]           = useState([]);
  const [team, setTeam]             = useState([]);
  const [packedBy, setPackedBy]     = useState('');
  const [searching, setSearching]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg]               = useState('');
  const [done, setDone]             = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    fetch('/api/orders/assign')
      .then(r => r.json())
      .then(d => setTeam(d.employees || []));
  }, []);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const search = async () => {
    const num = orderNum.trim().toUpperCase();
    if (!num) return;
    setSearching(true); setMsg(''); setOrder(null); setItems([]);
    try {
      const r = await fetch('/api/orders?search=' + encodeURIComponent(num) + '&limit=5');
      const d = await r.json();
      const found = (d.orders || []).find(o =>
        o.order_number?.toUpperCase() === num ||
        o.order_number?.toUpperCase().includes(num)
      );
      if (!found) { setMsg('Order nahi mila: ' + num); setSearching(false); return; }
      if (!['on_packing', 'confirmed'].includes(found.status)) {
        setMsg('Ye order "' + found.status + '" status mein hai — pack nahi ho sakta');
        setSearching(false); return;
      }
      setOrder(found);

      // Check if packer already set
      const ar = await fetch('/api/orders/assign?order_id=' + found.id);
      const ad = await ar.json();
      if (ad.assignment) {
        const existingName = ad.assignment.notes === 'packing_team'
          ? 'Packing Team'
          : ad.assignment.employee?.name || 'Kisi aur ne';
        setMsg('⚠️ Already: ' + existingName + ' ne pack mark kiya hai — dobara submit karne se override hoga');
      }

      const ir = await fetch('/api/orders?action=items&order_id=' + found.id);
      const id = await ir.json();
      setItems(id.items || []);
    } catch (e) { setMsg(e.message); }
    setSearching(false);
  };

  const submit = async () => {
    if (!order || !packedBy) { setMsg('Pehle Packed By select karo'); return; }
    setSubmitting(true); setMsg('');
    try {
      const r = await fetch('/api/orders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_packer',
          order_id: order.id,
          assigned_to: packedBy,
          performed_by: performer,
        }),
      });
      const d = await r.json();
      if (d.success) {
        setDone(true);
        setMsg('Order ' + order.order_number + ' — Packed by ' + d.packed_by);
        setTimeout(() => {
          setDone(false); setOrder(null); setItems([]);
          setOrderNum('ZEVAR-'); setPackedBy(''); setMsg('');
          if (inputRef.current) inputRef.current.focus();
        }, 2500);
      } else { setMsg(d.error); }
    } catch (e) { setMsg(e.message); }
    setSubmitting(false);
  };

  // ── Access denied (no packing.view) ──
  if (!canView) {
    return (
      <div style={{ fontFamily:'Inter,sans-serif', background:'#0a0a0a', minHeight:'100vh', padding:60, color:'#fff', maxWidth:480, margin:'0 auto', textAlign:'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Permission denied</div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 18 }}>
          Packing screen ki ijazat tumhe nahi hai.
        </div>
        <Link href="/" style={{ background: 'transparent', border: '1px solid #2a2a2a', color: '#ccc', borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-block' }}>
          ← Wapas
        </Link>
      </div>
    );
  }

  return (
    <div style={{ fontFamily:'Inter,sans-serif', background:'#0a0a0a', minHeight:'100vh', padding:'24px 20px', color:'#fff', maxWidth:480, margin:'0 auto' }}>
      <div style={{ textAlign:'center', marginBottom:32 }}>
        <div style={{ fontSize:36, marginBottom:6 }}>📦</div>
        <div style={{ fontSize:22, fontWeight:700, color:gold }}>Packing Screen</div>
        <div style={{ fontSize:13, color:'#555', marginTop:4 }}>Order number dalao, naam chuno, done</div>
      </div>

      {!order && (
        <div style={{ marginBottom:24 }}>
          <div style={{ display:'flex', gap:10 }}>
            <input ref={inputRef} value={orderNum}
              onChange={e => setOrderNum(e.target.value)}
              onKeyDown={e => e.key==='Enter' && search()}
              placeholder="ZEVAR-117XXX"
              style={{ flex:1, background:'#141414', border:`2px solid ${orderNum?gold:'#2a2a2a'}`, color:'#fff', borderRadius:10, padding:'16px', fontSize:20, fontWeight:600, outline:'none', fontFamily:'inherit' }}
            />
            <button onClick={search} disabled={searching||!orderNum}
              style={{ background:searching?'#1a1a1a':gold, border:'none', color:'#000', borderRadius:10, padding:'16px 22px', fontSize:20, fontWeight:700, cursor:searching?'not-allowed':'pointer' }}>
              {searching?'⟳':'🔍'}
            </button>
          </div>
          {msg && <div style={{ marginTop:12, background: msg.startsWith('⚠️') ? '#1a1000' : '#1a0000', border: '1px solid ' + (msg.startsWith('⚠️') ? '#f59e0b' : '#ef4444'), borderRadius:8, padding:'12px', fontSize:14, color: msg.startsWith('⚠️') ? '#f59e0b' : '#ef4444' }}>{msg}</div>}
        </div>
      )}

      {done && (
        <div style={{ background:'#001a0a', border:'2px solid #22c55e', borderRadius:14, padding:32, textAlign:'center', marginBottom:20 }}>
          <div style={{ fontSize:52, marginBottom:8 }}>✅</div>
          <div style={{ fontSize:18, fontWeight:700, color:'#22c55e' }}>{msg}</div>
        </div>
      )}

      {order && !done && (
        <>
          <div style={{ background:'#141414', border:`1px solid ${gold}44`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize:22, fontWeight:800, color:gold }}>{order.order_number}</div>
                <div style={{ fontSize:14, color:'#888', marginTop:3 }}>{order.customer_name} · {order.customer_city}</div>
                <div style={{ fontSize:13, color:'#555', marginTop:2 }}>Rs {Number(order.total_amount).toLocaleString()}</div>
              </div>
              <button onClick={() => { setOrder(null); setItems([]); setOrderNum('ZEVAR-'); setPackedBy(''); setMsg(''); }}
                style={{ background:'#1a1a1a', border:'1px solid #333', color:'#555', borderRadius:7, padding:'6px 12px', fontSize:12, cursor:'pointer' }}>✕</button>
            </div>
          </div>

          {items.length > 0 && (
            <div style={{ background:'#141414', border:'1px solid #222', borderRadius:12, padding:14, marginBottom:16 }}>
              <div style={{ fontSize:11, color:'#555', textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>Items ({items.length})</div>
              {items.map((item, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:i<items.length-1?'1px solid #1a1a1a':'none' }}>
                  {item.image_url
                    ? <img src={item.image_url} style={{ width:48, height:48, objectFit:'cover', borderRadius:7, flexShrink:0, border:'1px solid #2a2a2a' }} />
                    : <div style={{ width:48, height:48, borderRadius:7, background:gold+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>💍</div>
                  }
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, color:'#e2e8f0', fontWeight:600, lineHeight:1.3 }}>{item.title}</div>
                    {item.sku && <div style={{ fontSize:11, color:'#555', marginTop:1 }}>SKU: {item.sku}</div>}
                  </div>
                  <div style={{ fontSize:20, fontWeight:800, color:gold }}>×{item.quantity}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize:12, color:'#555', marginBottom:10, textTransform:'uppercase', letterSpacing:1 }}>Packed By</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>
            {team.map(emp => (
              <button key={emp.id} onClick={() => setPackedBy(String(emp.id))}
                style={{ background:packedBy===String(emp.id)?gold+'22':'#141414', border:`2px solid ${packedBy===String(emp.id)?gold:'#2a2a2a'}`, color:packedBy===String(emp.id)?gold:'#888', borderRadius:12, padding:'15px 18px', fontSize:17, fontWeight:packedBy===String(emp.id)?700:400, cursor:'pointer', textAlign:'left', fontFamily:'inherit', display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:38, height:38, borderRadius:'50%', background:packedBy===String(emp.id)?gold:'#2a2a2a', color:packedBy===String(emp.id)?'#000':'#555', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700, flexShrink:0 }}>{emp.name[0]}</div>
                {emp.name}
                {packedBy===String(emp.id)&&<span style={{ marginLeft:'auto', fontSize:20 }}>✓</span>}
              </button>
            ))}
            <button onClick={() => setPackedBy('packing_team')}
              style={{ background:packedBy==='packing_team'?'#3b82f622':'#141414', border:`2px solid ${packedBy==='packing_team'?'#3b82f6':'#2a2a2a'}`, color:packedBy==='packing_team'?'#3b82f6':'#555', borderRadius:12, padding:'15px 18px', fontSize:15, fontWeight:packedBy==='packing_team'?700:400, cursor:'pointer', textAlign:'left', fontFamily:'inherit', display:'flex', alignItems:'center', gap:12, marginTop:4 }}>
              <div style={{ width:38, height:38, borderRadius:'50%', background:packedBy==='packing_team'?'#3b82f6':'#2a2a2a', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>👥</div>
              <div><div>Packing Team</div><div style={{ fontSize:11, opacity:0.6, marginTop:1 }}>Wholesale / sab ne pack kiya</div></div>
              {packedBy==='packing_team'&&<span style={{ marginLeft:'auto', fontSize:20 }}>✓</span>}
            </button>
          </div>

          {msg && <div style={{ background:'#1a0000', border:'1px solid #ef4444', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#ef4444', marginBottom:14 }}>{msg}</div>}

          <button onClick={submit} disabled={submitting||!packedBy||!canSubmit}
            style={{ width:'100%', background:(packedBy&&canSubmit)?'#22c55e':'#1a1a1a', color:(packedBy&&canSubmit)?'#000':'#444', border:'none', borderRadius:14, padding:'18px', fontSize:18, fontWeight:800, cursor:(packedBy&&canSubmit&&!submitting)?'pointer':'not-allowed', fontFamily:'inherit' }}>
            {submitting?'⟳ Saving...':!canSubmit?'🔒 Submit ki ijazat nahi':packedBy?'✅ Done — Submit':'Packed By select karo'}
          </button>
        </>
      )}
    </div>
  );
}
