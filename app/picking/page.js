'use client';

// ============================================================================
// RS ZEVAR ERP — Order Picking Screen
// Route: /picking
// ----------------------------------------------------------------------------
// PURPOSE: Packing staff order ID dale → samne items + qty aa jaye taake
// inventory shelves se nikal sakein. Customer details intentionally HIDDEN
// (name, address, phone, total) — picker ko bas saamaan chahiye.
//
// ACCESS: packing.view permission (sidebar entry filtered hai).
//
// DIFFERENT FROM /packing:
//   /packing  → Pack mark karne ke liye (assign packer, write packing_log)
//   /picking  → SIRF dekhne ke liye items kya hain (no DB writes)
//
// MOBILE-FIRST: Big fonts, large touch targets, single column layout.
// ============================================================================

import { useState, useEffect, useRef } from 'react';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';

// Status display config — kis status mein hai pata chal jaye
const STATUS_DISPLAY = {
  pending:    { label: 'Pending',    color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  confirmed:  { label: 'Confirmed',  color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  on_packing: { label: 'On Packing', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  packed:     { label: 'Packed',     color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  dispatched: { label: 'Dispatched', color: '#22d3ee', bg: 'rgba(34,211,238,0.12)' },
  delivered:  { label: 'Delivered',  color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  returned:   { label: 'Returned',   color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  cancelled:  { label: 'Cancelled',  color: '#8a8580', bg: 'rgba(138,133,128,0.12)' },
};

function StatusPill({ status }) {
  const s = STATUS_DISPLAY[status] || { label: status || 'Unknown', color: '#888', bg: '#1a1a1a' };
  return (
    <span style={{
      fontSize: 11, padding: '4px 12px', borderRadius: 4,
      background: s.bg, color: s.color, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      {s.label}
    </span>
  );
}

export default function PickingPage() {
  const [orderNum, setOrderNum]   = useState('ZEVAR-');
  const [order, setOrder]         = useState(null);
  const [items, setItems]         = useState([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg]             = useState('');
  // Visual-only "picked" toggle per item — helps picker track progress.
  // NOT saved to DB (this page is read-only by design).
  const [pickedSet, setPickedSet] = useState(new Set());
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const search = async () => {
    const num = orderNum.trim().toUpperCase();
    if (!num) return;
    setSearching(true);
    setMsg('');
    setOrder(null);
    setItems([]);
    setPickedSet(new Set());

    try {
      // Search via list endpoint — handles both ZEVAR-XXXX and partial matches
      const r = await fetch('/api/orders?search=' + encodeURIComponent(num) + '&limit=5');
      const d = await r.json();
      const rows = d.orders || [];
      const found = rows.find(o =>
        o.order_number?.toUpperCase() === num ||
        o.order_number?.toUpperCase().includes(num)
      ) || rows[0];

      if (!found) {
        setMsg('❌ Order nahi mila: ' + num);
        setSearching(false);
        return;
      }

      setOrder(found);

      // Fetch items
      const ir = await fetch('/api/orders?action=items&order_id=' + found.id);
      const id = await ir.json();
      setItems(id.items || []);

      if ((id.items || []).length === 0) {
        setMsg('⚠ Is order mein koi items nahi hain');
      }
    } catch (e) {
      setMsg('Error: ' + e.message);
    }
    setSearching(false);
  };

  const reset = () => {
    setOrder(null);
    setItems([]);
    setOrderNum('ZEVAR-');
    setMsg('');
    setPickedSet(new Set());
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const togglePicked = (idx) => {
    setPickedSet(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const totalUnits = items.reduce((sum, it) => sum + (parseInt(it.quantity, 10) || 0), 0);
  const allPicked = items.length > 0 && pickedSet.size === items.length;

  return (
    <div style={{
      fontFamily: 'Inter, sans-serif',
      background: '#0a0a0a',
      minHeight: '100vh',
      padding: '24px 16px 60px',
      color: '#fff',
      maxWidth: 520,
      margin: '0 auto',
    }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 40, marginBottom: 6 }}>🏷️</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: gold }}>Pick Order</div>
        <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
          Order ID dalo, items + quantity dekho, shelves se nikalo
        </div>
      </div>

      {/* Search bar — always visible */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            ref={inputRef}
            value={orderNum}
            onChange={e => setOrderNum(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="ZEVAR-117XXX ya order number"
            style={{
              flex: 1,
              background: card,
              border: `2px solid ${orderNum ? gold : '#2a2a2a'}`,
              color: '#fff',
              borderRadius: 10,
              padding: '16px 14px',
              fontSize: 18,
              fontWeight: 600,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={search}
            disabled={searching || !orderNum}
            style={{
              background: searching || !orderNum ? '#1a1a1a' : gold,
              color: searching || !orderNum ? '#444' : '#000',
              border: 'none',
              borderRadius: 10,
              padding: '16px 22px',
              fontSize: 20,
              fontWeight: 700,
              cursor: searching || !orderNum ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              minWidth: 64,
            }}
          >
            {searching ? '⟳' : '🔍'}
          </button>
        </div>
        {msg && !order && (
          <div style={{
            marginTop: 12,
            background: msg.startsWith('❌') ? '#1a0000' : '#1a1000',
            border: '1px solid ' + (msg.startsWith('❌') ? '#ef4444' : '#f59e0b'),
            borderRadius: 8,
            padding: 12,
            fontSize: 14,
            color: msg.startsWith('❌') ? '#ef4444' : '#f59e0b',
          }}>
            {msg}
          </div>
        )}
      </div>

      {/* Order display */}
      {order && (
        <>
          {/* Order summary card — order# + status + item count, NO customer info */}
          <div style={{
            background: card,
            border: `1px solid ${gold}44`,
            borderRadius: 12,
            padding: '16px 18px',
            marginBottom: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: gold, lineHeight: 1.1 }}>
                  {order.order_number}
                </div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <StatusPill status={order.status} />
                  <span>·</span>
                  <span style={{ color: '#999' }}>
                    {items.length} item{items.length === 1 ? '' : 's'}, {totalUnits} unit{totalUnits === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <button
                onClick={reset}
                title="Clear & search again"
                style={{
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  color: '#888',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                ✕ New
              </button>
            </div>

            {/* All-picked celebration */}
            {allPicked && (
              <div style={{
                marginTop: 12,
                padding: '10px 14px',
                background: 'rgba(34,197,94,0.12)',
                border: '1px solid #22c55e',
                borderRadius: 8,
                color: '#4ade80',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'center',
              }}>
                ✅ Sab items pick ho gaye — packing pe le ja sakte ho
              </div>
            )}
          </div>

          {/* Items list — big card per item */}
          {items.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {items.map((item, i) => {
                const isPicked = pickedSet.has(i);
                return (
                  <button
                    key={i}
                    onClick={() => togglePicked(i)}
                    style={{
                      background: isPicked ? 'rgba(34,197,94,0.08)' : card,
                      border: `2px solid ${isPicked ? '#22c55e' : '#2a2a2a'}`,
                      borderRadius: 12,
                      padding: 12,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'all 0.12s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    {/* Image */}
                    {item.image_url
                      ? <img
                          src={item.image_url}
                          alt=""
                          style={{
                            width: 64, height: 64, objectFit: 'cover',
                            borderRadius: 8, flexShrink: 0,
                            border: '1px solid #2a2a2a',
                            opacity: isPicked ? 0.6 : 1,
                          }}
                        />
                      : <div style={{
                          width: 64, height: 64, borderRadius: 8,
                          background: gold + '22', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          fontSize: 26, flexShrink: 0,
                        }}>💍</div>
                    }

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 14,
                        color: isPicked ? '#777' : '#e8e8e8',
                        fontWeight: 600,
                        lineHeight: 1.35,
                        textDecoration: isPicked ? 'line-through' : 'none',
                      }}>
                        {item.title}
                      </div>
                      {item.sku && (
                        <div style={{
                          fontSize: 12,
                          color: isPicked ? '#444' : gold,
                          marginTop: 4,
                          fontWeight: 600,
                          letterSpacing: 0.4,
                        }}>
                          SKU: {item.sku}
                        </div>
                      )}
                    </div>

                    {/* Quantity — BIG */}
                    <div style={{
                      flexShrink: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      minWidth: 56,
                    }}>
                      <div style={{
                        fontSize: 28,
                        fontWeight: 800,
                        color: isPicked ? '#22c55e' : gold,
                        lineHeight: 1,
                      }}>
                        {isPicked ? '✓' : `×${item.quantity}`}
                      </div>
                      {!isPicked && (
                        <div style={{ fontSize: 9, color: '#555', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                          tap pick
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{
              background: card,
              border: '1px solid #2a2a2a',
              borderRadius: 12,
              padding: 20,
              textAlign: 'center',
              color: '#666',
              fontSize: 13,
              marginBottom: 20,
            }}>
              No items found for this order
            </div>
          )}

          {/* Search next button */}
          <button
            onClick={reset}
            style={{
              width: '100%',
              background: gold,
              color: '#000',
              border: 'none',
              borderRadius: 12,
              padding: 16,
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            🔍 Next Order
          </button>
        </>
      )}

      {/* Helper note when nothing searched yet */}
      {!order && !msg && (
        <div style={{
          marginTop: 24,
          padding: 14,
          background: 'rgba(201,169,110,0.05)',
          border: `1px solid ${gold}22`,
          borderRadius: 8,
          fontSize: 12,
          color: '#888',
          lineHeight: 1.6,
          textAlign: 'center',
        }}>
          💡 Tap karke item ko picked mark kar sakte ho.<br/>
          Yeh sirf tumhari madad ke liye hai — DB mein save nahi hota.
        </div>
      )}
    </div>
  );
}
