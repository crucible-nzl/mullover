/* nav-toggle.js · shared mobile-nav hamburger.
 *
 * Auto-installs the <.nav-toggle> button into any <.nav-bar > .nav-inner>
 * that doesn't already have one, then wires the click to toggle the
 * .menu-open class on the .nav-bar. CSS for the toggle + menu-open
 * states lives in styles-i8.css.
 *
 * Idempotent: pages that already shipped the toggle in their HTML
 * (e.g. via the nav-public / nav-app partial) are detected by the
 * existing #cd-nav-toggle and we just attach the handler. */
(function () {
  function init() {
    var navInner = document.querySelector('.nav-bar .nav-inner');
    if (!navInner) return;
    var bar = navInner.closest('.nav-bar');

    // Defensive dedup. If, for any reason (service worker, cached
    // double-import, partial-sync collision) there's more than one
    // .nav-toggle inside this nav, keep the first and remove the rest.
    var existing = navInner.querySelectorAll('.nav-toggle');
    for (var i = 1; i < existing.length; i++) {
      existing[i].parentNode.removeChild(existing[i]);
    }

    var toggle = navInner.querySelector('#cd-nav-toggle') || navInner.querySelector('.nav-toggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nav-toggle';
      toggle.id = 'cd-nav-toggle';
      toggle.setAttribute('aria-controls', 'cd-nav-links');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
      toggle.innerHTML = '<span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span>';
      // Insert after the brand link so the CSS `order: 3` still places
      // it correctly when the row wraps.
      var brand = navInner.querySelector('.nav-brand');
      if (brand && brand.nextSibling) {
        navInner.insertBefore(toggle, brand.nextSibling);
      } else {
        navInner.appendChild(toggle);
      }
    }

    // Belt-and-braces · clone-and-replace the button before wiring.
    // Cloning copies attributes but NOT event listeners, so any stray
    // handler that landed via a cached HTML snapshot, a service-worker
    // race, or a partial-sync collision is gone before we attach the
    // real one. We then swap the original with the clone so the rest
    // of the page sees the same button (same id/classes/aria).
    var fresh = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(fresh, toggle);
    toggle = fresh;

    // The CSS targets `.nav-bar.menu-open .nav-links` so we don't need
    // to add IDs to existing .nav-links elements.
    if (toggle.dataset.cdWired === '1') return;
    toggle.dataset.cdWired = '1';
    toggle.addEventListener('click', function (e) {
      // stopImmediatePropagation halts any other listener that, despite
      // the clone-and-replace, somehow got attached after us · e.g. a
      // late-running script that re-finds the button by id. Without
      // this, a second listener could re-toggle .menu-open within the
      // same click event and the menu opens-then-closes.
      e.stopImmediatePropagation();
      var open = bar.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });

    // Close on Escape (keyboard accessibility) + on outside click.
    // Both are no-ops when the menu is already closed.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && bar.classList.contains('menu-open')) {
        bar.classList.remove('menu-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
      }
    });
    document.addEventListener('click', function (e) {
      if (!bar.classList.contains('menu-open')) return;
      if (bar.contains(e.target)) return;
      bar.classList.remove('menu-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
    });
  }

  /* T3 · Log out link inside the burger menu. Wires the click via
     POST /api/signout, then redirects home. Falls through silently if
     the link doesn't exist on the page (public-facing pages don't have
     it). One handler attached at document level using delegation so a
     burger that re-renders later (e.g. after partial sync) still works. */
  function wireLogout() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('#cd-nav-logout');
      if (!a) return;
      e.preventDefault();
      try {
        fetch('/api/signout', { method: 'POST', credentials: 'include' })
          .catch(function () { /* swallow · we redirect either way */ })
          .finally(function () { window.location.href = '/'; });
      } catch (_) {
        window.location.href = '/';
      }
    }, { capture: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); wireLogout(); }, { once: true });
  } else {
    init();
    wireLogout();
  }
})();
