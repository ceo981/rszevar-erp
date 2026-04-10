'use client';

import { useState, useRef, useEffect } from 'react';

const SUGGESTIONS = [
  '📊 Last 30 days ki performance kaisi rahi?',
  '🪦 Dead stock pe kya karna chahiye?',
  '📦 Konse products restock karni chahiye?',
  '💸 Kitna COD settlement pending hai?',
  '🏆 Is mahine ke top selling products kaunse hain?',
  '⚠️ Kaunse products out of stock hain?',
];

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 16 }}>
      {!isUser && (
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #c9a96e, #a07840)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, marginRight: 10, flexShrink: 0, marginTop: 2 }}>
          🤖
        </div>
      )}
      <div style={{
        maxWidth: '75%',
        padding: '12px 16px',
        borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        background: isUser ? 'linear-gradient(135deg, #c9a96e, #a07840)' : '#1f2937',
        color: isUser ? '#000' : '#e5e5e5',
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        border: isUser ? 'none' : '1px solid #374151',
      }}>
        {msg.content}
        {msg.streaming && (
          <span style={{ display: 'inline-block', width: 8, height: 14, background: '#c9a96e', borderRadius: 2, marginLeft: 4, animation: 'blink 1s infinite' }} />
        )}
      </div>
      {isUser && (
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, marginLeft: 10, flexShrink: 0, marginTop: 2 }}>
          👤
        </div>
      )}
    </div>
  );
}

export default function AIAdvisorPage() {
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    // Welcome message
    setMessages([{
      role: 'assistant',
      content: `Assalam-o-Alaikum Abdul! 👋\n\nMain RS ZEVAR ka AI Business Advisor hoon. Aapke live ERP data ke saath kaam karta hoon — orders, inventory, dead stock, accounts, sab kuch.\n\nKoi bhi business question poochein — main real numbers ke saath jawab dunga! 🚀`,
    }]);
    setContextLoaded(true);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Error ${res.status}`);
      }

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
        updated[updated.length - 1] = { role: 'assistant', content: `⚠️ Error: ${err.message}`, streaming: false };
        return updated;
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([{
      role: 'assistant',
      content: `Chat clear ho gaya! Koi naya sawaal poochein. 🔄`,
    }]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        textarea:focus { outline: none; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
      `}</style>

      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0d1117' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #c9a96e, #a07840)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🤖</div>
          <div>
            <div style={{ fontWeight: 700, color: '#fff', fontSize: 16 }}>RS ZEVAR AI Advisor</div>
            <div style={{ fontSize: 12, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
              Live ERP Data Connected
            </div>
          </div>
        </div>
        <button onClick={clearChat} style={{ padding: '6px 14px', background: '#1f2937', color: '#9ca3af', border: '1px solid #374151', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
          🗑 Clear Chat
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column' }}>
        {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}

        {/* Suggestions — show when only welcome message */}
        {messages.length === 1 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>💡 Yeh pooch sakte hain:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => sendMessage(s)}
                  style={{ padding: '8px 14px', background: '#111827', color: '#c9a96e', border: '1px solid #374151', borderRadius: 20, cursor: 'pointer', fontSize: 12, transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.target.style.background = '#1f2937'; e.target.style.borderColor = '#c9a96e'; }}
                  onMouseLeave={e => { e.target.style.background = '#111827'; e.target.style.borderColor = '#374151'; }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '16px 24px', borderTop: '1px solid #1f2937', background: '#0d1117' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', background: '#111827', border: '1px solid #374151', borderRadius: 14, padding: '12px 16px', transition: 'border-color 0.2s' }}
          onFocus={e => e.currentTarget.style.borderColor = '#c9a96e'}
          onBlur={e => e.currentTarget.style.borderColor = '#374151'}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Koi bhi business sawaal poochein... (Enter to send, Shift+Enter for new line)"
            rows={1}
            style={{ flex: 1, background: 'transparent', border: 'none', color: '#e5e5e5', fontSize: 14, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto' }}
            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
            disabled={loading}
          />
          <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
            style={{ width: 38, height: 38, borderRadius: '50%', background: loading || !input.trim() ? '#374151' : 'linear-gradient(135deg, #c9a96e, #a07840)', border: 'none', cursor: loading || !input.trim() ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, transition: 'all 0.2s' }}>
            {loading ? '⏳' : '➤'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#4b5563', textAlign: 'center', marginTop: 8 }}>
          Powered by Claude Sonnet · Live RS ZEVAR ERP Data
        </div>
      </div>
    </div>
  );
}
