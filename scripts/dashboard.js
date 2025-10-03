/* Author: Logan Poole — 30083609
   FILE: /scripts/dashboard.js
   Purpose: Dashboard boot with deterministic/failsafe grid reveal, admin gate, metrics (optional).
*/
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var grid = $('#dash-grid');
  var statusEl = $('#dash-status');
  var adminTile = document.getElementById('tile-admin'); // initially display:none in HTML

  function sb() {
    if (typeof window.getSB === 'function') return window.getSB();
    return window.__sb || window.supabase || null;
  }

  // --- Reliable reveal (idempotent) ---
  function revealGrid(force) {
    try {
      if (!grid) return;
      // Only flip once; allow explicit force
      var current = (grid.style.opacity || '').trim();
      if (force || current === '' || current === '0' || current === '0.0') {
        grid.style.opacity = '1';
      }
    } catch (e) {}
  }

  // Failsafe: if nothing has revealed after N ms, un-hide anyway (authenticated page)
  function scheduleFailsafeReveal(ms) {
    setTimeout(function () { revealGrid(true); }, ms || 1500);
  }

  async function safeCount(table) {
    try {
      var supa = sb();
      if (!supa || !supa.from) return 0;
      var res = await supa.from(table).select('*', { count: 'exact', head: true });
      return (res && typeof res.count === 'number') ? res.count : 0;
    } catch (e) { return 0; }
  }

  async function isAdmin(userId) {
    try {
      var supa = sb();
      if (!supa || !supa.from) return false;
      var q = await supa.from('profiles').select('role').eq('id', userId).single();
      var role = q && q.data && q.data.role;
      return String(role || '').toLowerCase() === 'admin';
    } catch (e) { return false; }
  }

  async function boot() {
    // In case the guard loads a bit later, put a safety timer to reveal.
    scheduleFailsafeReveal(1600);

    // Wait for guard to be available
    if (typeof window.guardRequireAuth !== 'function') {
      await new Promise(function (resolve) {
        var done = false;
        function onReady(){ if (!done) { done = true; resolve(); } }
        window.addEventListener('auth-guard:ready', onReady, { once: true });
        setTimeout(onReady, 700);
      });
    }

    // Require auth (redirects to index.html if not signed in)
    var loginRoute = (window.PINGED_CONFIG && window.PINGED_CONFIG.ROUTES && window.PINGED_CONFIG.ROUTES.LOGIN) || 'index.html';
    var session = null;
    try {
      session = await window.guardRequireAuth({ redirectTo: loginRoute });
    } catch (e) {
      // Guard already redirected on failure; stop here.
      return;
    }

    if (!session || !session.user) {
      // Shouldn’t happen (guard redirects), but keep grid visible to avoid “blank” flash.
      revealGrid(true);
      return;
    }

    // We are authenticated — reveal immediately.
    revealGrid(true);

    // Status line (non-fatal)
    try {
      if (statusEl) statusEl.textContent = 'Signed in as ' + (session.user.email || session.user.id);
    } catch (e) {}

    // Gate admin tile (non-fatal)
    try {
      var admin = await isAdmin(session.user.id);
      if (adminTile) adminTile.style.display = admin ? '' : 'none';
    } catch (e) {
      if (adminTile) adminTile.style.display = 'none';
    }

    // Optional metrics (guarded; elements may not exist)
    try {
      var usersEl = document.getElementById('metric-users');
      var postsEl = document.getElementById('metric-posts');
      var msgsEl  = document.getElementById('metric-messages');
      if (usersEl) usersEl.textContent = await safeCount('profiles');
      if (postsEl) postsEl.textContent = await safeCount('posts');
      if (msgsEl)  msgsEl.textContent  = await safeCount('messages');
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
