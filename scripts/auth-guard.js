// ============================================================================
// FILE: scripts/auth-guard.js  (COMPLETE, UPDATED)
// WHAT CHANGED
// - Dispatches a window event 'pinged:auth' after each auth check/state change.
// - Uses getUser() (not just getSession()) to avoid stale local tokens.
// - Robustly toggles [data-auth="public"] vs [data-auth="protected"] and respects
//   <body data-require-auth="true"> pages (redirects to index?signin=1 when logged out).
// - Safe if Supabase or config are missing (keeps public links visible).
// ============================================================================
(function () {
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const showPublic = (on) => qsa('[data-auth="public"],[data-auth="guest"]').forEach(el => { el.hidden = !on; el.classList.toggle('hidden', !on); el.style.display = on ? '' : 'none'; });
  const showProtected = (on) => qsa('[data-auth="protected"],[data-auth="authed"]').forEach(el => { el.hidden = !on; el.classList.toggle('hidden', !on); el.style.display = on ? '' : 'none'; });

  function redirectToIndexWithNext() {
    const next = encodeURIComponent(location.pathname + location.search + location.hash);
    try { localStorage.setItem('pinged_return_to', decodeURIComponent(next)); } catch { }
    location.replace('index.html?signin=1');
  }

  function emitAuth(authed, user) {
    try { window.dispatchEvent(new CustomEvent('pinged:auth', { detail: { authed, user } })); } catch { }
  }

  // default state before checks
  showProtected(false); showPublic(true);

  const cfg = window.PINGED_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase?.createClient) {
    if (document.body?.dataset?.requireAuth === 'true') redirectToIndexWithNext();
    emitAuth(false, null);
    return;
  }
  if (!window.__sb) window.__sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const sb = window.__sb;

  async function computeAuth() {
    try {
      const { data, error } = await sb.auth.getUser();
      if (error) return { authed: false, user: null, error };
      return { authed: !!data?.user, user: data?.user || null };
    } catch (e) {
      return { authed: false, user: null, error: e };
    }
  }

  async function applyAuthAndMaybeGate() {
    const needAuth = (document.body?.dataset?.requireAuth === 'true');
    const { authed, user } = await computeAuth();

    showProtected(authed);
    showPublic(!authed);
    emitAuth(authed, user);

    if (!authed && needAuth) redirectToIndexWithNext();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAuthAndMaybeGate);
  } else {
    applyAuthAndMaybeGate();
  }

  sb.auth.onAuthStateChange(async (_event, _session) => {
    const needAuth = (document.body?.dataset?.requireAuth === 'true');
    const { authed, user } = await computeAuth();

    showProtected(authed);
    showPublic(!authed);
    emitAuth(authed, user);

    if (!authed && needAuth) redirectToIndexWithNext();
  });

  // Optional sign-out button anywhere in the app
  document.getElementById('signOutBtn')?.addEventListener('click', async () => {
    try { await sb.auth.signOut(); } catch { }
    try { window.notify?.carryNext?.('Signed out', 'success'); } catch { }
    location.href = 'index.html';
  });
})();
