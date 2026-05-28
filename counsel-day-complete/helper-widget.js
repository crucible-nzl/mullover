/* helper-widget.js · floating Counsel.day helper bot.
 *
 * Mounts a fixed bottom-right button on every page that includes this
 * script. Clicking opens a slide-up drawer with a small chat surface
 * that posts to the same /api/chatbot/message endpoint as /helper.html.
 *
 * Design intent (brand iteration 8 · white + wine):
 *   · No emoji, no colour gradients, no rounded corners on buttons.
 *   · Wine accent on the call-to-attention bubble.
 *   · The drawer is scrollable; the launcher stays put while the user
 *     reads other content.
 *
 * Idempotency: the script tags itself with data-cd-helper-installed=1
 * so a duplicate include is a no-op.
 */
(function () {
  'use strict';
  if (document.documentElement.getAttribute('data-cd-helper-installed') === '1') return;
  document.documentElement.setAttribute('data-cd-helper-installed', '1');

  // Skip on the helper page itself · the floating widget would be
  // redundant when the user is already on /helper.html.
  if (/\/helper(\.html)?$/.test(window.location.pathname)) return;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'style') n.style.cssText = attrs[k];
        else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
        else n.setAttribute(k, attrs[k]);
      });
    }
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  // Inject styles once.
  var style = document.createElement('style');
  style.textContent = [
    '.cd-help-launcher { position: fixed; right: 22px; bottom: 22px; z-index: 9998; }',
    '.cd-help-launcher-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 18px; background: var(--wine, #722F37); color: var(--paper, #ffffff); border: 1px solid var(--wine, #722F37); font-family: var(--font-mono, ui-monospace, monospace); font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; border-radius: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.12); }',
    '.cd-help-launcher-btn:hover { background: var(--wine-deep, #5a242c); border-color: var(--wine-deep, #5a242c); }',
    '.cd-help-launcher-btn:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }',
    '.cd-help-launcher-btn .ico { display: inline-block; width: 16px; height: 16px; flex-shrink: 0; }',
    '.cd-help-launcher-btn .ico svg { width: 100%; height: 100%; display: block; }',

    '.cd-help-drawer { position: fixed; right: 22px; bottom: 22px; z-index: 9999; width: 380px; max-width: calc(100vw - 36px); height: 540px; max-height: calc(100vh - 36px); background: var(--paper, #ffffff); border: 1px solid var(--ink, #1c1a17); display: none; flex-direction: column; box-shadow: 0 10px 36px rgba(0,0,0,0.18); font-family: var(--font-body, ui-serif, serif); }',
    '.cd-help-drawer.is-open { display: flex; }',
    '.cd-help-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; background: var(--ink, #1c1a17); color: var(--paper, #ffffff); }',
    '.cd-help-head-l { display: flex; align-items: center; gap: 10px; }',
    '.cd-help-head .lbl { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--paper, #ffffff); }',
    '.cd-help-close { background: transparent; border: 1px solid rgba(255,255,255,0.3); color: var(--paper, #ffffff); font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; letter-spacing: 0.08em; padding: 6px 10px; cursor: pointer; border-radius: 0; }',
    '.cd-help-close:hover { border-color: rgba(255,255,255,0.6); }',

    '.cd-help-body { flex: 1; overflow-y: auto; padding: 14px; }',
    '.cd-help-empty { font-family: var(--font-body, ui-serif, serif); font-size: 14px; line-height: 1.55; color: var(--ink-soft, #38332f); }',
    '.cd-help-empty p { margin: 0 0 10px; }',
    '.cd-help-chips { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }',
    '.cd-help-chip { text-align: left; padding: 8px 12px; background: var(--paper, #ffffff); border: 1px solid var(--rule, #e3dfd9); color: var(--ink, #1c1a17); font-family: var(--font-body, ui-serif, serif); font-size: 13px; line-height: 1.4; cursor: pointer; border-radius: 0; }',
    '.cd-help-chip:hover { border-color: var(--wine, #722F37); background: var(--wine-soft, #f6e8e9); }',

    '.cd-help-msg { margin-bottom: 12px; }',
    '.cd-help-msg .role { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: var(--muted, #8a847d); text-transform: uppercase; margin-bottom: 4px; }',
    '.cd-help-msg .bubble { font-family: var(--font-body, ui-serif, serif); font-size: 14px; line-height: 1.55; color: var(--ink, #1c1a17); padding: 10px 12px; background: var(--paper-deep, #faf8f4); border-left: 3px solid var(--rule, #e3dfd9); }',
    '.cd-help-msg.user .bubble { border-left-color: var(--wine, #722F37); }',
    '.cd-help-msg.system .bubble { background: #fdecea; border-left-color: #c0392b; color: #6b1e16; }',

    '.cd-help-form { display: flex; gap: 6px; border-top: 1px solid var(--rule, #e3dfd9); padding: 10px 12px; }',
    '.cd-help-input { flex: 1; min-height: 38px; max-height: 96px; resize: vertical; padding: 8px 10px; font-family: var(--font-body, ui-serif, serif); font-size: 14px; border: 1px solid var(--rule, #e3dfd9); background: var(--paper, #ffffff); color: var(--ink, #1c1a17); border-radius: 0; }',
    '.cd-help-input:focus { outline: none; border-color: var(--wine, #722F37); }',
    '.cd-help-send { padding: 8px 14px; background: var(--wine, #722F37); color: var(--paper, #ffffff); border: 1px solid var(--wine, #722F37); font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; border-radius: 0; }',
    '.cd-help-send:hover { background: var(--wine-deep, #5a242c); }',
    '.cd-help-send:disabled { opacity: 0.6; cursor: default; }',
    '.cd-help-foot { padding: 6px 12px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.08em; color: var(--muted, #8a847d); text-transform: uppercase; border-top: 1px solid var(--rule, #e3dfd9); }',
    '.cd-help-foot a { color: var(--wine, #722F37); }',

    '@media (max-width: 480px) {',
      '.cd-help-drawer { right: 10px; left: 10px; bottom: 10px; width: auto; max-width: none; height: 70vh; }',
      '.cd-help-launcher { right: 12px; bottom: 12px; }',
      '.cd-help-launcher-btn { padding: 10px 14px; }',
    '}',
  ].join('\n');
  document.head.appendChild(style);

  // Build launcher.
  var launcher = el('div', { 'class': 'cd-help-launcher', 'role': 'region', 'aria-label': 'Helper bot' });
  var launcherBtn = el('button', {
    type: 'button',
    'class': 'cd-help-launcher-btn',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    'aria-controls': 'cd-help-drawer',
  }, '<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></span><span>Help</span>');
  launcher.appendChild(launcherBtn);

  // Build drawer.
  var drawer = el('div', {
    id: 'cd-help-drawer',
    'class': 'cd-help-drawer',
    role: 'dialog',
    'aria-label': 'Counsel.day helper bot',
  });
  drawer.innerHTML =
    '<div class="cd-help-head">' +
      '<div class="cd-help-head-l">' +
        '<span class="lbl">Helper bot</span>' +
      '</div>' +
      '<button type="button" class="cd-help-close" id="cd-help-close" aria-label="Close helper">Close</button>' +
    '</div>' +
    '<div class="cd-help-body" id="cd-help-body">' +
      '<div class="cd-help-empty" id="cd-help-empty">' +
        '<p><strong style="font-family: var(--font-display, ui-serif, serif); font-weight: 400; font-size: 17px; color: var(--ink);">Ask about Counsel.day or The Daily.</strong></p>' +
        '<p>Factual questions only · pricing, the sealed-vote method, billing, refunds, technical issues. For your actual decision, the product is the answer.</p>' +
        '<div class="cd-help-chips">' +
          '<button type="button" class="cd-help-chip" data-q="How much does the Couple tier cost?">How much does Couple cost?</button>' +
          '<button type="button" class="cd-help-chip" data-q="What is The Daily Counsel and how does it work?">What is The Daily Counsel?</button>' +
          '<button type="button" class="cd-help-chip" data-q="How long can a decision run?">How long can a decision run?</button>' +
          '<button type="button" class="cd-help-chip" data-q="Does this replace therapy?">Does this replace therapy?</button>' +
          '<button type="button" class="cd-help-chip" data-q="Can I refund a decision?">Can I refund a decision?</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<form class="cd-help-form" id="cd-help-form">' +
      '<textarea class="cd-help-input" id="cd-help-input" placeholder="Ask about pricing, billing, The Daily, refunds…" maxlength="1000" required></textarea>' +
      '<button type="submit" class="cd-help-send" id="cd-help-send">Ask</button>' +
    '</form>' +
    '<div class="cd-help-foot">Need a human? <a href="mailto:support@counsel.day?subject=Helper%20question">Email support@counsel.day</a></div>';

  document.body.appendChild(launcher);
  document.body.appendChild(drawer);

  var bodyEl = $('#cd-help-body', drawer);
  var emptyEl = $('#cd-help-empty', drawer);
  var form = $('#cd-help-form', drawer);
  var input = $('#cd-help-input', drawer);
  var send = $('#cd-help-send', drawer);
  var closeBtn = $('#cd-help-close', drawer);
  var history = [];

  function openDrawer() {
    drawer.classList.add('is-open');
    launcher.style.display = 'none';
    launcherBtn.setAttribute('aria-expanded', 'true');
    setTimeout(function () { input && input.focus(); }, 60);
  }
  function closeDrawer() {
    drawer.classList.remove('is-open');
    launcher.style.display = '';
    launcherBtn.setAttribute('aria-expanded', 'false');
  }

  launcherBtn.addEventListener('click', openDrawer);
  closeBtn.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) closeDrawer();
  });

  function appendMsg(role, content) {
    if (emptyEl && !emptyEl.classList.contains('is-hidden')) {
      emptyEl.classList.add('is-hidden');
      emptyEl.style.display = 'none';
    }
    var wrap = el('div', { 'class': 'cd-help-msg ' + role });
    wrap.innerHTML =
      '<div class="role">' + (role === 'user' ? 'You' : role === 'system' ? 'Helper' : 'Helper') + '</div>' +
      '<div class="bubble">' + esc(content) + '</div>';
    bodyEl.appendChild(wrap);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function postMessage(text) {
    send.disabled = true;
    fetch('/api/chatbot/message', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, history: history.slice(-12) }),
    })
      .then(function (r) {
        if (r.status === 401) {
          window.location.href = '/signin?next=' + encodeURIComponent(window.location.pathname);
          return null;
        }
        return r.json().then(function (j) { return { status: r.status, body: j }; });
      })
      .then(function (res) {
        send.disabled = false;
        if (!res) return;
        if (res.status === 429 && res.body && res.body.recaptcha_required) {
          appendMsg('system', 'Too many questions in a short window. Take a beat and try again, or email support@counsel.day for an immediate human reply.');
          return;
        }
        if (res.status !== 200 || !res.body || !res.body.ok) {
          appendMsg('system', (res.body && res.body.message) || 'The helper bot is offline. Email support@counsel.day.');
          return;
        }
        appendMsg('assistant', res.body.reply || '');
        history.push({ role: 'assistant', content: res.body.reply || '' });
      })
      .catch(function () {
        send.disabled = false;
        appendMsg('system', 'Network error. Please try again.');
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = String(input.value || '').trim();
    if (!text) return;
    input.value = '';
    appendMsg('user', text);
    history.push({ role: 'user', content: text });
    postMessage(text);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  bodyEl.addEventListener('click', function (e) {
    var chip = e.target.closest('.cd-help-chip');
    if (!chip) return;
    var q = chip.getAttribute('data-q') || chip.textContent.trim();
    input.value = q;
    form.requestSubmit();
  });
})();
