/* friends-badge.js — tiny global badge updater
 * - RPC: list_friend_requests()
 * - Fallback: SELECT friendships where friend_id = me.id AND status='pending'
 * - Realtime on public.friendships
 */
(function () {
  function getSB() {
    if (typeof window.getSB === "function") return window.getSB();
    if (window.__sb && window.__sb.auth) return window.__sb;
    if (window.supabase && window.supabase.auth) return window.supabase;
    return null;
  }
  const sb = getSB();
  const badge = document.getElementById("nav-friends-badge");
  if (!sb || !badge) return;

  async function refresh() {
    try {
      const { data: sess } = await sb.auth.getSession();
      const user = sess?.session?.user;
      if (!user) { badge.textContent = "0"; badge.hidden = true; return; }

      // RPC
      try {
        const r = await sb.rpc("list_friend_requests");
        if (!r.error && Array.isArray(r.data)) {
          const inc = r.data.filter(x => x.direction === "incoming").length;
          badge.textContent = String(inc || 0);
          badge.hidden = !inc;
          return;
        }
      } catch {}

      // Fallback
      const q = await sb.from((window.PINGED_CONFIG?.TABLES?.FRIENDSHIPS || "friendships"))
        .select("id").eq("friend_id", user.id).eq("status", "pending");
      const inc = (q.data || []).length;
      badge.textContent = String(inc || 0);
      badge.hidden = !inc;
    } catch (e) {
      console.warn("[friends-badge] refresh error:", e?.message || e);
    }
  }

  function wire() {
    try {
      sb.channel("friendships-badge")
        .on("postgres_changes", { event: "*", schema: "public", table: (window.PINGED_CONFIG?.TABLES?.FRIENDSHIPS || "friendships") }, refresh)
        .subscribe();
    } catch {}
  }

  document.addEventListener("DOMContentLoaded", () => { refresh(); wire(); });
  sb.auth.onAuthStateChange((_e, sess) => { if (sess?.user) refresh(); else { badge.textContent="0"; badge.hidden=true; } });
})();
