/* scripts/auth-guard.js  — minimal, predictable redirects */
(function () {
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const showPublic = (on) =>
    qsa('[data-auth="public"],[data-auth="guest"]').forEach(el => {
      el.hidden = !on; el.classList.toggle('hidden', !on); el.style.display = on ? '' : 'none';
    });
  const showProtected = (on) =>
    qsa('[data-auth="protected"],[data-auth="authed"]').forEach(el => {
      el.hidden = !on; el.classList.toggle('hidden', !on); el.style.display = on ? '' : 'none';
    });

  function flags() {
    const b = document.body?.dataset || {};
    return { needAuth: b.requireAuth === 'true', publicOnly: b.publicOnly === 'true' };
  }

  function nukeOverlay() {
    const ov = document.getElementById('auth-overlay');
    if (!ov) return; ov.setAttribute('aria-hidden', 'true'); ov.style.display = 'none';
  }

  // “return to” helpers
  const NEXT_KEY = 'pinged_return_to';
  const rememberNext = () => {
    try { localStorage.setItem(NEXT_KEY, location.pathname + location.search + location.hash); } catch { }
  };
  const popNext = () => {
    try {
      const v = localStorage.getItem(NEXT_KEY);
      if (v) localStorage.removeItem(NEXT_KEY);
      return v || null;
    } catch { return null; }
  };
  const clearNext = () => { try { localStorage.removeItem(NEXT_KEY); } catch { } };

  function afterLoginTarget() {
    const urlNext = new URLSearchParams(location.search).get('next');
    if (urlNext) return urlNext;
    const ret = popNext();
    return ret || null; // ⚠️ do NOT default to dashboard here
  }
  function isCurrent(target) {
    if (!target) return true;
    const here = location.pathname.split('/').pop() || 'index.html';
    return here === target || ('/' + here) === target || here.endsWith('/' + target);
  }

  function getSBNow() { return (window.getSB && window.getSB()) ? window.getSB() : (window.__sb || null); }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function waitForSB(maxMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < maxMs) { const sb = getSBNow(); if (sb) return sb; await sleep(50); }
    return null;
  }

  async function initialRefresh() {
    const { needAuth, publicOnly } = flags();

    // default: show public so header doesn’t flicker empty
    showPublic(true); showProtected(false);

    const sb = await waitForSB();
    if (!sb) {
      if (needAuth) { rememberNext(); location.replace('index.html?signin=1'); }
      return;
    }

    // read session once; do NOT redirect on INITIAL_SESSION
    let authed = false, user = null;
    try { const { data } = await sb.auth.getSession(); user = data?.session?.user || null; authed = !!user; } catch { }

    nukeOverlay();
    showProtected(authed); showPublic(!authed);

    if (!authed && needAuth) {
      rememberNext();
      return location.replace('index.html?signin=1');
    }
    if (authed && publicOnly) {
      // only public pages (home/faq/etc.) should push an authed user to dashboard
      return location.replace('dashboard.html');
    }
    // otherwise: stay put (map/feed/settings won’t bounce)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialRefresh);
  else initialRefresh();

  // Live auth changes — redirect only on real sign-in
  (async function wire() {
    const sb = await waitForSB(2000); if (!sb) return;

    sb.auth.onAuthStateChange((evt, session) => {
      const { needAuth, publicOnly } = flags();
      const authed = !!session?.user;

      nukeOverlay();
      showProtected(authed); showPublic(!authed);

      if (evt === 'SIGNED_IN') {
        // fresh sign-in: prefer explicit “next” or remembered path, else stay
        const next = afterLoginTarget();
        if (publicOnly) return location.replace('dashboard.html');
        if (next && !isCurrent(next)) return location.replace(next);
        clearNext();
        return; // no default redirect
      }

      if (!authed && needAuth) {
        rememberNext();
        return location.replace('index.html?signin=1');
      }
      // INITIAL_SESSION / TOKEN_REFRESHED → never navigate
    });
  })();

  // Optional sign-out convenience
  document.getElementById('btnSignOut')?.addEventListener('click', async () => {
    try { const sb = getSBNow(); await sb?.auth?.signOut(); } catch { }
    location.replace('index.html');
  });
})();
