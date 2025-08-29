/* 
  scripts/page-flags.js — mark pages as public vs protected (UPDATED)
  -------------------------------------------------------------------
  WHAT CHANGED
  - Added verify.html (email confirmation landing) to public pages.
  - (Keep reset.html public.) You can also add wizard.html if you’re using the QA helper page.
*/

(function () {
  const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  const protectedPages = new Set([
    "dashboard.html","map.html","feed.html","friends.html","settings.html","customise.html","chat.html"
  ]);

  const publicPages = new Set([
    "index.html","faq.html","privacy.html","terms.html","support.html","reset.html","verify.html"
    // ,"wizard.html" // <- uncomment if you’re using the QA wizard page
  ]);

  const b = document.body; if (!b) return;

  if (protectedPages.has(file)) {
    b.dataset.requireAuth = "true";
    b.removeAttribute("data-public-only");
  } else if (publicPages.has(file)) {
    b.dataset.publicOnly = "true";
    b.removeAttribute("data-require-auth");
  } else {
    // neither → leave both flags unset (neutral pages)
    b.removeAttribute("data-require-auth");
    b.removeAttribute("data-public-only");
  }
})();
