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
  if (p.startsWith('92') && p.length === 12) {
    return `+${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5)}`;
  }
  return '+' + p;
};

const formatBytes = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
};

const formatDuration = (sec) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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

// Emojis grid — common set for business chat (no external lib)
const EMOJI_SET = [
  '😀','😃','😄','😁','😊','🙂','😉','😍','🥰','😘','😎','🤗','🤩','🤔','🙄','😅',
  '😂','🤣','😇','😋','😛','😜','😝','🤭','🤫','🤐','😐','😑','😶','🙂‍↕️','🙂‍↔️','😏',
  '😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠',
  '🥵','🥶','😳','😱','😨','😰','😥','😓','🤯','🥴','😴','🤤','😪','🙏','👍','👎',
  '👌','✌️','🤞','🤙','👏','🙌','💪','🤝','🫶','❤️','🧡','💛','💚','💙','💜','🖤',
  '🤍','💔','💯','🔥','✨','⭐','🌟','💫','💥','🎉','🎁','💐','🌹','🌸','🏆','💎',
  '👑','💍','💰','💵','💳','📦','📷','📸','📞','✅','❌','⚠️','❗','❓','🚀','📍',
];

// ─── Conversation list item ─────────────────────────────────────────────────
function ConversationItem({ conv, isActive, onClick }) {
  const name = conv.customer_name || conv.customer_wa_name || formatPhone(conv.customer_phone);
  const subtitle = conv.customer_name ? formatPhone(conv.customer_phone) : null;
  const hasUnread = conv.unread_count > 0;
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
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: gold + '22', color: gold,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 600, flexShrink: 0,
      }}>
        {(name[0] || '?').toUpperCase()}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 13,
            fontWeight: hasUnread ? 700 : 600,
            color: '#fff',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {name}
          </span>
          <span style={{
            fontSize: 10,
            color: hasUnread ? '#22c55e' : '#666',
            flexShrink: 0,
            fontWeight: hasUnread ? 700 : 400,
          }}>
            {timeAgo(conv.last_message_at)}
          </span>
        </div>
        {subtitle && (
          <div style={{ fontSize: 10, color: '#666', marginTop: 1, marginBottom: 3 }}>
            {subtitle}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 3 }}>
          <span style={{
            fontSize: 12,
            color: hasUnread ? '#ddd' : '#888',
            fontWeight: hasUnread ? 500 : 400,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
          }}>
            {conv.last_message_direction === 'out' && <span style={{ color: '#555' }}>↗ </span>}
            {conv.last_message_text || '(no messages)'}
          </span>
          {hasUnread && (
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

// ─── Media renderers (inline in bubbles) ────────────────────────────────────
function InboundImage({ url, caption, onPreview }) {
  if (!url) return <MediaProcessing label="Image" />;
  return (
    <div style={{ maxWidth: 280 }}>
      <img
        src={url}
        alt={caption || 'Image'}
        onClick={() => onPreview && onPreview(url)}
        style={{
          width: '100%', maxWidth: 280, borderRadius: 6,
          cursor: 'zoom-in', display: 'block',
          background: '#0a0a0a',
        }}
      />
      {caption && <div style={{ marginTop: 6, fontSize: 13 }}>{caption}</div>}
    </div>
  );
}

function InboundVideo({ url, mimeType, caption }) {
  if (!url) return <MediaProcessing label="Video" />;
  return (
    <div style={{ maxWidth: 280 }}>
      <video
        controls
        src={url}
        style={{ width: '100%', maxWidth: 280, borderRadius: 6, background: '#000' }}
      >
        <source src={url} type={mimeType || 'video/mp4'} />
      </video>
      {caption && <div style={{ marginTop: 6, fontSize: 13 }}>{caption}</div>}
    </div>
  );
}

function InboundAudio({ url, mimeType, isVoice }) {
  if (!url) return <MediaProcessing label={isVoice ? 'Voice note' : 'Audio'} />;
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{isVoice ? '🎤' : '🎵'}</span>
        <span>{isVoice ? 'Voice note' : 'Audio'}</span>
      </div>
      <audio controls src={url} style={{ width: '100%', height: 36 }}>
        <source src={url} type={mimeType || 'audio/mpeg'} />
      </audio>
    </div>
  );
}

function InboundDocument({ url, filename, size, mimeType }) {
  const name = filename || 'Document';
  return (
    <a
      href={url || '#'}
      download={filename || true}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px',
        background: '#0a0a0a', border: '1px solid #2a2a2a',
        borderRadius: 6, color: '#ddd', textDecoration: 'none',
        minWidth: 200, maxWidth: 280,
        pointerEvents: url ? 'auto' : 'none', opacity: url ? 1 : 0.5,
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 6, background: gold + '22',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0,
      }}>📄</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: 10, color: '#888' }}>
          {mimeType?.split('/')[1]?.toUpperCase() || 'FILE'}{size ? ' · ' + formatBytes(size) : ''}
        </div>
      </div>
    </a>
  );
}

function MediaProcessing({ label = 'Media' }) {
  return (
    <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>
      ⏳ {label} processing… (refresh in a few seconds)
    </div>
  );
}

// ─── Message bubble ─────────────────────────────────────────────────────────
function MessageBubble({ msg, onPreviewImage }) {
  const isOut = msg.direction === 'out';
  const isSystem = msg.sent_by_system;
  const isButton = msg.message_type === 'button' || msg.message_type === 'interactive';

  let bgColor = '#1f1f1f';
  let textColor = '#e5e5e5';
  let border2 = '1px solid #2a2a2a';

  if (isOut && isSystem) {
    bgColor = '#1a2e1a';
    textColor = '#a7e4a7';
    border2 = '1px solid #2d4a2d';
  } else if (isOut) {
    bgColor = '#2a2416';
    textColor = '#f0d9a0';
    border2 = `1px solid ${gold}44`;
  } else if (isButton) {
    bgColor = '#1a1f2e';
    textColor = '#a7c7e4';
    border2 = '1px solid #2d3a4a';
  }

  const meta = msg.metadata || {};
  const mediaUrl = meta.media_url;
  const mimeType = meta.mime_type;
  const isVoice = !!meta.voice;

  return (
    <div style={{
      display: 'flex',
      justifyContent: isOut ? 'flex-end' : 'flex-start',
      marginBottom: 10,
    }}>
      <div
        className="emoji-font-fallback"
        style={{
          maxWidth: '72%',
          background: bgColor,
          border: border2,
          borderRadius: isOut ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          padding: '8px 12px',
          color: textColor,
          fontFamily: "'Montserrat', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
        }}
      >
        {isButton && (
          <div style={{ fontSize: 10, color: '#6a8bb3', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            ▶ Button clicked
          </div>
        )}

        {isSystem && isOut && (
          <div style={{ fontSize: 10, color: '#6a9a6a', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            🤖 Auto-reply
          </div>
        )}

        {/* Media rendering */}
        {msg.message_type === 'image' && (
          <InboundImage url={mediaUrl} caption={null} onPreview={onPreviewImage} />
        )}
        {msg.message_type === 'video' && (
          <InboundVideo url={mediaUrl} mimeType={mimeType} caption={null} />
        )}
        {msg.message_type === 'audio' && (
          <InboundAudio url={mediaUrl} mimeType={mimeType} isVoice={isVoice || meta.raw_voice_flag || !isOut /* inbound audio in WhatsApp is usually voice */} />
        )}
        {msg.message_type === 'document' && (
          <InboundDocument url={mediaUrl} filename={meta.filename} size={meta.size} mimeType={mimeType} />
        )}
        {msg.message_type === 'sticker' && mediaUrl && (
          <img src={mediaUrl} alt="sticker" style={{ width: 120, height: 120, objectFit: 'contain' }} />
        )}
        {msg.message_type === 'sticker' && !mediaUrl && <MediaProcessing label="Sticker" />}
        {msg.message_type === 'location' && (
          <div style={{ fontSize: 12, color: '#ccc' }}>
            📍 {meta.address || meta.name || 'Location shared'}
            {meta.latitude && (
              <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                <a
                  href={`https://maps.google.com/?q=${meta.latitude},${meta.longitude}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: '#60a5fa', textDecoration: 'none' }}
                >
                  Open in Maps →
                </a>
              </div>
            )}
          </div>
        )}

        {/* Body text (for text messages, or caption on media with body set) */}
        {msg.body && !['image', 'video', 'sticker'].includes(msg.message_type) && (
          <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: ['audio', 'document', 'location'].includes(msg.message_type) ? 6 : 0 }}>
            {msg.body}
          </div>
        )}
        {msg.body && ['image', 'video'].includes(msg.message_type) && (
          <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 6 }}>
            {msg.body}
          </div>
        )}

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
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: '#1a1a1a', border: `1px solid ${color}44`,
        color: '#ccc', padding: '4px 10px', borderRadius: 6,
        fontSize: 11, textDecoration: 'none', fontFamily: 'inherit',
      }}
    >
      <span style={{ color: gold, fontWeight: 600 }}>{order.order_number}</span>
      <span style={{ color }}>{order.status}</span>
      <span style={{ color: '#666' }}>·</span>
      <span style={{ color: '#888' }}>Rs {Number(order.total_amount || 0).toLocaleString()}</span>
    </a>
  );
}

// ─── Image preview modal ────────────────────────────────────────────────────
function ImagePreviewModal({ url, onClose }) {
  if (!url) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'zoom-out', padding: 20,
      }}
    >
      <img src={url} alt="preview" style={{ maxWidth: '95%', maxHeight: '95%', borderRadius: 4 }} />
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 20, right: 20,
          background: '#1a1a1a', color: '#fff', border: '1px solid #333',
          width: 40, height: 40, borderRadius: 20, fontSize: 18, cursor: 'pointer',
        }}
      >✕</button>
      <a
        href={url}
        download
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 20, right: 70,
          background: '#1a1a1a', color: '#fff', border: '1px solid #333',
          padding: '8px 14px', borderRadius: 20, fontSize: 13, textDecoration: 'none',
        }}
      >⬇ Download</a>
    </div>
  );
}

// ─── Emoji picker ───────────────────────────────────────────────────────────
function EmojiPicker({ onPick, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 999 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="emoji-font"
        style={{
          position: 'absolute', bottom: 100, left: 20,
          width: 320, maxHeight: 280, overflowY: 'auto',
          background: '#1a1a1a', border: `1px solid ${border}`,
          borderRadius: 10, padding: 10,
          display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        }}
      >
        {EMOJI_SET.map(e => (
          <button
            key={e}
            onClick={() => { onPick(e); }}
            style={{
              background: 'transparent', border: 'none',
              fontSize: 20, padding: 4, cursor: 'pointer',
              borderRadius: 4, transition: 'background 0.1s',
            }}
            onMouseEnter={(ev) => ev.currentTarget.style.background = '#2a2a2a'}
            onMouseLeave={(ev) => ev.currentTarget.style.background = 'transparent'}
          >{e}</button>
        ))}
      </div>
    </div>
  );
}

// ─── Attachment menu ────────────────────────────────────────────────────────
function AttachmentMenu({ onPickPhoto, onPickVideo, onPickDocument, onClose }) {
  const items = [
    { icon: '📷', label: 'Photo', color: '#60a5fa', onClick: onPickPhoto },
    { icon: '🎥', label: 'Video', color: '#a78bfa', onClick: onPickVideo },
    { icon: '📄', label: 'Document', color: '#f59e0b', onClick: onPickDocument },
  ];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 998 }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', bottom: 100, left: 60,
          background: '#1a1a1a', border: `1px solid ${border}`,
          borderRadius: 10, padding: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column', gap: 2,
          minWidth: 180,
        }}
      >
        {items.map(it => (
          <button
            key={it.label}
            onClick={() => { it.onClick(); onClose(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'transparent', border: 'none', color: '#fff',
              padding: '10px 12px', borderRadius: 6, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            }}
            onMouseEnter={(ev) => ev.currentTarget.style.background = '#2a2a2a'}
            onMouseLeave={(ev) => ev.currentTarget.style.background = 'transparent'}
          >
            <span style={{
              width: 32, height: 32, borderRadius: 16,
              background: it.color + '22',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>{it.icon}</span>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Voice recorder ─────────────────────────────────────────────────────────
function VoiceRecorder({ onSend, onCancel }) {
  const [duration, setDuration] = useState(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const mimeRef = useRef('audio/webm;codecs=opus');

  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        // Pick best supported mime type
        const preferred = [
          'audio/webm;codecs=opus',
          'audio/ogg;codecs=opus',
          'audio/webm',
          'audio/mp4',
        ];
        let mimeType = '';
        for (const m of preferred) {
          if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
        }
        mimeRef.current = mimeType || 'audio/webm';

        const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorderRef.current = rec;
        rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
        rec.start();
        setRecording(true);

        intervalRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      } catch (e) {
        setError(e.message || 'Microphone permission denied');
      }
    })();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line
  }, []);

  const stopAndSend = () => {
    if (!recorderRef.current || !recording) return;
    const rec = recorderRef.current;
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      onSend(blob, mimeRef.current, duration);
    };
    rec.stop();
    setRecording(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
  };

  const cancel = () => {
    if (recorderRef.current && recording) {
      try { recorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (intervalRef.current) clearInterval(intervalRef.current);
    onCancel();
  };

  if (error) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: '#2e1a1a', border: '1px solid #4a2d2d',
        borderRadius: 8, padding: '10px 14px', flex: 1, color: '#f87171', fontSize: 13,
      }}>
        <span>⚠ {error}</span>
        <button
          onClick={cancel}
          style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #4a2d2d', color: '#f87171', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
        >Close</button>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: '#1a1a1a', border: `1px solid ${border}`,
      borderRadius: 8, padding: '10px 14px', flex: 1,
    }}>
      <div style={{
        width: 10, height: 10, borderRadius: 5, background: '#ef4444',
        animation: 'pulse 1s infinite',
      }} />
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      <span style={{ color: '#ef4444', fontSize: 13, fontWeight: 600 }}>Recording</span>
      <span style={{ color: '#888', fontSize: 13, fontFamily: 'monospace' }}>{formatDuration(duration)}</span>

      <div style={{ flex: 1 }} />

      <button
        onClick={cancel}
        title="Cancel"
        style={{
          background: '#2a1a1a', border: '1px solid #4a2d2d', color: '#f87171',
          width: 36, height: 36, borderRadius: 18, fontSize: 16, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >🗑</button>

      <button
        onClick={stopAndSend}
        title="Send voice note"
        style={{
          background: '#1a2e1a', border: '1px solid #2d4a2d', color: '#22c55e',
          width: 36, height: 36, borderRadius: 18, fontSize: 16, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >➤</button>
    </div>
  );
}

// ─── Chat header kebab menu ─────────────────────────────────────────────────
function HeaderMenu({ onMarkUnread, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 998 }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 60, right: 20,
          background: '#1a1a1a', border: `1px solid ${border}`,
          borderRadius: 10, padding: 6, minWidth: 180,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        }}
      >
        <button
          onClick={() => { onMarkUnread(); onClose(); }}
          style={{
            display: 'block', width: '100%',
            background: 'transparent', border: 'none', color: '#fff',
            padding: '10px 12px', borderRadius: 6, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          }}
          onMouseEnter={(ev) => ev.currentTarget.style.background = '#2a2a2a'}
          onMouseLeave={(ev) => ev.currentTarget.style.background = 'transparent'}
        >
          📌 Mark as unread
        </button>
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function MessagesPage() {
  const { profile, userEmail } = useUser();
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

  // New state
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState(null);

  const chatEndRef = useRef(null);
  const pollRef = useRef(null);
  const photoInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const docInputRef = useRef(null);
  const textareaRef = useRef(null);

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

  // ─── Mark as unread ──────────────────────────────────────────────────────
  const markUnread = async () => {
    if (!selectedId) return;
    try {
      const r = await fetch('/api/whatsapp/inbox/mark-unread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: selectedId }),
      });
      const d = await r.json();
      if (d.success) {
        setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, unread_count: d.unread_count || 1 } : c));
        // Also deselect so user sees the badge
        setSelectedId(null);
        setMessages([]);
        setOrders([]);
      }
    } catch (e) {
      console.error('Mark unread error:', e);
    }
  };

  // ─── Select conversation ─────────────────────────────────────────────────
  const selectConversation = (conv) => {
    setSelectedId(conv.id);
    setReply('');
    setSendError(null);
    setShowEmoji(false);
    setShowAttach(false);
    setShowMenu(false);
    loadMessages(conv.id);
    if (conv.unread_count > 0) markRead(conv.id);
  };

  // ─── Send text reply ─────────────────────────────────────────────────────
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
          user_id: profile?.id,
          user_email: userEmail,
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

  // ─── Send media (image/video/document/voice) ─────────────────────────────
  const sendMediaFile = async (file, { caption = '', voice = false, label = 'Media' } = {}) => {
    if (!file || !selectedId || uploading) return;
    setUploading(true);
    setUploadLabel(label);
    setSendError(null);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name || 'upload');
      fd.append('conversation_id', selectedId);
      if (caption) fd.append('caption', caption);
      if (voice) fd.append('voice', 'true');
      if (profile?.id) fd.append('user_id', profile.id);
      if (userEmail) fd.append('user_email', userEmail);

      const r = await fetch('/api/whatsapp/inbox/send-media', {
        method: 'POST',
        body: fd,
      });
      const d = await r.json();
      if (d.success) {
        await loadMessages(selectedId, true);
        await loadConversations(true);
      } else {
        setSendError(d.error || 'Upload failed' + (d.hint ? ` — ${d.hint}` : ''));
      }
    } catch (e) {
      setSendError(e.message || 'Network error');
    }
    setUploading(false);
    setUploadLabel('');
  };

  // ─── File input handlers ─────────────────────────────────────────────────
  const onPickPhoto = () => { photoInputRef.current && photoInputRef.current.click(); };
  const onPickVideo = () => { videoInputRef.current && videoInputRef.current.click(); };
  const onPickDocument = () => { docInputRef.current && docInputRef.current.click(); };

  const onFileSelected = (kind) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const caption = reply.trim();
    sendMediaFile(file, { caption, label: kind });
    if (caption) setReply('');
    // reset input so re-selecting same file works
    e.target.value = '';
  };

  // ─── Voice note: record and send ─────────────────────────────────────────
  const onSendVoice = async (blob, mimeType, duration) => {
    setRecording(false);
    if (!blob || blob.size < 200) {
      setSendError('Recording too short');
      return;
    }
    const ext = mimeType.includes('webm') ? 'webm' :
                mimeType.includes('ogg')  ? 'ogg'  :
                mimeType.includes('mp4')  ? 'm4a'  : 'audio';
    const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
    await sendMediaFile(file, { voice: true, label: 'Voice note' });
  };

  // ─── Emoji insert ────────────────────────────────────────────────────────
  const insertEmoji = (emoji) => {
    const ta = textareaRef.current;
    if (!ta) {
      setReply(r => r + emoji);
      return;
    }
    const start = ta.selectionStart ?? reply.length;
    const end = ta.selectionEnd ?? reply.length;
    const next = reply.slice(0, start) + emoji + reply.slice(end);
    setReply(next);
    // Restore cursor position after emoji
    setTimeout(() => {
      try {
        ta.focus();
        const pos = start + emoji.length;
        ta.setSelectionRange(pos, pos);
      } catch {}
    }, 0);
  };

  // ─── Initial load + search change ────────────────────────────────────────
  useEffect(() => { loadConversations(); }, [loadConversations]);

  // ─── Polling: refresh conversations + messages ───────────────────────────
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

  const canType = !recording && !uploading;

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
          background: card, border: `1px solid ${border}`, borderRadius: 10,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ padding: 12, borderBottom: `1px solid ${border}` }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Search name, phone, message..."
              style={{
                width: '100%', background: '#0a0a0a', border: `1px solid ${border}`,
                color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 12,
                fontFamily: 'inherit', outline: 'none',
              }}
            />
          </div>

          {/* Filter tabs: All / Unread (WhatsApp-style) */}
          {(() => {
            const unreadCount = conversations.filter(c => (c.unread_count || 0) > 0).length;
            const tabs = [
              { id: 'all',    label: 'All',    count: null },
              { id: 'unread', label: 'Unread', count: unreadCount },
            ];
            return (
              <div style={{
                display: 'flex', gap: 6, padding: '8px 12px',
                borderBottom: `1px solid ${border}`, background: '#0f0f0f',
              }}>
                {tabs.map(t => {
                  const active = filter === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setFilter(t.id)}
                      style={{
                        background: active ? gold : 'transparent',
                        color: active ? '#000' : '#aaa',
                        border: `1px solid ${active ? gold : border}`,
                        borderRadius: 14, padding: '4px 12px',
                        fontSize: 12, fontWeight: active ? 700 : 500,
                        cursor: 'pointer', fontFamily: 'inherit',
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {t.label}
                      {t.count != null && t.count > 0 && (
                        <span style={{
                          background: active ? '#000' : '#22c55e',
                          color: active ? gold : '#000',
                          fontSize: 10, fontWeight: 700,
                          padding: '1px 6px', borderRadius: 8, minWidth: 16, textAlign: 'center',
                        }}>{t.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })()}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {(() => {
              const visibleConvs = filter === 'unread'
                ? conversations.filter(c => (c.unread_count || 0) > 0)
                : conversations;
              return (
                <>
                  {loadingConvs && (
                    <div style={{ padding: 30, textAlign: 'center', color: '#555', fontSize: 12 }}>
                      Loading...
                    </div>
                  )}
                  {!loadingConvs && visibleConvs.length === 0 && (
                    <div style={{ padding: 30, textAlign: 'center', color: '#555', fontSize: 12 }}>
                      {filter === 'unread'
                        ? 'No unread conversations 🎉'
                        : (search ? 'No conversations match' : 'No conversations yet')}
                    </div>
                  )}
                  {visibleConvs.map(conv => (
                    <ConversationItem
                      key={conv.id}
                      conv={conv}
                      isActive={conv.id === selectedId}
                      onClick={() => selectConversation(conv)}
                    />
                  ))}
                </>
              );
            })()}
          </div>
        </div>

        {/* ─── RIGHT: Chat view ───────────────────────────────────────── */}
        <div style={{
          background: card, border: `1px solid ${border}`, borderRadius: 10,
          display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
        }}>
          {!selectedId ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#444' }}>
              <div style={{ fontSize: 48, opacity: 0.3 }}>💬</div>
              <div style={{ fontSize: 14 }}>Select a conversation to view messages</div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, background: '#0f0f0f', position: 'relative' }}>
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
                  <button
                    onClick={() => setShowMenu(s => !s)}
                    title="More actions"
                    style={{
                      background: 'transparent', border: `1px solid ${border}`, color: '#888',
                      width: 32, height: 32, borderRadius: 6, cursor: 'pointer', fontSize: 16,
                    }}
                  >⋮</button>
                </div>

                {orders.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {orders.slice(0, 6).map(o => <OrderChip key={o.id} order={o} />)}
                    {orders.length > 6 && (
                      <a
                        href={`/orders?search=${encodeURIComponent(selectedConv?.customer_phone || '')}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: gold, textDecoration: 'none', alignSelf: 'center', padding: '4px 8px' }}
                      >
                        +{orders.length - 6} more →
                      </a>
                    )}
                  </div>
                )}

                {showMenu && (
                  <HeaderMenu
                    onMarkUnread={markUnread}
                    onClose={() => setShowMenu(false)}
                  />
                )}
              </div>

              {/* Messages area */}
              <div style={{
                flex: 1, overflowY: 'auto', padding: 16,
                background: '#0a0a0a',
                backgroundImage: 'radial-gradient(#1a1a1a 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}>
                {loadingMsgs && messages.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#555', fontSize: 12, padding: 30 }}>Loading messages...</div>
                )}
                {!loadingMsgs && messages.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#555', fontSize: 12, padding: 30 }}>No messages in this conversation yet</div>
                )}
                {messages.map(msg => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    onPreviewImage={(u) => setPreviewImageUrl(u)}
                  />
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Reply bar */}
              <div style={{ padding: 12, borderTop: `1px solid ${border}`, background: '#0f0f0f' }}>
                {sendError && (
                  <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8, padding: '6px 10px', background: '#ef444411', border: '1px solid #ef444433', borderRadius: 5 }}>
                    ⚠ {sendError}
                  </div>
                )}
                {uploading && (
                  <div style={{ fontSize: 11, color: gold, marginBottom: 8, padding: '6px 10px', background: gold + '11', border: `1px solid ${gold}33`, borderRadius: 5 }}>
                    ⬆ Sending {uploadLabel.toLowerCase()}…
                  </div>
                )}

                {recording ? (
                  <VoiceRecorder
                    onSend={onSendVoice}
                    onCancel={() => setRecording(false)}
                  />
                ) : (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                    {/* Emoji */}
                    <button
                      onClick={() => { setShowEmoji(s => !s); setShowAttach(false); }}
                      disabled={!canType}
                      title="Emoji"
                      className="emoji-font"
                      style={{
                        background: '#1a1a1a', border: `1px solid ${border}`, color: '#ccc',
                        width: 40, height: 40, borderRadius: 8, fontSize: 18, cursor: canType ? 'pointer' : 'not-allowed',
                        opacity: canType ? 1 : 0.4,
                      }}
                    >😊</button>

                    {/* Attachment */}
                    <button
                      onClick={() => { setShowAttach(s => !s); setShowEmoji(false); }}
                      disabled={!canType}
                      title="Attach file"
                      style={{
                        background: '#1a1a1a', border: `1px solid ${border}`, color: '#ccc',
                        width: 40, height: 40, borderRadius: 8, fontSize: 18, cursor: canType ? 'pointer' : 'not-allowed',
                        opacity: canType ? 1 : 0.4,
                      }}
                    >📎</button>

                    {/* Textarea */}
                    <textarea
                      ref={textareaRef}
                      value={reply}
                      onChange={e => setReply(e.target.value)}
                      onKeyDown={onReplyKeyDown}
                      disabled={!canType}
                      placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
                      rows={2}
                      style={{
                        flex: 1, background: '#0a0a0a', border: `1px solid ${border}`,
                        color: '#fff', borderRadius: 8, padding: '10px 14px',
                        fontSize: 13,
                        fontFamily: "'Montserrat', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
                        resize: 'none', outline: 'none', maxHeight: 120,
                        opacity: canType ? 1 : 0.4,
                      }}
                    />

                    {/* Mic OR Send */}
                    {reply.trim() ? (
                      <button
                        onClick={sendReply}
                        disabled={sending || !canType}
                        title="Send"
                        style={{
                          background: (sending || !canType) ? '#2a2a2a' : gold,
                          color: (sending || !canType) ? '#555' : '#000',
                          border: 'none', borderRadius: 8, padding: '0 18px',
                          height: 40, fontSize: 14, fontWeight: 700,
                          cursor: (sending || !canType) ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        {sending ? '⟳' : '➤'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setRecording(true)}
                        disabled={!canType}
                        title="Record voice note"
                        style={{
                          background: '#1a1a1a', border: `1px solid ${border}`, color: '#ccc',
                          width: 40, height: 40, borderRadius: 8, fontSize: 18,
                          cursor: canType ? 'pointer' : 'not-allowed', opacity: canType ? 1 : 0.4,
                        }}
                      >🎤</button>
                    )}
                  </div>
                )}

                <div style={{ fontSize: 10, color: '#444', marginTop: 6 }}>
                  💡 You can only send free-text / media within 24 hours of customer's last message (Meta policy).
                  After that, use a pre-approved template.
                </div>

                {/* Popups */}
                {showEmoji && (
                  <EmojiPicker
                    onPick={(e) => { insertEmoji(e); }}
                    onClose={() => setShowEmoji(false)}
                  />
                )}
                {showAttach && (
                  <AttachmentMenu
                    onPickPhoto={onPickPhoto}
                    onPickVideo={onPickVideo}
                    onPickDocument={onPickDocument}
                    onClose={() => setShowAttach(false)}
                  />
                )}

                {/* Hidden file inputs */}
                <input
                  ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp"
                  onChange={onFileSelected('Photo')} style={{ display: 'none' }}
                />
                <input
                  ref={videoInputRef} type="file" accept="video/mp4,video/3gpp"
                  onChange={onFileSelected('Video')} style={{ display: 'none' }}
                />
                <input
                  ref={docInputRef} type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={onFileSelected('Document')} style={{ display: 'none' }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Image preview modal */}
      {previewImageUrl && (
        <ImagePreviewModal url={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      )}
    </div>
  );
}
