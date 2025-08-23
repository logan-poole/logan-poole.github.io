// scripts/feed.js
// -----------------------------------------------------------------------------
// Feed loader + composer with optimistic UI and strong diagnostics.
// - Binds composer by ID (#post-text, #post-image-url, #post-visibility, #post-submit)
// - Optimistically prepends the new post; also re-queries latest 50
// - Uses the ONE Supabase client from ui.js via window.__sb (no global redeclare)
// -----------------------------------------------------------------------------

(function (sb) {
  if (!sb) { console.error("[feed] Supabase client missing (window.__sb)"); return; }

  const feedList = document.getElementById("feed-list");
  const emptyMsg = document.getElementById("feed-empty");

  // ---- helpers --------------------------------------------------------------
  async function ensureUserFromUi(maxMs = 5000) {
    if (window.__loadUser) {
      const timeout = new Promise(res => setTimeout(res, maxMs));
      await Promise.race([window.__loadUser, timeout]);
      return window.__currentUser;
    }
    const { data: { session } } = await sb.auth.getSession();
    return session?.user ?? null;
  }

  async function getScopeIds(meId) {
    const ids = new Set([meId]);
    const { data: f1, error: e1 } = await sb
      .from("friends").select("friend_id").eq("user_id", meId).eq("status", "accepted");
    if (e1) console.warn("[feed] friends f1", e1.message);
    (f1 || []).forEach(r => ids.add(r.friend_id));

    const { data: f2, error: e2 } = await sb
      .from("friends").select("user_id").eq("friend_id", meId).eq("status", "accepted");
    if (e2) console.warn("[feed] friends f2", e2.message);
    (f2 || []).forEach(r => ids.add(r.user_id));
    return Array.from(ids);
  }

  function postCard(p, whoLabel) {
    const who  = whoLabel || p.author_label || p.author_id?.slice(0,8) || "someone";
    const when = p.created_at ? new Date(p.created_at).toLocaleString() : "";
    const el = document.createElement("article");
    el.className = "card";
    el.innerHTML = `
      <div class="muted" style="margin-bottom:6px;">${who}${when ? " • " + when : ""}</div>
      <div>${(p.text || "").replace(/\n/g, "<br>")}</div>
      ${p.image_url ? `<div style="margin-top:8px;"><img src="${p.image_url}" style="max-width:100%;border-radius:8px;" loading="lazy"></div>` : ""}
    `;
    return el;
  }

  async function fetchUsersBasic(ids) {
    if (!ids?.length) return {};
    const { data, error } = await sb.from("users").select("id, username, email").in("id", ids);
    if (error) { console.warn("[feed] fetchUsersBasic:", error.message); return {}; }
    const map = {};
    (data || []).forEach(u => map[u.id] = (u.username || u.email || u.id.slice(0,8)));
    return map;
  }

  // ---- main ops -------------------------------------------------------------
  async function loadFeed() {
    const { data: { session } } = await sb.auth.getSession();
    const user = session?.user;
    if (!user) {
      emptyMsg && (emptyMsg.textContent = "Please sign in to view your feed.", emptyMsg.classList.remove("hidden"));
      return;
    }

    if (!feedList) { console.warn("[feed] #feed-list not found"); return; }

    const ids = await getScopeIds(user.id);
    const { data, error, status } = await sb
      .from("posts")
      .select("id, author_id, text, image_url, visibility, created_at")
      .in("author_id", ids)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[feed] select posts:", status, error.message);
      emptyMsg && (emptyMsg.textContent = error.message, emptyMsg.classList.remove("hidden"));
      return;
    }

    feedList.innerHTML = "";
    if (!data?.length) {
      emptyMsg && (emptyMsg.textContent = "No posts yet. Be the first to share something!", emptyMsg.classList.remove("hidden"));
      return;
    } else emptyMsg?.classList.add("hidden");

    const labels = await fetchUsersBasic(ids);
    data.forEach(p => feedList.appendChild(postCard(p, labels[p.author_id])));
  }

  async function addPost() {
    const { data: { session } } = await sb.auth.getSession();
    const user = session?.user;
    if (!user) return alert("Please sign in to post.");

    const textEl = document.getElementById("post-text");
    const imgEl  = document.getElementById("post-image-url");
    const visEl  = document.getElementById("post-visibility");

    const text = (textEl?.value || "").trim();
    const image_url = (imgEl?.value || "").trim() || null;
    const visibility = (visEl?.value || "friends");

    if (!text && !image_url) return alert("Write something or add an image URL.");

    // Optimistically render
    if (feedList) {
      const optimistic = {
        id: "optimistic-" + Date.now(),
        author_id: user.id,
        author_label: user.user_metadata?.username || user.email || "You",
        text, image_url, visibility,
        created_at: new Date().toISOString()
      };
      feedList.prepend(postCard(optimistic, optimistic.author_label));
      emptyMsg?.classList.add("hidden");
    }

    // Insert and get row (works even if realtime is off)
    const { data, error, status } = await sb
      .from("posts")
      .insert({ author_id: user.id, text, image_url, visibility })
      .select("id") 
      .single();

    if (error) {
      console.error("[feed] insert post:", status, error.message);
      alert(error.message);
      // fallback: reload to reconcile UI
      await loadFeed();
      return;
    }

    // Clear inputs and refresh list authoritatively
    textEl && (textEl.value = "");
    imgEl && (imgEl.value = "");
    await loadFeed();
  }

  function bindComposer() {
    const btn = document.getElementById("post-submit");
    if (!btn) { console.warn("[feed] #post-submit not found"); return; }
    btn.addEventListener("click", (e) => { e.preventDefault(); addPost(); });
  }

  function subscribeRealtime() {
    try {
      sb
        .channel("posts-stream")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, async () => {
          // simple approach: requery
          await loadFeed();
        })
        .subscribe((status) => console.log("[feed] realtime status:", status));
    } catch (e) {
      console.warn("[feed] Realtime not available:", e);
    }
  }

  // ---- boot ----------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", async () => {
    console.log("[feed] boot");
    await ensureUserFromUi();
    bindComposer();
    await loadFeed();
    subscribeRealtime();

    sb.auth.onAuthStateChange((_e, sess) => {
      if (!sess?.user) {
        feedList && (feedList.innerHTML = "");
        emptyMsg && (emptyMsg.textContent = "Please sign in to view your feed.", emptyMsg.classList.remove("hidden"));
      } else loadFeed();
    });
  });
})(window.__sb);
