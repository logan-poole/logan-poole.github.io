/* 
  scripts/friends-badge.js — tiny global badge updater (OPTIONAL, add site-wide)
  - Counts incoming requests via list_friend_requests()
  - Realtime on public.friendships
*/
(function () {
  const sb = (typeof window.getSB === 'function' ? window.getSB() : window.__sb);
  const badge = document.getElementById('nav-friends-badge');
  if (!sb || !badge) return;

  async function refresh() {
    try {
      const { data: reqs, error } = await sb.rpc('list_friend_requests');
      if (error) throw error;
      const incoming = (reqs || []).filter(r => r.direction === 'incoming').length;
      if (!incoming) { badge.textContent = '0'; badge.hidden = true; }
      else { badge.textContent = String(incoming); badge.hidden = false; }
    } catch (e) {
      console.warn('[friends-badge] list_friend_requests:', e.message);
    }
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
