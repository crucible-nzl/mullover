/* Counsel.day · one-tap feedback widget.
 *
 * Mounts on any element with data-cd-feedback="<context>". Renders
 * "Was this useful? Yes / No", posts the rating to /api/feedback, then invites
 * an optional one-line note. Best-effort · network failures are swallowed and
 * the user always sees a thank-you. No decision/vote/note content is touched ·
 * only what the user types here.
 *
 * Usage:  <div data-cd-feedback="verdict"></div>
 *         <script src="/feedback.js" defer></script>
 */
(function () {
  'use strict';

  var WINE = 'var(--wine, #722F37)';
  var INK = 'var(--ink, #1c1a17)';
  var PAPER = 'var(--paper-deep, #faf9f6)';
  var RULE = 'var(--rule, #ddd8cf)';
  var MONO = 'var(--font-mono, ui-monospace, monospace)';
  var BODY = 'var(--font-body, Georgia, serif)';

  function post(context, payload) {
    try {
      fetch('/api/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ context: context, page: location.pathname }, payload)),
        keepalive: true
      }).catch(function () {});
    } catch (_) {}
  }

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function label(text) {
    return el('span', 'font-family:' + MONO + ';font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:' + WINE + ';', text);
  }

  function btn(text) {
    return el('button', 'font-family:' + MONO + ';font-size:11px;letter-spacing:0.08em;text-transform:uppercase;padding:8px 16px;min-height:36px;background:var(--paper,#fff);color:' + INK + ';border:1px solid ' + INK + ';border-radius:0;cursor:pointer;', text);
  }

  function mount(host) {
    var context = host.getAttribute('data-cd-feedback') || 'general';
    host.textContent = '';
    var wrap = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:14px 16px;border-left:3px solid ' + WINE + ';background:' + PAPER + ';');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Feedback');
    var q = label('Was this useful?');
    var yes = btn('Yes');
    var no = btn('No');
    yes.type = 'button'; no.type = 'button';
    wrap.appendChild(q); wrap.appendChild(yes); wrap.appendChild(no);
    host.appendChild(wrap);

    function afterRating(rating) {
      post(context, { rating: rating });
      wrap.textContent = '';
      wrap.appendChild(label('Thanks. Anything to add?'));
      var ta = el('textarea', 'flex:1 1 240px;min-width:200px;font-family:' + BODY + ';font-size:15px;line-height:1.5;padding:9px 12px;border:1px solid ' + RULE + ';border-radius:0;background:var(--paper,#fff);color:' + INK + ';resize:vertical;box-sizing:border-box;');
      ta.rows = 2; ta.maxLength = 1000; ta.placeholder = 'Optional · a sentence is plenty'; ta.setAttribute('aria-label', 'Optional feedback note');
      var send = btn('Send'); send.type = 'button';
      wrap.appendChild(ta); wrap.appendChild(send);
      ta.focus();
      send.addEventListener('click', function () {
        var note = (ta.value || '').trim();
        if (note) post(context, { rating: rating, comment: note });
        wrap.textContent = '';
        wrap.appendChild(label('Thank you · this genuinely helps.'));
      });
    }

    yes.addEventListener('click', function () { afterRating(5); });
    no.addEventListener('click', function () { afterRating(1); });
  }

  function init() {
    var hosts = document.querySelectorAll('[data-cd-feedback]');
    for (var i = 0; i < hosts.length; i++) {
      if (hosts[i].getAttribute('data-cd-fb-mounted') === '1') continue;
      hosts[i].setAttribute('data-cd-fb-mounted', '1');
      mount(hosts[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  // App surfaces reveal content dynamically (e.g. the verdict) · re-scan shortly
  // after load so a container inside revealed content still gets mounted.
  window.setTimeout(init, 1500);
})();
