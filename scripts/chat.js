/* Author: Logan Poole — 30083609
   FILE: /scripts/chat.js — DM chat via PostgREST (uses messages.body) */
(function () {
  'use strict';

  const $ = (s,r=document)=>r.querySelector(s);

  const friendsEl   = $('#friends-list');
  const friendsFind = $('#friend-search');

  const logEl       = $('#chat-log');
  const formEl      = $('#chat-form');
  const textEl      = $('#chat-text');

  const CFG   = window.PINGED_CONFIG || {};
  const T     = Object.assign({
    PROFILES:      'profiles',
    FRIENDSHIPS:   'friendships',
    CONVERSATIONS: 'conversations',
    PARTICIPANTS:  'conversation_participants',
    MESSAGES:      'messages'
  }, (CFG.TABLES || {}));
  const NAME_KEYS  = (CFG.PROFILE && CFG.PROFILE.DISPLAY_NAME_KEYS) || ['display_name','username'];
  const AVATAR_COL = (CFG.PROFILE && CFG.PROFILE.AVATAR_COLUMN)      || 'avatar_url';

  let myId = null;

  const labelOf = (p={}) => { for (const k of NAME_KEYS) if (p[k]) return String(p[k]); return p.username || p.display_name || p.full_name || p.email || p.id || 'User'; };
  const avatarOf = (p={}) => p[AVATAR_COL] || p.avatar_url || 'assets/avatar.png';
  const otherOf  = (row, uid) => (row.user_low === uid ? row.user_high : row.user_low);

  async function ensureSession() {
    const { data } = await getSB().auth.getSession();
    const sess = data && data.session;
    myId = (sess && sess.user && sess.user.id) || null;
    if (!myId) throw new Error('[chat] No session/user ID');
  }

  async function loadFriendsAccepted() {
    const all = await sbRest.from(T.FRIENDSHIPS)
      .select('id,user_low,user_high,requester_id,status')
      .or(`(user_low.eq.${myId},user_high.eq.${myId})`);
    const rows = all.filter(r => r.status === 'accepted');

    const ids = new Set(rows.map(r => otherOf(r, myId)));
    let profiles = [];
    if (ids.size) {
      const inCsv = Array.from(ids).map(id => `"${id}"`).join(',');
      profiles = await sbRest.from(T.PROFILES)
        .select(`id,username,${AVATAR_COL},${NAME_KEYS.join(',')}`)
        .in('id', inCsv);
    }
    const byId = new Map(profiles.map(p => [p.id, p]));
    return { rows, profiles: byId };
  }

  function renderFriends(rows, profilesById, filter='') {
    if (!friendsEl) return;
    friendsEl.innerHTML = '';
    const q = (filter || '').trim().toLowerCase();

    for (const r of rows) {
      const otherId = otherOf(r, myId);
      const p = profilesById.get(otherId) || {};
      const name = labelOf(p);
      if (q && !name.toLowerCase().includes(q)) continue;

      const li = document.createElement('li');
      li.className = 'dm-friend';
      li.innerHTML = `
        <button class="dm-open">
          <img class="avatar" src="${avatarOf(p)}" alt="">
          <span class="name">${name}</span>
          <span class="sub">@${p.username || otherId}</span>
        </button>`;
      li.querySelector('.dm-open').addEventListener('click', () => openDM(otherId));
      friendsEl.appendChild(li);
    }

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No accepted friends yet.';
      friendsEl.appendChild(empty);
    }
  }

  async function getOrCreateConversation(otherUserId) {
    const mine = await sbRest.from(T.PARTICIPANTS).select('conversation_id').eq('user_id', myId);
    const ids = mine.map(p => p.conversation_id);
    if (ids.length) {
      const inCsv = ids.map(id => `"${id}"`).join(',');
      const also = await sbRest.from(T.PARTICIPANTS)
        .select('conversation_id')
        .eq('user_id', otherUserId)
        .in('conversation_id', inCsv);
      if (also.length) return also[0].conversation_id;
    }
    const conv = (await sbRest.insert(T.CONVERSATIONS, { kind: 'dm' }))[0];
    await sbRest.insert(T.PARTICIPANTS, { conversation_id: conv.id, user_id: myId });
    await sbRest.insert(T.PARTICIPANTS, { conversation_id: conv.id, user_id: otherUserId });
    return conv.id;
  }

  async function loadMessages(conversationId) {
    return sbRest.from(T.MESSAGES)
      .select('id,conversation_id,sender_id,body,created_at')
      .eq('conversation_id', conversationId)
      .order('created_at','asc');
  }

  function renderMessages(msgs, profilesById) {
    if (!logEl) return;
    logEl.innerHTML = '';
    for (const m of msgs) {
      const mine = (m.sender_id === myId);
      const p = profilesById.get(m.sender_id) || {};
      const item = document.createElement('div');
      item.className = 'chat-msg ' + (mine ? 'me' : 'them');
      item.innerHTML = `
        <div class="bubble">
          <div class="meta">
            <img class="avatar" src="${avatarOf(p)}" alt="">
            <span class="name">${labelOf(p)}</span>
            <time class="ts">${new Date(m.created_at).toLocaleString()}</time>
          </div>
          <div class="text"></div>
        </div>`;
      item.querySelector('.text').textContent = m.body || '';
      logEl.appendChild(item);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function sendMessage(conversationId, text) {
    if (!text || !text.trim()) return;
    await sbRest.insert(T.MESSAGES, {
      conversation_id: conversationId,
      sender_id: myId,
      body: text.trim()
    });
  }

  async function openDM(otherUserId) {
    const ok = await sbRest.from(T.FRIENDSHIPS)
      .select('id,status,user_low,user_high')
      .or(`(and(user_low.eq.${myId},user_high.eq.${otherUserId}),and(user_low.eq.${otherUserId},user_high.eq.${myId}))`)
      .then(rows => rows.some(r => r.status === 'accepted'));
    if (!ok) { alert('You can only DM accepted friends.'); return; }

    const convId = await getOrCreateConversation(otherUserId);

    const profs = await sbRest.from(T.PROFILES)
      .select(`id,username,${AVATAR_COL},${NAME_KEYS.join(',')}`)
      .in('id', `"${myId}","${otherUserId}"`);
    const byId = new Map(profs.map(p => [p.id, p]));

    const msgs = await loadMessages(convId);
    renderMessages(msgs, byId);

    if (formEl && textEl) {
      formEl.onsubmit = async (e) => {
        e.preventDefault();
        const txt = textEl.value;
        textEl.value = '';
        await sendMessage(convId, txt);
        const newMsgs = await loadMessages(convId);
        renderMessages(newMsgs, byId);
      };
    }
  }

  async function boot() {
    // Ensure sb-client sync happened before checking guard/session
    await new Promise(res => {
      if (window.sbUser !== undefined) return res();
      window.addEventListener('sb:ready', res, { once: true });
    });

    try { if (window.guardRequireAuth) await window.guardRequireAuth({ redirectTo: (CFG.ROUTES && CFG.ROUTES.LOGIN) || 'index.html' }); }
    catch { return; }

    await ensureSession();

    const { rows, profiles } = await loadFriendsAccepted();
    renderFriends(rows, profiles, friendsFind ? friendsFind.value : '');

    if (friendsFind) {
      friendsFind.addEventListener('input', async () => {
        const { rows, profiles } = await loadFriendsAccepted();
        renderFriends(rows, profiles, friendsFind.value);
      });
    }

    const params = new URLSearchParams(location.search);
    const target = params.get('u') || params.get('friend');
    if (target) openDM(target);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
