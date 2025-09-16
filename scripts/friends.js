/* FILE: scripts/friends.js (hardened)
   - Works with friendships RPCs; schema-agnostic avatars
   - Pre-ensures DM via start_dm(p_other_user_id), then routes to chat.html?friend=<id>
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

  function say(msg, ok = false) {
    if (!elMsg) return;
    elMsg.textContent = msg || '';
    elMsg.className = ok ? 'ok' : 'warn';
  }

  function avatarFromAny(obj) {
    for (const k of ["profile_pic","avatar_url","avatar","image_url","photo_url","picture","photo"]) {
      if (obj && obj[k]) return obj[k];
    }
    return "assets/avatar-default.png";
  }

  async function rpcTry(name, variants) {
    for (const args of variants) {
      try {
        const { data, error } = await sb.rpc(name, args);
        if (!error) return { data, error: null };
      } catch {}
    }
    return { data: null, error: new Error(`RPC ${name} failed`) };
  }

  async function resolveUserId(identifier) {
    const ident = (identifier || '').trim();
    if (!ident) throw new Error('Enter a username or email');

    try {
      const { data, error } = await sb
        .from('profiles')
        .select('id, user_id, username, email, profile_pic, avatar_url')
        .or(`username.eq.${ident},email.eq.${ident}`);
      if (error) throw error;
      const row = (data || [])[0] || null;
      if (!row) throw new Error('User not found');
      return row.user_id || row.id;
    } catch (e) {
      throw new Error(e?.message || 'Could not resolve user');
    }
  }

  function renderList(el, rows, kind) {
    if (!el) return;
    el.innerHTML = '';

    if (!rows?.length) {
      el.innerHTML = `<div class="muted">No ${kind}.</div>`;
      return;
    }

    rows.forEach((r) => {
      const li = document.createElement('div');
      li.className = 'friend-item';

      const img = document.createElement('img');
      img.className = 'avatar';
      img.width = img.height = 32;
      img.src = avatarFromAny(r);

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `
        <div class="name">${r.display_name || (r.username ? '@' + r.username : 'Friend')}</div>
        <div class="sub">${r.email || ''}</div>
      `;

      const btns = document.createElement('div');
      btns.className = 'btns';

      function add(kind, label, onClick) {
        const b = document.createElement('button');
        b.className = `btn btn-sm ${kind}`;
        b.textContent = label;
        b.onclick = onClick;
        btns.appendChild(b);
      }

      // Buttons per list
      if (kind === 'friends') {
        add('primary', 'Message', () => openChat(r.id));
        add('danger', 'Unfriend', () => onUnfriend(r.id));
      } else if (kind === 'incoming') {
        add('primary', 'Accept', () => onAccept(r.id));
        add('danger', 'Decline', () => onDecline(r.id));
      } else if (kind === 'outgoing') {
        add('danger', 'Cancel', () => onCancel(r.id));
      }

      li.append(img, meta, btns);
      el.appendChild(li);
    });
  }

  async function loadLists() {
    try {
      const { data, error } = await sb.rpc('list_friends_full');
      if (error) throw error;

      const accepted = (data?.accepted || []).map(p => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name,
        email: p.email,
        profile_pic: p.profile_pic,
        avatar_url: p.avatar_url
      }));
      const incoming = data?.incoming || [];
      const outgoing = data?.outgoing || [];

      renderList(elAccepted, accepted, 'friends');
      renderList(elIncoming, incoming, 'incoming');
      renderList(elOutgoing, outgoing, 'outgoing');
      say('');
    } catch (e) {
      console.error('[friends] load error', e);
      say('Could not load friends.');
      renderList(elAccepted, [], 'friends');
      renderList(elIncoming, [], 'incoming');
      renderList(elOutgoing, [], 'outgoing');
    }
  }

  async function onAccept(otherId) {
    try {
      const { error } = await rpcTry('accept_friend_request', [{ p_other: otherId }, { p_target: otherId }]);
      if (error) throw error;
      say('Accepted request.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not accept'); }
  }

  async function onDecline(otherId) {
    try {
      const { error } = await rpcTry('decline_friend_request', [{ p_other: otherId }, { p_target: otherId }]);
      if (error) throw error;
      say('Declined request.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not decline'); }
  }

  async function onCancel(otherId) {
    try {
      const { error } = await rpcTry('cancel_friend_request', [{ p_other: otherId }, { p_target: otherId }]);
      if (error) throw error;
      say('Request cancelled.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not cancel'); }
  }

  async function onUnfriend(otherId) {
    if (!confirm('Remove this friend?')) return;
    try {
      const { error } = await rpcTry('unfriend', [{ p_other: otherId }, { p_target: otherId }]);
      if (error) throw error;
      say('Unfriended.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not remove'); }
  }

  async function onAdd(e) {
    e?.preventDefault?.();
    try {
      const uid = await resolveUserId(addInput?.value);
      const { error } = await rpcTry('send_friend_request', [{ p_target: uid }, { p_other: uid }]);
      if (error) throw error;
      say('Friend request sent.', true);
      (e?.target || null)?.reset?.();
      loadLists();
    } catch (err) { say(err?.message || 'Could not send request'); }
  }

  async function openChat(friendId) {
    try {
      // Canonical call: start_dm(p_other_user_id uuid) => uuid
      await sb.rpc('start_dm', { p_other_user_id: friendId });
    } catch {
      // Fallback if you still have ensure_dm
      try { await sb.rpc('ensure_dm', { p_other: friendId }); } catch {}
    }
    location.href = `chat.html?friend=${encodeURIComponent(friendId)}`;
  }

  function wireRealtime() {
    let channel = null;
    try {
      if (channel) sb.removeChannel(channel);
      channel = sb.channel('friends')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => loadLists())
        .subscribe(() => {});
    } catch {}
  }

  // Wire UI
  addForm && addForm.addEventListener('submit', onAdd);

  // Boot
  sb?.auth?.onAuthStateChange((_e, sess) => {
    if (!sess?.user) {
      renderList(elAccepted, [], 'friends');
      renderList(elIncoming, [], 'incoming');
      renderList(elOutgoing, [], 'outgoing');
      say('Please sign in to manage friends.');
    } else {
      say('');
      loadLists();
      wireRealtime();
    }
  });

  // Initial load if already signed in
  (async () => {
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (user) { await loadLists(); wireRealtime(); }
      else say('Please sign in to manage friends.');
    } catch { say('Please sign in to manage friends.'); }
  })();
})();
