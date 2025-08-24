/* scripts/page-flags.js */
(function () {
  const file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const protectedPages = new Set(['dashboard.html','map.html','feed.html','friends.html','settings.html','customise.html','chat.html']);
  const publicPages    = new Set(['index.html','faq.html','privacy.html','terms.html','support.html']);
  const b = document.body; if (!b) return;
  if (protectedPages.has(file)) {
    b.dataset.requireAuth = 'true';
    b.removeAttribute('data-public-only');
  } else if (publicPages.has(file)) {
    b.dataset.publicOnly = 'true';
    b.removeAttribute('data-require-auth');
  }
})();
