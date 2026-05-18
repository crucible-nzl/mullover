/* ============================================================
   COUNSEL.DAY · POSTHOG PRODUCT ANALYTICS
   Loaded on every public page after ga4.js.

   Gated on window.CD_POSTHOG_KEY · the key is injected at deploy
   time by replacing the placeholder below. When unset, this file
   is a no-op and ships zero bytes of PostHog runtime.

   PostHog complements GA4: GA4 owns acquisition (which channel,
   which campaign, which page brought them in), PostHog owns
   funnels (which step in the compose flow drops people, which
   tier converts best at which session number, retention cohorts).

   Privacy posture:
     · disable_session_recording: true (we don't record screens)
     · mask_all_text: true (defence-in-depth on any future replay)
     · respects Global Privacy Control / Do-Not-Track silently
     · respects the same cd_consent_v1 banner decision as GA4 ·
       no events sent until analytics_storage is granted

   ============================================================ */
(function () {
  'use strict';

  /* DO NOT EDIT THIS LINE BY HAND · the deploy pipeline replaces
     `__POSTHOG_KEY__` at build time. Until that lands, leaving
     it as the placeholder keeps the SDK dormant. */
  var POSTHOG_KEY = window.CD_POSTHOG_KEY || '__POSTHOG_KEY__';
  var POSTHOG_HOST = window.CD_POSTHOG_HOST || 'https://eu.i.posthog.com';

  if (!POSTHOG_KEY || POSTHOG_KEY === '__POSTHOG_KEY__') return;

  /* Honour GPC / DNT before loading any code */
  if (navigator.globalPrivacyControl === true ||
      navigator.doNotTrack === '1' ||
      window.doNotTrack === '1' ||
      navigator.msDoNotTrack === '1') {
    return;
  }

  /* Honour the cd_consent_v1 banner. Same decision GA4 listens to. */
  try {
    var raw = localStorage.getItem('cd_consent_v1');
    if (raw) {
      var stored = JSON.parse(raw);
      if (!stored || !stored.analytics) return;
    } else {
      /* No decision yet · wait for banner. We re-run on next page load
         once the user has chosen. */
      return;
    }
  } catch (e) { return; }

  /* PostHog snippet (official · https://posthog.com/docs/libraries/js).
     Slim · sets up the queue, loads the SDK async, no blocking. */
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  window.posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: false,
    persistence: 'localStorage+cookie',
    cross_subdomain_cookie: false,
    secure_cookie: true,
    opt_out_capturing_by_default: false,
    autocapture: {
      element_allowlist: ['a', 'button'],
      css_selector_allowlist: ['.btn', '.btn-large', '.btn-ghost', '.btn-text', '.btn-danger', '[data-ph]'],
      dom_event_allowlist: ['click', 'submit'],
    },
    loaded: function (ph) {
      /* Fire the funnel events the GA4 file also fires · gives us a
         single canonical event taxonomy across both tools. */
      var path = (window.location.pathname || '').toLowerCase();
      function on(p, ev, props) { if (path.indexOf(p) !== -1) ph.capture(ev, props || {}); }
      on('compose.html', 'begin_compose', { surface: 'compose' });
      on('signup.html', 'view_account_signup', { surface: 'signup' });
      on('verify-email.html', 'complete_signup', {});
      on('verdict-reveal.html', 'verdict_view', {});
      on('vote-today.html', 'view_vote', { surface: 'vote-today' });
      on('vote.html', 'view_vote', { surface: 'vote' });
      on('pricing.html', 'view_pricing', { surface: 'pricing' });
    }
  });
})();
