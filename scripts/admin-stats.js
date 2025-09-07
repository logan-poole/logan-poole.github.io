/* scripts/admin-stats.js
   - Requires: scripts/sb-client.js (getSB, callSupabaseFn)
   - Also loads: Chart.js on admin page
*/
(function () {
  const sb = window.getSB?.();
  if (!sb) return;

  async function gate() {
    const gateEl = document.getElementById("gate");
    const contentEl = document.getElementById("content");
    const whoEl = document.getElementById("who");

    const { data: s } = await sb.auth.getSession();
    if (!s?.session) {
      gateEl.style.display = "";
      gateEl.innerHTML = `
        <p>You need to sign in to access admin.</p>
        <p><a href="./dev-login.html?next=admin.html">Go to Admin Login</a></p>
      `;
      return null;
    }
    whoEl.textContent = `Signed in as ${s.session.user.email}`;

    // require admin via read-your-own-role policy
    const { data, error } = await sb.from("user_roles").select("role").eq("user_id", s.session.user.id).maybeSingle();
    if (error) {
      gateEl.style.display = "";
      gateEl.innerHTML = `<p>Role check error: ${error.message}</p>`;
      return null;
    }
    const ok = !!data && (data.role === "admin" || data.role === "super_admin");
    if (!ok) {
      gateEl.style.display = "";
      gateEl.innerHTML = "<p>403 — You are signed in but do not have admin access.</p>";
      return null;
    }

    contentEl.style.display = "";
    document.getElementById("logout").onclick = async () => {
      await sb.auth.signOut();
      location.reload();
    };
    return s.session.user;
  }

  function fmtWhen(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  async function loadStats() {
    const data = await window.callSupabaseFn("admin-users", {
      method: "GET",
      query: { stats: 1 }
    });

    // Metrics
    const t = data?.totals || {};
    (document.getElementById("m-total") || {}).textContent = t.total_users ?? "—";
    (document.getElementById("m-new7")  || {}).textContent = t.new_7d ?? "—";
    (document.getElementById("m-a24")   || {}).textContent = t.active_24h ?? "—";
    (document.getElementById("m-a30")   || {}).textContent = t.active_30d ?? "—";
    (document.getElementById("m-admins")|| {}).textContent = t.admins ?? "—";
    (document.getElementById("m-banned")|| {}).textContent = t.banned ?? "—";

    // Chart
    const series = (data?.signups_by_day || []).sort((a,b) => a.date.localeCompare(b.date));
    const labels = series.map(d => d.date.slice(5)); // MM-DD
    const values = series.map(d => d.count);
    const ctx = document.getElementById("signupChart");
    if (ctx && window.Chart) {
      new Chart(ctx, {
        type: "line",
        data: { labels, datasets: [{ label: "Sign-ups", data: values, tension: .25, fill: false }] },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision:0 } } }
        }
      });
    }

    // Recent logins
    const tbody = (document.querySelector("#login-table tbody"));
    if (tbody) {
      tbody.innerHTML = "";
      const rec = data?.recent_logins || [];
      if (rec.length === 0) {
        const empty = document.getElementById("login-empty");
        if (empty) empty.style.display = "";
      }
      rec.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${r.email || "(no email)"}</td><td>${fmtWhen(r.last_sign_in_at)}</td><td class="muted">${r.id}</td>`;
        tbody.appendChild(tr);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const u = await gate();
    if (!u) return;
    try { await loadStats(); } catch (e) {
      console.error("[admin] stats error", e);
    }
  });
})();
