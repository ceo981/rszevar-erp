'use client';

// ============================================================================
// RS ZEVAR ERP — Dispatch Scan Page (May 6 2026)
// Route: /orders/dispatch-scan
// ----------------------------------------------------------------------------
// PURPOSE: Dispatcher airway bills / order numbers scan karta hai (USB scanner
// ya phone camera). Har scan: order ka status `packed → dispatched` instant
// update. Last mein "Generate Loadsheet" press → DB record + RS ZEVAR-branded
// PDF print page.
//
// WORKFLOW:
//   1. USB scanner: input field auto-focused, scanner Enter dabaye to scan
//   2. Camera: button click → html5-qrcode scanner overlay
//   3. Har scan → /api/orders/scan-dispatch (instant dispatch + add to list)
//   4. "Generate Loadsheet" → /api/loadsheets/generate → redirect to print
//
// ACCESS: orders.view permission (most order users — managers, dispatchers)
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/context/UserContext';

// Theme tokens (matching existing pages)
const gold = '#c9a96e';
const bg = '#0a0a0a';
const card = '#141414';
const border = '#222';
const text1 = '#e5e5e5';
const text2 = '#888';
const success = '#22c55e';
const danger = '#ef4444';
const warn = '#f59e0b';

// ── Scan input parser (May 6 2026) ────────────────────────────────────────
// Different couriers ke barcode/QR codes mein different content hota hai.
// Ye function us raw scanned text ko clean karke actual tracking number
// extract karta hai jo DB mein match karega.
//
// Cases handle hote hain:
//   1. Plain tracking (e.g. "KI7534542222")        → as-is
//   2. Leopards QR     (e.g. "KI7534528163,789,2500.00") → "KI7534528163"
//      (comma-separated: tracking, user_id, cod_amount)
//   3. Scan-to-Pay QR  (e.g. "https://payment...")  → REJECT with hint
//   4. Order number    (e.g. "ZEVAR-119098")        → as-is (backend handles)
//   5. Kangaroo 1D     (e.g. "KL97671415")          → as-is
function parseScanInput(rawText) {
  let text = String(rawText || '').trim();
  if (!text) return { value: '', valid: false, reason: 'Empty input' };

  // Scan-to-Pay QRs contain URLs — Leopards aur baqi couriers ka payment QR.
  // Hum tracking chahte hain, payment URL nahi.
  if (/^https?:\/\//i.test(text)) {
    return {
      value: text,
      valid: false,
      reason: 'Ye Scan-to-Pay QR lagta hai (URL hai). Tracking barcode/QR scan karein',
    };
  }

  // Leopards QR format: "TRACKING,USER_ID,COD_AMOUNT"
  // Pehle segment ko (tracking) lelo
  if (text.includes(',')) {
    text = text.split(',')[0].trim();
  }

  // Trailing non-alphanumeric chars hata do (rare scanner artifact)
  text = text.replace(/[^A-Za-z0-9-]+$/, '');
  if (!text) {
    return { value: '', valid: false, reason: 'Parse ke baad text empty' };
  }

  // Normalize to uppercase — DB mein tracking + ZEVAR-XXX uppercase store hote hain
  return { value: text.toUpperCase(), valid: true };
}

// ── Audio feedback (Web Audio API — no asset files) ──────────────────────
function playBeep(type = 'success') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      osc.frequency.value = 1200;       // Higher pitch for success
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === 'warn') {
      osc.frequency.value = 600;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else {
      osc.frequency.value = 220;        // Lower buzz for error
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch {}
}

// ── Helpers ──────────────────────────────────────────────────────────────
const fmt = (n) => 'Rs ' + Math.round(Number(n || 0)).toLocaleString('en-PK');

function formatTimeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function CourierBadge({ courier }) {
  if (!courier) return <span style={{ color: text2 }}>—</span>;
  const colors = {
    Leopards: { bg: '#3b82f622', fg: '#60a5fa' },
    PostEx:   { bg: '#a855f722', fg: '#c084fc' },
    Kangaroo: { bg: '#f5970022', fg: '#fbbf24' },
    Pickup:   { bg: '#10b98122', fg: '#34d399' },
    Other:    { bg: '#6b728022', fg: '#9ca3af' },
  };
  const c = colors[courier] || colors.Other;
  return (
    <span style={{
      fontSize: 10, padding: '3px 8px', borderRadius: 3,
      background: c.bg, color: c.fg, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: 0.4,
    }}>{courier}</span>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function DispatchScanPage() {
  const router = useRouter();
  const { can, userEmail, profile } = useUser();
  const canView = can('orders.view');
  const performer = profile?.full_name || profile?.name || userEmail || 'Dispatcher';

  // ── State ──────────────────────────────────────────────────────────────
  const [scanInput, setScanInput] = useState('');
  const [scannedOrders, setScannedOrders] = useState([]);  // newest first
  // May 2026 — Per-parcel selection. Default: every scanned parcel is selected.
  // User can uncheck the ones they don't want in this loadsheet (e.g. wo
  // parcel jiska tracking abhi missing hai, ya wo jis pe dispute chal raha hai).
  // Generate loadsheet sirf selected IDs ke saath kaam karta hai.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState(null);          // {type, text}
  const [cameraOpen, setCameraOpen] = useState(false);
  const [notes, setNotes] = useState('');

  // May 6 2026 — Cross-device sync state
  const [initialLoading, setInitialLoading] = useState(true);
  const [recentLoadsheets, setRecentLoadsheets] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const inputRef = useRef(null);
  const scannerRef = useRef(null);
  const lastScanTimeRef = useRef(0);  // debounce duplicate camera scans

  // ── Auto-focus input on mount + after every scan ───────────────────────
  useEffect(() => {
    if (!cameraOpen) inputRef.current?.focus();
  }, [cameraOpen, busy]);

  // ── Feedback auto-clear after 3s ───────────────────────────────────────
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 3500);
    return () => clearTimeout(t);
  }, [feedback]);

  // ── Cross-device sync (May 6 2026) ─────────────────────────────────────
  // Pending loadsheet orders fetch karte hain — yani jo dispatched hain
  // magar abhi tak kisi loadsheet mein add nahi hue. Multiple devices se
  // scan ho rahe parcels sab dispatchers ko dikhte hain.
  const fetchPending = useCallback(async (silent = false) => {
    try {
      const r = await fetch('/api/orders/pending-loadsheet');
      const d = await r.json();
      if (d.success) {
        setScannedOrders(d.orders || []);
        // Auto-select all on initial / refresh fetch (default = include all)
        setSelectedIds(new Set((d.orders || []).map(o => o.id)));
      } else if (!silent) {
        console.error('Pending fetch failed:', d.error);
      }
    } catch (e) {
      if (!silent) console.error('Pending fetch error:', e.message);
    }
  }, []);

  // Recent loadsheets for bottom history widget
  const fetchRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const r = await fetch('/api/loadsheets?limit=10');
      const d = await r.json();
      if (d.success) setRecentLoadsheets(d.loadsheets || []);
    } catch (e) {
      console.error('Recent loadsheets fetch failed:', e.message);
    }
    setRecentLoading(false);
  }, []);

  // Initial load on mount
  useEffect(() => {
    (async () => {
      await fetchPending();
      setInitialLoading(false);
    })();
    fetchRecent();
  }, [fetchPending, fetchRecent]);

  // Poll every 30s when tab is visible — picks up scans from other devices
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy && !generating) {
        fetchPending(true);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchPending, busy, generating]);

  // Refetch on tab focus (user comes back to tab)
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible' && !busy && !generating) {
        fetchPending(true);
      }
    };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [fetchPending, busy, generating]);

  // ── Camera scanner lifecycle (html5-qrcode) ────────────────────────────
  useEffect(() => {
    if (!cameraOpen) return;

    let scanner;
    let mounted = true;

    (async () => {
      try {
        const lib = await import('html5-qrcode');
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = lib;
        if (!mounted) return;
        scanner = new Html5Qrcode('qr-reader');
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },     // Back camera on phones
          {
            fps: 10,
            // Wider qrbox so 1D barcodes (Kangaroo KL..., Leopards 1D KI...)
            // ke saath bhi work kare. Adapts to viewfinder size.
            qrbox: (vw, vh) => {
              const minEdge = Math.min(vw || 320, vh || 320);
              const w = Math.floor(minEdge * 0.85);
              const h = Math.floor(w * 0.55);  // 1D-friendly aspect
              return { width: w, height: h };
            },
            aspectRatio: 1.4,
            // Explicit format support — both 2D (QR) AND common 1D barcodes
            // jo Pakistani couriers use karte hain
            formatsToSupport: [
              Html5QrcodeSupportedFormats.QR_CODE,
              Html5QrcodeSupportedFormats.CODE_128,   // Leopards/Kangaroo 1D
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
              Html5QrcodeSupportedFormats.CODE_93,
              Html5QrcodeSupportedFormats.ITF,
            ],
            // Native browser BarcodeDetector use karo agar available — Chrome/Edge
            // pe much faster aur reliable hai 1D barcodes ke liye
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          },
          (decodedText) => {
            // Debounce: same camera might fire same code multiple times rapidly
            const now = Date.now();
            if (now - lastScanTimeRef.current < 1500) return;
            lastScanTimeRef.current = now;

            // Parse raw scan output → extract clean tracking number
            // (handles Leopards comma-separated QR, rejects Scan-to-Pay URLs)
            const parsed = parseScanInput(decodedText);
            if (!parsed.valid) {
              setFeedback({ type: 'error', text: parsed.reason });
              playBeep('error');
              return;
            }
            handleScan(parsed.value);
          },
          () => {} // Ignore per-frame parse errors
        );
      } catch (e) {
        if (!mounted) return;
        setFeedback({ type: 'error', text: 'Camera open nahi hua: ' + e.message });
        playBeep('error');
        setCameraOpen(false);
      }
    })();

    return () => {
      mounted = false;
      const s = scannerRef.current;
      if (s) {
        s.stop().then(() => {
          try { s.clear(); } catch {}
        }).catch(() => {});
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  // ── Core scan handler ──────────────────────────────────────────────────
  const handleScan = useCallback(async (rawValue) => {
    const value = String(rawValue || '').trim();
    if (!value) return;
    if (busy) return;

    // Dedup check (same tracking already in this session)
    if (scannedOrders.some(o =>
      o.tracking_number === value || o.order_number === value
    )) {
      setFeedback({ type: 'warn', text: `${value} pehle scan ho chuka hai` });
      playBeep('warn');
      setScanInput('');
      return;
    }

    setBusy(true);
    setScanInput('');

    try {
      const r = await fetch('/api/orders/scan-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking_number: value,
          performed_by: performer,
          performed_by_email: userEmail,
        }),
      });
      const d = await r.json();

      if (d.success) {
        // Prepend (newest first)
        setScannedOrders(prev => [d.order, ...prev]);
        // Auto-select newly scanned parcel
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.add(d.order.id);
          return next;
        });
        setFeedback({
          type: 'success',
          text: `✓ ${d.order.order_number} dispatched (${d.from_status} → dispatched)`,
        });
        playBeep('success');
      } else if (d.already_dispatched) {
        // Don't add to list, but show informational message
        setFeedback({
          type: 'warn',
          text: d.error || 'Pehle se dispatched',
        });
        playBeep('warn');
      } else {
        setFeedback({ type: 'error', text: d.error || 'Scan failed' });
        playBeep('error');
      }
    } catch (e) {
      setFeedback({ type: 'error', text: e.message });
      playBeep('error');
    }

    setBusy(false);
  }, [busy, scannedOrders, performer, userEmail]);

  // ── USB scanner: Enter key triggers scan ───────────────────────────────
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && scanInput.trim()) {
      e.preventDefault();
      // Parse the input — strips Leopards comma-separated format,
      // rejects URLs, normalizes to uppercase
      const parsed = parseScanInput(scanInput);
      if (!parsed.valid) {
        setFeedback({ type: 'error', text: parsed.reason });
        playBeep('error');
        setScanInput('');
        return;
      }
      handleScan(parsed.value);
    }
  };

  // ── Generate loadsheet → DB save → redirect to print ───────────────────
  const generateLoadsheet = async () => {
    // Use selected only — user uncheck karke filter kar sakta hai.
    const selectedOrders = scannedOrders.filter(o => selectedIds.has(o.id));
    if (selectedOrders.length === 0) return;
    if (!confirm(
      `${selectedOrders.length} parcel(s) ki loadsheet generate karein?` +
      (selectedOrders.length < scannedOrders.length
        ? `\n\n(${scannedOrders.length - selectedOrders.length} parcel(s) deselect kiye gaye — agle loadsheet ke liye pending rahenge)`
        : '')
    )) return;

    setGenerating(true);
    try {
      const r = await fetch('/api/loadsheets/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Reverse — backend sorts by position. UI showed newest-first;
          // loadsheet should be in scan order (oldest first = position 1).
          order_ids: [...selectedOrders].reverse().map(o => o.id),
          notes: notes.trim() || null,
          performed_by: performer,
          performed_by_email: userEmail,
        }),
      });
      const d = await r.json();

      if (d.success) {
        // Redirect to print page with autoprint flag — print dialog opens
        // automatically. (Without flag, viewing from history just shows.)
        router.push(`/orders/loadsheets/${d.loadsheet_id}/print?autoprint=1`);
      } else {
        // 409 = race condition (orders already in another loadsheet)
        // Refresh pending list to reflect actual server state
        if (r.status === 409) {
          await fetchPending(true);
          await fetchRecent();
        }
        setFeedback({ type: 'error', text: d.error || 'Generate failed' });
        playBeep('error');
        setGenerating(false);
      }
    } catch (e) {
      setFeedback({ type: 'error', text: e.message });
      playBeep('error');
      setGenerating(false);
    }
  };

  // ── Computed totals — based on SELECTED parcels (not all scanned) ──────
  const selectedOrders = scannedOrders.filter(o => selectedIds.has(o.id));
  const totalCod = selectedOrders.reduce((s, o) => s + Number(o.cod_amount || 0), 0);

  const couriersBreakdown = selectedOrders.reduce((acc, o) => {
    const c = o.courier || 'Other';
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});

  // ── Permission gate ────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div style={{ background: bg, minHeight: '100vh', color: text1, padding: 40 }}>
        <h1 style={{ color: gold }}>Access Denied</h1>
        <p>Aap ke paas dispatch scan ki permission nahi hai.</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ background: bg, minHeight: '100vh', color: text1 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 24px 60px' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <Link href="/orders" style={{ color: text2, fontSize: 13, textDecoration: 'none' }}>
            ← Orders
          </Link>
          <h1 style={{
            color: gold, fontSize: 28, margin: '8px 0 4px',
            fontWeight: 700, letterSpacing: -0.5,
          }}>
            📡 Dispatch Scan
          </h1>
          <p style={{ color: text2, fontSize: 13, margin: 0 }}>
            Airway bill ya order number scan karein. Scan hote hi order dispatched ho jayega.
          </p>
        </div>

        {/* Scan input bar */}
        <div style={{
          background: card, border: `1px solid ${border}`, borderRadius: 8,
          padding: 16, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              ref={inputRef}
              type="text"
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Tracking number ya order number scan karein... (USB scanner Enter dabaye)"
              disabled={busy || generating || cameraOpen}
              autoComplete="off"
              autoFocus
              style={{
                flex: 1, padding: '14px 16px', fontSize: 16,
                background: '#0d0d0d', color: text1,
                border: `1.5px solid ${busy ? gold : border}`, borderRadius: 6,
                outline: 'none', fontFamily: 'monospace',
              }}
            />
            <button
              onClick={() => setCameraOpen(true)}
              disabled={busy || generating}
              style={{
                padding: '14px 18px', fontSize: 14, fontWeight: 600,
                background: cameraOpen ? gold : '#1a1a1a',
                color: cameraOpen ? '#000' : text1,
                border: `1.5px solid ${gold}`, borderRadius: 6,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
              title="Phone ya laptop camera se scan karein"
            >
              📷 Camera
            </button>
          </div>

          {/* Feedback toast */}
          {feedback && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 6, fontSize: 13,
              background:
                feedback.type === 'success' ? 'rgba(34,197,94,0.12)' :
                feedback.type === 'warn'    ? 'rgba(245,158,11,0.12)' :
                                              'rgba(239,68,68,0.12)',
              color:
                feedback.type === 'success' ? success :
                feedback.type === 'warn'    ? warn :
                                              danger,
              border: `1px solid ${
                feedback.type === 'success' ? success + '44' :
                feedback.type === 'warn'    ? warn + '44' :
                                              danger + '44'
              }`,
            }}>
              {feedback.text}
            </div>
          )}

          {busy && (
            <div style={{ marginTop: 8, fontSize: 12, color: text2 }}>
              ⏳ Processing scan...
            </div>
          )}
        </div>

        {/* Live scanned list */}
        <div style={{
          background: card, border: `1px solid ${border}`, borderRadius: 8,
          marginBottom: 16,
        }}>
          <div style={{
            padding: '14px 18px', borderBottom: `1px solid ${border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: text1 }}>
              Scanned Parcels ({scannedOrders.length}
              {scannedOrders.length > 0 && selectedIds.size !== scannedOrders.length && (
                <span style={{ color: gold, fontSize: 12, fontWeight: 500, marginLeft: 6 }}>
                  · {selectedIds.size} selected
                </span>
              )})
            </div>
            {/* May 2026 — Select all/none toggle. When some/none selected,
                clicking selects all. When all selected, clicking deselects all. */}
            {scannedOrders.length > 0 && (
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: text2 }}>
                <button
                  onClick={() => {
                    if (selectedIds.size === scannedOrders.length) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(scannedOrders.map(o => o.id)));
                    }
                  }}
                  style={{
                    background: 'transparent', border: `1px solid ${border}`,
                    color: text2, padding: '4px 10px', borderRadius: 4,
                    fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  {selectedIds.size === scannedOrders.length ? 'Deselect all' : 'Select all'}
                </button>
                <span>Newest first</span>
              </div>
            )}
          </div>

          {scannedOrders.length === 0 ? (
            <div style={{
              padding: '60px 20px', textAlign: 'center',
              color: text2, fontSize: 14,
            }}>
              {initialLoading
                ? 'Pending parcels load ho rahi hain...'
                : <>Koi parcel scan nahi hua abhi tak.<br/>
                  <span style={{ fontSize: 12 }}>Upar input mein scanner se ya camera button se shuru karein.</span></>}
            </div>
          ) : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {scannedOrders.map((o, i) => {
                const isSel = selectedIds.has(o.id);
                return (
                <div key={o.id}
                  onClick={() => {
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
                      return next;
                    });
                  }}
                  style={{
                    padding: '12px 18px',
                    borderBottom: i < scannedOrders.length - 1 ? `1px solid ${border}` : 'none',
                    display: 'grid',
                    // May 2026 — Added 28px checkbox column at start.
                    gridTemplateColumns: '28px 40px 1fr 130px 100px 90px',
                    alignItems: 'center', gap: 12, fontSize: 13,
                    cursor: 'pointer',
                    background: isSel ? 'transparent' : 'rgba(255,255,255,0.025)',
                    opacity: isSel ? 1 : 0.6,
                    transition: 'all 0.15s',
                  }}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => {/* outer onClick handles toggle */}}
                    onClick={e => e.stopPropagation()}
                    style={{
                      width: 16, height: 16, cursor: 'pointer',
                      accentColor: gold,
                    }}
                  />
                  <div style={{ color: text2, fontFamily: 'monospace' }}>
                    #{scannedOrders.length - i}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{o.order_number}</div>
                    <div style={{ fontSize: 11, color: text2, fontFamily: 'monospace' }}>
                      {o.tracking_number || 'No tracking'}
                    </div>
                  </div>
                  <div>
                    <CourierBadge courier={o.courier} />
                    {o.customer_city && (
                      <div style={{ fontSize: 11, color: text2, marginTop: 3 }}>
                        {o.customer_city}
                      </div>
                    )}
                  </div>
                  <div style={{ color: text1 }}>
                    {o.customer_name || '—'}
                  </div>
                  <div style={{ textAlign: 'right', color: gold, fontWeight: 600 }}>
                    {o.cod_amount > 0 ? fmt(o.cod_amount) : <span style={{ color: text2 }}>—</span>}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer / Generate — only shown when at least 1 parcel selected */}
        {selectedOrders.length > 0 && (
          <div style={{
            background: card, border: `1px solid ${border}`, borderRadius: 8,
            padding: 18, marginBottom: 16,
          }}>
            {/* Totals — based on SELECTED parcels */}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 24,
              paddingBottom: 14, borderBottom: `1px solid ${border}`, marginBottom: 14,
            }}>
              <div>
                <div style={{ fontSize: 11, color: text2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Selected Parcels
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: text1, marginTop: 2 }}>
                  {selectedOrders.length}
                  {selectedOrders.length < scannedOrders.length && (
                    <span style={{ fontSize: 12, fontWeight: 400, color: text2, marginLeft: 6 }}>
                      / {scannedOrders.length}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: text2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Total COD
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: gold, marginTop: 2 }}>
                  {fmt(totalCod)}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, color: text2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Per Courier
                </div>
                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(couriersBreakdown).map(([c, n]) => (
                    <div key={c} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <CourierBadge courier={c} />
                      <span style={{ fontSize: 12, color: text1 }}>{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: text2, display: 'block', marginBottom: 6 }}>
                Notes (optional) — e.g. "Karachi pickup batch", rider name, etc.
              </label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Loadsheet ke liye koi note..."
                disabled={generating}
                style={{
                  width: '100%', padding: '10px 12px', fontSize: 13,
                  background: '#0d0d0d', color: text1,
                  border: `1px solid ${border}`, borderRadius: 6,
                  outline: 'none',
                }}
              />
            </div>

            {/* Generate button */}
            <button
              onClick={generateLoadsheet}
              disabled={generating || selectedOrders.length === 0}
              style={{
                width: '100%', padding: '16px', fontSize: 15, fontWeight: 700,
                background: generating ? '#444' : gold,
                color: generating ? text2 : '#000',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                letterSpacing: 0.3, textTransform: 'uppercase',
              }}
            >
              {generating
                ? '⏳ Loadsheet generate ho rahi hai...'
                : `📋 Generate Loadsheet (${selectedOrders.length} parcel${selectedOrders.length !== 1 ? 's' : ''})`}
            </button>
          </div>
        )}

      </div>

      {/* ── Recent Loadsheets (history widget — May 6 2026) ─────────── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px 60px' }}>
        <div style={{
          background: card, border: `1px solid ${border}`, borderRadius: 8,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 18px', borderBottom: `1px solid ${border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: text1 }}>
              📋 Recent Loadsheets
            </div>
            <Link href="/orders/loadsheets" style={{
              fontSize: 12, color: gold, textDecoration: 'none',
            }}>
              View all →
            </Link>
          </div>

          {recentLoading ? (
            <div style={{ padding: 30, textAlign: 'center', color: text2, fontSize: 13 }}>
              Loading...
            </div>
          ) : recentLoadsheets.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: text2, fontSize: 13 }}>
              Abhi tak koi loadsheet generate nahi hui
            </div>
          ) : (
            recentLoadsheets.map((ls, i) => (
              <Link
                key={ls.id}
                href={`/orders/loadsheets/${ls.id}/print`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 90px 100px 70px 60px',
                  gap: 12, alignItems: 'center',
                  padding: '12px 18px',
                  borderBottom: i < recentLoadsheets.length - 1 ? `1px solid ${border}` : 'none',
                  fontSize: 12, color: text1, textDecoration: 'none',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div>
                  <div style={{
                    fontFamily: 'monospace', fontSize: 11.5, color: gold, fontWeight: 600,
                  }}>
                    {ls.loadsheet_number}
                  </div>
                  {ls.generated_by && (
                    <div style={{ fontSize: 10.5, color: text2, marginTop: 2 }}>
                      by {ls.generated_by}
                    </div>
                  )}
                </div>
                <div style={{ color: text2 }}>
                  {formatTimeAgo(ls.generated_at)}
                </div>
                <div style={{ textAlign: 'right', color: text1 }}>
                  {ls.total_parcels} parcels
                </div>
                <div style={{ textAlign: 'right', color: gold, fontWeight: 600 }}>
                  {fmt(ls.total_cod)}
                </div>
                <div style={{ textAlign: 'right', fontSize: 11, color: gold }}>
                  🖨️
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* ── Camera Modal ──────────────────────────────────────────────── */}
      {cameraOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
          zIndex: 1000, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '14px 18px', borderBottom: `1px solid ${border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ color: gold, fontWeight: 700, fontSize: 16 }}>
              📷 Camera Scanner
            </div>
            <button
              onClick={() => setCameraOpen(false)}
              style={{
                padding: '8px 16px', fontSize: 14, fontWeight: 600,
                background: '#1a1a1a', color: text1,
                border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer',
              }}
            >
              ✕ Close
            </button>
          </div>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}>
            <div id="qr-reader" style={{
              width: '100%', maxWidth: 500,
              background: '#000', borderRadius: 8, overflow: 'hidden',
            }} />
          </div>
          {feedback && (
            <div style={{
              padding: '14px 18px', textAlign: 'center', fontSize: 14,
              color:
                feedback.type === 'success' ? success :
                feedback.type === 'warn'    ? warn :
                                              danger,
              background: '#0a0a0a', borderTop: `1px solid ${border}`,
            }}>
              {feedback.text}
            </div>
          )}
          <div style={{
            padding: '12px 18px', textAlign: 'center', fontSize: 12,
            color: text2, borderTop: `1px solid ${border}`,
          }}>
            Camera barcode/QR ke saamne rakhein. Auto-scan ho jayega.
          </div>
        </div>
      )}
    </div>
  );
}
