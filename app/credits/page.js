// ============================================================================
// RS ZEVAR ERP — Customer Credits (Khaata) — Coming Soon Placeholder
// /credits
// ----------------------------------------------------------------------------
// May 2 2026 — Sidebar mein link added, but full feature build pending.
// Yeh placeholder page user ko inform karta hai ke feature aa raha hai aur
// preview deta hai kya kya hoga. Real implementation aane par yeh file
// replace ho jayegi proper dashboard se.
//
// Why placeholder instead of removing the sidebar link?
// - User experience continuous rahta hai (link kabhi 404 nahi)
// - Build progressive ho sakta hai — backend pehle, UI baad mein
// - Stakeholder demo / preview ke kaam aata hai
// ============================================================================

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const gold = '#c9a96e';
const border = '#222';
const card = '#0f0f0f';
const text1 = '#fff';
const text2 = '#bbb';
const text3 = '#666';

export default function CustomerCreditsPlaceholder() {
  return (
    <div style={{ padding: '32px 28px', maxWidth: 980, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Link href="/orders"
          style={{ fontSize: 12, color: text3, textDecoration: 'none' }}>← Orders</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 6 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, color: text1 }}>
              📒 Customer Credits
            </h1>
            <p style={{ fontSize: 13, color: text2, margin: '6px 0 0' }}>
              Udhaar customers ka khaata management — outstanding balance, payment tracking, auto-allocation
            </p>
          </div>
          <span style={{
            background: 'rgba(201,169,110,0.1)', color: gold,
            border: `1px solid ${gold}`, padding: '6px 14px',
            borderRadius: 8, fontSize: 12, fontWeight: 600,
            letterSpacing: 0.5, textTransform: 'uppercase',
          }}>Coming Soon</span>
        </div>
      </div>

      {/* Hero card */}
      <div style={{
        background: card, border: `1px solid ${border}`,
        borderRadius: 12, padding: 28, marginBottom: 20,
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: text1, marginBottom: 14 }}>
          Yeh feature kya karega?
        </div>
        <div style={{ fontSize: 13, color: text2, lineHeight: 1.7, marginBottom: 18 }}>
          Tumhare regular wholesale aur trusted customers jo udhaar pe maal lete hain — unka complete khaata system. Order delivered ho jayega real-time, payment baad mein aaye to system FIFO se purane orders pe allocate karega aur automatically <strong style={{ color: gold }}>paid</strong> mark kar dega.
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14, marginTop: 18,
        }}>
          <Feature icon="💰" title="Outstanding tracking" desc="Per-customer balance, total billed, total received" />
          <Feature icon="📥" title="Payment recording" desc="Amount + screenshot + note + date with auto-allocation" />
          <Feature icon="🔄" title="FIFO auto-allocation" desc="Oldest unpaid orders get paid first (with manual override)" />
          <Feature icon="✅" title="Auto status update" desc="Order automatically paid jab full amount allocate ho" />
          <Feature icon="📊" title="Partial payment" desc="Order partially paid ho to clear balance dikhega" />
          <Feature icon="📒" title="Khaata history" desc="Saare orders + payments ek timeline mein" />
        </div>
      </div>

      {/* Status / progress */}
      <div style={{
        background: card, border: `1px solid ${border}`,
        borderRadius: 12, padding: 24,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: text1, marginBottom: 14 }}>
          Build Status
        </div>
        <Step label="Design + UX mockups" done />
        <Step label="Database schema migration" />
        <Step label="Backend API endpoints" />
        <Step label="Customer list dashboard" />
        <Step label="Per-customer khaata page" />
        <Step label="Payment record modal with screenshot upload" />
        <Step label="Order detail integration (partial banner)" />
        <Step label="Convert-to-credit button on existing orders" />

        <div style={{
          marginTop: 18, padding: '12px 14px',
          background: 'rgba(201,169,110,0.05)',
          border: '1px solid rgba(201,169,110,0.2)',
          borderRadius: 8, fontSize: 12, color: text2,
          lineHeight: 1.6,
        }}>
          💡 Build incrementally hoga taake production data safe rahe. Har step deploy + test ke baad next step start hoga.
        </div>
      </div>

    </div>
  );
}

function Feature({ icon, title, desc }) {
  return (
    <div style={{
      background: '#0a0a0a', border: `1px solid ${border}`,
      borderRadius: 8, padding: 14,
    }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: text1, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 11, color: text3, lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

function Step({ label, done }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 0', fontSize: 13,
    }}>
      <span style={{
        width: 16, height: 16, borderRadius: '50%',
        background: done ? '#10b981' : '#1a1a1a',
        border: `1px solid ${done ? '#10b981' : border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, color: '#000', flexShrink: 0,
      }}>{done ? '✓' : ''}</span>
      <span style={{ color: done ? text1 : text3, textDecoration: done ? 'none' : 'none' }}>{label}</span>
    </div>
  );
}
