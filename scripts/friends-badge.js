/* 
  scripts/friends-badge.js — tiny global badge updater (OPTIONAL, add site-wide)
  -----------------------------------------------------------------------------
  WHAT THIS DOES
  - Keeps the red badge in the top nav (#nav-friends-badge) in sync with the count
    of incoming friend requests, no matter which page you’re on.
  - Subscribes to realtime on public.friendships and re-counts when rows change.
  HOW TO USE
  - Include on every page after your Supabase client (see friends.html bottom).
*/

(function () {
  const sb = (typeof window.getSB === 'function' ? window.getSB() : window.__sb);
  const badge = document.getElementById('nav-friends-badge');
  if (!sb || !badge) return;

  async function refresh() {
    const { data: reqs, error } = await sb.rpc('list_friend_requests');
    if (error) { console.warn('[friends-badge] list_friend_requests:', error.message); return; }
    const incoming = (reqs || []).filter(r => r.direction === 'incoming').length;
    if (!incoming) { badge.textContent = '0'; badge.hidden = true; }
    else { badge.textContent = String(incoming); badge.hidden = false; }
  }

  function wire() {
    try {
      sb.channel('friendships-badge')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, refresh)
        .subscribe();
    } catch {}
  }

  document.addEventListener('DOMContentLoaded', () => { refresh(); wire(); });
  sb.auth.onAuthStateChange((_e, sess) => { if (sess?.user) refresh(); else { badge.textContent='0'; badge.hidden=true; } });
})();
