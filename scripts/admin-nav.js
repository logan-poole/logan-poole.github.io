/* Shows the Admin link/tile only if the current user has role admin/super_admin. */
(function () {
  function once(fn) { let ran = false; return (...a) => { if (ran) return; ran = true; return fn(...a); }; }

  async function isAdmin(sb) {
    const { data: s } = await sb.auth.getSession();
    if (!s?.session) return false;
    // Read-your-own-role policy avoids recursion
    const { data, error } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", s.session.user.id)
      .maybeSingle();
    if (error) { console.warn("[admin-nav] role check error:", error.message); return false; }
    return !!data && (data.role === "admin" || data.role === "super_admin");
  }

  document.addEventListener("DOMContentLoaded", once(async () => {
    const sb = window.getSB?.();
    if (!sb) return;

    const show = await isAdmin(sb);
    const nav = document.getElementById("nav-admin");
    const tile = document.getElementById("tile-admin");
    if (show && nav) {
      nav.href = "admin/admin.html";
      nav.style.display = "";
    }
    if (show && tile) {
      tile.href = "admin/admin.html";
      tile.style.display = "";
    }
  }));
})();
