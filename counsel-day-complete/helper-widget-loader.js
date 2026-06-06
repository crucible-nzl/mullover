/* helper-widget-loader.js · tiny lazy-loader for the helper bot.
 *
 * Replaces the previous "<script src=/helper-widget.js defer>" tag on
 * every public page. The full helper-widget.js bundle is ~85KB · loading
 * it eagerly delayed first-paint and inflated the JS budget on every
 * page even though the widget was used by a small fraction of visitors.
 *
 * This loader is ~700 bytes and does one job: inject the real widget
 * <script> the moment the user looks like they might need it. Triggers:
 *   1. First scroll past 60px (user is reading and may want help)
 *   2. First user interaction (click, touchstart, keydown, focusin)
 *   3. A 4-second idle timeout (background preload so the widget is
 *      ready by the time someone reaches for it)
 *   4. Hover over any element with [data-help] (an opt-in early hint)
 *
 * Idempotent: once loaded the listeners detach themselves and a second
 * call is a no-op. The real widget also has its own
 * data-cd-helper-installed flag so a duplicate insert is safe.
 *
 * The full widget self-installs when it parses · we don't have to call
 * an init function. */
(function () {
  if (window.__cdHelperLoading) return;
  window.__cdHelperLoading = true;
  // Skip on the dedicated /helper page · the widget would be a
  // duplicate of the page's main content.
  if (/\/helper(\.html)?$/.test(window.location.pathname)) return;

  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    detach();
    var s = document.createElement('script');
    // Honour the asset-hashing script · if any hashed copy was injected
    // by Caddy via <link rel="modulepreload">, prefer it. Otherwise use
    // the plain filename · CI build-step renames in-place so this
    // resolves to the hashed copy after deploy.
    s.src = '/helper-widget.js';
    s.defer = true;
    document.head.appendChild(s);
  }

  // Detach all listeners once we've decided to load.
  function detach() {
    window.removeEventListener('scroll', onScroll, { passive: true });
    window.removeEventListener('click', load, true);
    window.removeEventListener('touchstart', load, { passive: true });
    window.removeEventListener('keydown', load, true);
    window.removeEventListener('focusin', load, true);
    document.removeEventListener('pointerover', onPointer, true);
    if (idleTimer) clearTimeout(idleTimer);
  }

  function onScroll() {
    if (window.scrollY > 60) load();
  }
  function onPointer(e) {
    if (e.target && e.target.closest && e.target.closest('[data-help]')) load();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('click', load, true);
  window.addEventListener('touchstart', load, { passive: true });
  window.addEventListener('keydown', load, true);
  window.addEventListener('focusin', load, true);
  document.addEventListener('pointerover', onPointer, true);

  // Idle preload · the widget likely-shows on most pages within a few
  // seconds, so preload it once the browser has nothing else to do.
  var idleTimer = setTimeout(load, 4000);
})();
