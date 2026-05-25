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

  function init() {
    wrapAll(document);
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
