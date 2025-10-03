/* Author: Logan Poole — 30083609
   FILE: /scripts/friends-ui.js
   Purpose: Load & render friends using canonical schema:
            friendships(user_low, user_high, requester_id, status)
            profiles(id, username, display_name, avatar_url)
*/

(function () {
  'use strict';

  // ------- Utilities -------
  const $ = (sel, r = document) => r.querySelector(sel);

  // Prefer these containers if they exist (in this order)
  const acceptedEl = $('#friends-accepted') || $('#friends-list') || $('#friends') || null;
  const incomingEl = $('#friends-incoming') || null;
  const outgoingEl = $('#friends-outgoing') || null;
  const filterEl   = $('#friends-filter') || null;
  const addForm    = $('#friend-add-form') || null;
  const addInput   = $('#friend-username') || null;
  const emptyEl    = $('#friends-empty') || null;
  const errEl      = $('#friends-error') || null;

  const CFG = window.PINGED_CONFIG || {};
  const T   = Object.assign({
    PROFILES: 'profiles',
    FRIENDSHIPS: 'friendships'
  }, (CFG.TABLES || {}));

  const NAME_KEYS  = (CFG.PROFILE && CFG.PROFILE.DISPLAY_NAME_KEYS) || ['display_name','username'];
  const AVATAR_COL = (CFG.PROFILE && CFG.PROFILE.AVATAR_COLUMN)      || 'avatar_url';

  const labelOf = (p = {}) => {
    for (const k of NAME_KEYS) if (p && p[k]) return String(p[k]);
    return p.username || p.display_name || p.email || p.id || 'User';
  };
  const avatarOf = (p = {}) => p[AVATAR_COL] || p.avatar_url || 'assets/avatar.png';
  const otherOf  = (row, uid) => (row.user_low === uid ? row.user_high : row.user_low);
  const canonical = (a,b) => (a < b ? {low:a, high:b} : {low:b, high:a});

  function showError(msg) {
    if (!errEl) return;
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
  }

  // ------- Data loading -------
  async function loadFriendshipsForMe(myId) {
    // Fetch ANY friendships where the current user is either side
    // (we avoid the 400 by NOT referencing non-existent columns)
    const rows = await sbRest
      .from(T.FRIENDSHIPS)
      .select('id,user_low,user_high,requester_id,status')
      .or(`(user_low.eq.${myId},user_high.eq.${myId})`);

    const pending   = rows.filter(r => r.status === 'pending');
    const accepted  = rows.filter(r => r.status === 'accepted');
    const incoming  = pending.filter(r => r.requester_id !== myId);
    const outgoing  = pending.filter(r => r.requester_id === myId);

    // Collect profile IDs to hydrate display
    const ids = new Set();
    for (const r of rows) ids.add(otherOf(r, myId));
    const idList = Array.from(ids);
    let profiles = [];
    if (idList.length) {
      const inCsv = idList.map(id => `"${id}"`).join(',');
      profiles = await sbRest
        .from(T.PROFILES)
        .select(`id,username,${AVATAR_COL},${NAME_KEYS.join(',')}`)
        .in('id', inCsv);
    }
    const byId = new Map(profiles.map(p => [p.id, p]));
    return { incoming, outgoing, accepted, profiles: byId };
  }

  // ------- Renderers -------
  function renderAccepted(rows, profilesById, myId, filterText = '') {
    if (!acceptedEl) return; // nothing to render into on this page

    acceptedEl.innerHTML = '';
    const q = (filterText || '').trim().toLowerCase();
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

      const openChat = () => { location.href = 'chat.html?u=' + encodeURIComponent(otherId); };
      const unfriend = async () => {
        try {
          await sbRest.delete(T.FRIENDSHIPS, {
            user_low:  'eq.' + r.user_low,
            user_high: 'eq.' + r.user_high
          });
          await boot(); // reload
        } catch (e) { showError(String(e.message || e)); }
      };

      item.querySelector('.chat').addEventListener('click', openChat);
      item.querySelector('.unfriend').addEventListener('click', unfriend);

      acceptedEl.appendChild(item);
      shown++;
    }
    if (emptyEl) emptyEl.hidden = shown !== 0;
  }

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

  // ------- Add friend by username -------
  async function addFriend(myId, username) {
    showError('');
    const uname = String(username || '').trim();
    if (!uname) { showError('Enter a username'); return; }
    if (!myId)   { showError('Not signed in'); return; }

    const profs = await sbRest.from(T.PROFILES)
      .select(`id,username,${AVATAR_COL},${NAME_KEYS.join(',')}`);
    const target = profs.find(p => p.username === uname);
    if (!target) { showError('User not found'); return; }
    if (target.id === myId) { showError('You cannot friend yourself'); return; }

    const { low, high } = canonical(myId, target.id);

    // Check for existing pair
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
      user_low: low,
      user_high: high,
      requester_id: myId,
      status: 'pending'
    });
  }

  // ------- Boot -------
  async function boot() {
    try {
      // Ensure authenticated & we have myId
      if (window.guardRequireAuth) await window.guardRequireAuth({ redirectTo: (CFG.ROUTES && CFG.ROUTES.LOGIN) || 'index.html' });
    } catch {
      return; // redirected
    }

    const { data } = await getSB().auth.getSession();
    const sess = data && data.session;
    const myId = (sess && sess.user && sess.user.id) || null;
    if (!myId) return;

    // Load
    const { incoming, outgoing, accepted, profiles } = await loadFriendshipsForMe(myId);

    // Render
    renderAccepted(accepted, profiles, myId, filterEl ? filterEl.value : '');
    renderIncoming(incoming, profiles, myId);
    renderOutgoing(outgoing, profiles, myId);

    // Wire UI
    if (filterEl) {
      filterEl.oninput = () => renderAccepted(accepted, profiles, myId, filterEl.value);
    }
    if (addForm) {
      addForm.onsubmit = async (e) => {
        e.preventDefault();
        await addFriend(myId, addInput && addInput.value);
        if (addInput) addInput.value = '';
        await boot(); // refresh lists
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
