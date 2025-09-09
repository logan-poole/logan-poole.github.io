/* FILE: scripts/chat.js  (schema-agnostic + realtime)
   - No hard-coded avatar col; picks from common keys
   - start_dm via JSONB (and fallbacks)
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
  const friendsEl = $("#friends-list");
  const searchEl = $("#friend-search");
  const newGroupBtn = $("#new-group-btn");
  const addPeopleBtn = $("#add-people-btn");
  const participantsEl = $("#participants");
  const logEl = $("#chat-log");
  const formEl = $("#chat-form");
  const textEl = $("#chat-text");
  const filesEl = $("#chat-files");

  // Modal (create/add people)
  const modal = $("#group-modal");
  const modalClose = $("#group-close");
  const modalCancel = $("#group-cancel");
  const modalCreate = $("#group-create");
  const modalFriends = $("#group-friends");

  // State
  let sb = null, me = null;
  let activeConv = null;
  let channel = null;
  let allFriends = [];
  const seenMsgIds = new Set();

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

  // ---- Friends (via list_friends RPC if present) ----
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
    renderFriends();
  }

  function renderFriends(filterText = "") {
    if (!friendsEl) return;
    const q = (filterText || "").trim().toLowerCase();

    const items = (allFriends || [])
      .filter(f => {
        const hay = [f.username, f.display_name].filter(Boolean).join(" ").toLowerCase();
        return !q || hay.includes(q);
      })
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
        <img src="${f.avatar || 'assets/avatar-default.png'}" width="32" height="32" style="border-radius:50%" alt="">
        <div class="meta">
          <div class="name">${f.display_name || (f.username ? '@'+f.username : 'Friend')}</div>
          <div class="sub muted">${f.username ? '@'+f.username : ''}</div>
        </div>`;
      btn.addEventListener("click", () => openDM(f.id));
      friendsEl.appendChild(btn);
    });
  }

  // ---- DM creation via JSONB RPC (with fallbacks) ----
  async function tryDMRPC(otherUserId) {
    const attempts = [
      ["start_dm", { params: { p_other: otherUserId } }],
      ["start_dm", { p_other: otherUserId }],
      ["start_dm", { p_other_user_id: otherUserId }],
      ["start_dm", { other_user_id: otherUserId }],
      ["start_dm", { other: otherUserId }],
      ["ensure_dm", { p_other: otherUserId }],
      ["create_or_get_dm", { p_other: otherUserId }],
    ];
    for (const [fn, args] of attempts) {
      try {
        const { data, error } = await sb.rpc(fn, args);
        if (!error && data) return typeof data === "string" ? data : data?.id || data;
      } catch {}
    }
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
    if (!participantsEl) return;

    const { data: parts, error } = await sb
      .from(T.PARTICIPANTS)
      .select("user_id")
      .eq("conversation_id", conversationId);
    if (error) { console.error("[chat] participants error", error); return; }

    const ids = (parts || []).map(r => r.user_id);
    if (!ids.length) { participantsEl.innerHTML = ""; return; }

    let profs = [];
    try { profs = await fetchProfilesByIds(ids); }
    catch (e2) { console.error("[chat] participant profiles error", e2); return; }

    participantsEl.innerHTML = "";
    (profs || []).forEach(p => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML =
        `<img src="${avatarFromAny(p)}" width="20" height="20" style="border-radius:50%;vertical-align:middle;margin-right:6px"> ${labelFromProfile(p)}`;
      participantsEl.appendChild(chip);
    });
  }

  // ---- Messages ----
  async function resolveMediaUrl(pathOrUrl) {
    if (!pathOrUrl) return null;
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    const bucket = (CFG.BUCKETS && CFG.BUCKETS.DM_MEDIA) || "dm-media";
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(pathOrUrl, 60 * 60);
    if (error) { console.warn("[chat] signed url error", error.message); return null; }
    return data?.signedUrl || null;
  }

  function messageBubbleSkeleton(msg, authorProfile) {
    const authorId = getMsgAuthorId(msg);
    const mine = authorId === me.id;

    const wrap = document.createElement("div");
    wrap.className = `msg ${mine ? "mine" : "theirs"}`;

    if (!mine) {
      const avatar = document.createElement("img");
      avatar.src = avatarFromAny(authorProfile);
      avatar.alt = "";
      avatar.width = 28; avatar.height = 28; avatar.style.borderRadius = "50%";
      wrap.appendChild(avatar);
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (msg.body || msg.content || msg.text) {
      const p = document.createElement("p");
      p.textContent = msg.body ?? msg.content ?? msg.text ?? "";
      bubble.appendChild(p);
    }

    const mediaBox = document.createElement("div");
    mediaBox.className = "media-box";
    bubble.appendChild(mediaBox);

    const ts = document.createElement("div");
    ts.className = "ts";
    ts.textContent = new Date(msg.created_at || msg.inserted_at || Date.now()).toLocaleString();
    bubble.appendChild(ts);

    wrap.appendChild(bubble);
    return { wrap, mediaBox };
  }

  async function renderOneMessage(m, authorProfile) {
    const { wrap, mediaBox } = messageBubbleSkeleton(m, authorProfile);
    if (m.media_url || m.attachment_url) {
      const url = await resolveMediaUrl(m.media_url || m.attachment_url);
      if (url) {
        if ((m.media_type || "").startsWith("video/")) {
          const v = document.createElement("video");
          v.src = url; v.controls = true; v.preload = "metadata";
          v.style.maxWidth = "100%"; v.style.borderRadius = "8px"; v.style.marginTop = "6px";
          mediaBox.appendChild(v);
        } else {
          const i = document.createElement("img");
          i.src = url; i.alt = ""; i.loading = "lazy";
          i.style.maxWidth = "100%"; i.style.borderRadius = "8px"; i.style.marginTop = "6px";
          mediaBox.appendChild(i);
        }
      }
    }
    return wrap;
  }

  async function loadMessages(conversationId) {
    if (!logEl) return;
    logEl.innerHTML = '<div class="muted" style="padding:10px">Loading…</div>';

    const { data: rows, error } = await sb
      .from(T.MESSAGES)
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) { console.error("[chat] load messages error", error); return; }

    const authorIds = [...new Set((rows || []).map(getMsgAuthorId).filter(Boolean))];
    const authorMap = {};
    if (authorIds.length) {
      try {
        const { data } = await sb.from(T.PROFILES).select("*").in("user_id", authorIds);
        (data || []).forEach(p => { authorMap[p.user_id] = p; });
      } catch {
        const { data } = await sb.from(T.PROFILES).select("*").in("id", authorIds);
        (data || []).forEach(p => { authorMap[p.id] = p; });
      }
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
      headers: { "content-type": data.contentType || file.type || "application/octet-stream" },
      body: file
    });
    if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
    return { path: data.path, type: file.type || null };
  }

  // ---- Send (with insert fallbacks for author column) ----
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

    // Optimistic
    if (logEl) {
      const optimistic = {
        id: "optimistic-" + Date.now(),
        conversation_id: activeConv,
        author_id: me.id, // for rendering; real row may use different col
        body: body || null,
        media_url: media_path,
        media_type: media_type,
        created_at: new Date().toISOString()
      };
      seenMsgIds.add(optimistic.id);
      renderOneMessage(optimistic, { username: "you", display_name: "You" })
        .then(node => { logEl.appendChild(node); logEl.scrollTop = logEl.scrollHeight; });
    }

    const base = {
      conversation_id: activeConv,
      body: body || null,
      media_url: media_path,
      media_type
    };

    // Try different author column names
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
        !(msg.includes("null value in column") || msg.includes("does not exist") || error.code === "23502" || error.code === "42703")
      ) break;
    }

    if (lastError) {
      console.error("[chat] send error", lastError);
      alert("Could not send message. Check RLS and column names (author/sender).");
    }

    textEl && (textEl.value = "");
    filesEl && (filesEl.value = "");
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
    modal.removeAttribute("hidden");
  }
  function closeGroupModal() { modal?.setAttribute("hidden", ""); }

  async function createGroupFromModal() {
    if (!modal) return;
    const mode = modal.dataset.mode || "create";
    const selected = Array.from(modalFriends.querySelectorAll("input[type=checkbox]:checked")).map(i => i.value);
    if (!selected.length) return alert("Select at least one friend.");

    if (mode === "create") {
      const { data: conv, error: e1 } = await sb
        .from(T.CONVERSATIONS)
        .insert({ kind: 'group', is_group: true })
        .select("id").single();
      if (e1) { console.error("[chat] create group failed", e1); return; }
      const convId = conv.id;
      const inserts = [{ conversation_id: convId, user_id: me.id, role: "admin" }]
        .concat(selected.map(uid => ({ conversation_id: convId, user_id: uid, role: "member" })));
      const { error: e2 } = await sb.from(T.PARTICIPANTS).insert(inserts);
      if (e2) { console.error("[chat] add members failed", e2); return; }
      closeGroupModal();
      await enterConversation(convId);
    } else {
      const convId = modal.dataset.conversationId;
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

  document.addEventListener("DOMContentLoaded", init);
})();
