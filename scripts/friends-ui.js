/* Author: Logan Poole — 30083609
   FILE: /scripts/friends-ui.js
   Purpose: Friends as avatar cards + rich modal with scoped accent colour and
            mutual-friends count. Profiles SELECT is schema-safe with fallbacks. */

(function () {
  'use strict';

  const $ = (sel, r=document) => r.querySelector(sel);

  // Containers
  const acceptedEl = $('#friends-accepted') || $('#friends-list') || $('#friends') || null;
  const incomingEl = $('#friends-incoming') || null;
  const outgoingEl = $('#friends-outgoing') || null;
  const filterEl   = $('#friends-filter') || null;
  const addForm    = $('#friend-add-form') || null;
  const addInput   = $('#friend-username') || null;
  const emptyEl    = $('#friends-empty') || null;
  const errEl      = $('#friends-error') || null;

  // Modal nodes
  const modal   = $('#friendModal');
  const mBody   = modal?.querySelector('.friend-modal-body') || null;
  const mClose  = $('#friendClose');
  const mAvatar = $('#friendAvatar');
  const mName   = $('#friendName');
  const mUser   = $('#friendUser');
  const mRole   = $('#friendRole');
  const mFields = $('#friendFields');
  const msgBtn  = $('#msgBtn');
  const locBtn  = $('#locateBtn');
  const unBtn   = $('#unfriendBtn');

  // Config
  const CFG = window.PINGED_CONFIG || {};
  const T   = Object.assign({ PROFILES:'profiles', FRIENDSHIPS:'friendships' }, (CFG.TABLES||{}));
  const NAME_KEYS  = (CFG.PROFILE && CFG.PROFILE.DISPLAY_NAME_KEYS) || ['display_name','username'];
  const AVATAR_COL = (CFG.PROFILE && CFG.PROFILE.AVATAR_COLUMN)      || 'avatar_url';

  // Local cache for my accepted friends (for quick mutuals)
  let myAcceptedIds = new Set();

  const labelOf = (p = {}) => {
    for (const k of NAME_KEYS) if (p && p[k]) return String(p[k]);
    return p.username || p.display_name || p.email || p.id || 'User';
  };
  const avatarOf = (p = {}) => p[AVATAR_COL] || p.avatar_url || 'assets/avatar.png';
  const otherOf  = (row, uid) => (row.user_low === uid ? row.user_high : row.user_low);
  const canonical = (a,b) => (a < b ? {low:a, high:b} : {low:b, high:a});

  function showError(msg) { if (errEl) { errEl.textContent = msg || ''; errEl.hidden = !msg; } }

  // --- scoped accent helpers ---
  const hexToRGBA = (hex, a=0.22) => {
    const h = hex?.toString().trim();
    if (!h || !/^#?[0-9a-f]{3,8}$/i.test(h)) return null;
    let r,g,b;
    const s = h[0]==='#' ? h.slice(1) : h;
    if (s.length===3) { r=parseInt(s[0]+s[0],16); g=parseInt(s[1]+s[1],16); b=parseInt(s[2]+s[2],16); }
    else { r=parseInt(s.slice(0,2),16); g=parseInt(s.slice(2,4),16); b=parseInt(s.slice(4,6),16); }
    return `rgba(${r},${g},${b},${a})`;
  };
  function applyModalAccent(color) {
    if (!mBody || !color) return;
    const soft = hexToRGBA(color, 0.22) || 'rgba(0,0,0,.18)';
    mBody.style.setProperty('--friend-accent', color);
    mBody.style.setProperty('--friend-accent-soft', soft);
  }

  // ---------- Data ----------
  async function loadFriendshipsForMe(myId) {
    const rows = await sbRest
      .from(T.FRIENDSHIPS)
      .select('id,user_low,user_high,requester_id,status')
      .or(`(user_low.eq.${myId},user_high.eq.${myId})`);

    const pending   = rows.filter(r => r.status === 'pending');
    const accepted  = rows.filter(r => r.status === 'accepted');
    const incoming  = pending.filter(r => r.requester_id !== myId);
    const outgoing  = pending.filter(r => r.requester_id === myId);

    // Cache my accepted ids for mutuals
    myAcceptedIds = new Set(accepted.map(r => otherOf(r, myId)));

    // Profiles to hydrate
    const ids = Array.from(new Set(rows.map(r => otherOf(r, myId))));
    let profiles = [];
    if (ids.length) {
      const inCsv = ids.map(id => `"${id}"`).join(',');

      const nameCols = Array.from(new Set(NAME_KEYS));
      const includeUsername = !nameCols.includes('username');
      const baseCols = ['id', includeUsername ? 'username' : null, ...nameCols, AVATAR_COL]
        .filter(Boolean)
        .join(',');

      try {
        profiles = await sbRest
          .from(T.PROFILES)
          .select(`${baseCols},full_name,email,bio,location,website,role,is_admin,accent_color,theme_color,brand_color,created_at`)
          .in('id', inCsv);
      } catch {
        try {
          profiles = await sbRest
            .from(T.PROFILES)
            .select(`${baseCols},full_name,email,role,is_admin,created_at`)
            .in('id', inCsv);
        } catch {
          profiles = await sbRest
            .from(T.PROFILES)
            .select(baseCols)
            .in('id', inCsv);
        }
      }
    }

    const byId = new Map(profiles.map(p => [p.id, p]));
    return { incoming, outgoing, accepted, profiles: byId };
  }

  // --- mutual friends (computed on open) ---
  async function getMutualCount(myId, otherId) {
    const a = await sbRest.from(T.FRIENDSHIPS)
      .select('user_low,user_high,status')
      .eq('user_low', otherId)
      .eq('status','accepted');
    const b = await sbRest.from(T.FRIENDSHIPS)
      .select('user_low,user_high,status')
      .eq('user_high', otherId)
      .eq('status','accepted');

    const their = new Set([...a, ...b].map(r => otherOf(r, otherId)));
    let count = 0;
    for (const id of their) if (myAcceptedIds.has(id)) count++;
    return count;
  }

  // ---------- Render: Accepted as avatar cards ----------
  function renderAccepted(rows, profilesById, myId, filterText = '') {
    if (!acceptedEl) return;

    acceptedEl.classList.add('friends-grid-cards');
    acceptedEl.innerHTML = '';
    const q = (filterText || '').trim().toLowerCase();
    let shown = 0;

    for (const r of rows) {
      const otherId = otherOf(r, myId);
      const p = profilesById.get(otherId) || {};
      const name = labelOf(p);
      if (q && !name.toLowerCase().includes(q)) continue;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'friend-card';
      card.setAttribute('role', 'listitem');
      card.dataset.uid = otherId;
      card.innerHTML = `
        <img class="avatar-lg" src="${avatarOf(p)}" alt="">
        <div class="name">${name}</div>
        <div class="sub">@${p.username || otherId.slice(0,6)}</div>
      `;

      card.addEventListener('click', () => openModal(p, r, myId));
      acceptedEl.appendChild(card);
      shown++;
    }

    if (emptyEl) emptyEl.hidden = shown !== 0;
  }

  // ---------- Modal ----------
  async function openModal(p, friendshipRow, myId) {
    if (!modal) return;

    // avatar + text
    if (mAvatar) mAvatar.src = avatarOf(p);
    if (mName)   mName.textContent = labelOf(p);
    if (mUser)   mUser.textContent = p.username ? `@${p.username}` : '';

    // role badge
    const isAdmin = !!(p?.is_admin || String(p?.role||'').toLowerCase() === 'admin');
    if (mRole) mRole.hidden = !isAdmin;

    // scoped accent colour (optional profile keys)
    const accent = p.accent_color || p.theme_color || p.brand_color || null;
    applyModalAccent(accent);

    // details
    const rows = [];
    if (p.full_name && p.full_name !== p.display_name) rows.push(['Full name', p.full_name]);
    if (p.bio)       rows.push(['Bio', p.bio]);
    if (p.location)  rows.push(['Location', p.location]);
    if (p.website)   rows.push(['Website', `<a href="${p.website}" target="_blank" rel="noopener">${p.website}</a>`]);
    if (p.email)     rows.push(['Email', p.email]);
    if (p.created_at) rows.push(['Member since', new Date(p.created_at).toLocaleDateString()]);
    rows.push(['Mutual friends', '<span class="muted">Calculating…</span>']); // placeholder

    if (mFields) {
      mFields.innerHTML = rows.map(([k,v]) =>
        `<li class="kv"><span class="k">${k}</span><span class="v">${v}</span></li>`
      ).join('') || '<li class="kv"><span class="v muted">No additional details.</span></li>';
    }

    // compute mutuals
    if (myId && p.id && mFields) {
      try {
        const n = await getMutualCount(myId, p.id);
        const lastKV = mFields.querySelector('.kv:last-child .v');
        if (lastKV) lastKV.textContent = `${n}`;
      } catch { /* ignore */ }
    }

    // actions
    if (locBtn) locBtn.onclick = () => {
      // Focus this friend on the map page
      location.href = `map.html?focus=${encodeURIComponent(p.id)}`;
    };

    if (msgBtn) msgBtn.onclick = () => {
      location.href = `chat.html?user=${encodeURIComponent(p.id)}`;
    };

    if (unBtn) unBtn.onclick  = async () => {
      try {
        await sbRest.delete(T.FRIENDSHIPS, {
          user_low:  'eq.' + friendshipRow.user_low,
          user_high: 'eq.' + friendshipRow.user_high
        });
        closeModal();
        await boot();
      } catch (e) {
        console.error(e);
        alert('Could not unfriend. Please try again.');
      }
    };

    modal.showModal ? modal.showModal() : (modal.open = true);
  }
  function closeModal(){ if (!modal) return; modal.close ? modal.close() : (modal.open=false); }
  mClose && mClose.addEventListener('click', closeModal);
  modal  && modal.addEventListener('click', (e)=>{ if (e.target === modal) closeModal(); });

  // ---------- Requests ----------
  function renderIncoming(rows, profilesById, myId) {
    if (!incomingEl) return;
    incomingEl.innerHTML = '';
    for (const r of rows) {
      const otherId = otherOf(r, myId);
      const p = profilesById.get(otherId) || {};
      const li = document.createElement('li');
      li.className = 'friend-request incoming';
      li.innerHTML = `
        <img class="avatar" src="${avatarOf(p)}" alt="">
        <div class="meta">
          <div class="name">${labelOf(p)}</div>
          <div class="sub">sent you a friend request</div>
        </div>
        <div class="actions">
          <button class="btn btn-primary accept">Accept</button>
          <button class="btn btn-ghost decline">Decline</button>
        </div>`;

      li.querySelector('.accept').addEventListener('click', async () => {
        try {
          await sbRest.update(T.FRIENDSHIPS, { status: 'accepted' }, {
            user_low:  'eq.' + r.user_low,
            user_high: 'eq.' + r.user_high,
            status:    'eq.pending'
          });
          await boot();
        } catch (e) { showError(String(e.message || e)); }
      });
      li.querySelector('.decline').addEventListener('click', async () => {
        try {
          await sbRest.delete(T.FRIENDSHIPS, {
            user_low:  'eq.' + r.user_low,
            user_high: 'eq.' + r.user_high
          });
          await boot();
        } catch (e) { showError(String(e.message || e)); }
      });

      incomingEl.appendChild(li);
    }
  }

  function renderOutgoing(rows, profilesById, myId) {
    if (!outgoingEl) return;
    outgoingEl.innerHTML = '';
    for (const r of rows) {
      const otherId = otherOf(r, myId);
      const p = profilesById.get(otherId) || {};
      const li = document.createElement('li');
      li.className = 'friend-request outgoing';
      li.innerHTML = `
        <img class="avatar" src="${avatarOf(p)}" alt="">
        <div class="meta">
          <div class="name">${labelOf(p)}</div>
          <div class="sub">request pending</div>
        </div>
        <div class="actions">
          <button class="btn btn-ghost cancel">Cancel</button>
        </div>`;

      li.querySelector('.cancel').addEventListener('click', async () => {
        try {
          await sbRest.delete(T.FRIENDSHIPS, {
            user_low:  'eq.' + r.user_low,
            user_high: 'eq.' + r.user_high
          });
          await boot();
        } catch (e) { showError(String(e.message || e)); }
      });

      outgoingEl.appendChild(li);
    }
  }

  // ---------- Add friend by username ----------
  async function addFriend(myId, username) {
    showError('');
    const uname = String(username || '').trim();
    if (!uname) { showError('Enter a username'); return; }
    if (!myId)   { showError('Not signed in'); return; }

    const profs = await sbRest.from(T.PROFILES)
      .select(`id,username,${AVATAR_COL},${Array.from(new Set(NAME_KEYS)).join(',')}`);
    const target = profs.find(p => p.username === uname);
    if (!target)        return showError('User not found');
    if (target.id===myId) return showError('You cannot friend yourself');

    const { low, high } = canonical(myId, target.id);
    const existing = await sbRest.from(T.FRIENDSHIPS)
      .select('id,status,requester_id,user_low,user_high')
      .or(`(and(user_low.eq.${low},user_high.eq.${high}))`);

    if (existing.length) {
      const row = existing[0];
      if (row.status === 'accepted') return showError('You are already friends');
      if (row.status === 'pending')  return showError('Request already pending');
      return showError('A request already exists');
    }

    await sbRest.insert(T.FRIENDSHIPS, {
      user_low: low, user_high: high, requester_id: myId, status: 'pending'
    });
  }

  // ---------- Boot ----------
  async function boot() {
    try {
      if (window.guardRequireAuth) await window.guardRequireAuth({ redirectTo: (CFG.ROUTES && CFG.ROUTES.LOGIN) || 'index.html' });
    } catch { return; }

    const { data } = await getSB().auth.getSession();
    const myId = data?.session?.user?.id || null;
    if (!myId) return;

    const { incoming, outgoing, accepted, profiles } = await loadFriendshipsForMe(myId);

    renderAccepted(accepted, profiles, myId, filterEl ? filterEl.value : '');
    renderIncoming(incoming, profiles, myId);
    renderOutgoing(outgoing, profiles, myId);

    if (filterEl) filterEl.oninput = () =>
      renderAccepted(accepted, profiles, myId, filterEl.value);

    if (addForm) {
      addForm.onsubmit = async (e) => {
        e.preventDefault();
        await addFriend(myId, addInput && addInput.value);
        if (addInput) addInput.value = '';
        await boot();
      };
    }

    $('#refresh-friends')?.addEventListener('click', boot);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
