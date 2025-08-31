/* =============================================================================
FILE: pinged/scripts/chat.js

READ ME FIRST — What’s new in this update
- Keeps your DM logic, RPC send, realtime + polling fallback, and username/email
  labels (no raw UUIDs).
- Fixes the confusing “Bucket not found” popups by distinguishing real missing
  buckets from Storage RLS denials (Supabase returns 404 for both).
- Adds precise upload diagnostics and a “probe” helper to test Storage from the
  browser.
- Still tries buckets in this order: window.PINGED_MEDIA_BUCKETS ?? ['dm-media','chat-media'].
- Still sends "" for p_content when sending file-only messages (NOT NULL safe).

Key additions
- showStorageError(err, ctx): clear, actionable messages for 401/403/404/etc.
- uploadChatFile(): instrumented; logs bucket/key/phase and hints.
- window.tryProbeUpload(): tiny end-to-end upload/download test for each bucket.

Labels (no UUIDs)
- Preferred order: display_name → @username → email → short id (8). “You” for me.

No server changes required for this client update.
============================================================================= */

(function () {
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

  /* === Storage buckets (can be overridden globally) ======================= */
  const CHAT_BUCKETS = (window.PINGED_MEDIA_BUCKETS && Array.isArray(window.PINGED_MEDIA_BUCKETS))
    ? window.PINGED_MEDIA_BUCKETS
    : ['dm-media','chat-media'];

  // DOM
  const friendsEl      = $("#friends-list");
  const searchEl       = $("#friend-search");
  const newGroupBtn    = $("#new-group-btn");
  const addPeopleBtn   = $("#add-people-btn");
  const participantsEl = $("#participants");

  const logEl   = $("#chat-log");
  const formEl  = $("#chat-form");
  const textEl  = $("#chat-text");
  const filesEl = $("#chat-files");

  // Modal
  const modal        = $("#group-modal");
  const modalClose   = $("#group-close");
  const modalCancel  = $("#group-cancel");
  const modalCreate  = $("#group-create");
  const modalFriends = $("#group-friends");

  // State
  let sb = null;
  let me = null;
  let activeConv = null;   // { id, is_direct, created_by }
  let channel = null;      // realtime channel
  let pollTimer = null;    // polling fallback
  let lastSeenAt = null;   // ISO string
  /** @type {{id: string, username?: string, display_name?: string, email?: string, avatar_url?: string}[]} */
  let allFriends = [];

  /* === Name cache ========================================================= */
  /** @type {Map<string, {id:string, username?:string, display_name?:string, email?:string, avatar_url?:string, label:string}>} */
  const nameCache = new Map();

  function labelFromProfile(p){
    return (p?.display_name?.trim())
        || (p?.username ? `@${p.username}` : "")
        || (p?.email || "")
        || (p?.id ? p.id.slice(0,8) : "User");
  }
  function cacheProfile(p){
    if (!p || !p.id) return;
    const existing = nameCache.get(p.id) || {};
    const merged = { ...existing, ...p };
    merged.label = labelFromProfile(merged);
    nameCache.set(p.id, merged);
  }
  function resolveNameSync(uid){
    if (uid === me) return "You";
    const rec = nameCache.get(uid);
    if (rec) return rec.label;
    return uid ? uid.slice(0,8) : "User";
  }
  async function ensureName(uid, onUpdate){
    if (!uid || uid === me || nameCache.has(uid)) return resolveNameSync(uid);
    // Try friends cache first
    const f = allFriends.find(x => x.id === uid);
    if (f){ cacheProfile({ id: uid, ...f }); onUpdate?.(resolveNameSync(uid)); return resolveNameSync(uid); }
    // Try profiles table (if present)
    try {
      const { data, error } = await sb.from("profiles")
        .select("id,username,display_name,email,avatar_url")
        .eq("id", uid).single();
      if (!error && data){ cacheProfile(data); onUpdate?.(resolveNameSync(uid)); }
    } catch(_e){}
    return resolveNameSync(uid);
  }

  // ========= E2EE STUBS =========
  async function encryptForConversation(_convId, plaintext){ return plaintext; }
  async function decryptForConversation(_convId, ciphertext){ return ciphertext; }

  // ========= AUTH + INIT =========
  async function requireAuth(){
    const r = await sb.auth.getSession();
    const user = r?.data?.session?.user;
    if (!user){
      location.replace("index.html?signin=1&next="+encodeURIComponent(location.pathname));
      throw new Error("Not signed in");
    }
    me = user.id;
    cacheProfile({ id: me, display_name: "You" });
  }

  // ========= FRIENDS =========
  async function loadFriends(){
    // Rich list with profiles if available
    const r1 = await sb.rpc("friends_with_profiles");
    if (!r1.error && Array.isArray(r1.data)) {
      allFriends = r1.data.map(row => ({
        id: row.user_id,
        username: row.username || null,
        display_name: row.display_name || null,
        email: row.email || null,
        avatar_url: row.avatar_url || null
      }));
      allFriends.forEach(cacheProfile);   // seed name cache
      renderFriends();
      return;
    }
    // Fallback to ids only
    const r2 = await sb.rpc("list_friends");
    if (!r2.error && Array.isArray(r2.data)) {
      allFriends = r2.data.map(row => ({ id: row.friend_id }));
      allFriends.forEach(cacheProfile);
      renderFriends();
      return;
    }
    friendsEl && (friendsEl.innerHTML = "<div class='muted' style='padding:10px'>No friends yet.</div>");
  }

  function avatarLetterFromLabel(label){
    const t = (label || "").replace(/^@/, "").trim();
    return t ? t[0].toUpperCase() : "U";
  }
  function friendDisplayName(f){ return labelFromProfile({ id: f.id, ...f }); }
  function friendSubline(f){
    if (f?.username) return `@${f.username}`;
    if (f?.email) return f.email;
    return ""; // never show UUIDs in the subline
  }

  function friendRow(u){
    const el = document.createElement("div");
    el.className = "friend";
    el.dataset.uid = u.id;

    const av = document.createElement("div");
    av.className = "avatar";
    const label = friendDisplayName(u);
    if (u.avatar_url) {
      const img = document.createElement("img");
      img.src = u.avatar_url; img.alt = label;
      img.style.width="100%"; img.style.height="100%"; img.style.borderRadius="50%";
      av.appendChild(img);
    } else {
      av.textContent = avatarLetterFromLabel(label);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.className = "name"; name.textContent = label;
    const sub  = document.createElement("div");
    sub.className = "sub"; sub.textContent = friendSubline(u);
    meta.append(name, sub);

    el.append(av, meta);
    el.addEventListener("click", () => openDirectWith(u.id));
    return el;
  }

  function renderFriends(){
    if (!friendsEl) return;
    const q = (searchEl?.value || "").toLowerCase();
    friendsEl.innerHTML = "";
    allFriends
      .filter(f => {
        const label = friendDisplayName(f).toLowerCase();
        const sub   = friendSubline(f).toLowerCase();
        return label.includes(q) || sub.includes(q);
      })
      .forEach(f => friendsEl.appendChild(friendRow(f)));
    if (!friendsEl.childElementCount){
      friendsEl.innerHTML = "<div class='muted' style='padding:10px'>No friends found.</div>";
    }
  }

  // ========= CONVERSATIONS =========
  async function openDirectWith(otherUserId){
    clearActive();
    const { data: convId, error } = await sb.rpc("create_or_get_dm", { p_other_user_id: otherUserId });
    if (error){ alert(error.details || error.message); return; }

    const meta = await sb.from("conversations")
                         .select("id,is_direct,created_at")
                         .eq("id", convId).single();

    activeConv = meta.data || { id: convId, is_direct: true, created_by: me };
    highlightFriend(otherUserId);

    // make sure both names end up cached
    cacheProfile({ id: otherUserId, ...allFriends.find(f=>f.id===otherUserId) });

    await paintParticipants();
    await loadMessages();
    subscribeRealtime();
    enableComposer(true);
  }

  // (Group helpers left for future use)
  async function openGroupWith(members){
    clearActive();
    const { data, error } = await sb.rpc("create_group_conversation", { participants: members });
    if (error){ alert(error.details || error.message); return; }
    const meta = await sb.from("conversations").select("id,is_direct,created_by").eq("id", data).single();
    activeConv = meta.data || { id: data, is_direct: false, created_by: me };
    highlightFriend(null);
    await paintParticipants();
    await loadMessages();
    subscribeRealtime();
    enableComposer(true);
  }

  async function addPeopleToActive(members){
    if (!activeConv) return;
    const { error } = await sb.rpc("add_participants", { p_conversation_id: activeConv.id, new_user_ids: members });
    if (error){ alert(error.details || error.message); return; }
    members.forEach(id => cacheProfile({ id })); // prime cache
    await paintParticipants();
  }

  function highlightFriend(uid){
    $$(".friend").forEach(n => n.classList.toggle("active", n.dataset.uid === uid));
  }

  function clearActive(){
    enableComposer(false);
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    logEl && (logEl.innerHTML = "");
    participantsEl && (participantsEl.innerHTML = "");
    activeConv = null;
    lastSeenAt = null;
  }

  async function paintParticipants(){
    if (!activeConv || !participantsEl) return;
    const { data, error } = await sb
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", activeConv.id);
    if (error) { console.error("[chat] participants error", error); return; }
    participantsEl.innerHTML = "";
    (data||[]).forEach(row => {
      cacheProfile({ id: row.user_id, ...allFriends.find(f=>f.id===row.user_id) });
      const label = resolveNameSync(row.user_id);
      const p = document.createElement("span");
      p.className = "participant";
      const chip = document.createElement("span"); chip.className="chip"; chip.textContent = avatarLetterFromLabel(label);
      const txt  = document.createElement("span"); txt.textContent = label;
      p.append(chip, txt);
      participantsEl.appendChild(p);
      // Try to improve label asynchronously if unknown
      ensureName(row.user_id, (newLabel)=>{ txt.textContent = newLabel; chip.textContent = avatarLetterFromLabel(newLabel); });
    });
    addPeopleBtn && (addPeopleBtn.disabled = !!activeConv?.is_direct);
  }

  // ========= MESSAGES =========
  async function loadMessages(){
    if (!activeConv || !logEl) return;

    try {
      let { data, error } = await sb
        .from("messages_ui")
        .select("*")
        .eq("conversation_id", activeConv.id)
        .order("created_at", { ascending: true })
        .limit(500);

      if (error){
        ({ data, error } = await sb
          .from("messages")
          .select("*")
          .eq("conversation_id", activeConv.id)
          .order("created_at", { ascending: true })
          .limit(500));
        if (error){ throw error; }
        data = (data||[]).map(m => ({
          ...m,
          content: m.content ?? m.body ?? null,
          sender_id: m.sender_id
        }));
      }

      logEl.innerHTML = "";
      for (const m of (data||[])) appendMessage(m);
      if (data?.length) lastSeenAt = data[data.length-1].created_at;
      scrollToBottom();
    } catch (err) {
      console.error("[chat] load error", err);
      alert("Could not load messages: " + (err.details || err.message || JSON.stringify(err)));
    }
  }

  function appendMessage(m){
    const sender = m.sender_id ?? "unknown";
    const mine = sender === me;

    const wrap = document.createElement("div");
    wrap.className = "msg" + (mine ? " mine" : "");

    const who = document.createElement("strong");
    const initialLabel = resolveNameSync(sender);
    who.textContent = mine ? "You" : initialLabel;
    wrap.appendChild(who);

    // Try to upgrade the label asynchronously if it was a fallback
    if (!mine) ensureName(sender, (newLabel)=>{ who.textContent = newLabel; });

    const contentText = m.content ?? m.body ?? "";
    if (contentText) {
      const div = document.createElement("span");
      decryptForConversation(activeConv.id, contentText).then(txt => { div.innerText = " — " + txt; });
      wrap.appendChild(div);
    }

    if (m.media_url){
      const box = document.createElement("div"); box.className="media";
      const t = (m.media_type||"").toLowerCase();
      if (t.includes("video")){
        const v=document.createElement("video"); v.controls=true; v.src=m.media_url; box.appendChild(v);
      } else if (t.includes("audio") || t.includes("voice")){
        const a=document.createElement("audio"); a.controls=true; a.src=m.media_url; box.appendChild(a);
      } else {
        const i=document.createElement("img"); i.src=m.media_url; box.appendChild(i);
      }
      wrap.appendChild(box);
    }

    const time = document.createElement("div"); time.className="muted"; time.textContent = new Date(m.created_at).toLocaleString();
    wrap.appendChild(time);

    logEl.appendChild(wrap);
  }

  function subscribeRealtime(){
    if (channel) sb.removeChannel(channel);
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (!activeConv) return;

    channel = sb.channel("conv:"+activeConv.id)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "messages",
        filter: `conversation_id=eq.${activeConv.id}`
      }, (payload) => {
        const m = payload.new;
        appendMessage({ ...m, content: m.content ?? m.body ?? null });
        lastSeenAt = m.created_at;
        scrollToBottom();
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" && !pollTimer) {
          pollTimer = setInterval(async () => {
            if (!activeConv) return;
            const { data, error } = await sb
              .from("messages")
              .select("*")
              .eq("conversation_id", activeConv.id)
              .gt("created_at", lastSeenAt || "1970-01-01")
              .order("created_at", { ascending: true })
              .limit(50);
            if (error) { console.error("[chat] poll error", error); return; }
            if (data && data.length){
              data.forEach(m => appendMessage({ ...m, content: m.content ?? m.body ?? null }));
              lastSeenAt = data[data.length-1].created_at;
              scrollToBottom();
            }
          }, 5000);
        }
      });
  }

  function enableComposer(enabled){
    formEl?.querySelector("button[type=submit]")?.toggleAttribute("disabled", !enabled);
    textEl?.toggleAttribute("disabled", !enabled);
    filesEl?.toggleAttribute("disabled", !enabled);
  }

  /* ========= Storage diagnostics & upload ================================= */

  function showStorageError(err, ctx = {}) {
    const code = err?.statusCode ?? err?.status ?? null;
    const msg = err?.message || String(err);

    console.error('[storage]', ctx.phase || 'op', 'bucket:', ctx.bucket, 'key:', ctx.key, '→', code, msg, err);

    let hint = '';
    if (code === 401 || code === 403) {
      hint =
        'Access denied. Check Storage RLS: are you a member of this conversation AND does the key start with conv-<uuid>/?';
    } else if (code === 404) {
      hint =
        'Not found (or blocked by RLS). Buckets exist, so this is usually policy denial.\n' +
        '• Ensure object key format: conv-<conversation_uuid>/filename\n' +
        '• Ensure your user is in public.conversation_members for that conversation\n' +
        '• Ensure Storage policies use the same regex + bucket check';
    } else if (/already exists/i.test(msg)) {
      hint = 'Object already exists. Use a new random filename or { upsert: true }.';
    } else if (/bucket/i.test(msg)) {
      hint = 'Bucket error. Verify id EXACTLY "dm-media" or "chat-media" in THIS project.';
    } else {
      hint = 'Unexpected error. See console for details.';
    }

    if (!showStorageError._debounce) {
      alert(`Send failed: ${msg}\n\nHint: ${hint}`);
      showStorageError._debounce = setTimeout(() => (showStorageError._debounce = null), 250);
    }
  }

  // Try configured buckets; return a signed URL on success
  async function uploadChatFile(){
    const f = filesEl?.files?.[0];
    if (!f) return { url: null, type: null };
    if (!activeConv?.id) throw new Error('No active conversation.');

    const key = `conv-${activeConv.id}/${crypto.randomUUID()}-${f.name}`;
    const candidateBuckets = CHAT_BUCKETS;

    for (const bucket of candidateBuckets){
      const up = await sb.storage.from(bucket).upload(key, f, { upsert:false, cacheControl:"3600" });
      if (!up.error) {
        const signed = await sb.storage.from(bucket).createSignedUrl(key, 60*60*24*7);
        if (signed.error) {
          showStorageError(signed.error, { bucket, key, phase: 'createSignedUrl' });
          throw signed.error;
        }
        const type = guessTypeFromName(f.name) || f.type || "application/octet-stream";
        return { url: signed.data.signedUrl, type };
      }
      // Explain why upload failed on this bucket
      showStorageError(up.error, { bucket, key, phase: 'upload' });
    }

    throw new Error('Upload failed on all buckets. See console for detailed diagnostics.');
  }

  function guessTypeFromName(name){
    if (/\.(mp4|webm|ogg)$/i.test(name)) return "video/mp4";
    if (/\.(mp3|m4a|wav|ogg)$/i.test(name)) return "audio/mpeg";
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return "image/png";
    return "";
  }

  // Optional: quick probe you can run from DevTools AFTER opening a DM
  window.tryProbeUpload = async () => {
    try {
      if (!activeConv?.id) return console.warn('Open a DM first so activeConv is set.');
      const text = `pinged probe ${new Date().toISOString()}`;
      const file = new File([text], 'probe.txt', { type: 'text/plain' });
      const key = `conv-${activeConv.id}/probe-${crypto.randomUUID()}.txt`;

      for (const bucket of CHAT_BUCKETS) {
        const up = await sb.storage.from(bucket).upload(key, file);
        if (up.error) {
          showStorageError(up.error, { bucket, key, phase: 'probe-upload' });
        } else {
          console.log('[probe] uploaded to', bucket, key);
          const dl = await sb.storage.from(bucket).download(key);
          if (dl.error) showStorageError(dl.error, { bucket, key, phase: 'probe-download' });
          else console.log('[probe] downloaded OK from', bucket);
        }
      }
    } catch (e) {
      console.error('tryProbeUpload failed', e);
    }
  };

  // ========= SEND ===========================================================
  async function sendViaRpc(payload){
    const { data, error } = await sb.rpc("send_message", {
      p_conversation_id: payload.conversation_id,
      p_content:         payload.body ?? payload.content ?? "",
      p_media_type:      payload.media_type ?? null,
      p_media_url:       payload.media_url ?? null
    });
    if (error) throw error;
    console.log("[chat] sent message id:", String(data)); // bigint or uuid -> safe log
  }

  async function onSend(e){
    e.preventDefault();
    if (!activeConv) return;

    const raw = (textEl?.value || "").trim();
    const msgText = raw ? await encryptForConversation(activeConv.id, raw) : null;
    const hasText = !!msgText;
    const hasFile = (filesEl?.files?.length || 0) > 0;
    if (!hasText && !hasFile) return;

    const contentToSend = hasText ? msgText : "";  // satisfy NOT NULL schemas

    const btn = formEl?.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    if (textEl) textEl.disabled = true;

    try {
      let media_url = null, media_type = null;
      if (hasFile) {
        const uploaded = await uploadChatFile();
        media_url = uploaded.url;
        media_type = uploaded.type;
      }
      const payload = {
        conversation_id: activeConv.id,
        body: contentToSend,
        media_url,
        media_type
      };

      await sendViaRpc(payload);

      // Optimistic append (Realtime will also deliver the row)
      appendMessage({
        conversation_id: activeConv.id,
        sender_id: me,
        body: contentToSend,
        media_url,
        media_type,
        created_at: new Date().toISOString()
      });

      if (textEl) textEl.value = "";
      if (filesEl) filesEl.value = "";
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      console.error("[send failed]", err);
      alert("Send failed: " + (err.details || err.message || JSON.stringify(err)));
    } finally {
      if (btn) btn.disabled = false;
      if (textEl) { textEl.disabled = false; textEl.focus(); }
    }
  }

  // ========= MODAL (Group) =========
  function openGroupModal(){
    renderModalFriends();
    if (modal) modal.hidden = false;
  }
  function closeGroupModal(){ if (modal) modal.hidden = true; }

  function renderModalFriends(){
    if (!modalFriends) return;
    modalFriends.innerHTML = "";
    allFriends.forEach(f => {
      const row = document.createElement("label");
      row.className = "row";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = f.id;
      const span = document.createElement("span");
      span.textContent = `${friendDisplayName(f)}${friendSubline(f) ? " ("+friendSubline(f)+")" : ""}`;
      row.append(cb, span);
      modalFriends.appendChild(row);
    });
  }

  function selectedModalFriends(){
    return $$("input[type=checkbox]", modalFriends).filter(cb => cb.checked).map(cb => cb.value);
  }

  async function onCreateGroup(){
    const members = selectedModalFriends();
    if (members.length === 0){ alert("Pick at least one friend."); return; }
    await openGroupWith(members);
    closeGroupModal();
  }

  async function onAddPeople(){
    openGroupModal();
    modalCreate.onclick = async () => {
      const members = selectedModalFriends();
      if (members.length === 0){ closeGroupModal(); return; }
      await addPeopleToActive(members);
      closeGroupModal();
    };
  }

  // ========= UTIL =========
  function scrollToBottom(){ if (logEl) logEl.scrollTop = (logEl.scrollHeight||0)+999; }

  // ========= BOOT =========
  document.addEventListener("DOMContentLoaded", async () => {
    sb = (typeof window.getSB === "function" ? window.getSB() : null);
    if (!sb){ alert("Supabase not initialized."); return; }

    await requireAuth();
    await loadFriends();

    searchEl && searchEl.addEventListener("input", renderFriends);
    newGroupBtn && newGroupBtn.addEventListener("click", openGroupModal);
    addPeopleBtn && addPeopleBtn.addEventListener("click", onAddPeople);
    formEl && formEl.addEventListener("submit", onSend);

    modalClose && modalClose.addEventListener("click", closeGroupModal);
    modalCancel && modalCancel.addEventListener("click", closeGroupModal);
    modalCreate && modalCreate.addEventListener("click", onCreateGroup);
    modal && modal.addEventListener("click", (e)=>{ if(e.target===modal) closeGroupModal(); });
  });
})();
