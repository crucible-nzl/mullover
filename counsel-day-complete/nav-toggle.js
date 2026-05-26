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

    var toggle = navInner.querySelector('#cd-nav-toggle');
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

    // The CSS targets `.nav-bar.menu-open .nav-links` so we don't need
    // to add IDs to existing .nav-links elements.
    if (toggle.dataset.cdWired === '1') return;
    toggle.dataset.cdWired = '1';
    toggle.addEventListener('click', function () {
      var open = bar.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
