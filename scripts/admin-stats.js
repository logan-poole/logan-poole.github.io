/* Author: Logan Poole — 30083609
   FILE: /scripts/admin-stats.js
   Purpose: Minimal counts for users/posts/messages.
*/
(function () {
  const $ = (s, r=document)=>r.querySelector(s);
  const CFG = window.PINGED_CONFIG || {};
  const T   = Object.assign({ PROFILES:'profiles', POSTS:'posts', MESSAGES:'messages' }, CFG.TABLES || {});

  function sb(){ return (typeof window.getSB === 'function' ? window.getSB() : (window.__sb || window.supabase)); }

  async function count(table) {
    try {
      const { count } = await sb().from(table).select('*', { count:'exact', head:true });
      return count || 0;
    } catch { return 0; }
  }

  async function boot() {
    const u = $('#metric-users'), p = $('#metric-posts'), m = $('#metric-messages');
    u && (u.textContent = await count(T.PROFILES));
    p && (p.textContent = await count(T.POSTS));
    m && (m.textContent = await count(T.MESSAGES));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
