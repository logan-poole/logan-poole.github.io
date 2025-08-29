/* 
  scripts/auth-guard.js — predictable auth UI + recovery-safe redirects (FINAL)
  ----------------------------------------------------------------------------
  WHAT’S NEW IN THIS UPDATE
  - Treats Supabase recovery/confirm/hash-token states as “special”: public pages won’t
    auto-redirect to dashboard while those flows are active (fixes reset.html and email confirm).
  - More robust recovery detection: checks query *and* hash for type=recovery, access_token,
    refresh_token, and code (used by some providers).
  - Safer “next” handling: won’t loop to the same page; preserves query+hash; never defaults.
  - Small resilience tweaks: longer wait for Supabase client; defensive overlay hide.

  EXPECTED MARKUP + HELPERS
  - <body data-require-auth="true"> on protected pages (page-flags.js sets this).
  - <body data-public-only="true"> on public-only pages.
  - Elements with [data-auth="public"/"guest"] and [data-auth="protected"/"authed"] to toggle UI.
  - sb-client.js must expose window.getSB() (Supabase JS v2).
*/

(function () {
  // ---------- tiny DOM helpers ----------
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Toggle public-only vs protected UI chunks
  const showPublic = (on) =>
    qsa('[data-auth="public"],[data-auth="guest"]').forEach(el => {
      el.hidden = !on; el.classList.toggle('hidden', !on);
      el.style.display = on ? '' : 'none';
    });

  const showProtected = (on) =>
    qsa('[data-auth="protected"],[data-auth="authed"]').forEach(el => {
      el.hidden = !on; el.classList.toggle('hidden', !on);
      el.style.display = on ? '' : 'none';
    });

  // Read page flags
  function flags() {
    const b = document.body?.dataset || {};
    return {
      needAuth:  b.requireAuth === 'true',
      publicOnly:b.publicOnly  === 'true'
    };
  }

  // Hide the auth overlay if present
  function nukeOverlay() {
    const ov = document.getElementById('auth-overlay');
    if (!ov) return;
    ov.setAttribute('aria-hidden', 'true');
    ov.style.display = 'none';
  }

  // ---------- special flow detection (recovery / confirm / tokens in hash) ----------
  function urlParams() {
    return {
      q: new URLSearchParams(location.search),
      h: new URLSearchParams((location.hash || '').replace(/^#/, ''))
    };
  }
  function isRecoveryFlow() {
    const { q, h } = urlParams();
    if (q.get('type') === 'recovery' || h.get('type') === 'recovery') return true;
    // Supabase recovery & magic link often carry tokens in hash
    const tokenish = ['access_token','refresh_token','code'];
    return tokenish.some(k => h.has(k));
  }

  // ---------- “return to” helpers ----------
  const NEXT_KEY = 'pinged_return_to';
  const rememberNext = () => {
    try { localStorage.setItem(NEXT_KEY, location.pathname + location.search + location.hash); } catch {}
  };
  const popNext = () => {
    try {
      const v = localStorage.getItem(NEXT_KEY);
      if (v) localStorage.removeItem(NEXT_KEY);
      return v || null;
    } catch { return null; }
  };
  const clearNext = () => { try { localStorage.removeItem(NEXT_KEY); } catch {} };

  function afterLoginTarget() {
    // explicit ?next= takes priority, else use remembered; never synthesize a default
    const urlNext = new URLSearchParams(location.search).get('next');
    if (urlNext) return urlNext;
    return popNext(); // may be null
  }

  function isCurrent(target) {
    if (!target) return true;
    try {
      // normalize both to path+query+hash (relative or absolute)
      const here = location.pathname + location.search + location.hash;
      const a = document.createElement('a');
      a.href = target; // browser resolves relative targets
      const there = a.pathname + a.search + a.hash;
      return here === there;
    } catch { return false; }
  }

  // ---------- Supabase client access ----------
  function getSBNow() {
    try { return (typeof window.getSB === 'function' ? window.getSB() : (window.__sb || null)); }
    catch { return null; }
  }
  async function waitForSB(maxMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const sb = getSBNow();
      if (sb) return sb;
      await sleep(60);
    }
    return null;
  }

  // ---------- initial render / redirect logic ----------
  async function initialRefresh() {
    const { needAuth, publicOnly } = flags();
    const recovering = isRecoveryFlow();

    // Show public by default to avoid header flicker
    showPublic(true); showProtected(false);

    const sb = await waitForSB();
    if (!sb) {
      if (needAuth) { rememberNext(); location.replace('index.html?signin=1'); }
      return;
    }

    // read session once; do NOT navigate on INITIAL_SESSION/TOKEN_REFRESHED
    let authed = false;
    try {
      const { data } = await sb.auth.getSession();
      authed = !!data?.session?.user;
    } catch {}

    nukeOverlay();
    showProtected(authed); showPublic(!authed);

    if (!authed && needAuth) {
      rememberNext();
      return location.replace('index.html?signin=1');
    }

    // If already authed on a public-only page, normally go to dashboard…
    // …except when in recovery/confirm/hash-token flows (let reset.html or confirm land)
    if (authed && publicOnly && !recovering) {
      return location.replace('dashboard.html');
    }
    // otherwise: stay
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', initialRefresh);
  else
    initialRefresh();

  // ---------- live auth changes ----------
  (async function wire() {
    const sb = await waitForSB(3000);
    if (!sb) return;

    sb.auth.onAuthStateChange((evt, session) => {
      const { needAuth, publicOnly } = flags();
      const recovering = isRecoveryFlow();
      const authed = !!session?.user;

      nukeOverlay();
      showProtected(authed); showPublic(!authed);

      if (evt === 'SIGNED_IN') {
        // Prefer explicit next or remembered route; avoid no-op loops
        const next = afterLoginTarget();
        if (publicOnly && !recovering) return location.replace('dashboard.html');
        if (next && !isCurrent(next)) return location.replace(next);
        clearNext();
        return; // stay put otherwise
      }

      if (!authed && needAuth) {
        rememberNext();
        return location.replace('index.html?signin=1');
      }
      // INITIAL_SESSION / TOKEN_REFRESHED / USER_UPDATED → never navigate here
    });
  })();

  // ---------- optional sign-out convenience ----------
  document.getElementById('btnSignOut')?.addEventListener('click', async () => {
    try { const sb = getSBNow(); await sb?.auth?.signOut(); } catch {}
    location.replace('index.html');
  });
})();
