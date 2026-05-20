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

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-cd-install]');
    if (!btn) return;
    if (!deferredInstall) return;
    btn.disabled = true;
    deferredInstall.prompt();
    deferredInstall.userChoice.finally(function () {
      deferredInstall = null;
      btn.hidden = true;
    });
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
