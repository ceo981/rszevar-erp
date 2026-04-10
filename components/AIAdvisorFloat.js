'use client';

import { useState, useRef, useEffect } from 'react';

const QUICK = [
  '📊 Performance summary?',
  '🪦 Dead stock advice?',
  '📦 Restock kya karein?',
  '💸 Pending settlement?',
];

export default function AIAdvisorFloat() {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: 'assistant', content: 'Salam! 👋 Quick business sawaal poochein — main live ERP data se jawab dunga!' }]);
    }
  }, [open]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const sendMessage = async (text) => {
    const userMsg = text || input.trim();
    if (!userMsg || loading) return;
    setInput('');

    const newMessages = [...messages.filter(m => !m.streaming), { role: 'user', content: userMsg }];
    setMessages([...newMessages, { role: 'assistant', content: '', streaming: true }]);
    setLoading(true);

    try {
      const res = await fetch('/api/ai-advisor', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) throw new Error(`Error ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: full, streaming: true };
          return updated;
        });
      }

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: full, streaming: false };
        return updated;
      });
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: `⚠️ ${err.message}`, streaming: false };
        return updated;
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .ai-float-chat { animation: slideUp 0.25s ease; }
        .ai-float-chat ::-webkit-scrollbar { width: 3px; }
        .ai-float-chat ::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
      `}</style>

      {/* Chat Window */}
      {open && (
        <div className="ai-float-chat" style={{
          position: 'fixed', bottom: 90, right: 24, width: 360, height: 480,
          background: '#0d1117', border: '1px solid #374151', borderRadius: 16,
          display: 'flex', flexDirection: 'column', zIndex: 1000,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          fontFamily: 'Inter, sans-serif',
        }}>
          {/* Header */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #c9a96e, #a07840)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>🤖</div>
              <div>
                <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>AI Advisor</div>
                <div style={{ fontSize: 10, color: '#4ade80' }}>● Live ERP</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                <div style={{
                  maxWidth: '85%', padding: '8px 12px', fontSize: 13, lineHeight: 1.5,
                  borderRadius: msg.role === 'user' ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
                  background: msg.role === 'user' ? 'linear-gradient(135deg, #c9a96e, #a07840)' : '#1f2937',
                  color: msg.role === 'user' ? '#000' : '#e5e5e5',
                  border: msg.role === 'user' ? 'none' : '1px solid #374151',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.content}
                  {msg.streaming && <span style={{ display: 'inline-block', width: 6, height: 12, background: '#c9a96e', borderRadius: 2, marginLeft: 3, animation: 'blink 1s infinite' }} />}
                </div>
              </div>
            ))}

            {/* Quick suggestions */}
            {messages.length === 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {QUICK.map((q, i) => (
                  <button key={i} onClick={() => sendMessage(q)}
                    style={{ padding: '5px 10px', background: '#111827', color: '#c9a96e', border: '1px solid #374151', borderRadius: 12, cursor: 'pointer', fontSize: 11 }}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '10px 12px', borderTop: '1px solid #1f2937' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#111827', border: '1px solid #374151', borderRadius: 10, padding: '8px 12px' }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(); } }}
                placeholder="Sawaal poochein..."
                disabled={loading}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#e5e5e5', fontSize: 13, fontFamily: 'inherit' }}
              />
              <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
                style={{ width: 28, height: 28, borderRadius: '50%', background: loading || !input.trim() ? '#374151' : '#c9a96e', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>
                {loading ? '⏳' : '➤'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Button */}
      <button onClick={() => setOpen(o => !o)} style={{
        position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
        borderRadius: '50%', background: open ? '#374151' : 'linear-gradient(135deg, #c9a96e, #a07840)',
        border: 'none', cursor: 'pointer', zIndex: 1001,
        boxShadow: '0 4px 20px rgba(201,169,110,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24, transition: 'all 0.2s',
      }}>
        {open ? '×' : '🤖'}
      </button>
    </>
  );
}
