/* FILE: scripts/friends.js (hardened)
   - Works with friendships RPCs; tries multiple param names + JSONB
   - Schema-agnostic avatars
   - Pre-ensures DM via start_dm JSONB, then routes to chat.html?friend=<id>
*/
(function () {
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sb = (typeof window.getSB === 'function' ? window.getSB() : (window.__sb || window.supabase));

  const elAccepted = $('#friends-accepted');
  const elIncoming = $('#friends-incoming');
  const elOutgoing = $('#friends-outgoing');
  const elMsg      = $('#friends-msg');
  const addForm    = $('#friend-add-form');
  const addInput   = $('#friend-username');
  const navBadge   = $('#nav-friends-badge');

  const AVATAR_KEYS = ["profile_pic","avatar_url","avatar","image_url","photo_url","picture","photo"];
  let ME = null;
  let channel = null;

  function say(t, good = false) {
    if (!elMsg) return;
    elMsg.textContent = t || '';
    elMsg.style.color = good ? '#9effb4' : '#ff9ea1';
    elMsg.hidden = !t;
    if (t && window.pingedUI?.showToast) window.pingedUI.showToast(t);
  }
  function setBadge(n) {
    if (!navBadge) return;
    if (!n) { navBadge.textContent = '0'; navBadge.hidden = true; return; }
    navBadge.textContent = String(n);
    navBadge.hidden = false;
  }
  function getAvatar(user) {
    for (const k of AVATAR_KEYS) if (user && user[k]) return user[k];
    return 'assets/avatar-default.png';
  }
  function prettyName(u) {
    return u?.display_name || u?.username || u?.email || 'Friend';
  }
  function card(user, actions = []) {
    const wrap = document.createElement('div');
    wrap.className = 'friend-card';

    const img = document.createElement('img');
    img.src = getAvatar(user);
    img.alt = `${prettyName(user)} avatar`;
    img.style.width = '32px';
    img.style.height = '32px';
    img.style.borderRadius = '50%';
    img.referrerPolicy = 'no-referrer';

    const meta = document.createElement('div');
    meta.style.flex = '1';
    meta.innerHTML = `<strong>${user.username || user.display_name || '(no username)'}</strong><br><span class="muted">${user.display_name || user.email || ''}</span>`;

    const btns = document.createElement('div');
    btns.style.display = 'flex'; btns.style.gap = '6px';
    actions.forEach(([label, handler, kind]) => {
      const b = document.createElement('button');
      b.textContent = label; b.type='button'; b.onclick = handler;
      b.style.padding = '.45rem .7rem'; b.style.borderRadius = '8px';
      b.style.border = '1px solid #334';
      b.style.background = kind === 'danger' ? '#3a1a1f' : '#1a2030';
      b.style.color = '#fff';
      btns.appendChild(b);
    });

    wrap.append(img, meta, btns);
    return wrap;
  }

  async function resolveUserId(identifier) {
    const ident = (identifier || '').trim();
    if (!ident) throw new Error('Enter a username or email');

    try {
      const { data, error } = await sb.rpc('resolve_user_id', { p_identifier: ident });
      if (!error && data) return data;
    } catch {}

    const { data, error } = await sb
      .from('profiles')
      .select('user_id, id, username, email')
      .or(`username.eq.${ident},email.eq.${ident}`)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('No user with that username or email');
    return data.user_id || data.id;
  }

  async function rpcTry(name, payloads) {
    for (const body of payloads) {
      try {
        const { data, error } = await sb.rpc(name, body);
        if (!error) return { data, error: null };
      } catch {}
    }
    return { data: null, error: new Error(`RPC ${name} failed`) };
  }

  async function loadLists() {
    say('');
    // accepted
    try {
      let accepted = [];
      try {
        const { data, error } = await sb.rpc('list_friends');
        if (error) throw error;
        accepted = data || [];
      } catch { accepted = []; }

      if (elAccepted) {
        elAccepted.innerHTML = '';
        (accepted || []).forEach(u => {
          const row = { id:u.id, username:u.username, display_name:u.display_name, profile_pic:u.profile_pic, email:u.email };
          elAccepted.appendChild(card(row, [
            ['Chat',     () => openChat(u.id)],
            ['Unfriend', () => onUnfriend(u.id), 'danger']
          ]));
        });
        if (!accepted.length) elAccepted.innerHTML = '<p class="muted">No friends yet.</p>';
      }
    } catch (e) { say(e.message || 'Could not load friends'); }

    // requests
    try {
      let incoming = [], outgoing = [];
      try {
        const { data, error } = await sb.rpc('list_friend_requests');
        if (error) throw error;
        incoming = (data || []).filter(r => r.direction === 'incoming');
        outgoing = (data || []).filter(r => r.direction === 'outgoing');
      } catch { incoming = []; outgoing = []; }

      if (elIncoming) {
        elIncoming.innerHTML = '';
        incoming.forEach(r => {
          const row = { other_id:r.other_id, username:r.username, display_name:r.display_name, profile_pic:r.profile_pic, email:r.email };
          elIncoming.appendChild(card(row, [
            ['Accept',  () => onAccept(r.other_id)],
            ['Decline', () => onDecline(r.other_id), 'danger']
          ]));
        });
        if (!incoming.length) elIncoming.innerHTML = '<p class="muted">No incoming requests.</p>';
      }

      if (elOutgoing) {
        elOutgoing.innerHTML = '';
        outgoing.forEach(r => {
          const row = { other_id:r.other_id, username:r.username, display_name:r.display_name, profile_pic:r.profile_pic, email:r.email };
          elOutgoing.appendChild(card(row, [
            ['Cancel', () => onCancel(r.other_id), 'danger']
          ]));
        });
        if (!outgoing.length) elOutgoing.innerHTML = '<p class="muted">No outgoing requests.</p>';
      }

      setBadge(incoming.length);
    } catch (e) { say(e.message || 'Could not load requests'); }
  }

  async function onAdd(e) {
    e?.preventDefault?.();
    try {
      const uid = await resolveUserId(addInput?.value);
      const { error } = await rpcTry('send_friend_request', [
        { p_target: uid }, { p_other: uid },
        { params: { p_target: uid } }, { params: { p_other: uid } }
      ]);
      if (error) throw error;
      say('Friend request sent.', true);
      (e?.target || null)?.reset?.();
      loadLists();
    } catch (err) { say(err?.message || 'Could not send request'); }
  }

  async function onAccept(otherId) {
    try {
      const { error } = await rpcTry('accept_friend_request', [
        { p_requester: otherId }, { p_other: otherId },
        { params: { p_requester: otherId } }, { params: { p_other: otherId } }
      ]);
      if (error) throw error;
      say('Request accepted.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not accept'); }
  }

  async function onDecline(otherId) {
    try {
      const { error } = await rpcTry('decline_friend_request', [
        { p_requester: otherId }, { p_other: otherId },
        { params: { p_requester: otherId } }, { params: { p_other: otherId } }
      ]);
      if (error) throw error;
      say('Request declined.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not decline'); }
  }

  async function onCancel(otherId) {
    try {
      const { error } = await rpcTry('cancel_friend_request', [
        { p_target: otherId }, { p_other: otherId },
        { params: { p_target: otherId } }, { params: { p_other: otherId } }
      ]);
      if (error) throw error;
      say('Request cancelled.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not cancel'); }
  }

  async function onUnfriend(otherId) {
    if (!confirm('Remove this friend?')) return;
    try {
      const { error } = await rpcTry('unfriend', [
        { p_other: otherId }, { p_target: otherId },
        { params: { p_other: otherId } }, { params: { p_target: otherId } }
      ]);
      if (error) throw error;
      say('Unfriended.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not unfriend'); }
  }

  async function openChat(friendId) {
    await rpcTry('start_dm', [
      { params: { p_other: friendId } },
      { p_other: friendId }, { p_other_user_id: friendId },
      { other_user_id: friendId }, { other: friendId }
    ]);
    location.href = `chat.html?friend=${encodeURIComponent(friendId)}`;
  }

  function wireRealtime() {
    try {
      if (channel) sb.removeChannel(channel);
      channel = sb.channel('friends-stream')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, loadLists)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'follows' }, loadLists)
        .subscribe((st) => console.log('[friends] realtime status:', st));
    } catch (e) {
      console.warn('[friends] realtime subscribe failed:', e?.message || e);
    }
  }

  addForm?.addEventListener('submit', onAdd);

  (async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) say('Please sign in to manage friends.');
    loadLists();
    wireRealtime();
  })();

  sb?.auth?.onAuthStateChange((_e, sess) => {
    if (!sess?.user) {
      setBadge(0);
      elAccepted && (elAccepted.innerHTML = '');
      elIncoming && (elIncoming.innerHTML = '');
      elOutgoing && (elOutgoing.innerHTML = '');
      say('Please sign in to manage friends.');
    } else {
      say('');
      loadLists();
    }
  });

  window.FriendsUI = { reload: loadLists };
})();
