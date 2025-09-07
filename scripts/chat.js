/* FILE: scripts/chat.js  (COMPLETE, UPDATED)
   - DM + Groups + Messages with optional media
   - Uses Edge Function `chat-upload` for signed uploads
   - Stores Storage *path* in messages.media_url and resolves signed URL on display
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

  // Modal (create group)
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
  const AVATAR_COL = (CFG.PROFILE && CFG.PROFILE.AVATAR_COLUMN) || "profile_pic";
  const DM_BUCKET = (CFG.BUCKETS && CFG.BUCKETS.DM_MEDIA) || "dm-media";

  // Helpers
  const labelFromProfile = (p) =>
    p?.display_name || (p?.username ? `@${p.username}` : "User");
  const avatarFromProfile = (p) => (p && p[AVATAR_COL]) || "assets/icons/profile.png";

  function assertSB() {
    sb = (typeof window.getSB === "function" ? window.getSB() : window.__sb);
    if (!sb) throw new Error("[chat] Supabase not initialised");
  }

  async function init() {
    try { assertSB(); } catch (e) { console.error(e.message); return; }

    const { data } = await sb.auth.getUser();
    me = data?.user || null;
    if (!me) {
      if (logEl) logEl.innerHTML = `<div class="muted" style="padding:10px">Please sign in.</div>`;
      return;
    }

    // Wire UI
    formEl?.addEventListener("submit", onSend);
    filesEl?.addEventListener("change", () => {});
    newGroupBtn?.addEventListener("click", openGroupModal);
    addPeopleBtn?.addEventListener("click", () => openGroupModal(activeConv));
    modalClose?.addEventListener("click", closeGroupModal);
    modalCancel?.addEventListener("click", closeGroupModal);
    modalCreate?.addEventListener("click", createGroupFromModal);
    searchEl?.addEventListener("input", () => renderFriends(searchEl.value));

    await loadFriends();
  }

  // ---- Friends ----
  async function loadFriends() {
    let rows = [];
    try {
      // If you created RPC list_friends(), it will return enriched rows
      const { data, error } = await sb.rpc("list_friends");
      if (!error && data) {
        rows = data;
      } else {
        // fallback to friendships: accepted pairs (user_low,user_high)
        const { data: fs, error: e1 } = await sb
          .from(T.FRIENDSHIPS)
          .select("*")
          .or(`user_low.eq.${me.id},user_high.eq.${me.id}`)
          .eq("status", "accepted")
          .limit(200);
        if (e1) throw e1;

        const friendIds = [...new Set((fs || []).map(r => r.user_low === me.id ? r.user_high : r.user_low))];
        if (friendIds.length) {
          const { data: profs, error: e2 } = await sb
            .from(T.PROFILES)
            .select(`user_id, username, display_name, ${AVATAR_COL}`)
            .in("user_id", friendIds);
          if (e2) throw e2;
          rows = (profs || []).map(p => ({
            id: p.user_id,
            username: p.username,
            display_name: p.display_name,
            profile_pic: p[AVATAR_COL]
          }));
        }
      }
    } catch (err) {
      console.error("[chat] friends load error", err);
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
      .sort((a, b) => (a.display_name || a.username || "").localeCompare(b.display_name || b.username || ""));

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
        <img src="${f.profile_pic || 'assets/icons/profile.png'}" width="32" height="32" style="border-radius:50%" alt="">
        <div class="meta">
          <div class="name">${f.display_name || (f.username ? '@'+f.username : 'Friend')}</div>
          <div class="sub muted">${f.username ? '@'+f.username : ''}</div>
        </div>`;
      btn.addEventListener("click", () => openDM(f.id));
      friendsEl.appendChild(btn);
    });
  }

  // ---- Conversations ----
  async function openDM(otherUserId) {
    let convId = null;

    // Preferred: server RPC (ensures single DM per pair)
    try {
      const { data, error } = await sb.rpc("start_dm", { p_other: otherUserId });
      if (!error && data) convId = typeof data === "string" ? data : data?.id;
    } catch (_) { /* ignore -> fallback */ }

    // Fallback client-side creation if RPC not available
    if (!convId) {
      // Find my conversation ids
      const { data: mineParts } = await sb
        .from(T.PARTICIPANTS)
        .select("conversation_id")
        .eq("user_id", me.id)
        .limit(1000);
      const myConvIds = [...new Set((mineParts || []).map(r => r.conversation_id))];

      if (myConvIds.length) {
        const { data: cands } = await sb
          .from(T.CONVERSATIONS)
          .select("id,is_group")
          .eq("is_group", false)
          .in("id", myConvIds);

        for (const c of (cands || [])) {
          const { data: hasOther } = await sb
            .from(T.PARTICIPANTS)
            .select("user_id")
            .eq("conversation_id", c.id)
            .eq("user_id", otherUserId)
            .limit(1);
          if (hasOther && hasOther.length) { convId = c.id; break; }
        }
      }
      if (!convId) {
        const { data: conv, error: e1 } = await sb.from(T.CONVERSATIONS).insert({ is_group: false }).select("id").single();
        if (e1) { console.error("[chat] create DM conv failed", e1); return; }
        convId = conv.id;
        const { error: e2 } = await sb.from(T.PARTICIPANTS).insert([
          { conversation_id: convId, user_id: me.id, role: "member" },
          { conversation_id: convId, user_id: otherUserId, role: "member" }
        ]);
        if (e2) { console.error("[chat] add participants failed", e2); return; }
      }
    }

    await enterConversation(convId);
  }

  async function enterConversation(conversationId) {
    activeConv = conversationId;
    addPeopleBtn && (addPeopleBtn.disabled = false);
    await renderParticipants(conversationId);
    await loadMessages(conversationId);
    subscribeMessages(conversationId);
  }

  async function renderParticipants(conversationId) {
    if (!participantsEl) return;
    const { data: parts, error } = await sb
      .from(T.PARTICIPANTS)
      .select("user_id")
      .eq("conversation_id", conversationId);
    if (error) { console.error("[chat] participants error", error); return; }

    const ids = (parts || []).map(r => r.user_id);
    const { data: profs, error: e2 } = await sb
      .from(T.PROFILES)
      .select(`user_id, username, display_name, ${AVATAR_COL}`)
      .in("user_id", ids);
    if (e2) { console.error("[chat] participant profiles error", e2); return; }

    participantsEl.innerHTML = "";
    (profs || []).forEach(p => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `<img src="${avatarFromProfile(p)}" width="20" height="20" style="border-radius:50%;vertical-align:middle;margin-right:6px"> ${labelFromProfile(p)}`;
      participantsEl.appendChild(chip);
    });
  }

  // ---- Messages ----
  async function resolveMediaUrl(pathOrUrl) {
    if (!pathOrUrl) return null;
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl; // already a URL
    // treat as Storage path
    const { data, error } = await sb.storage.from(DM_BUCKET).createSignedUrl(pathOrUrl, 60 * 60);
    if (error) { console.warn("[chat] signed url error", error.message); return null; }
    return data?.signedUrl || null;
  }

  function messageBubbleSkeleton(msg, authorProfile) {
    const mine = msg.author_id === me.id;
    const wrap = document.createElement("div");
    wrap.className = `msg ${mine ? "mine" : "theirs"}`;

    if (!mine) {
      const avatar = document.createElement("img");
      avatar.src = avatarFromProfile(authorProfile);
      avatar.alt = "";
      avatar.width = 28; avatar.height = 28; avatar.style.borderRadius = "50%";
      wrap.appendChild(avatar);
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (msg.body) {
      const p = document.createElement("p");
      p.textContent = msg.body;
      bubble.appendChild(p);
    }

    // Media container (we’ll fill after resolving signed URL)
    const mediaBox = document.createElement("div");
    mediaBox.className = "media-box";
    bubble.appendChild(mediaBox);

    const ts = document.createElement("div");
    ts.className = "ts";
    ts.textContent = new Date(msg.created_at).toLocaleString();
    bubble.appendChild(ts);

    wrap.appendChild(bubble);
    return { wrap, mediaBox };
  }

  async function renderOneMessage(m, authorProfile) {
    const { wrap, mediaBox } = messageBubbleSkeleton(m, authorProfile);
    if (m.media_url) {
      const url = await resolveMediaUrl(m.media_url);
      if (url) {
        if ((m.media_type || "").startsWith("video/")) {
          const v = document.createElement("video");
          v.src = url; v.controls = true; v.preload = "metadata";
          v.style.maxWidth = "100%"; v.style.borderRadius = "8px"; v.style.marginTop = "6px";
          mediaBox.appendChild(v);
        } else {
          const i = document.createElement("img");
          i.src = url; i.alt = "";
          i.loading = "lazy";
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

    // Collect author ids → profiles
    const authorIds = [...new Set((rows || []).map(r => r.author_id).filter(Boolean))];
    const authorMap = {};
    if (authorIds.length) {
      const { data: profs } = await sb
        .from(T.PROFILES)
        .select(`user_id, username, display_name, ${AVATAR_COL}`)
        .in("user_id", authorIds);
      (profs || []).forEach(p => { authorMap[p.user_id] = p; });
    }

    logEl.innerHTML = "";
    for (const m of (rows || [])) {
      const node = await renderOneMessage(m, authorMap[m.author_id]);
      logEl.appendChild(node);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  function subscribeMessages(conversationId) {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel(`msgs-${conversationId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: T.MESSAGES,
        filter: `conversation_id=eq.${conversationId}`
      }, async (payload) => {
        const m = payload.new;
        if (!m || seenMsgIds.has(m.id)) return;
        seenMsgIds.add(m.id);
        // fetch author profile
        const { data: profs } = await sb
          .from(T.PROFILES)
          .select(`user_id, username, display_name, ${AVATAR_COL}`)
          .eq("user_id", m.author_id)
          .limit(1);
        const author = (profs && profs[0]) || null;
        const node = await renderOneMessage(m, author);
        logEl.appendChild(node);
        logEl.scrollTop = logEl.scrollHeight;
      })
      .subscribe();
  }

  // ---- Uploads via Edge Function ----
  async function uploadViaFunction(conversationId, file) {
    const data = await window.callSupabaseFn("chat-upload", {
      method: "GET",
      query: { convId: conversationId, contentType: file.type || "application/octet-stream" }
    });
    // PUT bytes to the signed URL (no auth header)
    const putRes = await fetch(data.uploadUrl, {
      method: "PUT",
      headers: { "content-type": data.contentType || file.type || "application/octet-stream" },
      body: file
    });
    if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
    // Return the storage path (we’ll sign for reading when displaying)
    return { path: data.path, type: file.type || null };
  }

  // ---- Send ----
  async function onSend(e) {
    e.preventDefault();
    if (!activeConv) return alert("Open a conversation first.");
    const body = (textEl?.value || "").trim();

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

    // Optimistic append
    if (logEl) {
      const optimistic = {
        id: "optimistic-" + Date.now(),
        conversation_id: activeConv,
        author_id: me.id,
        body: body || null,
        media_url: media_path,     // store path in media_url column
        media_type: media_type,
        created_at: new Date().toISOString()
      };
      seenMsgIds.add(optimistic.id);
      renderOneMessage(optimistic, { username: "you", display_name: "You", [AVATAR_COL]: null })
        .then(node => { logEl.appendChild(node); logEl.scrollTop = logEl.scrollHeight; });
    }

    const { error } = await sb.from(T.MESSAGES).insert({
      conversation_id: activeConv,
      author_id: me.id,
      body: body || null,
      media_url: media_path,   // path-only, signed at display time
      media_type
    });
    if (error) {
      console.error("[chat] send error", error);
      alert("Could not send message. Check RLS.");
    }

    textEl && (textEl.value = "");
    filesEl && (filesEl.value = "");
  }

  // ---- Groups ----
  function openGroupModal(existingConversationId = null) {
    if (!modal) return;
    modal.dataset.mode = existingConversationId ? "add" : "create";
    modal.dataset.conversationId = existingConversationId || "";
    // Render friend checkboxes
    if (modalFriends) {
      modalFriends.innerHTML = "";
      allFriends.forEach(f => {
        const id = `friend-${f.id}`;
        const li = document.createElement("label");
        li.className = "friend-check";
        li.htmlFor = id;
        li.innerHTML = `
          <input type="checkbox" id="${id}" value="${f.id}">
          <img src="${f.profile_pic || 'assets/icons/profile.png'}" width="24" height="24" style="border-radius:50%">
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
      const { data: conv, error: e1 } = await sb.from(T.CONVERSATIONS).insert({ is_group: true }).select("id").single();
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

  document.addEventListener("DOMContentLoaded", init);
})();
