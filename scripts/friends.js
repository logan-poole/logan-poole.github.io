
(function () {
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sb = (typeof window.getSB === 'function' ? window.getSB() : window.__sb);

  const elAccepted = $('#friends-accepted');
  const elIncoming = $('#friends-incoming');
  const elOutgoing = $('#friends-outgoing');
  const elMsg      = $('#friends-msg');
  const addForm    = $('#friend-add-form');
  const addInput   = $('#friend-username');
  const navBadge   = $('#nav-friends-badge');

  let ME = null; // my user id

  /* ------------------------- helpers ------------------------- */
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
  function card(user, actions = []) {
    const wrap = document.createElement('div');
    wrap.className = 'friend-card';

    const img = document.createElement('img');
    img.src = user.avatar_url || 'assets/avatar-default.png';
    img.alt = (user.username || user.display_name || 'user') + ' avatar';
    img.style.width = '32px';
    img.style.height = '32px';
    img.style.borderRadius = '50%';
    img.referrerPolicy = 'no-referrer';

    const meta = document.createElement('div');
    meta.style.flex = '1';
    meta.innerHTML = `<strong>${user.username || '(no username)'}</strong><br><span class="muted">${user.display_name || ''}</span>`;

    const btns = document.createElement('div');
    btns.style.display = 'flex';
    btns.style.gap = '6px';
    actions.forEach(([label, handler, kind]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = handler;
      b.style.padding = '.45rem .7rem';
      b.style.borderRadius = '8px';
      b.style.border = '1px solid #334';
      b.style.background = kind === 'danger' ? '#3a1a1f' : '#1a2030';
      b.style.color = '#fff';
      btns.appendChild(b);
    });

    wrap.append(img, meta, btns);
    return wrap;
  }

  async function getMe() {
    if (ME) return ME;
    const { data } = await sb.auth.getSession();
    ME = data?.session?.user?.id || null;
    return ME;
  }

  /* -------------------- resolver (username/email) -------------------- */
  async function resolveUserId(identifier) {
    const ident = (identifier || '').trim();
    if (!ident) throw new Error('Enter a username or email');

    // 1) Try privacy-aware resolver RPC (if you deployed it)
    try {
      const { data, error } = await sb.rpc('resolve_user_id', { p_identifier: ident });
      if (!error && data) return data; // uuid
    } catch (e) {
      // ignore & fall through
    }

    // 2) Fallback: username -> profiles.id (public SELECT allowed in your RLS)
    const { data, error } = await sb
      .from('profiles')
      .select('id, username')
      .eq('username', ident.toLowerCase())
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('No user with that username or email');
    return data.id;
  }

  /* ------------------------- data loaders ------------------------- */
  async function loadAcceptedFriendsFallback() {
    const me = await getMe();
    // mutuals: f1(me -> x) and f2(x -> me)
    const { data, error } = await sb
      .from('follows')
      .select(`
        followed_id,
        other:followed_id ( id, username, display_name, avatar_url )
      `)
      .eq('follower_id', me);

    if (error) throw error;

    const rows = [];
    for (const r of (data || [])) {
      const { data: back } = await sb
        .from('follows')
        .select('follower_id')
        .eq('follower_id', r.followed_id)
        .eq('followed_id', me)
        .maybeSingle();
      if (back && r.other) {
        rows.push({
          other_id: r.other.id,
          username: r.other.username,
          display_name: r.other.display_name,
          avatar_url: r.other.avatar_url
        });
      }
    }
    return rows;
  }

  async function loadRequestsFallback() {
    const me = await getMe();

    // outgoing: I follow them, but they don't follow back
    const { data: outs, error: e1 } = await sb
      .from('follows')
      .select(`
        followed_id,
        p:followed_id ( id, username, display_name, avatar_url )
      `)
      .eq('follower_id', me);
    if (e1) throw e1;

    const outgoing = [];
    for (const r of (outs || [])) {
      const { data: back } = await sb
        .from('follows')
        .select('follower_id')
        .eq('follower_id', r.followed_id)
        .eq('followed_id', me)
        .maybeSingle();
      if (!back && r.p) {
        outgoing.push({
          direction: 'outgoing',
          other_id: r.p.id,
          username: r.p.username,
          display_name: r.p.display_name,
          avatar_url: r.p.avatar_url
        });
      }
    }

    // incoming: they follow me, but I don't follow back
    const { data: ins, error: e2 } = await sb
      .from('follows')
      .select(`
        follower_id,
        p:follower_id ( id, username, display_name, avatar_url )
      `)
      .eq('followed_id', me);
    if (e2) throw e2;

    const incoming = [];
    for (const r of (ins || [])) {
      const { data: back } = await sb
        .from('follows')
        .select('follower_id')
        .eq('follower_id', me)
        .eq('followed_id', r.follower_id)
        .maybeSingle();
      if (!back && r.p) {
        incoming.push({
          direction: 'incoming',
          other_id: r.p.id,
          username: r.p.username,
          display_name: r.p.display_name,
          avatar_url: r.p.avatar_url
        });
      }
    }

    return { incoming, outgoing };
  }

  async function loadLists() {
    say('');
    // accepted mutuals
    try {
      let accepted = null;
      try {
        const { data, error } = await sb.rpc('list_friends');
        if (error) throw error;
        accepted = data || [];
      } catch (_e) {
        accepted = await loadAcceptedFriendsFallback();
      }

      if (elAccepted) {
        elAccepted.innerHTML = '';
        (accepted || []).forEach(u => {
          elAccepted.appendChild(card(u, [['Unfriend', () => onUnfriend(u.other_id), 'danger']]));
        });
        if (!accepted?.length) elAccepted.innerHTML = '<p class="muted">No friends yet.</p>';
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
      } catch (_e) {
        const f = await loadRequestsFallback();
        incoming = f.incoming; outgoing = f.outgoing;
      }

      if (elIncoming) {
        elIncoming.innerHTML = '';
        incoming.forEach(r => elIncoming.appendChild(card(r, [
          ['Accept',  () => onAccept(r.other_id)],
          ['Decline', () => onDecline(r.other_id), 'danger']
        ])));
        if (!incoming.length) elIncoming.innerHTML = '<p class="muted">No incoming requests.</p>';
      }
      if (elOutgoing) {
        elOutgoing.innerHTML = '';
        outgoing.forEach(r => elOutgoing.appendChild(card(r, [
          ['Cancel', () => onCancel(r.other_id), 'danger']
        ])));
        if (!outgoing.length) elOutgoing.innerHTML = '<p class="muted">No outgoing requests.</p>';
      }
      setBadge(incoming.length);
    } catch (e) {
      say(e.message || 'Could not load requests');
    }
  }

  /* ------------------------- actions ------------------------- */
  async function onAdd(e) {
    e?.preventDefault?.();
    try {
      const uid = await resolveUserId(addInput?.value);

      // prefer RPC
      let error = null;
      try {
        ({ error } = await sb.rpc('send_friend_request', { p_target: uid }));
      } catch (e) { error = e; }

      // fallback: direct insert (allowed by RLS: follower_id = auth.uid())
      if (error) {
        const { error: e2 } = await sb.from('follows').insert({ follower_id: await getMe(), followed_id: uid });
        if (e2) throw e2;
      }

      say('Friend request sent.', true);
      addForm?.reset?.();
      loadLists();
    } catch (err) { say(err?.message || 'Could not send request'); }
  }

  async function onAccept(otherId) {
    try {
      // prefer RPC
      let error = null;
      try {
        ({ error } = await sb.rpc('accept_friend_request', { p_requester: otherId }));
      } catch (e) { error = e; }

      // fallback: insert reciprocal edge me -> other
      if (error) {
        const { error: e2 } = await sb.from('follows').insert({ follower_id: await getMe(), followed_id: otherId });
        if (e2) throw e2;
      }

      say('Request accepted.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not accept'); }
  }

  async function onDecline(otherId) {
    try {
      // prefer RPC
      let error = null;
      try {
        ({ error } = await sb.rpc('decline_friend_request', { p_requester: otherId }));
      } catch (e) { error = e; }

      // fallback: delete their edge (other -> me). RLS policy allows followed_id = auth.uid()
      if (error) {
        const { error: e2 } = await sb
          .from('follows')
          .delete()
          .eq('follower_id', otherId)
          .eq('followed_id', await getMe());
        if (e2) throw e2;
      }

      say('Request declined.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not decline'); }
  }

  async function onCancel(otherId) {
    try {
      // prefer RPC
      let error = null;
      try {
        ({ error } = await sb.rpc('cancel_friend_request', { p_target: otherId }));
      } catch (e) { error = e; }

      // fallback: delete my edge (me -> other)
      if (error) {
        const { error: e2 } = await sb
          .from('follows')
          .delete()
          .eq('follower_id', await getMe())
          .eq('followed_id', otherId);
        if (e2) throw e2;
      }

      say('Request cancelled.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not cancel'); }
  }

  async function onUnfriend(otherId) {
    if (!confirm('Remove this friend?')) return;
    try {
      // prefer RPC
      let error = null;
      try {
        ({ error } = await sb.rpc('unfriend', { p_other: otherId }));
      } catch (e) { error = e; }

      // fallback: delete both edges
      if (error) {
        const me = await getMe();
        await sb.from('follows').delete().eq('follower_id', me).eq('followed_id', otherId);
        await sb.from('follows').delete().eq('follower_id', otherId).eq('followed_id', me);
      }

      say('Unfriended.', true);
      loadLists();
    } catch (e) { say(e.message || 'Could not unfriend'); }
  }

  /* ------------------------- realtime ------------------------- */
  function wireRealtime() {
    try {
      sb.channel('friends-stream')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'follows' }, loadLists)
        .subscribe(st => console.log('[friends] realtime status:', st));
    } catch (e) {
      console.warn('[friends] realtime subscribe failed:', e?.message || e);
    }
  }

  /* ------------------------- boot ------------------------- */
  addForm?.addEventListener('submit', onAdd);

  (async () => {
    const { data } = await sb.auth.getSession();
    ME = data?.session?.user?.id || null;
    if (!ME) say('Please sign in to manage friends.');
    loadLists();
    wireRealtime();
  })();

  sb?.auth?.onAuthStateChange((_e, sess) => {
    ME = sess?.user?.id || null;
    if (!ME) {
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

  // expose manual reload if needed
  window.FriendsUI = { reload: loadLists };
})();
