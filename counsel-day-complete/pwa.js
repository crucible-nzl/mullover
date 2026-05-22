/**
 * Counsel.day · PWA bootstrap (browser side)
 *
 * Loaded by every page via <script src="pwa.js" defer>. Three jobs:
 *
 *   1. Register /sw.js so the service worker can install + handle push.
 *   2. Capture the browser's beforeinstallprompt so any "Install app"
 *      button (data-cd-install) can fire it on demand.
 *   3. Expose window.CounselDayPush.{ enable, disable, status } for
 *      account.html and any future surface that toggles push.
 *
 * Web Push contract: the user clicks Enable → we ask Notification
 * permission → we subscribe via the SW's PushManager → we POST the
 * subscription to /api/push/subscribe so the backend can send pushes
 * when a vote prompt or verdict reveal fires.
 *
 * VAPID public key is fetched from /api/push/public-key (so we don't
 * have to redeploy static when keys rotate · backend reads it from
 * env). Cached for the page lifetime.
 */

(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  var ALLOWED = location.protocol === 'https:' || location.hostname === 'localhost';
  if (!ALLOWED) return; // service workers + push require secure context

  // ---------- 1 · Register the service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (err) {
        // Failure is non-fatal · the app still works without SW.
        console.warn('[cd-pwa] sw registration failed:', err);
      });
    });
  }

  // ---------- 2 · Install prompt capture ----------
  // Showing "Install app" on the very first page-view is noisy · the user
  // hasn't decided whether they care yet. Defer it until:
  //   (a) this is at least the user's 2nd distinct visit (visit counter
  //       in localStorage, incremented once per browser session), OR
  //   (b) the user has performed a meaningful interaction this session,
  //       signalled by other code calling window.CounselDayPWA.markEngaged()
  //       (compose, vote-today, verdict-reveal call this on success).
  // Until one of those is true, the captured beforeinstallprompt sits in
  // `deferredInstall` ready to fire, but the install buttons stay hidden.
  var deferredInstall = null;
  var SESSION_KEY = 'cd-pwa-session-tick';
  var VISIT_KEY = 'cd-pwa-visit-count';
  var ENGAGED_KEY = 'cd-pwa-engaged';

  function readNum(key) {
    try { return parseInt(window.localStorage.getItem(key) || '0', 10) || 0; } catch (e) { return 0; }
  }
  function writeNum(key, n) {
    try { window.localStorage.setItem(key, String(n)); } catch (e) { /* private mode */ }
  }
  function isEngaged() {
    try { return window.localStorage.getItem(ENGAGED_KEY) === '1'; } catch (e) { return false; }
  }

  // Increment the visit counter at most once per browser session.
  try {
    if (window.sessionStorage && !window.sessionStorage.getItem(SESSION_KEY)) {
      window.sessionStorage.setItem(SESSION_KEY, '1');
      writeNum(VISIT_KEY, readNum(VISIT_KEY) + 1);
    }
  } catch (e) { /* storage disabled · prompt will just stay hidden */ }

  function shouldReveal() {
    return readNum(VISIT_KEY) >= 2 || isEngaged();
  }

  function revealInstallButtons() {
    document.querySelectorAll('[data-cd-install]').forEach(function (btn) {
      btn.hidden = false;
      btn.disabled = false;
    });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
    if (shouldReveal()) revealInstallButtons();
  });

  // Helper · show inline feedback next to the install button. The
  // page's #cd-install-fallback span exists on account.html; on
  // pages without it we fall back to alert() so the click is never
  // truly silent.
  function setInstallFeedback(btn, text) {
    var span = document.getElementById('cd-install-fallback');
    if (span) {
      span.textContent = text;
      span.style.color = 'var(--wine)';
    } else if (btn) {
      btn.title = text;
    }
  }

  // Install-instructions modal · shown when the in-page install
  // button is clicked but beforeinstallprompt hasn't fired yet (very
  // common on Android Chrome before the engagement budget tips over,
  // and always on iOS Safari which has no install event at all). A
  // text hint pointing at the browser menu is too weak; this modal
  // shows the user exactly where the menu is, with a visual cue.
  function buildInstallModal(platform) {
    var wrap = document.createElement('div');
    wrap.id = 'cd-install-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'cd-install-modal-title');
    wrap.style.cssText = [
      'position: fixed', 'inset: 0', 'z-index: 9999',
      'background: rgba(10,10,10,0.6)',
      'display: flex', 'align-items: center', 'justify-content: center',
      'padding: 20px', 'box-sizing: border-box',
      'font-family: var(--font-body, system-ui, sans-serif)',
    ].join('; ');

    // ---- panel ----
    var panel = document.createElement('div');
    panel.style.cssText = [
      'background: #ffffff', 'max-width: 480px', 'width: 100%',
      'border: 1px solid #0a0a0a', 'padding: 28px 26px 24px',
      'position: relative', 'max-height: 90vh', 'overflow-y: auto',
    ].join('; ');

    // ---- close X ----
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close install instructions');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = [
      'position: absolute', 'top: 8px', 'right: 12px',
      'background: transparent', 'border: none', 'cursor: pointer',
      'font-size: 28px', 'line-height: 1', 'color: #6b635a',
      'padding: 4px 8px',
    ].join('; ');
    closeBtn.addEventListener('click', function () { closeInstallModal(); });
    panel.appendChild(closeBtn);

    // ---- eyebrow + title ----
    var eyebrow = document.createElement('div');
    eyebrow.textContent = 'INSTALL COUNSEL.DAY';
    eyebrow.style.cssText = 'font-family: var(--font-mono, monospace); font-size: 11px; letter-spacing: 0.18em; color: #722F37; margin-bottom: 10px;';
    panel.appendChild(eyebrow);

    var title = document.createElement('h2');
    title.id = 'cd-install-modal-title';
    title.style.cssText = 'font-family: var(--font-display, Georgia, serif); font-size: 24px; font-weight: 500; line-height: 1.22; margin: 0 0 18px; color: #0a0a0a;';

    var body = document.createElement('div');
    body.style.cssText = 'font-family: var(--font-body, Georgia, serif); font-size: 15px; line-height: 1.55; color: #3a3530;';

    if (platform === 'ios') {
      title.innerHTML = 'Add to your <span style="font-style: italic; color: #722F37;">home screen.</span>';
      body.innerHTML =
        '<ol style="padding-left: 22px; margin: 0 0 16px;">' +
          '<li style="margin-bottom: 10px;">Tap the <strong>Share</strong> icon at the bottom of Safari ' +
            '<span style="display: inline-block; vertical-align: -2px; margin: 0 2px;">' +
            '<svg width="18" height="22" viewBox="0 0 18 22" fill="none" stroke="#722F37" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M9 1v14"/><path d="M4 6l5-5 5 5"/><path d="M2 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>' +
            '</svg></span>' +
          '</li>' +
          '<li style="margin-bottom: 10px;">Scroll down and tap <strong>Add to Home Screen</strong>.</li>' +
          '<li>Tap <strong>Add</strong> in the top-right of the dialog.</li>' +
        '</ol>' +
        '<p style="margin: 0; font-style: italic; color: #6b635a; font-size: 13px;">Counsel.day will appear on your home screen as a regular app icon.</p>';
    } else if (platform === 'android') {
      title.innerHTML = 'Add to your <span style="font-style: italic; color: #722F37;">home screen.</span>';
      body.innerHTML =
        '<div style="display: flex; gap: 16px; align-items: flex-start; margin-bottom: 16px;">' +
          '<div style="flex: 0 0 64px; height: 110px; border: 2px solid #0a0a0a; padding: 6px 4px; position: relative; background: #fafaf8;">' +
            '<div style="position: absolute; top: 6px; right: 4px; display: flex; flex-direction: column; gap: 3px;">' +
              '<span style="display: block; width: 4px; height: 4px; background: #722F37; border-radius: 50%;"></span>' +
              '<span style="display: block; width: 4px; height: 4px; background: #722F37; border-radius: 50%;"></span>' +
              '<span style="display: block; width: 4px; height: 4px; background: #722F37; border-radius: 50%;"></span>' +
            '</div>' +
            '<div style="position: absolute; bottom: 8px; left: 8px; right: 8px; height: 4px; background: #e8e6e1;"></div>' +
            '<div style="position: absolute; bottom: 20px; left: 8px; width: 24px; height: 4px; background: #e8e6e1;"></div>' +
            '<div style="position: absolute; bottom: 32px; left: 8px; right: 8px; height: 4px; background: #e8e6e1;"></div>' +
          '</div>' +
          '<ol style="padding-left: 22px; margin: 0; flex: 1;">' +
            '<li style="margin-bottom: 8px;">Tap the <strong>three-dot menu</strong> in the top-right of Chrome.</li>' +
            '<li style="margin-bottom: 8px;">Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong> on older versions).</li>' +
            '<li>Tap <strong>Install</strong> to confirm.</li>' +
          '</ol>' +
        '</div>' +
        '<p style="margin: 0; font-style: italic; color: #6b635a; font-size: 13px;">If the menu doesn\'t show those options yet, browse the site for a minute and try again. Chrome unlocks installation once it has seen enough engagement.</p>';
    } else {
      title.innerHTML = 'Install on your <span style="font-style: italic; color: #722F37;">desktop.</span>';
      body.innerHTML =
        '<ol style="padding-left: 22px; margin: 0 0 16px;">' +
          '<li style="margin-bottom: 10px;">Look at the right end of your browser\'s URL bar for a small install icon (it looks like a monitor with an arrow).</li>' +
          '<li style="margin-bottom: 10px;">If you don\'t see one, open the browser menu (⋮ or hamburger icon) and look for <strong>Install Counsel.day</strong>.</li>' +
          '<li>Confirm the dialog · the app opens in its own window.</li>' +
        '</ol>' +
        '<p style="margin: 0; font-style: italic; color: #6b635a; font-size: 13px;">Chrome, Edge, and Brave all support PWA install. Firefox and Safari on desktop do not.</p>';
    }

    panel.appendChild(title);
    panel.appendChild(body);

    // ---- footer button ----
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'Got it';
    ok.style.cssText = [
      'margin-top: 20px',
      'font-family: var(--font-ui, system-ui, sans-serif)', 'font-size: 14px', 'font-weight: 500',
      'letter-spacing: 0.08em', 'text-transform: uppercase',
      'padding: 12px 22px', 'background: #722F37', 'color: #ffffff',
      'border: 1px solid #722F37', 'cursor: pointer', 'border-radius: 0',
    ].join('; ');
    ok.addEventListener('click', function () { closeInstallModal(); });
    panel.appendChild(ok);

    wrap.appendChild(panel);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeInstallModal(); });
    return wrap;
  }

  function showInstallModal(platform) {
    closeInstallModal();
    var modal = buildInstallModal(platform);
    document.body.appendChild(modal);
    // Trap focus on the close button so Esc/Enter behave sensibly.
    var firstBtn = modal.querySelector('button');
    if (firstBtn && firstBtn.focus) firstBtn.focus();
    document.addEventListener('keydown', escHandler);
  }
  function closeInstallModal() {
    var el = document.getElementById('cd-install-modal');
    if (el && el.parentNode) el.parentNode.removeChild(el);
    document.removeEventListener('keydown', escHandler);
  }
  function escHandler(e) { if (e.key === 'Escape') closeInstallModal(); }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-cd-install]');
    if (!btn) return;

    // No deferredInstall · the browser hasn't decided this PWA is
    // installable yet (Android Chrome engagement gate), OR the user
    // dismissed an earlier prompt, OR the browser doesn't support
    // installs at all (Firefox, Safari). Show a proper modal with a
    // visual cue rather than just a text hint.
    if (!deferredInstall) {
      var ua = navigator.userAgent || '';
      var isIos = /iPhone|iPad|iPod/i.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
      var isAndroid = /Android/i.test(ua);
      showInstallModal(isIos ? 'ios' : (isAndroid ? 'android' : 'desktop'));
      return;
    }

    btn.disabled = true;
    setInstallFeedback(btn, 'Opening install prompt' + String.fromCharCode(0x2026));
    try {
      deferredInstall.prompt();
      deferredInstall.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') {
          setInstallFeedback(btn, 'Installed · check your home screen.');
          btn.hidden = true;
        } else {
          setInstallFeedback(btn, 'Install dismissed · you can use the browser menu later if you change your mind.');
          btn.disabled = false;
        }
      }).finally(function () {
        deferredInstall = null;
      });
    } catch (err) {
      setInstallFeedback(btn, 'Could not open the install prompt · please reload.');
      btn.disabled = false;
    }
  });

  // Exposed for app surfaces to call on success of a real interaction.
  window.CounselDayPWA = {
    markEngaged: function () {
      try { window.localStorage.setItem(ENGAGED_KEY, '1'); } catch (e) { /* noop */ }
      if (deferredInstall) revealInstallButtons();
    },
    visitCount: function () { return readNum(VISIT_KEY); },
  };

  // ---------- 3 · Push subscription helpers ----------
  function urlBase64ToUint8Array(base64) {
    var padding = '='.repeat((4 - base64.length % 4) % 4);
    var b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  var cachedPublicKey = null;
  function getVapidPublicKey() {
    if (cachedPublicKey) return Promise.resolve(cachedPublicKey);
    return fetch('/api/push/public-key', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.public_key) throw new Error('no public key from server');
        cachedPublicKey = j.public_key;
        return cachedPublicKey;
      });
  }

  function pushStatus() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return Promise.resolve({ supported: false, permission: 'unsupported', subscribed: false });
    }
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        return {
          supported: true,
          permission: Notification.permission,
          subscribed: !!sub,
        };
      });
    });
  }

  function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return Promise.reject(new Error('Web Push is not supported on this browser.'));
    }
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') {
        throw new Error('Notification permission was not granted.');
      }
      return Promise.all([
        navigator.serviceWorker.ready,
        getVapidPublicKey(),
      ]);
    }).then(function (pair) {
      var reg = pair[0];
      var key = pair[1];
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }).then(function (sub) {
      return fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      }).then(function (r) {
        if (!r.ok) throw new Error('Server rejected the subscription · ' + r.status);
        return sub;
      });
    });
  }

  function disablePush() {
    if (!('serviceWorker' in navigator)) return Promise.resolve();
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) return null;
        return fetch('/api/push/subscribe', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).finally(function () { sub.unsubscribe(); });
      });
    });
  }

  window.CounselDayPush = {
    status: pushStatus,
    enable: enablePush,
    disable: disablePush,
  };
})();
