'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@/context/UserContext';

const gold = '#c9a96e';
const card = '#141414';
const border = '#222';

// ─── Utilities ─────────────────────────────────────────────────────────────
const timeAgo = iso => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const formatTime = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (isToday) return time;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + time;
};

const formatPhone = p => {
  if (!p) return '';
  // 923001234567 → +92 300 1234567
  if (p.startsWith('92') && p.length === 12) {
    return `+${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5)}`;
  }
  return '+' + p;
};

const STATUS_COLOR = {
  pending:    '#888',
  confirmed:  '#3b82f6',
  on_packing: '#f59e0b',
  packed:     '#06b6d4',
  dispatched: '#a855f7',
  delivered:  '#22c55e',
  returned:   '#f59e0b',
  rto:        '#ef4444',
  cancelled:  '#ef4444',
  attempted:  '#f97316',
  hold:       '#64748b',
};

// ─── Conversation list item ─────────────────────────────────────────────────
function ConversationItem({ conv, isActive, onClick }) {
  const name = conv.customer_name || conv.customer_wa_name || formatPhone(conv.customer_phone);
  const subtitle = conv.customer_name ? formatPhone(conv.customer_phone) : null;
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        background: isActive ? '#1a1a1a' : 'transparent',
        border: 'none',
        borderLeft: isActive ? `3px solid ${gold}` : '3px solid transparent',
        borderBottom: `1px solid ${border}`,
        padding: '14px 16px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: '#fff',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        transition: 'background 0.12s',
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: gold + '22', color: gold,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 600, flexShrink: 0,
      }}>
        {(name[0] || '?').toUpperCase()}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </span>
          <span style={{ fontSize: 10, color: '#666', flexShrink: 0 }}>
            {timeAgo(conv.last_message_at)}
          </span>
        </div>
        {subtitle && (
          <div style={{ fontSize: 10, color: '#666', marginTop: 1, marginBottom: 3 }}>
            {subtitle}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 3 }}>
          <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
            {conv.last_message_direction === 'out' && <span style={{ color: '#555' }}>↗ </span>}
            {conv.last_message_text || '(no messages)'}
          </span>
          {conv.unread_count > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              background: '#22c55e', color: '#000',
              padding: '2px 7px', borderRadius: 10,
              minWidth: 18, textAlign: 'center',
              flexShrink: 0,
            }}>
              {conv.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Message bubble ─────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  const isOut = msg.direction === 'out';
  const isSystem = msg.sent_by_system;
  const isButton = msg.message_type === 'button' || msg.message_type === 'interactive';

  let bgColor = '#1f1f1f';
  let textColor = '#e5e5e5';
  let border2 = '1px solid #2a2a2a';

  if (isOut && isSystem) {
    // System auto-reply (confirm/cancel)
    bgColor = '#1a2e1a';
    textColor = '#a7e4a7';
    border2 = '1px solid #2d4a2d';
  } else if (isOut) {
    // Manual reply from team
    bgColor = '#2a2416';
    textColor = '#f0d9a0';
    border2 = `1px solid ${gold}44`;
  } else if (isButton) {
    // Customer button click
    bgColor = '#1a1f2e';
    textColor = '#a7c7e4';
    border2 = '1px solid #2d3a4a';
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: isOut ? 'flex-end' : 'flex-start',
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: '70%',
        background: bgColor,
        border: border2,
        borderRadius: isOut ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
        padding: '8px 12px',
        color: textColor,
      }}>
        {/* Button click prefix */}
        {isButton && (
          <div style={{ fontSize: 10, color: '#6a8bb3', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            ▶ Button clicked
          </div>
        )}

        {/* System badge */}
        {isSystem && isOut && (
          <div style={{ fontSize: 10, color: '#6a9a6a', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            🤖 Auto-reply
          </div>
        )}

        {/* Media / special types */}
        {['image', 'video', 'audio', 'document', 'sticker'].includes(msg.message_type) && (
          <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic', marginBottom: msg.body ? 6 : 0 }}>
            {msg.message_type === 'image'    && '📷 Image'}
            {msg.message_type === 'video'    && '🎥 Video'}
            {msg.message_type === 'audio'    && '🎵 Audio'}
            {msg.message_type === 'document' && `📄 Document${msg.metadata?.filename ? `: ${msg.metadata.filename}` : ''}`}
            {msg.message_type === 'sticker'  && '🗯 Sticker'}
          </div>
        )}
        {msg.message_type === 'location' && (
          <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic', marginBottom: msg.body ? 6 : 0 }}>
            📍 {msg.metadata?.address || msg.metadata?.name || 'Location shared'}
            {msg.metadata?.latitude && (
              <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                {msg.metadata.latitude}, {msg.metadata.longitude}
              </div>
            )}
          </div>
        )}

        {/* Body */}
        {msg.body && (
          <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {msg.body}
          </div>
        )}

        {/* Timestamp */}
        <div style={{ fontSize: 10, color: '#555', marginTop: 4, textAlign: 'right' }}>
          {formatTime(msg.created_at)}
          {isOut && <span style={{ marginLeft: 4 }}>✓✓</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Order chip ─────────────────────────────────────────────────────────────
function OrderChip({ order }) {
  const color = STATUS_COLOR[order.status] || '#888';
  return (
    <a
      href={`/orders?search=${encodeURIComponent(order.order_number)}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: '#1a1a1a',
        border: `1px solid ${color}44`,
        color: '#ccc',
        padding: '4px 10px',
        borderRadius: 6,
        fontSize: 11,
        textDecoration: 'none',
        fontFamily: 'inherit',
      }}
    >
      <span style={{ color: gold, fontWeight: 600 }}>{order.order_number}</span>
      <span style={{ color }}>{order.status}</span>
      <span style={{ color: '#666' }}>·</span>
      <span style={{ color: '#888' }}>Rs {Number(order.total_amount || 0).toLocaleString()}</span>
    </a>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function MessagesPage() {
  const { user } = useUser();
  const [conversations, setConversations] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  const chatEndRef = useRef(null);
  const pollRef = useRef(null);

  // ─── Load conversations ──────────────────────────────────────────────────
  const loadConversations = useCallback(async (silent = false) => {
    if (!silent) setLoadingConvs(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      const r = await fetch(`/api/whatsapp/inbox/conversations?${params}`);
      const d = await r.json();
      if (d.success) {
        setConversations(d.conversations || []);
      }
    } catch (e) {
      console.error('Load conversations error:', e);
    }
    setLoadingConvs(false);
  }, [search]);

  // ─── Load messages for selected ──────────────────────────────────────────
  const loadMessages = useCallback(async (convId, silent = false) => {
    if (!convId) return;
    if (!silent) setLoadingMsgs(true);
    try {
      const r = await fetch(`/api/whatsapp/inbox/messages?conversation_id=${convId}`);
      const d = await r.json();
      if (d.success) {
        setConversation(d.conversation);
        setMessages(d.messages || []);
        setOrders(d.orders || []);
      }
    } catch (e) {
      console.error('Load messages error:', e);
    }
    setLoadingMsgs(false);
  }, []);

  // ─── Mark as read when opening ───────────────────────────────────────────
  const markRead = async (convId) => {
    try {
      await fetch('/api/whatsapp/inbox/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: convId }),
      });
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, unread_count: 0 } : c));
    } catch {}
  };

  // ─── Select conversation ─────────────────────────────────────────────────
  const selectConversation = (conv) => {
    setSelectedId(conv.id);
    loadMessages(conv.id);
    if (conv.unread_count > 0) markRead(conv.id);
  };

  // ─── Send reply ──────────────────────────────────────────────────────────
  const sendReply = async () => {
    const text = reply.trim();
    if (!text || !selectedId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await fetch('/api/whatsapp/inbox/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: selectedId,
          text,
          user_id: user?.id,
          user_email: user?.email,
        }),
      });
      const d = await r.json();
      if (d.success) {
        setReply('');
        await loadMessages(selectedId, true);
        await loadConversations(true);
      } else {
        setSendError(d.error || 'Failed to send');
      }
    } catch (e) {
      setSendError(e.message || 'Network error');
    }
    setSending(false);
  };

  // ─── Initial load + search change ────────────────────────────────────────
  useEffect(() => { loadConversations(); }, [loadConversations]);

  // ─── Polling: refresh conversations every 15s, messages every 10s ────────
  useEffect(() => {
    pollRef.current = setInterval(() => {
      loadConversations(true);
      if (selectedId) loadMessages(selectedId, true);
    }, 12000);
    return () => clearInterval(pollRef.current);
  }, [selectedId, loadConversations, loadMessages]);

  // ─── Scroll to bottom when messages change ───────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Keyboard shortcut: Enter to send, Shift+Enter for newline ───────────
  const onReplyKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  };

  const selectedConv = conversations.find(c => c.id === selectedId) || conversation;
  const selectedName = selectedConv?.customer_name || selectedConv?.customer_wa_name || formatPhone(selectedConv?.customer_phone || '');

  return (
    <div style={{ padding: 20, fontFamily: 'inherit', color: '#fff', minHeight: 'calc(100vh - 60px)' }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: gold, fontWeight: 600 }}>💬 Messages</h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>
            WhatsApp customer conversations
          </p>
        </div>
        <button
          onClick={() => { loadConversations(); if (selectedId) loadMessages(selectedId); }}
          style={{ background: '#1a1a1a', border: `1px solid ${border}`, color: '#888', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ⟳ Refresh
        </button>
      </div>

      {/* Two-column layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '360px 1fr',
        gap: 16,
        height: 'calc(100vh - 150px)',
        minHeight: 500,
      }}>
        {/* ─── LEFT: Conversations list ──────────────────────────────── */}
        <div style={{
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{ padding: 12, borderBottom: `1px solid ${border}` }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Search name, phone, message..."
              style={{
                width: '100%',
                background: '#0a0a0a',
                border: `1px solid ${border}`,
                color: '#fff',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingConvs && (
              <div style={{ padding: 30, textAlign: 'center', color: '#555', fontSize: 12 }}>
                Loading...
              </div>
            )}
            {!loadingConvs && conversations.length === 0 && (
              <div style={{ padding: 30, textAlign: 'center', color: '#555', fontSize: 12 }}>
                {search ? 'No conversations match' : 'No conversations yet'}
              </div>
            )}
            {conversations.map(conv => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                isActive={conv.id === selectedId}
                onClick={() => selectConversation(conv)}
              />
            ))}
          </div>
        </div>

        {/* ─── RIGHT: Chat view ───────────────────────────────────────── */}
        <div style={{
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {!selectedId ? (
            // Empty state
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#444' }}>
              <div style={{ fontSize: 48, opacity: 0.3 }}>💬</div>
              <div style={{ fontSize: 14 }}>Select a conversation to view messages</div>
            </div>
          ) : (
            <>
              {/* Chat header with customer info + orders */}
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, background: '#0f0f0f' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: gold + '22', color: gold,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 600,
                  }}>
                    {(selectedName[0] || '?').toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{selectedName}</div>
                    <div style={{ fontSize: 11, color: '#666' }}>
                      {formatPhone(selectedConv?.customer_phone || '')}
                      {selectedConv?.customer_wa_name && selectedConv?.customer_name && selectedConv?.customer_wa_name !== selectedConv?.customer_name && (
                        <span style={{ marginLeft: 8 }}>· WA: {selectedConv.customer_wa_name}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Orders chips */}
                {orders.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {orders.slice(0, 6).map(o => <OrderChip key={o.id} order={o} />)}
                    {orders.length > 6 && (
                      <a
                        href={`/orders?search=${encodeURIComponent(selectedConv?.customer_phone || '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, color: gold, textDecoration: 'none', alignSelf: 'center', padding: '4px 8px' }}
                      >
                        +{orders.length - 6} more →
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Messages area */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: 16,
                background: '#0a0a0a',
                backgroundImage: 'radial-gradient(#1a1a1a 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}>
                {loadingMsgs && messages.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#555', fontSize: 12, padding: 30 }}>
                    Loading messages...
                  </div>
                )}
                {!loadingMsgs && messages.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#555', fontSize: 12, padding: 30 }}>
                    No messages in this conversation yet
                  </div>
                )}
                {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
                <div ref={chatEndRef} />
              </div>

              {/* Reply input */}
              <div style={{ padding: 12, borderTop: `1px solid ${border}`, background: '#0f0f0f' }}>
                {sendError && (
                  <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8, padding: '6px 10px', background: '#ef444411', border: '1px solid #ef444433', borderRadius: 5 }}>
                    ⚠ {sendError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <textarea
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    onKeyDown={onReplyKeyDown}
                    placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
                    rows={2}
                    style={{
                      flex: 1,
                      background: '#0a0a0a',
                      border: `1px solid ${border}`,
                      color: '#fff',
                      borderRadius: 8,
                      padding: '10px 14px',
                      fontSize: 13,
                      fontFamily: 'inherit',
                      resize: 'none',
                      outline: 'none',
                      maxHeight: 120,
                    }}
                  />
                  <button
                    onClick={sendReply}
                    disabled={!reply.trim() || sending}
                    style={{
                      background: reply.trim() && !sending ? gold : '#2a2a2a',
                      color: reply.trim() && !sending ? '#000' : '#555',
                      border: 'none',
                      borderRadius: 8,
                      padding: '10px 18px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: reply.trim() && !sending ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sending ? '⟳ Sending...' : 'Send →'}
                  </button>
                </div>
                <div style={{ fontSize: 10, color: '#444', marginTop: 6 }}>
                  💡 You can only send free-text within 24 hours of customer's last message (Meta policy). 
                  After that, you'll need to send a pre-approved template.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
