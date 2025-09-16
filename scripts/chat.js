/* FILE: scripts/chat.js  (schema-agnostic + realtime)
   - No hard-coded avatar col; picks from common keys
   - start_dm: single canonical call (p_other_user_id), legacy ensure_dm as fallback
   - Detects message author column on read; tries multiple on insert:
     author_id → sender_id → user_id → from_user_id
   - Default avatar path fixed to assets/avatar-default.png
   - Realtime:
     • sets socket auth automatically
     • subscribes to INSERTs for this conversation
     • ignores your own inserts (you already see the optimistic bubble)
*/

(function () {
  const $ = (s, r = document) => r.querySelector(s);

  // DOM
  const logEl         = $("#chat-log");
  const formEl        = $("#chat-form");
  const textEl        = $("#chat-text");
  const filesEl       = $("#chat-files");
  const sendBtn       = $("#chat-send");
  const addPeopleBtn  = $("#add-people-btn");

  // Group modal
  const modal         = $("#group-modal");
  const modalClose    = $("#group-close");
  const modalCancel   = $("#group-cancel");
  const modalCreate   = $("#group-create");
  const newGroupBtn   = $("#new-group-btn");
  const modalFriends  = $("#group-friends");

  // Sidebar
  const searchEl      = $("#friend-search");
  const friendsEl     = $("#friends-list");

  // Config (from scripts/config.js); allow overrides via PINGED_CONFIG
  const CFG = window.PINGED_CONFIG || window.PINGED || {};
  const T = Object.assign({
    PROFILES: "profiles",
    CONVERSATIONS: "conversations",
    PARTICIPANTS: "conversation_participants",
    MESSAGES: "messages",
    FRIENDSHIPS: "friendships"
  }, CFG.TABLES || {});

  // Column detection
  const AVATAR_KEYS = ["profile_pic","avatar_url","avatar","image_url","photo_url","picture","photo"];
  const MSG_AUTHOR_KEYS = ["author_id","sender_id","user_id","from_user_id"];

  const labelFromProfile = (p) =>
    p?.display_name || (p?.username ? `@${p.username}` : "User");

  const avatarFromAny = (obj) => {
    for (const k of AVATAR_KEYS) if (obj && obj[k]) return obj[k];
    return "assets/avatar-default.png";
  };

  function getMsgAuthorId(m) {
    for (const k of MSG_AUTHOR_KEYS) if (m && m[k]) return m[k];
    return null;
  }

  function assertSB() {
    sb = (typeof window.getSB === "function" ? window.getSB() : (window.__sb || window.supabase));
    if (!sb) throw new Error("[chat] Supabase not initialised");
  }

  // --- Realtime auth helper ---
  async function ensureRealtimeAuth() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session?.access_token) sb.realtime.setAuth(session.access_token);
    } catch {}
    sb.auth.onAuthStateChange((_e, sess) => {
      if (sess?.access_token) sb.realtime.setAuth(sess.access_token);
    });
  }

  // ---- State ----
  let sb = null, me = null;
  let activeConv = null;
  let channel = null;
  const seenMsgIds = new Set();
  let allFriends = [];

  // ---- RPC: canonical DM opener ----
  async function tryDMRPC(otherUserId) {
    // Single canonical call; your DB has start_dm(p_other_user_id uuid) => uuid
    try {
      const { data, error } = await sb.rpc("start_dm", { p_other_user_id: otherUserId });
      if (!error && data) return typeof data === "string" ? data : data?.id || data;
    } catch {}
    // Fallback (only if you also kept a legacy ensure_dm)
    try {
      const { data, error } = await sb.rpc("ensure_dm", { p_other: otherUserId });
      if (!error && data) return typeof data === "string" ? data : data?.id || data;
    } catch {}
    return null;
  }

  async function openDM(otherUserId) {
    try {
      if (!otherUserId || typeof otherUserId !== "string") {
        alert("Sorry, I couldn't find that user's id. Try from your friends list.");
        return;
      }
      const convId = await tryDMRPC(otherUserId);
      if (!convId) {
        alert("Could not start DM. Check RPC/RLS.");
        return;
      }
      await enterConversation(convId);
    } catch (e) {
      console.error("[chat] create/open DM failed", e);
      alert("Could not open DM. Check authentication and RLS policies.");
    }
  }

  async function enterConversation(conversationId) {
    activeConv = conversationId;
    addPeopleBtn && (addPeopleBtn.disabled = false);
    await renderParticipants(conversationId);
    await loadMessages(conversationId);
    subscribeMessages(conversationId);
  }

  // ---- Participants (no hardcoded columns) ----
  async function fetchProfilesByIds(ids) {
    try {
      const { data, error } = await sb.from(T.PROFILES).select("*").in("user_id", ids);
      if (error) throw error;
      return data || [];
    } catch {
      const { data } = await sb.from(T.PROFILES).select("*").in("id", ids);
      return data || [];
    }
  }

  async function renderParticipants(conversationId) {
    try {
      const { data: rows, error } = await sb
        .from(T.PARTICIPANTS)
        .select("user_id")
        .eq("conversation_id", conversationId);
      if (error) throw error;
      const ids = (rows || []).map(r => r.user_id).filter(Boolean);
      const profiles = await fetchProfilesByIds(ids);
      const youId = me?.id;

      const pills = (profiles || [])
        .sort((a, b) => (a.display_name || a.username || "")
          .localeCompare(b.display_name || b.username || ""))
        .map(p => {
          const label = p.user_id === youId || p.id === youId ? "You" : labelFromProfile(p);
          return `<span class="pill"><img src="${avatarFromAny(p)}" width="16" height="16" style="border-radius:50%"> ${label}</span>`;
        });

      const holder = $("#participants");
      if (holder) holder.innerHTML = pills.join(" ");
    } catch (e) {
      console.warn("[chat] participants error", e?.message);
    }
  }

  // ---- Messages ----
  async function loadMessages(conversationId) {
    if (!logEl) return;
    logEl.innerHTML = '<div class="muted" style="padding:10px">Loading…</div>';

    const { data: rows, error } = await sb
      .from(T.MESSAGES)
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) {
      console.error("[chat] load messages error", error);
      logEl.innerHTML = `<div class="error" style="padding:10px">Couldn't load messages (${error.code || ""}).</div>`;
      return;
    }

    const authorIds = [...new Set((rows || []).map(getMsgAuthorId).filter(Boolean))];
    const authorMap = {};
    if (authorIds.length) {
      try {
        const { data } = await sb.from(T.PROFILES).select("*").in("user_id", authorIds);
        (data || []).forEach(p => { authorMap[p.user_id || p.id] = p; });
      } catch {
        const { data } = await sb.from(T.PROFILES).select("*").in("id", authorIds);
        (data || []).forEach(p => { authorMap[p.id] = p; });
      }
    }

    if (!rows || !rows.length) {
      logEl.innerHTML = '<div class="muted" style="padding:10px">No messages yet — say hi! ✨</div>';
      return;
    }

    logEl.innerHTML = "";
    for (const m of (rows || [])) {
      const author = authorMap[getMsgAuthorId(m)];
      const node = await renderOneMessage(m, author);
      logEl.appendChild(node);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Realtime: INSERT-only; skip own inserts (optimistic already shown)
  function subscribeMessages(conversationId) {
    if (channel) sb.removeChannel(channel);

    channel = sb
      .channel(`msgs-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: T.MESSAGES,
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const m = payload.new;
          if (!m || seenMsgIds.has(m.id)) return;
          const authorId = getMsgAuthorId(m);
          if (authorId === me.id) return; // avoid duping optimistic bubble
          seenMsgIds.add(m.id);

          let author = null;
          try {
            const { data } = await sb.from(T.PROFILES).select("*").in("user_id", [authorId]);
            author = (data && data[0]) || null;
          } catch {
            const { data } = await sb.from(T.PROFILES).select("*").in("id", [authorId]);
            author = (data && data[0]) || null;
          }

          const node = await renderOneMessage(m, author);
          logEl.appendChild(node);
          logEl.scrollTop = logEl.scrollHeight;
        }
      )
      .subscribe((status) => {
        console.log("[realtime] messages channel status:", status);
      });
  }

  // ---- Uploads via Edge Function ----
  async function uploadViaFunction(conversationId, file) {
    const data = await window.callSupabaseFn("chat-upload", {
      method: "GET",
      query: { convId: conversationId, contentType: file.type || "application/octet-stream" }
    });
    const putRes = await fetch(data.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file
    });
    if (!putRes.ok) throw new Error("Upload failed");
    return { path: data.storagePath, type: file.type || null };
  }

  // ---- Send ----
  async function onSend(e) {
    e.preventDefault();
    if (!activeConv) return alert("Open a conversation first.");
    const body = (textEl?.value || "").trim();
    if (!body && !(filesEl?.files?.length)) return; // nothing to send

    let media_path = null, media_type = null;
    if (filesEl?.files?.length) {
      try {
        const up = await uploadViaFunction(activeConv, filesEl.files[0]);
        media_path = up.path; media_type = up.type;
      } catch (err) {
        console.error("[chat] upload failed", err);
        return alert("Could not upload media.");
      }
    }

    // optimistic bubble
    const optimistic = {
      id: `tmp-${Date.now()}`,
      conversation_id: activeConv,
      created_at: new Date().toISOString(),
      body, media_path, media_type
    };
    seenMsgIds.add(optimistic.id);
    const node = await renderOneMessage({ ...optimistic, author_id: me.id }, { id: me.id, user_id: me.id, display_name: "You", username: me.email?.split("@")[0] });
    logEl && logEl.appendChild(node);
    logEl && (logEl.scrollTop = logEl.scrollHeight);

    const base = { conversation_id: activeConv, created_at: new Date().toISOString(), body, media_path, media_type };
    const variants = [
      { ...base, author_id: me.id },
      { ...base, sender_id: me.id },
      { ...base, user_id: me.id },
      { ...base, from_user_id: me.id },
    ];

    let lastError = null;
    for (const row of variants) {
      const { error } = await sb.from(T.MESSAGES).insert(row);
      if (!error) { lastError = null; break; }
      lastError = error;
      const msg = (error.message || "").toLowerCase();
      if (
        !(msg.includes("null value in column") || msg.includes("...not exist") || error.code === "23502" || error.code === "42703")
      ) break;
    }

    if (lastError) {
      console.error("[chat] send error", lastError)
      alert("Could not send. Check message table columns/policy.");
    } else {
      textEl && (textEl.value = "");
      filesEl && (filesEl.value = "");
    }
  }

  // ---- Render one message ----
  async function renderOneMessage(m, author) {
    const wrap = document.createElement("div");
    wrap.className = "msg";
    const mine = (getMsgAuthorId(m) === me?.id);
    if (mine) wrap.classList.add("mine");
    const pic = avatarFromAny(author);
    wrap.innerHTML = `
      <img class="avatar" src="${pic}" width="36" height="36" alt="">
      <div class="bubble">
        <div class="meta">
          <span class="name">${mine ? "You" : (labelFromProfile(author) || "User")}</span>
          <span class="time">${new Date(m.created_at || Date.now()).toLocaleString()}</span>
        </div>
        ${m.body ? `<div class="body"></div>` : ""}
        ${m.media_path ? `<div class="media"><a href="${m.media_path}" target="_blank" rel="nofollow noopener">Attachment</a></div>` : ""}
      </div>
    `;
    if (m.body) wrap.querySelector(".body").textContent = m.body;
    return wrap;
  }

  // ---- Groups ----
  function openGroupModal(existingConversationId = null) {
    if (!modal) return;
    modal.dataset.mode = existingConversationId ? "add" : "create";
    modal.dataset.conversationId = existingConversationId || "";
    if (modalFriends) {
      modalFriends.innerHTML = "";
      allFriends.forEach(f => {
        const id = `friend-${f.id}`;
        const li = document.createElement("label");
        li.className = "friend-check";
        li.htmlFor = id;
        li.innerHTML = `
          <input type="checkbox" id="${id}" value="${f.id}">
          <img src="${f.avatar || 'assets/avatar-default.png'}" width="24" height="24" style="border-radius:50%">
          <span>${f.display_name || (f.username ? '@'+f.username : 'Friend')}</span>
        `;
        modalFriends.appendChild(li);
      });
    }
    modal.hidden = false;
  }

  function closeGroupModal() {
    if (modal) modal.hidden = true;
  }

  async function createGroupFromModal() {
    if (!modal || !modalFriends) return;
    const mode = modal.dataset.mode || "create";
    const selected = Array.from(modalFriends.querySelectorAll("input[type=checkbox]:checked")).map(i => i.value).filter(Boolean);
    if (!selected.length) return closeGroupModal();

    if (mode === "create") {
      // Create new conversation row (group)
      const { data: conv, error: e1 } = await sb.from(T.CONVERSATIONS).insert({ kind: "group", is_group: true, created_by: me.id }).select().single();
      if (e1) { console.error("[chat] create group failed", e1); return; }

      const rows = [me.id, ...selected].map(uid => ({ conversation_id: conv.id, user_id: uid, role: "member" }));
      const { error: e2 } = await sb.from(T.PARTICIPANTS).insert(rows);
      if (e2) { console.error("[chat] add members failed", e2); return; }

      closeGroupModal();
      await enterConversation(conv.id);
    } else {
      // Add to existing
      const convId = modal.dataset.conversationId || null;
      if (!convId) return;
      const inserts = selected.map(uid => ({ conversation_id: convId, user_id: uid, role: "member" }));
      const { error: e3 } = await sb.from(T.PARTICIPANTS).insert(inserts);
      if (e3) { console.error("[chat] add members failed", e3); return; }
      closeGroupModal();
      await renderParticipants(convId);
    }
  }

  // expose for other scripts
  window.PINGED_CHAT = Object.assign(window.PINGED_CHAT || {}, { openDM });

  // ---- Friends sidebar ----
  async function loadFriends() {
    let rows = [];
    try {
      const { data } = await sb.rpc("list_friends");
      rows = (data || []).map(p => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name,
        avatar: p.profile_pic || p.avatar_url || null
      }));
    } catch {
      rows = [];
    }
    allFriends = rows || [];
    renderFriends(searchEl?.value || "");
  }

  function renderFriends(filterText = "") {
    const q = (filterText || "").trim().toLowerCase();
    const items = (allFriends || [])
      .filter(f => !q || (f.display_name || f.username || "").toLowerCase().includes(q))
      .sort((a, b) => (a.display_name || a.username || "")
        .localeCompare(b.display_name || b.username || ""));

    friendsEl.innerHTML = "";
    if (!items.length) {
      friendsEl.innerHTML = `<div class="muted" style="padding:10px">No friends matched.</div>`;
      return;
    }

    items.forEach(f => {
      const btn = document.createElement("button");
      btn.className = "friend";
      btn.type = "button";
      btn.innerHTML = `
        <img src="${f.avatar || 'assets/avatar-default.png'}" width="28" height="28" style="border-radius:50%">
        <span>${f.display_name || (f.username ? '@'+f.username : 'Friend')}</span>
      `;
      btn.addEventListener("click", () => openDM(f.id));
      friendsEl.appendChild(btn);
    });
  }

  // ---- Boot ----
  async function init() {
    try { assertSB(); } catch (e) { console.error(e.message); return; }

    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) {
      me = null;
      if (logEl) logEl.innerHTML = `<div class="muted" style="padding:10px">Please sign in.</div>`;
      return;
    }
    me = user;

    await ensureRealtimeAuth();

    // UI events
    formEl?.addEventListener("submit", onSend);
    newGroupBtn?.addEventListener("click", openGroupModal);
    addPeopleBtn?.addEventListener("click", () => openGroupModal(activeConv));
    modalClose?.addEventListener("click", closeGroupModal);
    modalCancel?.addEventListener("click", closeGroupModal);
    modalCreate?.addEventListener("click", createGroupFromModal);
    searchEl?.addEventListener("input", () => renderFriends(searchEl.value));

    // Auto-open via ?friend=<uuid>
    const fid = new URL(location.href).searchParams.get("friend");
    if (fid) await openDM(fid);

    await loadFriends();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
