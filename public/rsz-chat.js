/* ============================================================================
 * RS ZEVAR — Storefront Chat Widget  (served at https://erp.rszevar.com/rsz-chat.js)
 * Add ONCE to theme.liquid before </body>:
 *   <script src="https://erp.rszevar.com/rsz-chat.js" defer></script>
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__RSZ_CHAT__) return;
  window.__RSZ_CHAT__ = true;

  var API = 'https://erp.rszevar.com/api/public/storefront-chat';
  var WHATSAPP = '923032244550';
  var GREETING = 'Hi! \uD83D\uDC4B Welcome to RS ZEVAR. How can we help you today?';
  var INK = '#171513', INK2 = '#2a2520', GOLD = '#c6a15b', GOLD_DARK = '#a8853f';
  var HIST_TTL = 24 * 60 * 60 * 1000;

  var sessionId;
  try {
    sessionId = localStorage.getItem('rsz_chat_sid');
    if (!sessionId) { sessionId = 'w_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('rsz_chat_sid', sessionId); }
  } catch (e) { sessionId = 'w_' + Math.random().toString(36).slice(2); }

  function loadHistory() {
    try { var raw = JSON.parse(localStorage.getItem('rsz_chat_hist') || 'null'); if (raw && raw.t && (Date.now() - raw.t) < HIST_TTL && Array.isArray(raw.h)) return raw.h; } catch (e) {}
    return [];
  }
  function saveHistory() { try { localStorage.setItem('rsz_chat_hist', JSON.stringify({ t: Date.now(), h: history.slice(-40) })); } catch (e) {} }

  var history = loadHistory();
  var pendingMedia = null;  // images only (voice auto-sends)
  var open = false, busy = false, rendered = false;

  var css = ''
    + '.rsz-fab{position:fixed;right:18px;bottom:20px;width:56px;height:56px;border-radius:50%;'
    + 'background:linear-gradient(145deg,' + INK2 + ',' + INK + ');box-shadow:0 8px 22px rgba(0,0,0,.32);'
    + 'display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483000;border:1px solid ' + GOLD + '55;transition:transform .15s;}'
    + '.rsz-fab:hover{transform:scale(1.06);}'
    + '.rsz-fab svg{width:26px;height:26px;fill:' + GOLD + ';}'
    + '.rsz-panel{position:fixed;right:18px;bottom:88px;width:min(372px,calc(100vw - 24px));height:min(600px,calc(100vh - 120px));'
    + 'background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.32);display:none;flex-direction:column;overflow:hidden;'
    + 'z-index:2147483001;font-family:inherit,-apple-system,Segoe UI,Roboto,sans-serif;}'
    + '.rsz-panel.show{display:flex;}'
    + '.rsz-head{background:linear-gradient(135deg,' + INK + ',' + INK2 + ');color:#fff;padding:14px 16px;display:flex;align-items:center;gap:8px;}'
    + '.rsz-head .t b{font-size:15px;font-weight:700;color:' + GOLD + ';letter-spacing:.5px;}'
    + '.rsz-head .t small{display:block;font-size:11px;opacity:.7;font-weight:400;color:#fff;}'
    + '.rsz-spacer{flex:1;}'
    + '#rszWa{cursor:pointer;background:#25D366;border:none;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.25);}'
    + '#rszWa svg{width:30px;height:30px;display:block;}'
    + '.rsz-x{margin-left:2px;cursor:pointer;font-size:24px;line-height:1;opacity:.85;background:none;border:none;color:#fff;padding:0 4px;}'
    + '.rsz-body{flex:1;overflow-y:auto;padding:14px;background:#f7f4ef;display:flex;flex-direction:column;gap:10px;}'
    + '.rsz-msg{max-width:82%;padding:9px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}'
    + '.rsz-bot{align-self:flex-start;background:#fff;color:#222;border:1px solid #ece5da;border-bottom-left-radius:4px;}'
    + '.rsz-user{align-self:flex-end;background:linear-gradient(135deg,' + GOLD + ',' + GOLD_DARK + ');color:#fff;border-bottom-right-radius:4px;}'
    + '.rsz-msg a{color:' + GOLD_DARK + ';font-weight:600;}'
    + '.rsz-user a{color:#fff;text-decoration:underline;}'
    + '.rsz-typing{align-self:flex-start;color:#999;font-size:13px;padding:4px 6px;}'
    + '.rsz-cards{display:flex;flex-direction:column;gap:8px;align-self:flex-start;width:82%;}'
    + '.rsz-card{display:flex;gap:10px;background:#fff;border:1px solid #ece5da;border-radius:12px;padding:8px;text-decoration:none;color:#222;align-items:center;}'
    + '.rsz-card img{width:52px;height:52px;border-radius:8px;object-fit:cover;background:#f0eadf;flex:0 0 auto;}'
    + '.rsz-card .n{font-size:13px;font-weight:600;line-height:1.3;}'
    + '.rsz-card .p{font-size:12px;color:' + GOLD_DARK + ';font-weight:700;margin-top:2px;}'
    + '.rsz-card .oos{font-size:11px;color:#c0392b;margin-top:2px;}'
    + '.rsz-wa{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;background:#25D366;color:#fff;text-decoration:none;padding:9px 14px;border-radius:10px;font-size:13px;font-weight:700;}'
    + '.rsz-foot{border-top:1px solid #ece5da;padding:8px;background:#fff;}'
    + '.rsz-prev{display:flex;align-items:center;gap:8px;font-size:12px;color:#666;padding:4px 6px 6px;}'
    + '.rsz-prev img{width:36px;height:36px;border-radius:6px;object-fit:cover;}'
    + '.rsz-prev button{margin-left:auto;background:none;border:none;color:#c0392b;cursor:pointer;font-size:12px;}'
    + '.rsz-inrow{display:flex;align-items:center;gap:6px;}'
    + '.rsz-in{flex:1;border:1px solid #ddd;border-radius:22px;padding:10px 15px;font-size:14px;outline:none;font-family:inherit;min-width:0;}'
    + '.rsz-ico{width:42px;height:42px;border-radius:50%;border:none;background:#f1ece3;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}'
    + '.rsz-ico svg{width:23px;height:23px;fill:#7c6a4d;}'
    + '.rsz-send{background:linear-gradient(135deg,' + GOLD + ',' + GOLD_DARK + ');}'
    + '.rsz-send svg{fill:#fff;}'
    // recording bar (WhatsApp-style)
    + '.rsz-recbar{display:flex;align-items:center;gap:8px;}'
    + '.rsz-recmid{flex:1;display:flex;align-items:center;gap:9px;background:#fdeceb;border-radius:22px;padding:11px 16px;}'
    + '.rsz-dot{width:11px;height:11px;border-radius:50%;background:#e0392b;animation:rszpulse 1s infinite;flex:0 0 auto;}'
    + '.rsz-tmr{font-size:14px;font-weight:700;color:#c0392b;font-variant-numeric:tabular-nums;}'
    + '.rsz-reclbl{font-size:12px;color:#999;margin-left:auto;}'
    + '.rsz-cancel{background:#f3eded;}.rsz-cancel svg{fill:#c0392b;}'
    + '@keyframes rszpulse{0%{opacity:1}50%{opacity:.25}100%{opacity:1}}'
    + '.rsz-foot .pwr{display:block;text-align:center;font-size:10px;color:#bbb;margin-top:5px;}'
    + '@media (max-width:600px){'
    + '.rsz-fab{bottom:78px;right:14px;width:50px;height:50px;}'
    + '.rsz-fab svg{width:23px;height:23px;}'
    + '.rsz-panel{right:0;left:0;bottom:0;width:100%;height:min(72vh,560px);border-radius:18px 18px 0 0;}'
    + '}';

  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var fab = document.createElement('button');
  fab.className = 'rsz-fab'; fab.setAttribute('aria-label', 'Chat with RS ZEVAR');
  fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.4 1.2 4.6 3.1 6.1-.1 1.1-.6 2.4-1.4 3.4 1.6-.2 3.2-.8 4.4-1.7 1.2.4 2.5.6 3.9.6 5.5 0 10-3.8 10-8.4S17.5 3 12 3z"/></svg>';

  // Proper filled WhatsApp logo (white on green)
  var WA_LOGO = '<svg viewBox="0 0 24 24" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.2-.58.2-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"/></svg>';

  var panel = document.createElement('div');
  panel.className = 'rsz-panel';
  panel.innerHTML = ''
    + '<div class="rsz-head">'
    +   '<div class="t"><b>RS ZEVAR</b><small>Typically replies instantly</small></div>'
    +   '<div class="rsz-spacer"></div>'
    +   '<button id="rszWa" title="Chat on WhatsApp">' + WA_LOGO + '</button>'
    +   '<button class="rsz-x" aria-label="Close">\u00D7</button>'
    + '</div>'
    + '<div class="rsz-body" id="rszBody"></div>'
    + '<div class="rsz-foot">'
    +   '<div class="rsz-prev" id="rszPrev" style="display:none;"></div>'
    +   '<div class="rsz-inrow" id="rszInrow">'
    +     '<button class="rsz-ico" id="rszPhoto" title="Send a photo"><svg viewBox="0 0 24 24"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg></button>'
    +     '<button class="rsz-ico" id="rszMic" title="Voice message"><svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg></button>'
    +     '<input class="rsz-in" id="rszIn" placeholder="Type your message..." />'
    +     '<button class="rsz-ico rsz-send" id="rszSend" title="Send"><svg viewBox="0 0 24 24"><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z"/></svg></button>'
    +   '</div>'
    +   '<div class="rsz-recbar" id="rszRec" style="display:none;">'
    +     '<button class="rsz-ico rsz-cancel" id="rszCancel" title="Cancel"><svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7zm3-3h6l1 2h4v2H2V6h4l1-2z"/></svg></button>'
    +     '<div class="rsz-recmid"><span class="rsz-dot"></span><span class="rsz-tmr" id="rszTimer">0:00</span><span class="rsz-reclbl">Recording…</span></div>'
    +     '<button class="rsz-ico rsz-send" id="rszStop" title="Send voice"><svg viewBox="0 0 24 24"><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z"/></svg></button>'
    +   '</div>'
    +   '<span class="pwr">RS ZEVAR \u2022 rszevar.com</span>'
    + '</div>'
    + '<input type="file" id="rszFile" accept="image/*" style="display:none;" />';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var bodyEl = panel.querySelector('#rszBody');
  var inEl = panel.querySelector('#rszIn');
  var prevEl = panel.querySelector('#rszPrev');
  var fileEl = panel.querySelector('#rszFile');
  var inRow = panel.querySelector('#rszInrow');
  var recBar = panel.querySelector('#rszRec');
  var timerEl = panel.querySelector('#rszTimer');

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>'; }); }
  function scroll() { bodyEl.scrollTop = bodyEl.scrollHeight; }
  function fmtDur(s) { var m = Math.floor(s / 60), ss = s % 60; return m + ':' + (ss < 10 ? '0' : '') + ss; }

  function addMsg(role, text, img) {
    var d = document.createElement('div');
    d.className = 'rsz-msg ' + (role === 'user' ? 'rsz-user' : 'rsz-bot');
    var html = '';
    if (img) html += '<img src="' + img + '" style="max-width:170px;max-height:170px;border-radius:9px;display:block;margin-bottom:' + (text ? '6px' : '0') + ';">';
    if (text) html += linkify(text);
    d.innerHTML = html; bodyEl.appendChild(d); scroll();
  }
  function addCards(products) {
    if (!products || !products.length) return;
    var wrap = document.createElement('div'); wrap.className = 'rsz-cards';
    products.forEach(function (p) {
      var a = document.createElement('a'); a.className = 'rsz-card'; a.href = p.url || '#'; a.target = '_blank'; a.rel = 'noopener';
      var price = p.price != null ? ('Rs. ' + p.price) : '';
      a.innerHTML = (p.image ? '<img src="' + esc(p.image) + '" alt="">' : '<div style="width:52px;height:52px;border-radius:8px;background:#f0eadf;"></div>')
        + '<div><div class="n">' + esc(p.name || 'Product') + '</div>'
        + (price ? '<div class="p">' + esc(price) + '</div>' : '')
        + (p.in_stock === false ? '<div class="oos">Out of stock</div>' : '') + '</div>';
      wrap.appendChild(a);
    });
    bodyEl.appendChild(wrap); scroll();
  }
  function waLink() {
    // Prefill the customer's recent messages so the team gets full context.
    var userMsgs = history.filter(function (m) { return m.role === 'user'; })
      .map(function (m) { return (m.text || '').trim(); })
      .filter(function (t) { return t && t !== '\uD83D\uDCF7 Photo'; });
    var recent = userMsgs.slice(-4).join('\n\u2022 ');
    var txt = 'Assalam-o-alaikum! Main RS ZEVAR website chat se aaya hun.';
    if (recent) txt += '\n\nMeri baat-cheet:\n\u2022 ' + recent;
    txt += '\n\n(rszevar.com chat)';
    return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(txt.slice(0, 1500));
  }
  function addWhatsApp() {
    var a = document.createElement('a'); a.className = 'rsz-wa'; a.href = waLink(); a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M20 11.5a8 8 0 0 1-11.9 7L4 19.5l1.1-4A8 8 0 1 1 20 11.5z"/></svg> Chat on WhatsApp';
    bodyEl.appendChild(a); scroll();
  }

  var typingEl = null;
  function showTyping() { typingEl = document.createElement('div'); typingEl.className = 'rsz-typing'; typingEl.textContent = 'typing\u2026'; bodyEl.appendChild(typingEl); scroll(); }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  function setPreview() {
    if (!pendingMedia) { prevEl.style.display = 'none'; prevEl.innerHTML = ''; return; }
    prevEl.style.display = 'flex';
    prevEl.innerHTML = '<img src="data:' + pendingMedia.mimeType + ';base64,' + pendingMedia.data + '"><span>Photo ready</span>';
    var btn = document.createElement('button'); btn.textContent = 'Remove';
    btn.onclick = function () { pendingMedia = null; setPreview(); };
    prevEl.appendChild(btn);
  }

  function renderHistory() {
    if (rendered) return; rendered = true; bodyEl.innerHTML = '';
    if (history.length === 0) { addMsg('bot', GREETING); history.push({ role: 'assistant', text: GREETING }); saveHistory(); }
    else { history.forEach(function (m) { addMsg(m.role === 'user' ? 'user' : 'bot', m.text); }); }
  }

  // ── Send (text + optional image, or voice) ──
  function doSend(text, media, displayOverride) {
    if (busy) return;
    if (!text && !media) return;
    var img = (media && media.kind === 'image') ? ('data:' + media.mimeType + ';base64,' + media.data) : null;
    if (img) {
      // photo (with optional caption) shown as a real thumbnail
      addMsg('user', text || '', img);
    } else {
      var display = displayOverride || text || (media && media.kind === 'audio' ? '\uD83C\uDFA4 Voice message' : '');
      addMsg('user', display);
    }
    var histText = text || (media && media.kind === 'image' ? '\uD83D\uDCF7 Photo' : (media ? '[' + media.kind + ']' : ''));
    history.push({ role: 'user', text: histText }); saveHistory();
    busy = true; showTyping();
    var payload = { sessionId: sessionId, messages: history };
    if (media) payload[media.kind === 'image' ? 'image' : 'audio'] = { mimeType: media.mimeType, data: media.data };
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        hideTyping(); busy = false;
        var reply = d.reply || 'Sorry, please try again \uD83D\uDE0A';
        addMsg('bot', reply); history.push({ role: 'assistant', text: reply }); saveHistory();
        if (d.products && d.products.length) addCards(d.products);
        if (d.handoff) addWhatsApp();
      })
      .catch(function () { hideTyping(); busy = false; addMsg('bot', 'Connection issue \uD83D\uDE0A please try WhatsApp.'); addWhatsApp(); });
  }
  function send() {
    var text = inEl.value.trim(); var media = pendingMedia;
    if (!text && !media) return;
    inEl.value = ''; pendingMedia = null; setPreview();
    doSend(text, media, null);
  }

  // ── Photo ──
  panel.querySelector('#rszPhoto').onclick = function () { fileEl.click(); };
  fileEl.onchange = function () {
    var f = fileEl.files && fileEl.files[0]; if (!f) return;
    if (f.size > 4.4 * 1024 * 1024) { addMsg('bot', 'Please send a smaller photo (under 4MB) \uD83D\uDE0A'); fileEl.value = ''; return; }
    var rd = new FileReader();
    rd.onload = function () { pendingMedia = { kind: 'image', mimeType: f.type || 'image/jpeg', data: String(rd.result).split(',')[1] }; setPreview(); };
    rd.readAsDataURL(f); fileEl.value = '';
  };

  // ── Voice (WhatsApp-style with live timer) ──
  var rec = null, chunks = [], recTimer = null, recStart = 0;
  function pickMime() {
    var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (var i = 0; i < c.length; i++) { if (window.MediaRecorder && MediaRecorder.isTypeSupported(c[i])) return c[i]; }
    return '';
  }
  function showRec(on) {
    inRow.style.display = on ? 'none' : 'flex';
    recBar.style.display = on ? 'flex' : 'none';
  }
  function startRec() {
    if (!navigator.mediaDevices || !window.MediaRecorder) { addMsg('bot', 'Voice is not supported in this browser \uD83D\uDE0A please type.'); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mime = pickMime();
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      rec.__cancel = false; chunks = [];
      rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (recTimer) { clearInterval(recTimer); recTimer = null; }
        var dur = Math.max(1, Math.round((Date.now() - recStart) / 1000));
        showRec(false);
        if (rec.__cancel) return;
        var blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm') });
        var rd = new FileReader();
        rd.onload = function () {
          doSend('', { kind: 'audio', mimeType: (rec.mimeType || 'audio/webm').split(';')[0], data: String(rd.result).split(',')[1] }, '\uD83C\uDFA4 Voice message (' + fmtDur(dur) + ')');
        };
        rd.readAsDataURL(blob);
      };
      rec.start(); recStart = Date.now();
      showRec(true); timerEl.textContent = '0:00';
      recTimer = setInterval(function () { timerEl.textContent = fmtDur(Math.round((Date.now() - recStart) / 1000)); }, 250);
    }).catch(function () { addMsg('bot', 'Microphone access denied \uD83D\uDE0A please type.'); });
  }
  panel.querySelector('#rszMic').onclick = startRec;
  panel.querySelector('#rszStop').onclick = function () { if (rec && rec.state === 'recording') rec.stop(); };
  panel.querySelector('#rszCancel').onclick = function () { if (rec && rec.state === 'recording') { rec.__cancel = true; rec.stop(); } };

  // ── Header WhatsApp + open/close ──
  panel.querySelector('#rszWa').onclick = function () { window.open(waLink(), '_blank', 'noopener'); };
  function toggle() {
    open = !open;
    panel.classList.toggle('show', open);
    fab.style.display = open ? 'none' : 'flex';
    if (open) { renderHistory(); setTimeout(function () { inEl.focus(); }, 100); }
  }
  fab.onclick = toggle;
  panel.querySelector('.rsz-x').onclick = toggle;
  panel.querySelector('#rszSend').onclick = send;
  inEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
})();
