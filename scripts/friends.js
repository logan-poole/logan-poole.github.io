/* Author: Logan Poole — 30083609
   FILE: /scripts/friends.js — Friends (canonical pairs) */
(function () {
  'use strict';

  const $  = (s,r=document)=>r.querySelector(s);

  const addForm       = $('#friend-add-form');
  const addInput      = $('#friend-username');

  const reqIncomingEl = $('#friends-incoming');
  const reqOutgoingEl = $('#friends-outgoing');
  const acceptedEl    = $('#friends-accepted');
  const emptyEl       = $('#friends-empty');
  const errEl         = $('#friends-error');
  const filterEl      = $('#friends-filter');

  const CFG = window.PINGED_CONFIG || {};
  const T   = Object.assign({ PROFILES:'profiles', FRIENDSHIPS:'friendships' }, (CFG.TABLES||{}));
  const NAME_KEYS  = (CFG.PROFILE && CFG.PROFILE.DISPLAY_NAME_KEYS) || ['display_name','username'];
  const AVATAR_COL = (CFG.PROFILE && CFG.PROFILE.AVATAR_COLUMN) || 'avatar_url';

  const me   = (window.sbUser || {});
  const myId = me?.id;

  const labelOf = (p={}) => { for (const k of NAME_KEYS) if (p[k]) return String(p[k]); return p.username || p.display_name || p.id || 'Unknown'; };
  const avatarOf = (p={}) => p[AVATAR_COL] || p.avatar_url || 'assets/avatar.png';
  const otherOf  = (row, uid) => (row.user_low === uid ? row.user_high : row.user_low);
  const canonical = (a,b) => (a < b ? {low:a, high:b} : {low:b, high:a});

  function showError(msg){ if(!errEl) return; errEl.textContent = msg||''; errEl.hidden = !msg; }

  async function RGET(table, params){ return sbRest.from(table).select(params.select||'*').then(rows=>{
    if (params.or) rows = rows.filter(()=>true); return rows;
  }); } // Not used; we rely on sbRest directly below for clarity.

  async function loadAll() {
    if (!myId) return { incoming:[], outgoing:[], accepted:[], profiles:new Map() };

    const all = await sbRest.from(T.FRIENDSHIPS)
      .select('id,user_low,user_high,requester_id,status')
      .or(`(user_low.eq.${myId},user_high.eq.${myId})`);

    const pending  = all.filter(r => r.status === 'pending');
    const accepted = all.filter(r => r.status === 'accepted');
    const incoming = pending.filter(r => r.requester_id !== myId);
    const outgoing = pending.filter(r => r.requester_id === myId);

    const ids = new Set();
    for (const r of all) ids.add(otherOf(r, myId));
    const list = Array.from(ids);
    let profiles = [];
    if (list.length) {
      const inCsv = list.map(id => `"${id}"`).join(',');
      profiles = await sbRest.from(T.PROFILES)
        .select(`id,username,${AVATAR_COL},${NAME_KEYS.join(',')}`)
        .in('id', inCsv);
    }
    const byId = new Map(profiles.map(p => [p.id, p]));
    return { incoming, outgoing, accepted, profiles: byId };
  }

  function renderRequestsIncoming(rows, profilesById) {
    if (!reqIncomingEl) return;
    reqIncomingEl.innerHTML = '';
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
      li.querySelector('.accept').addEventListener('click', () => acceptRequest(r));
      li.querySelector('.decline').addEventListener('click', () => removeFriendship(r));
      reqIncomingEl.appendChild(li);
    }
  }

  function renderRequestsOutgoing(rows, profilesById) {
    if (!reqOutgoingEl) return;
    reqOutgoingEl.innerHTML = '';
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
      li.querySelector('.cancel').addEventListener('click', () => removeFriendship(r));
      reqOutgoingEl.appendChild(li);
    }
  }

  function renderAccepted(rows, profilesById, filterText='') {
    if (!acceptedEl) return;
    acceptedEl.innerHTML = '';
    const q = (filterText||'').trim().toLowerCase();

    let shown = 0;
    for (const r of rows) {
      const otherId = otherOf(r, myId);
      const p = profilesById.get(otherId) || {};
      const name = labelOf(p);
      if (q && !name.toLowerCase().includes(q)) continue;

      const item = document.createElement('div');
      item.className = 'friend-item';
      item.innerHTML = `
        <img class="avatar" src="${avatarOf(p)}" alt="">
        <div class="meta">
          <div class="name">${name}</div>
          <div class="sub">@${p.username || otherId}</div>
        </div>
        <div class="actions">
          <button class="btn chat">Message</button>
          <button class="btn btn-ghost unfriend">Unfriend</button>
        </div>`;
      item.querySelector('.chat').addEventListener('click', () => openChat(otherId));
      item.querySelector('.unfriend').addEventListener('click', () => removeFriendship(r));
      acceptedEl.appendChild(item);
      shown++;
    }
    if (emptyEl) emptyEl.hidden = shown !== 0;
  }

  async function acceptRequest(row) {
    try {
      showError('');
      await sbRest.update(T.FRIENDSHIPS, { status: 'accepted' }, {
        user_low:  'eq.' + row.user_low,
        user_high: 'eq.' + row.user_high,
        status:    'eq.pending'
      });
      await refreshAll();
    } catch (e) { showError(String(e.message || e)); }
  }

  async function removeFriendship(row) {
    try {
      showError('');
      await sbRest.delete(T.FRIENDSHIPS, {
        user_low:  'eq.' + row.user_low,
        user_high: 'eq.' + row.user_high
      });
      await refreshAll();
    } catch (e) { showError(String(e.message || e)); }
  }

  async function openChat(otherUserId) {
    location.href = 'chat.html?u=' + encodeURIComponent(otherUserId);
  }

  async function addFriendByUsername(username) {
    showError('');
    const uname = String(username || '').trim();
    if (!uname) { showError('Enter a username'); return; }
    if (!myId)   { showError('Not signed in'); return; }

    const profs = await sbRest.from(T.PROFILES).select('id,username,'+AVATAR_COL)
      .then(rows => rows.filter(p => p.username === uname));
    const prof  = profs[0];
    if (!prof) { showError('User not found'); return; }
    if (prof.id === myId) { showError('You cannot friend yourself'); return; }

    const { low, high } = canonical(myId, prof.id);
    const exists = await sbRest.from(T.FRIENDSHIPS).select('id,status,requester_id')
      .then(rows => rows.find(r => r.user_low===low && r.user_high===high));
    if (exists) {
      if (exists.status === 'accepted')     showError('You are already friends');
      else if (exists.status === 'pending') showError('Request already pending');
      else showError('A request already exists');
      return;
    }

    await sbRest.insert(T.FRIENDSHIPS, {
      user_low: low, user_high: high, requester_id: myId, status: 'pending'
    });
  }

  async function refreshAll() {
    const { incoming, outgoing, accepted, profiles } = await loadAll();
    renderRequestsIncoming(incoming, profiles);
    renderRequestsOutgoing(outgoing, profiles);
    renderAccepted(accepted, profiles, filterEl ? filterEl.value : '');
  }

  async function boot() {
    try { if (window.guardRequireAuth) await window.guardRequireAuth({ redirectTo: (CFG.ROUTES && CFG.ROUTES.LOGIN) || 'index.html' }); }
    catch { return; }

    if (!myId) return;

    if (addForm) {
      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await addFriendByUsername(addInput?.value);
        if (addInput) addInput.value = '';
        await refreshAll();
      });
    }
    if (filterEl) {
      filterEl.addEventListener('input', () => { refreshAll().catch(err => showError(String(err.message||err))); });
    }
    const refreshBtn = $('#refresh-friends');
    if (refreshBtn) refreshBtn.addEventListener('click', () => refreshAll());

    await refreshAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
