/* admin-shell.js · shared chrome JS for every /admin-*.html page.
 *
 * Current job:
 *   · Wrap every .tbl and table.adm in a .tbl-scroll div so that
 *     on mobile the table scrolls horizontally inside its wrapper
 *     while the rest of the page stays put. Pure CSS can't do this
 *     because there's no parent-selector and `display: block` on
 *     <table> breaks thead/tbody column alignment.
 *
 * Idempotent · safe to call multiple times; tables already inside a
 * .tbl-scroll are skipped. Runs after DOMContentLoaded AND again after
 * any fetch resolves (admin pages render tables async), via a single
 * MutationObserver scoped to .shell.
 */
(function () {
  'use strict';

  function wrapOne(tbl) {
    if (!tbl || !tbl.parentNode) return;
    if (tbl.parentNode.classList && tbl.parentNode.classList.contains('tbl-scroll')) return;
    var wrap = document.createElement('div');
    wrap.className = 'tbl-scroll';
    tbl.parentNode.insertBefore(wrap, tbl);
    wrap.appendChild(tbl);
  }

  function wrapAll(root) {
    var scope = root || document;
    var tables = scope.querySelectorAll('.tbl, table.adm');
    for (var i = 0; i < tables.length; i++) wrapOne(tables[i]);
  }

  // Mirror the .adm-subnav (horizontal anchor list) into a <select>
  // dropdown that's visible on screens < 900px. CSS hides one or the
  // other depending on viewport. Single source of truth: the original
  // anchor list. Avoids editing 17 admin HTML files.
  function buildSubnavDropdown() {
    var nav = document.querySelector('nav.adm-subnav');
    if (!nav) return;
    if (nav.dataset.cdDropdownBuilt === '1') return;
    nav.dataset.cdDropdownBuilt = '1';

    var links = nav.querySelectorAll('a');
    if (links.length === 0) return;

    var sel = document.createElement('select');
    sel.className = 'adm-subnav-dd';
    sel.setAttribute('aria-label', 'Admin section');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var opt = document.createElement('option');
      opt.value = a.getAttribute('href') || '#';
      opt.textContent = a.textContent.trim();
      if (a.classList.contains('active')) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', function () {
      var href = sel.value;
      if (href && href !== '#') window.location.href = href;
    });
    nav.parentNode.insertBefore(sel, nav.nextSibling);

    // Inject responsive CSS once: on narrow viewports, show the dropdown
    // and hide the horizontal nav; on wide, the opposite.
    if (!document.getElementById('cd-adm-subnav-dd-style')) {
      var sty = document.createElement('style');
      sty.id = 'cd-adm-subnav-dd-style';
      sty.textContent =
        '.adm-subnav-dd { display: none; }' +
        '.adm-subnav-dd { font-family: var(--font-ui, system-ui); font-size: 13px; padding: 8px 10px; border: 1px solid var(--ink, #1c1a17); background: var(--paper, #fff); color: var(--ink, #1c1a17); margin: 8px 12px; width: calc(100% - 24px); max-width: 380px; border-radius: 0; cursor: pointer; }' +
        '@media (max-width: 900px) {' +
          '.adm-subnav { display: none !important; }' +
          '.adm-subnav-dd { display: block; }' +
        '}';
      document.head.appendChild(sty);
    }
  }

  function init() {
    wrapAll(document);
    buildSubnavDropdown();
    var shell = document.querySelector('.shell');
    if (shell && 'MutationObserver' in window) {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType !== 1) continue;
            if (node.matches && node.matches('.tbl, table.adm')) wrapOne(node);
            else if (node.querySelectorAll) wrapAll(node);
          }
        }
      });
      mo.observe(shell, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
