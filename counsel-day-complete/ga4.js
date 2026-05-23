/* ============================================================
   COUNSEL.DAY · CONSENT BANNER + GA4 EVENTS + MOBILE NAV
   Loaded on every public page (and ../ga4.js in subdirs).

   This file does THREE things, in order:

     1. Consent banner UI · GDPR/UK PECR-compliant.
        - Google Consent Mode v2 defaults are set INLINE in the
          <head> of every page (see counsel-day-complete/ops/cd-head-snippet.html).
          They default everything to 'denied' BEFORE GTM and gtag
          load, so this is Google "Advanced consent mode": tags
          still load and send cookieless pings, but no analytics
          storage is written until the user grants here.
        - This file reads the stored decision (cd_consent_v1 in
          localStorage) and calls gtag('consent', 'update', ...)
          on every page load to reflect it.
        - Honours Global Privacy Control and Do-Not-Track silently
          (no banner shown; defaults stay denied).
        - Shows the banner once on first visit if no GPC/DNT and
          no prior decision exists.

     2. GA4 events · 10 funnel events + 3 engagement events.
        The gtag library is already loaded in <head>; this file just
        calls gtag('event', ...). Consent Mode v2 in the gtag library
        respects analytics_storage: denied → cookieless pings only.

     3. Mobile nav toggle · injects a hamburger button into every
        .nav-bar and toggles a slide-down panel below 1024px.

   Storage key: cd_consent_v1 (localStorage).
   GA4 ID: G-SX20BZZP59 (set in inline head snippet).
   GTM container: GTM-PFFSDN3M (set in inline head snippet).
   ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'cd_consent_v1';
  var BANNER_ID = 'cd-consent-banner';
  var GA4_ID = 'G-SX20BZZP59';

  /* gtag is defined in the inline <head> snippet, before this file
     loads. Fall back to a no-op shim if something has stripped it. */
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function () { window.dataLayer.push(arguments); };
  }
  var gtag = window.gtag;

  /* ============================================================
     PART 1 · CONSENT
     ============================================================ */

  function readConsent() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function writeConsent(consent) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(consent)); }
    catch (e) { /* private mode · ignore */ }
  }

  function hasGpcOrDnt() {
    if (navigator.globalPrivacyControl === true) return true;
    if (navigator.doNotTrack === '1') return true;
    if (window.doNotTrack === '1') return true;
    if (navigator.msDoNotTrack === '1') return true;
    return false;
  }

  /* Apply a stored or fresh decision to Google Consent Mode v2.
     'denied' is already the default (set inline in <head>); this
     either confirms denial or upgrades to 'granted' on accept. */
  function applyConsent(consent) {
    var analytics = !!(consent && consent.analytics);
    gtag('consent', 'update', {
      'analytics_storage': analytics ? 'granted' : 'denied',
      'ad_storage':         'denied',
      'ad_user_data':       'denied',
      'ad_personalization': 'denied'
    });
  }

  /* Anonymous id for linking pre-signup consent rows to a user account
     later (when they sign up). Stable across visits, regenerated only
     if cleared. Used by /api/consent server-side audit log. */
  function anonId() {
    var key = 'cd_consent_anon_id';
    try {
      var existing = localStorage.getItem(key);
      if (existing) return existing;
      var fresh = 'anon-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(key, fresh);
      return fresh;
    } catch (e) { return null; }
  }

  /* Server-side consent log · GDPR Article 7(1) audit trail. Best-effort:
     a network failure does NOT roll back the local decision. The user's
     choice is honoured regardless of whether the audit row reached us. */
  function sendConsentToServer(consent) {
    try {
      fetch('/api/consent', {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          consent_type: consent.analytics ? 'analytics' : 'essential_only',
          granted: !!consent.analytics,
          anon_id: anonId(),
        })
      }).catch(function () { /* swallow · audit log is best-effort */ });
    } catch (e) { /* swallow */ }
  }

  function saveAndApply(decision, source) {
    var consent = {
      essential: true,
      analytics: decision === 'granted',
      source: source || 'banner',
      timestamp: Date.now(),
      version: 2
    };
    writeConsent(consent);
    applyConsent(consent);
    sendConsentToServer(consent);
    closeBanner();
  }

  /* ---------- Banner UI ---------- */

  function buildBanner() {
    var b = document.createElement('div');
    b.id = BANNER_ID;
    b.className = 'cd-consent-banner';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-labelledby', 'cd-consent-title');
    b.setAttribute('aria-describedby', 'cd-consent-body');
    b.innerHTML =
      '<div class="cd-consent-inner">' +
        '<div class="cd-consent-copy">' +
          '<div id="cd-consent-title" class="cd-consent-title">Analytics cookies</div>' +
          '<p id="cd-consent-body" class="cd-consent-body">We use Google Analytics 4 with IP anonymisation to understand which pages help people decide. No advertising cookies, ever. You can change this any time on <a href="/cookies">the cookies page</a>.</p>' +
        '</div>' +
        '<div class="cd-consent-actions">' +
          '<button type="button" class="cd-consent-btn cd-consent-decline" data-cd-consent="deny">Essential only</button>' +
          '<button type="button" class="cd-consent-btn cd-consent-accept" data-cd-consent="accept">Accept analytics</button>' +
        '</div>' +
      '</div>';
    return b;
  }

  function showBanner() {
    if (document.getElementById(BANNER_ID)) return;
    var b = buildBanner();
    document.body.appendChild(b);
    requestAnimationFrame(function () { b.classList.add('cd-consent-banner-visible'); });
    b.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cd-consent]');
      if (!btn) return;
      var decision = btn.getAttribute('data-cd-consent') === 'accept' ? 'granted' : 'denied';
      saveAndApply(decision, 'banner');
    });
  }

  function closeBanner() {
    var b = document.getElementById(BANNER_ID);
    if (!b) return;
    b.classList.remove('cd-consent-banner-visible');
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 300);
  }

  /* Public API for cookies.html buttons. */
  window.CounselDayConsent = {
    grant:  function () { saveAndApply('granted', 'cookies-page'); },
    revoke: function () { saveAndApply('denied',  'cookies-page'); },
    state:  function () { return readConsent(); },
    show:   function () { showBanner(); }
  };

  function resolveConsent() {
    var stored = readConsent();
    if (stored) {
      applyConsent(stored);
    } else if (hasGpcOrDnt()) {
      saveAndApply('denied', 'gpc-dnt-default');
    } else {
      if (document.body) showBanner();
      else document.addEventListener('DOMContentLoaded', showBanner);
    }
  }

  /* ============================================================
     PART 2 · GA4 EVENTS
     Consent Mode v2 (set inline in <head>) handles whether these
     calls store cookies or send cookieless pings.
     ============================================================ */

  /* AB variant attachment.
     If the visitor came through /o.html, that rotator dropped a
     `cd_ab_variant` cookie. Surface the assigned variant as both a
     gtag default param (so every subsequent event carries it) and a
     custom dimension in GA4. Register `ab_variant` as a custom dim
     in the GA4 UI to slice conversions by landing-page variant. */
  (function () {
    try {
      var m = document.cookie.match(/(?:^|;\s*)cd_ab_variant=([^;]+)/);
      if (!m) return;
      var v = decodeURIComponent(m[1]).slice(0, 24); // defensive
      if (!/^[a-z0-9_-]+$/i.test(v)) return;
      gtag('set', { ab_variant: v });
      // Also fire a one-shot ab_seen on first page of the visit, so
      // there's always at least one event carrying the variant even
      // for visitors who bounce before any auto-event fires.
      gtag('event', 'ab_seen', { ab_variant: v });
    } catch (e) { /* swallow · analytics never blocks UX */ }
  })();

  function track(name, params) {
    try { gtag('event', name, params || {}); } catch (e) { /* swallow */ }
  }

  var path = (window.location.pathname || '').toLowerCase();
  function pageIs(name) { return path.indexOf(name) !== -1; }

  function fireAutoEvents() {
    if (pageIs('compose.html')) track('begin_compose', { surface: 'compose' });
    if (pageIs('signup.html') || pageIs('start.html') || pageIs('invite.html')) {
      var surface = pageIs('invite.html') ? 'invite' : (pageIs('signup.html') ? 'signup' : 'start');
      track('view_account_signup', { surface: surface });
    }
    if (pageIs('verify-email.html')) track('complete_signup', { surface: 'verify-email' });
    if (pageIs('verdict-reveal.html')) track('verdict_view', { surface: 'verdict-reveal' });
    if (pageIs('vote.html') || pageIs('vote-today.html')) {
      track('view_vote', { surface: pageIs('vote-today.html') ? 'vote-today' : 'vote' });
    }
  }

  function watchPricing() {
    var el = document.getElementById('editions');
    if (!el || !('IntersectionObserver' in window)) return;
    var fired = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !fired) {
          fired = true;
          track('view_pricing', { surface: 'editions' });
          io.disconnect();
        }
      });
    }, { threshold: 0.4 });
    io.observe(el);
  }

  function watchCtas() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a, button');
      if (!a) return;
      var href = (a.getAttribute('href') || '').toLowerCase();
      var label = (a.textContent || '').trim().toLowerCase();
      if (
        href.indexOf('signup.html') !== -1 ||
        href.indexOf('vote.html') !== -1 ||
        href.indexOf('compose.html') !== -1 ||
        href.indexOf('start.html') !== -1 ||
        label.indexOf('start a decision') !== -1 ||
        label.indexOf('start your first decision') !== -1 ||
        label.indexOf('begin a decision') !== -1 ||
        label.indexOf('start free') !== -1
      ) {
        track('click_start_decision', {
          label: label.slice(0, 60),
          surface: window.location.pathname,
          destination: href
        });
      }
      if (a.tagName === 'A' && a.hostname && a.hostname !== window.location.hostname && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
        track('outbound_click', { url: a.href, surface: window.location.pathname });
      }
    }, { passive: true });
  }

  function watchForms() {
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      if (pageIs('signup.html')) track('submit_signup', { surface: 'signup' });
      if (pageIs('compose.html')) track('submit_compose', { surface: 'compose' });
      if (pageIs('vote.html') || pageIs('vote-today.html')) {
        track('first_vote', { surface: pageIs('vote-today.html') ? 'vote-today' : 'vote' });
      }
    }, true);
  }

  function watchScroll() {
    var fired = false;
    function onScroll() {
      if (fired) return;
      var doc = document.documentElement;
      var max = (doc.scrollHeight - doc.clientHeight) || 1;
      var pct = (window.scrollY || doc.scrollTop) / max;
      if (pct >= 0.75) {
        fired = true;
        track('scroll_75', { surface: window.location.pathname });
        window.removeEventListener('scroll', onScroll);
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function watchEngagement() {
    var interacted = false;
    function mark() { interacted = true; }
    ['scroll', 'click', 'keydown', 'pointermove'].forEach(function (ev) {
      window.addEventListener(ev, mark, { passive: true, once: true });
    });
    setTimeout(function () {
      if (interacted && !document.hidden) {
        track('engaged_session', { surface: window.location.pathname });
      }
    }, 30000);
  }

  /* ============================================================
     AUTH-AWARE NAV · when the user has a live session:
       · "Sign in" / "Begin a decision" → "Your decisions" / "Account"
       · always append a "Log out" link
     Hits /api/auth-check (200 if signed in, 401 otherwise).
     Best-effort: a network failure leaves the public nav alone.
     ============================================================ */
  function ensureLogOutLink(cta) {
    if (cta.querySelector('[data-cd-logout]')) return; // idempotent
    var logout = document.createElement('a');
    logout.setAttribute('href', '/api/signout');
    logout.setAttribute('data-cd-logout', '1');
    logout.className = 'btn-text';
    logout.style.cssText = 'margin-left: 12px; cursor: pointer; color: var(--muted); border-bottom: 1px solid var(--rule); padding-bottom: 1px;';
    logout.textContent = 'Log out';
    logout.addEventListener('click', function (e) {
      e.preventDefault();
      fetch('/api/signout', { method: 'POST', credentials: 'include' })
        .catch(function () { /* fall through to GET redirect */ })
        .finally(function () { window.location.href = '/'; });
    });
    cta.appendChild(logout);
  }

  function ensureAdminLink(cta) {
    if (cta.querySelector('[data-cd-admin]')) return; // idempotent
    var link = document.createElement('a');
    link.setAttribute('href', '/admin');
    link.setAttribute('data-cd-admin', '1');
    link.className = 'btn-text';
    link.style.cssText = 'margin-left: 12px; color: var(--wine); border-bottom: 1px solid var(--wine); padding-bottom: 1px; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;';
    link.textContent = 'Admin';
    // Insert BEFORE the logout link so order is: Decisions · Account · Admin · Log out
    var logout = cta.querySelector('[data-cd-logout]');
    if (logout) cta.insertBefore(link, logout); else cta.appendChild(link);
  }

  function refreshNav() {
    fetch('/api/auth-check', {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
      .then(function (r) {
        if (r.status !== 200) return null;
        // Body may be empty (older deploys) or { ok, is_admin } · both fine
        return r.json().catch(function () { return { is_admin: r.headers.get('x-is-admin') === '1' }; });
      })
      .then(function (info) {
        if (!info) return;
        var isAdmin = !!info.is_admin;
        document.querySelectorAll('nav.nav-bar .nav-cta').forEach(function (cta) {
          var anchors = cta.querySelectorAll('a:not([data-cd-logout]):not([data-cd-admin])');
          if (anchors.length === 0) {
            ensureLogOutLink(cta);
            if (isAdmin) ensureAdminLink(cta);
            return;
          }
          // Pattern A · two CTAs ("Sign in" text + "Begin a decision" btn)
          if (anchors.length >= 2) {
            var first = anchors[0];
            var second = anchors[1];
            first.textContent = 'Your decisions';
            first.setAttribute('href', 'decisions.html');
            second.textContent = 'Account';
            second.setAttribute('href', 'account.html');
            ensureLogOutLink(cta);
            if (isAdmin) ensureAdminLink(cta);
            return;
          }
          // Pattern B · single CTA (already pointing at account.html on
          // signed-in pages); leave alone if it's already account-related.
          var a = anchors[0];
          var href = (a.getAttribute('href') || '').toLowerCase();
          if (href.indexOf('signin') !== -1) {
            a.textContent = 'Account';
            a.setAttribute('href', 'account.html');
          }
          ensureLogOutLink(cta);
          if (isAdmin) ensureAdminLink(cta);
        });
      })
      .catch(function () { /* swallow · keep public nav as-is */ });
  }

  /* ============================================================
     PART 3 · MOBILE NAV
     ============================================================ */

  function injectMobileMenu() {
    document.querySelectorAll('nav.nav-bar').forEach(function (navBar) {
      if (navBar.querySelector('.nav-toggle')) return; // idempotent
      var navInner = navBar.querySelector('.nav-inner');
      if (!navInner) return;
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nav-toggle';
      toggle.setAttribute('aria-label', 'Toggle navigation menu');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span>';
      navInner.appendChild(toggle);

      function close() {
        navBar.classList.remove('menu-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
      function open() {
        navBar.classList.add('menu-open');
        toggle.setAttribute('aria-expanded', 'true');
      }
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        if (navBar.classList.contains('menu-open')) close(); else open();
      });
      document.addEventListener('click', function (e) {
        if (!navBar.contains(e.target) && navBar.classList.contains('menu-open')) close();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && navBar.classList.contains('menu-open')) {
          close();
          toggle.focus();
        }
      });
    });
  }

  /* ============================================================
     BOOTSTRAP
     ============================================================ */

  function start() {
    injectMobileMenu();
    refreshNav();
    fireAutoEvents();
    watchPricing();
    watchCtas();
    watchForms();
    watchScroll();
    watchEngagement();
  }

  resolveConsent();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
