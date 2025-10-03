/* Author: Logan Poole — 30083609
   FILE: /scripts/auth-guard.js
   Purpose: Gate pages that require auth and toggle header nav visibility based on session,
            but DO NOT redirect until the Supabase session is actually known. */
(function () {
  'use strict';

  const CFG = window.PINGED_CONFIG || {};
  const LOGIN_PATH = (CFG.ROUTES && CFG.ROUTES.LOGIN) || 'index.html';

  function updateNavForAuth(isAuthed) {
    const pub = document.querySelectorAll('[data-auth="public"]');
    const pro = document.querySelectorAll('[data-auth="protected"]');
    pub.forEach(el => el.hidden = !!isAuthed);
    pro.forEach(el => el.hidden = !isAuthed);
  }

  // Wait for sb-client to either:
  //  - emit 'sb:ready' / 'sb:session', OR
  //  - already have a user/token, OR
  //  - after a short fallback, fetch session once ourselves.
  async function waitForSessionReady() {
    // If we already have a user/token, no need to wait.
    if (window.sbUser?.id || window.sbAccessToken) return;

    const waited = new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };

      // Resolve when sb-client announces readiness or session change
      window.addEventListener('sb:ready', finish, { once: true });
      window.addEventListener('sb:session', finish, { once: true });

      // Safety net: if events don’t arrive quickly, finish anyway
      setTimeout(finish, 800);
    });

    await waited;

    // If still no user, fetch once without blocking future loads
    if (!window.sbUser?.id) {
      try {
        const sb = (typeof window.getSB === 'function') ? window.getSB() : null;
        if (sb?.auth?.getSession) {
          const { data } = await sb.auth.getSession();
          const sess = data && data.session;
          if (sess) {
            window.sbAccessToken = sess.access_token || window.sbAccessToken || null;
            window.sbUser = sess.user || window.sbUser || null;
          }
        }
      } catch {
        // ignore — we'll treat as unauthenticated below
      }
    }
  }

  async function guardIfNeeded() {
    // IMPORTANT: do not treat "sbUser defined (null)" as ready
    await waitForSessionReady();

    const needsAuth =
      document.body?.getAttribute('data-require-auth') === 'true' ||
      !!document.querySelector('[data-require-auth="true"]');

    const isAuthed = !!(window.sbUser && window.sbUser.id);
    updateNavForAuth(isAuthed);

    if (needsAuth && !isAuthed) {
      location.replace(LOGIN_PATH);
      throw new Error('[auth-guard] Not authenticated: redirecting to ' + LOGIN_PATH);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', guardIfNeeded);
  } else {
    guardIfNeeded();
  }

  // Live updates when auth state changes toggle header links immediately
  window.addEventListener('sb:session', (e) => {
    updateNavForAuth(!!(e.detail && e.detail.user));
  });
})();
