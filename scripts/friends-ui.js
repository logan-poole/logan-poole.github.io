/* FILE: scripts/friends-ui.js
   Current Friends grid + friend action modal (Chat/Map/Settings) + Friend Settings form.
   - Tries RPC list_friends(); falls back to friendships + profiles.
   - Chat action: tries window.PINGED_CHAT.openDM(friendId); else navigates to chat.html?friend=<id>.
   - Settings save: tries to update friendships columns; else stores locally.
*/
(function() {
  const $  = (s, r=document)=>r.querySelector(s);

  const CFG = window.PINGED_CONFIG || window.PINGED || {};
  const T = Object.assign({ PROFILES:"profiles", FRIENDSHIPS:"friendships" }, CFG.TABLES || {});
  const AVATAR_COL = (CFG.PROFILE && CFG.PROFILE.AVATAR_COLUMN) || "profile_pic";

  // DOM
  const gridEl   = $("#current-friends");
  const filterEl = $("#friends-filter");

  const fsForm    = $("#friend-settings-form");
  const fsEmpty   = $("#friend-settings-empty");
  const fsAvatar  = $("#fs-avatar");
  const fsName    = $("#fs-name");
  const fsSub     = $("#fs-sub");
  const fsShare   = $("#fs-share-location");
  const fsBlocked = $("#fs-blocked");
  const fsIcon    = $("#fs-icon");
  const fsColour  = $("#fs-colour");
  const fsSave    = $("#fs-save");

  const modal     = $("#friend-action-modal");
  const fmAvatar  = $("#fm-avatar");
  const fmName    = $("#fm-name");
  const fmSub     = $("#fm-sub");
  const fmClose   = $("#fm-close");
  const fmChat    = $("#fm-chat");
  const fmMap     = $("#fm-map");
  const fmSettings= $("#fm-settings");

  let sb = null, me = null;
  let allFriends = [];
  let selectedFriend = null;

  function getSB() {
    if (typeof window.getSB === "function") return window.getSB();
    if (window.supabase) return window.supabase;
    throw new Error("Supabase client not found.");
  }

  async function requireAuthedUser() {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error) throw error;
    if (!user) throw new Error("Please sign in first.");
    return user;
  }

  function avatarFromProfile(p) {
    return (p && (p[AVATAR_COL] || p.avatar_url || p.profile_pic)) || "assets/icons/profile.png";
  }

  function friendPrefsKey(friendId) { return `pinged_friend_prefs_${me.id}_${friendId}`; }
  function saveLocalPrefs(friendId, prefs) { localStorage.setItem(friendPrefsKey(friendId), JSON.stringify(prefs)); }
  function loadLocalPrefs(friendId) { try { return JSON.parse(localStorage.getItem(friendPrefsKey(friendId)) || "{}"); } catch { return {}; } }

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    try { sb = getSB(); me = await requireAuthedUser(); }
    catch (e) { console.warn("[friends-ui] auth not ready:", e.message); return; }

    filterEl?.addEventListener("input", renderGrid);
    fsSave?.addEventListener("click", onSaveSettings);
    fmClose?.addEventListener("click", closeModal);
    modal?.addEventListener("close", closeModal);

    await loadFriends();
    renderGrid();
  }

  async function loadFriends() {
    let rows = [];
    try {
      const { data, error } = await sb.rpc("list_friends");
      if (!error && Array.isArray(data)) {
        rows = data.map(x => ({
          id: x.id || x.user_id || x.friend_id,
          username: x.username ?? null,
          display_name: x.display_name ?? null,
          email: x.email ?? null,
          avatar_url: x[AVATAR_COL] || x.avatar_url || x.profile_pic || null
        })).filter(f => !!f.id);
      }
    } catch {}

    if (!rows.length) {
      const { data: fs, error: e1 } = await sb
        .from(T.FRIENDSHIPS).select("*")
        .or(`user_low.eq.${me.id},user_high.eq.${me.id}`)
        .eq("status", "accepted").limit(500);
      if (e1) { console.error("[friends-ui] friendships load error", e1); return; }

      const friendIds = [...new Set((fs || []).map(r => r.user_low === me.id ? r.user_high : r.user_low))];
      if (friendIds.length) {
        const cols = [`user_id`, `username`, `display_name`, `${AVATAR_COL}`, `email`].join(", ");
        const { data: profs, error: e2 } = await sb.from(T.PROFILES).select(cols).in("user_id", friendIds);
        if (e2) { console.error("[friends-ui] profiles load error", e2); return; }
        rows = (profs || []).map(p => ({
          id: p.user_id,
          username: p.username,
          display_name: p.display_name,
          email: p.email || null,
          avatar_url: p[AVATAR_COL] || null
        }));
      }
    }
    allFriends = rows;
  }

  function renderGrid() {
    if (!gridEl) return;
    const q = (filterEl?.value || "").trim().toLowerCase();
    const items = (allFriends || []).filter(f => {
      const hay = [f.display_name, f.username, f.email].filter(Boolean).join(" ").toLowerCase();
      return !q || hay.includes(q);
    }).sort((a, b) => (a.display_name || a.username || "").localeCompare(b.display_name || b.username || ""));

    gridEl.innerHTML = "";
    if (!items.length) {
      gridEl.innerHTML = `<div class="muted" style="padding:8px">No friends matched.</div>`;
      return;
    }

    for (const f of items) {
      const card = document.createElement("button");
      card.className = "friend-card";
      card.type = "button";
      card.setAttribute("role","listitem");
      card.innerHTML = `
        <img src="${f.avatar_url || 'assets/icons/profile.png'}" alt="">
        <div class="fc-meta">
          <div class="fc-name">${f.display_name || (f.username ? '@'+f.username : 'Friend')}</div>
          <div class="fc-sub">${f.email || (f.username ? '@'+f.username : '')}</div>
        </div>
      `;
      card.addEventListener("click", () => openModalForFriend(f));
      gridEl.appendChild(card);
    }
  }

  function openModalForFriend(friend) {
    selectedFriend = friend;
    if (!modal) return;

    $("#fm-avatar").src = friend.avatar_url || "assets/icons/profile.png";
    $("#fm-name").textContent = friend.display_name || (friend.username ? '@'+friend.username : 'Friend');
    $("#fm-sub").textContent = friend.email || (friend.username ? '@'+friend.username : '');

    $("#fm-chat").addEventListener("click", onChatClick, { once: true });
    $("#fm-map").addEventListener("click", onMapClick, { once: true });
    $("#fm-settings").addEventListener("click", onSettingsClick, { once: true });

    if (typeof modal.showModal === "function") modal.showModal();
    else modal.removeAttribute("hidden");
  }

  function closeModal() {
    if (!modal) return;
    if (typeof modal.close === "function") try { modal.close(); } catch {}
    modal.setAttribute("hidden","");
  }

  async function onChatClick() {
    closeModal();
    const id = selectedFriend?.id;
    if (!id) return alert("Missing friend id");

    // Prefer inline chat if available on this page
    const CHAT = window.PINGED_CHAT || window;
    if (typeof CHAT.openDM === "function") {
      try { await CHAT.openDM(id); return; } catch (e) { console.warn("[friends-ui] openDM failed, falling back", e); }
    }
    // Fallback: navigate to chat.html and let it auto-open via query param
    const sep = "chat.html".includes("?") ? "&" : "?";
    location.href = `chat.html${sep}friend=${encodeURIComponent(id)}`;
  }

  function onMapClick() {
    closeModal();
    const id = selectedFriend?.id;
    if (!id) return alert("Missing friend id");
    const ev = new CustomEvent("pinged:open-map", { detail: { friendId: id } });
    window.dispatchEvent(ev);
    setTimeout(() => {
      if (!ev.defaultPrevented) {
        const url = (window.PINGED_MAP && window.PINGED_MAP.url) || "map.html";
        const sep = url.includes("?") ? "&" : "?";
        location.href = `${url}${sep}friend=${encodeURIComponent(id)}`;
      }
    }, 0);
  }

  async function onSettingsClick() {
    closeModal();
    await openFriendSettings(selectedFriend);
  }

  async function openFriendSettings(friend) {
    if (!fsForm) return;
    fsAvatar.src = friend.avatar_url || "assets/icons/profile.png";
    fsName.textContent = friend.display_name || (friend.username ? '@'+friend.username : 'Friend');
    fsSub.textContent  = friend.email || (friend.username ? '@'+friend.username : '');

    const prefs = await loadPrefs(friend.id);
    fsShare.checked   = !!prefs.share_location;
    fsBlocked.checked = !!prefs.blocked;
    fsIcon.value      = prefs.icon || "";
    fsColour.value    = prefs.color || prefs.colour || "#00bfa6";

    fsForm.hidden = false;
    fsEmpty.hidden = true;
    document.getElementById("friends-management")?.scrollIntoView({ behavior: "smooth" });
    fsSave.dataset.friendId = friend.id;
  }

  async function loadPrefs(friendId) {
    try {
      const [low, high] = [me.id, friendId].sort();
      const { data, error } = await sb
        .from(T.FRIENDSHIPS)
        .select("share_location, blocked, icon, color, colour, settings")
        .eq("user_low", low).eq("user_high", high).limit(1).maybeSingle();
      if (error) throw error;
      const row = data || {};
      let settings = {};
      try { settings = (row.settings && typeof row.settings === "object") ? row.settings : JSON.parse(row.settings || "{}"); }
      catch {}
      const merged = Object.assign({}, settings, {
        share_location: row.share_location,
        blocked: row.blocked,
        icon: row.icon,
        color: row.color || row.colour
      });
      if (Object.values(merged).every(v => typeof v === "undefined")) return loadLocalPrefs(friendId);
      return merged;
    } catch {
      return loadLocalPrefs(friendId);
    }
  }

  async function onSaveSettings() {
    const friendId = fsSave?.dataset.friendId;
    if (!friendId) return;
    const changes = {
      share_location: !!fsShare.checked,
      blocked: !!fsBlocked.checked,
      icon: fsIcon.value || null,
      color: fsColour.value || null
    };
    const [low, high] = [me.id, friendId].sort();
    try {
      const { error } = await sb.from(T.FRIENDSHIPS).update(changes).eq("user_low", low).eq("user_high", high);
      if (error) throw error;
      toast("Settings saved.");
    } catch {
      saveLocalPrefs(friendId, changes);
      toast("Settings saved (local only). Add columns to friendships to persist.");
    }
  }

  function toast(msg) {
    try { new Notification("Pinged", { body: msg }); }
    catch {
      const el = document.createElement("div");
      el.textContent = msg;
      Object.assign(el.style, { position:"fixed", right:"12px", bottom:"12px", background:"#222", color:"#fff",
        padding:"10px 12px", borderRadius:"10px", zIndex:99999, fontSize:"13px" });
      document.body.appendChild(el); setTimeout(()=>el.remove(), 2000);
    }
  }
})();
