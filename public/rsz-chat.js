/* ============================================================================
 * RS ZEVAR — Storefront Chat Widget  (served at https://erp.rszevar.com/rsz-chat.js)
 * ----------------------------------------------------------------------------
 * Add ONCE to the Shopify theme (theme.liquid, just before </body>):
 *   <script src="https://erp.rszevar.com/rsz-chat.js" defer></script>
 *
 * Self-contained: no dependencies, injects its own CSS + DOM. Talks to the
 * public Bot Brain endpoint. Features: text, link paste, photo upload, voice
 * note, product cards, WhatsApp human handoff.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__RSZ_CHAT__) return; // guard against double-load
  window.__RSZ_CHAT__ = true;

  // ── Config ────────────────────────────────────────────────────────────────
  var API = 'https://erp.rszevar.com/api/public/storefront-chat';
  var WHATSAPP = '923032244550';
  var GREETING = 'Assalam-o-alaikum! 😊 RS ZEVAR mein khush aamadeed. Kya dhoondh rahe hain — main madad kar deti hun.';
  var GOLD = '#c6a15b';
  var GOLD_DARK = '#a8853f';

  // ── Session id (persist so rate-limit + continuity work) ───────────────────
  var sessionId;
  try {
    sessionId = localStorage.getItem('rsz_chat_sid');
    if (!sessionId) { sessionId = 'w_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('rsz_chat_sid', sessionId); }
  } catch (e) { sessionId = 'w_' + Math.random().toString(36).slice(2); }

  var history = [];        // { role, text }
  var pendingMedia = null; // { mimeType, data, kind }
  var open = false;
  var busy = false;

  // ── Styles ──────────────────────────────────────────────────────────────────
  var css = ''
    + '.rsz-fab{position:fixed;right:18px;bottom:18px;width:58px;height:58px;border-radius:50%;'
    + 'background:linear-gradient(135deg,' + GOLD + ',' + GOLD_DARK + ');box-shadow:0 8px 24px rgba(0,0,0,.28);'
    + 'display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483000;border:none;transition:transform .15s;}'
    + '.rsz-fab:hover{transform:scale(1.06);}'
    + '.rsz-fab svg{width:28px;height:28px;fill:#fff;}'
    + '.rsz-panel{position:fixed;right:18px;bottom:86px;width:min(380px,calc(100vw - 24px));height:min(620px,calc(100vh - 110px));'
    + 'background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.3);display:none;flex-direction:column;overflow:hidden;'
    + 'z-index:2147483000;font-family:inherit,-apple-system,Segoe UI,Roboto,sans-serif;}'
    + '.rsz-panel.show{display:flex;}'
    + '.rsz-head{background:linear-gradient(135deg,' + GOLD + ',' + GOLD_DARK + ');color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;}'
    + '.rsz-head b{font-size:15px;font-weight:700;}'
    + '.rsz-head small{display:block;font-size:11px;opacity:.85;font-weight:400;}'
    + '.rsz-x{margin-left:auto;cursor:pointer;font-size:20px;line-height:1;opacity:.9;background:none;border:none;color:#fff;}'
    + '.rsz-body{flex:1;overflow-y:auto;padding:14px;background:#faf7f2;display:flex;flex-direction:column;gap:10px;}'
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
    + '.rsz-wa{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;background:#25D366;color:#fff;text-decoration:none;'
    + 'padding:9px 14px;border-radius:10px;font-size:13px;font-weight:700;}'
    + '.rsz-foot{border-top:1px solid #ece5da;padding:8px;background:#fff;}'
    + '.rsz-prev{display:flex;align-items:center;gap:8px;font-size:12px;color:#666;padding:4px 6px 6px;}'
    + '.rsz-prev img{width:36px;height:36px;border-radius:6px;object-fit:cover;}'
    + '.rsz-prev button{margin-left:auto;background:none;border:none;color:#c0392b;cursor:pointer;font-size:12px;}'
    + '.rsz-inrow{display:flex;align-items:center;gap:6px;}'
    + '.rsz-in{flex:1;border:1px solid #ddd;border-radius:20px;padding:9px 14px;font-size:14px;outline:none;font-family:inherit;min-width:0;}'
    + '.rsz-ico{width:38px;height:38px;border-radius:50%;border:none;background:#f1ece3;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}'
    + '.rsz-ico svg{width:19px;height:19px;fill:#8a7a5e;}'
    + '.rsz-ico.rec{background:#ffe2e2;}'
    + '.rsz-send{background:linear-gradient(135deg,' + GOLD + ',' + GOLD_DARK + ');}'
    + '.rsz-send svg{fill:#fff;}'
    + '.rsz-foot small{display:block;text-align:center;font-size:10px;color:#bbb;margin-top:5px;}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ── Build DOM ────────────────────────────────────────────────────────────────
  var fab = document.createElement('button');
  fab.className = 'rsz-fab';
  fab.setAttribute('aria-label', 'Chat with RS ZEVAR');
  fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.4 1.2 4.6 3.1 6.1-.1 1.1-.6 2.4-1.4 3.4 1.6-.2 3.2-.8 4.4-1.7 1.2.4 2.5.6 3.9.6 5.5 0 10-3.8 10-8.4S17.5 3 12 3z"/></svg>';

  var panel = document.createElement('div');
  panel.className = 'rsz-panel';
  panel.innerHTML = ''
    + '<div class="rsz-head"><div><b>RS ZEVAR</b><small>Online support 😊</small></div><button class="rsz-x" aria-label="Close">×</button></div>'
    + '<div class="rsz-body" id="rszBody"></div>'
    + '<div class="rsz-foot">'
    +   '<div class="rsz-prev" id="rszPrev" style="display:none;"></div>'
    +   '<div class="rsz-inrow">'
    +     '<button class="rsz-ico" id="rszPhoto" title="Photo bhejein"><svg viewBox="0 0 24 24"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg></button>'
    +     '<button class="rsz-ico" id="rszMic" title="Voice note"><svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg></button>'
    +     '<input class="rsz-in" id="rszIn" placeholder="Type karein ya link paste karein..." />'
    +     '<button class="rsz-ico rsz-send" id="rszSend" title="Send"><svg viewBox="0 0 24 24"><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z"/></svg></button>'
    +   '</div>'
    +   '<small>RS ZEVAR • rszevar.com</small>'
    + '</div>'
    + '<input type="file" id="rszFile" accept="image/*" style="display:none;" />';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var bodyEl = panel.querySelector('#rszBody');
  var inEl = panel.querySelector('#rszIn');
  var prevEl = panel.querySelector('#rszPrev');
  var fileEl = panel.querySelector('#rszFile');

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function linkify(s) {
    return esc(s).replace(/(https?:\/\/[^\s]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>'; });
  }
  function scroll() { bodyEl.scrollTop = bodyEl.scrollHeight; }

  function addMsg(role, text) {
    var d = document.createElement('div');
    d.className = 'rsz-msg ' + (role === 'user' ? 'rsz-user' : 'rsz-bot');
    d.innerHTML = linkify(text);
    bodyEl.appendChild(d);
    scroll();
  }

  function addCards(products) {
    if (!products || !products.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'rsz-cards';
    products.forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'rsz-card';
      a.href = p.url || '#';
      a.target = '_blank'; a.rel = 'noopener';
      var price = p.price != null ? ('Rs. ' + p.price) : '';
      a.innerHTML =
        (p.image ? '<img src="' + esc(p.image) + '" alt="">' : '<div class="rsz-card-noimg" style="width:52px;height:52px;border-radius:8px;background:#f0eadf;"></div>')
        + '<div><div class="n">' + esc(p.name || 'Product') + '</div>'
        + (price ? '<div class="p">' + esc(price) + '</div>' : '')
        + (p.in_stock === false ? '<div class="oos">Out of stock</div>' : '') + '</div>';
      wrap.appendChild(a);
    });
    bodyEl.appendChild(wrap);
    scroll();
  }

  function addWhatsApp() {
    var msg = encodeURIComponent('Assalam-o-alaikum, mujhe RS ZEVAR se help chahiye.');
    var a = document.createElement('a');
    a.className = 'rsz-wa';
    a.href = 'https://wa.me/' + WHATSAPP + '?text=' + msg;
    a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M20 11.5a8 8 0 0 1-11.9 7L4 19.5l1.1-4A8 8 0 1 1 20 11.5z"/></svg> WhatsApp pe baat karein';
    bodyEl.appendChild(a);
    scroll();
  }

  var typingEl = null;
  function showTyping() { typingEl = document.createElement('div'); typingEl.className = 'rsz-typing'; typingEl.textContent = 'typing…'; bodyEl.appendChild(typingEl); scroll(); }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  function setPreview() {
    if (!pendingMedia) { prevEl.style.display = 'none'; prevEl.innerHTML = ''; return; }
    prevEl.style.display = 'flex';
    prevEl.innerHTML = pendingMedia.kind === 'image'
      ? '<img src="data:' + pendingMedia.mimeType + ';base64,' + pendingMedia.data + '"><span>Photo ready</span>'
      : '<span>🎤 Voice note ready</span>';
    var btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.onclick = function () { pendingMedia = null; setPreview(); };
    prevEl.appendChild(btn);
  }

  // ── Send ─────────────────────────────────────────────────────────────────────
  function send() {
    if (busy) return;
    var text = inEl.value.trim();
    if (!text && !pendingMedia) return;

    var media = pendingMedia;
    var display = text || (media && media.kind === 'image' ? '📷 Photo' : '🎤 Voice note');
    addMsg('user', display);
    history.push({ role: 'user', text: text || (media ? '[' + media.kind + ']' : '') });
    inEl.value = '';
    pendingMedia = null; setPreview();

    busy = true; showTyping();
    var payload = { sessionId: sessionId, messages: history };
    if (media) { payload[media.kind === 'image' ? 'image' : 'audio'] = { mimeType: media.mimeType, data: media.data }; }

    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        hideTyping(); busy = false;
        var reply = d.reply || 'Maazrat, dobara try karein 😊';
        addMsg('bot', reply);
        history.push({ role: 'assistant', text: reply });
        if (d.products && d.products.length) addCards(d.products);
        if (d.handoff) addWhatsApp();
      })
      .catch(function () {
        hideTyping(); busy = false;
        addMsg('bot', 'Maazrat, connection issue 😊 WhatsApp pe try karein.');
        addWhatsApp();
      });
  }

  // ── Photo ─────────────────────────────────────────────────────────────────────
  panel.querySelector('#rszPhoto').onclick = function () { fileEl.click(); };
  fileEl.onchange = function () {
    var f = fileEl.files && fileEl.files[0];
    if (!f) return;
    if (f.size > 4.4 * 1024 * 1024) { addMsg('bot', 'Photo thori choti bhejein please (4MB se kam) 😊'); fileEl.value = ''; return; }
    var rd = new FileReader();
    rd.onload = function () { pendingMedia = { kind: 'image', mimeType: f.type || 'image/jpeg', data: String(rd.result).split(',')[1] }; setPreview(); };
    rd.readAsDataURL(f);
    fileEl.value = '';
  };

  // ── Voice ───────────────────────────────────────────────────────────────────
  var rec = null, chunks = [];
  function pickMime() {
    var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (var i = 0; i < c.length; i++) { if (window.MediaRecorder && MediaRecorder.isTypeSupported(c[i])) return c[i]; }
    return '';
  }
  var micBtn = panel.querySelector('#rszMic');
  micBtn.onclick = function () {
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { addMsg('bot', 'Is browser mein voice support nahi 😊 type kar dein.'); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mime = pickMime();
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks = [];
      rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        micBtn.classList.remove('rec');
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm') });
        var rd = new FileReader();
        rd.onload = function () {
          var b64 = String(rd.result).split(',')[1];
          var sendMime = (rec.mimeType || 'audio/webm').split(';')[0];
          pendingMedia = { kind: 'audio', mimeType: sendMime, data: b64 };
          setPreview();
        };
        rd.readAsDataURL(blob);
      };
      rec.start();
      micBtn.classList.add('rec');
    }).catch(function () { addMsg('bot', 'Mic access nahi mila 😊 type kar dein.'); });
  };

  // ── Open / close ───────────────────────────────────────────────────────────
  function toggle() {
    open = !open;
    panel.classList.toggle('show', open);
    if (open && history.length === 0) { addMsg('bot', GREETING); history.push({ role: 'assistant', text: GREETING }); }
    if (open) setTimeout(function () { inEl.focus(); }, 100);
  }
  fab.onclick = toggle;
  panel.querySelector('.rsz-x').onclick = toggle;
  panel.querySelector('#rszSend').onclick = send;
  inEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
})();
