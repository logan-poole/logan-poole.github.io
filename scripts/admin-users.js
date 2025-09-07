/* Admin Users UI — calls Edge Function 'admin-users'
   Requires: logged-in session with role in public.user_roles (admin / super_admin)
   Depends on: scripts/sb-client.js (getSB, callSupabaseFn)
*/
(function () {
  const sb = window.getSB?.();
  if (!sb) {
    console.error("[users] Supabase not initialised — check script order and config.js values.");
    document.addEventListener("DOMContentLoaded", () => {
      const hint = document.getElementById("auth-hint");
      if (hint) hint.style.display = "";
    });
    return;
  }

  // ------- elements -------
  let state = { page: 1, perPage: 50, q: "" };

  const listEl = document.getElementById("users-list");
  const qEl = document.getElementById("q");
  const perEl = document.getElementById("perPage");
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");
  const pageInfo = document.getElementById("page-info");
  const refreshBtn = document.getElementById("refresh");
  const authHint = document.getElementById("auth-hint");

  const cForm = document.getElementById("create-form");
  const cEmail = document.getElementById("c-email");
  const cPwd = document.getElementById("c-password");
  const cUser = document.getElementById("c-username");
  const cName = document.getElementById("c-displayname");
  const cAvatar = document.getElementById("c-avatar");
  const cConfirmed = document.getElementById("c-confirmed");
  const cMsg = document.getElementById("create-msg");

  // ------- helpers -------
  function el(html) {
    const div = document.createElement("div");
    div.innerHTML = html.trim();
    return div.firstElementChild;
  }

  function fmtDate(s) {
    if (!s) return "—";
    try { return new Date(s).toLocaleString(); } catch { return s; }
  }

  function userCard(u) {
    const meta = u.user_metadata || {};
    const banned = !!u.banned_until;
    const card = el(`
      <div class="card">
        <div class="row space-between" style="gap:12px;">
          <div class="stack" style="min-width:0;">
            <div><strong>${u.email || "(no email)"}</strong></div>
            <div class="muted">id: ${u.id}</div>
            <div class="muted">${meta.display_name || meta.username || ""}</div>
            <div class="muted">Created: ${fmtDate(u.created_at)}</div>
          </div>
          <div class="row" style="gap:6px; flex-wrap:wrap;">
            <button class="small" data-act="ban">${banned ? "Unban" : "Ban"}</button>
            <button class="small" data-act="promote">Make Admin</button>
            <button class="small danger" data-act="del">Delete</button>
          </div>
        </div>
      </div>
    `);

    // Delete
    card.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm(`Delete ${u.email || u.id}? This removes the auth user.`)) return;
      try {
        await window.callSupabaseFn("admin-users", {
          method: "DELETE",
          query: { id: u.id },
        });
        await load(state.page);
      } catch (e) {
        alert(`Delete failed: ${e.message}`);
      }
    });

    // Ban / Unban
    card.querySelector('[data-act="ban"]').addEventListener("click", async () => {
      const banned_until = u.banned_until ? null : new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
      try {
        await window.callSupabaseFn("admin-users", {
          method: "PATCH",
          query: { id: u.id },
          body: { banned_until }
        });
        await load(state.page);
      } catch (e) {
        alert(`Ban/Unban failed: ${e.message}`);
      }
    });

    // Promote to admin -- now via Edge Function (service role)
    card.querySelector('[data-act="promote"]').addEventListener("click", async () => {
      if (!confirm(`Make ${u.email || u.id} an admin?`)) return;
      try {
        await window.callSupabaseFn("admin-users", {
          method: "PATCH",
          body: { action: "set_role", user_id: u.id, role: "admin" }
        });
        alert("User promoted to admin.");
      } catch (e) {
        alert(`Promote failed: ${e.message || e}`);
      }
    });

    return card;
  }

  async function ensureLoggedIn() {
    const { data } = await sb.auth.getSession();
    if (!data?.session) {
      if (authHint) authHint.style.display = "";
      throw new Error("Not signed in");
    }
  }

  async function load(page = 1) {
    try {
      await ensureLoggedIn();
    } catch {
      // Page shows the hint; stop here.
      listEl.innerHTML = "";
      pageInfo.textContent = "";
      return;
    }

    state.page = Math.max(1, Number(page || 1));
    state.perPage = Math.max(1, Number(perEl?.value || 50));
    state.q = (qEl?.value || "").trim();

    listEl.innerHTML = `<div class="muted">Loading…</div>`;
    pageInfo.textContent = `Page ${state.page}`;

    try {
      const data = await window.callSupabaseFn("admin-users", {
        method: "GET",
        query: { page: state.page, perPage: state.perPage, q: state.q || "" }
      });

      const users = data?.users || [];
      listEl.innerHTML = "";
      users.forEach(u => listEl.appendChild(userCard(u)));
      if (users.length === 0) listEl.innerHTML = `<div class="empty">No users found.</div>`;

      // Naive next/prev enablement (no total pages returned reliably)
      prevBtn.disabled = state.page <= 1;
      nextBtn.disabled = users.length < state.perPage;
      pageInfo.textContent = `Page ${state.page} • Showing ${users.length} user(s)`;
    } catch (e) {
      listEl.innerHTML = `<div class="error">Failed to load users: ${e.message}</div>`;
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    }
  }

  async function onCreate(e) {
    e.preventDefault();
    cMsg.textContent = "";
    const payload = {
      email: cEmail.value.trim(),
      password: cPwd.value ? cPwd.value : undefined,
      email_confirm: !!cConfirmed.checked,
      user_metadata: {
        username: cUser.value || undefined,
        display_name: cName.value || undefined,
        profile_pic: cAvatar.value || undefined
      }
    };
    if (!payload.email) {
      cMsg.textContent = "Email is required.";
      return;
    }

    try {
      await window.callSupabaseFn("admin-users", { method: "POST", body: payload });
      cMsg.textContent = "User created.";
      cForm.reset();
      await load(1);
    } catch (e) {
      cMsg.textContent = `Create failed: ${e.message}`;
    }
  }

  // ------- init -------
  document.addEventListener("DOMContentLoaded", () => {
    if (cForm) cForm.addEventListener("submit", onCreate);
    if (refreshBtn) refreshBtn.addEventListener("click", () => load(state.page));
    if (qEl) qEl.addEventListener("input", () => load(1));
    if (perEl) perEl.addEventListener("change", () => load(1));
    if (prevBtn) prevBtn.addEventListener("click", () => load(state.page - 1));
    if (nextBtn) nextBtn.addEventListener("click", () => load(state.page + 1));
    load(1);
  });
})();
