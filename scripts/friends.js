/* 
  scripts/friends.js — username OR email lookup + realtime + actions (UPDATED FINAL)
  ---------------------------------------------------------------------------------
  WHAT CHANGED
  - Input now accepts **username OR email**. We call `rpc('resolve_user_id', { p_identifier })`.
  - Keeps everything else (incoming/outgoing/accepted, accept/decline/cancel/unfriend, badge).
  - Clear messages + toasts if your UI provides window.pingedUI.showToast.

  DOM (unchanged except copy): 
  - #friend-add-form with #friend-username (placeholder now says "username or email")
  - #friends-incoming, #friends-outgoing, #friends-accepted, #friends-msg, optional #nav-friends-badge
*/

(function () {
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const sb = (typeof window.getSB === 'function' ? window.getSB() : window.__sb);

    const elAccepted = $('#friends-accepted');
    const elIncoming = $('#friends-incoming');
    const elOutgoing = $('#friends-outgoing');
    const elMsg = $('#friends-msg');
    const addForm = $('#friend-add-form');
    const addInput = $('#friend-username');
    const navBadge = $('#nav-friends-badge');

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
        img.style.width = '32px'; img.style.height = '32px'; img.style.borderRadius = '50%';
        img.referrerPolicy = 'no-referrer';

        const meta = document.createElement('div');
        meta.style.flex = '1';
        meta.innerHTML = `<strong>${user.username || '(no username)'}</strong><br><span class="muted">${user.display_name || ''}</span>`;

        const btns = document.createElement('div');
        btns.style.display = 'flex'; btns.style.gap = '6px';
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

    async function resolveUserId(identifier) {
        const ident = (identifier || '').trim();
        if (!ident) throw new Error('Enter a username or email');
        // 1) Try RPC that handles username OR email (privacy-aware)
        try {
            const { data, error } = await sb.rpc('resolve_user_id', { p_identifier: ident });
            if (error) throw error;
            if (data) return data; // uuid
        } catch (e) {
            console.warn('[friends] resolve_user_id RPC failed:', e?.message || e);
        }
        // 2) Fallback to username-only via profiles (in case RPC not deployed yet)
        const { data, error } = await sb
            .from('profiles')
            .select('user_id, username')
            .eq('username', ident.toLowerCase())
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('No user with that username or email');
        return data.user_id;
    }

    async function loadLists() {
        say('');
        try {
            const { data: accepted, error } = await sb.rpc('list_friends');
            if (error) throw error;
            if (elAccepted) {
                elAccepted.innerHTML = '';
                (accepted || []).forEach(u => {
                    elAccepted.appendChild(card(u, [['Unfriend', () => onUnfriend(u.other_id), 'danger']]));
                });
                if (!accepted?.length) elAccepted.innerHTML = '<p class="muted">No friends yet.</p>';
            }
        } catch (e) { say(e.message || 'Could not load friends'); }

        try {
            const { data: reqs, error } = await sb.rpc('list_friend_requests');
            if (error) throw error;
            const incoming = (reqs || []).filter(r => r.direction === 'incoming');
            const outgoing = (reqs || []).filter(r => r.direction === 'outgoing');

            if (elIncoming) {
                elIncoming.innerHTML = '';
                incoming.forEach(r => elIncoming.appendChild(card(r, [
                    ['Accept', () => onAccept(r.other_id)],
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
        } catch (e) { say(e.message || 'Could not load requests'); }
    }

    async function onAdd(e) {
        e?.preventDefault?.();
        try {
            const uid = await resolveUserId(addInput?.value);
            const { error } = await sb.rpc('send_friend_request', { p_target: uid });
            if (error) throw error;
            say('Friend request sent.', true);
            addForm?.reset?.();
            loadLists();
        } catch (err) { say(err?.message || 'Could not send request'); }
    }
    async function onAccept(otherId) { try { const { error } = await sb.rpc('accept_friend_request', { p_requester: otherId }); if (error) throw error; say('Request accepted.', true); loadLists(); } catch (e) { say(e.message || 'Could not accept'); } }
    async function onDecline(otherId) { try { const { error } = await sb.rpc('decline_friend_request', { p_requester: otherId }); if (error) throw error; say('Request declined.', true); loadLists(); } catch (e) { say(e.message || 'Could not decline'); } }
    async function onCancel(otherId) { try { const { error } = await sb.rpc('cancel_friend_request', { p_target: otherId }); if (error) throw error; say('Request cancelled.', true); loadLists(); } catch (e) { say(e.message || 'Could not cancel'); } }
    async function onUnfriend(otherId) {
        if (!confirm('Remove this friend?')) return;
        try { const { error } = await sb.rpc('unfriend', { p_other: otherId }); if (error) throw error; say('Unfriended.', true); loadLists(); } catch (e) { say(e.message || 'Could not unfriend'); }
    }

    function wireRealtime() {
        try {
            sb.channel('friendships-stream')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, loadLists)
                .subscribe((st) => console.log('[friends] realtime status:', st));
        } catch (e) { console.warn('[friends] realtime subscribe failed:', e?.message || e); }
    }

    addForm?.addEventListener('submit', onAdd);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { loadLists(); wireRealtime(); });
    else { loadLists(); wireRealtime(); }

    sb?.auth?.onAuthStateChange((_e, sess) => {
        if (!sess?.user) {
            setBadge(0);
            elAccepted && (elAccepted.innerHTML = '');
            elIncoming && (elIncoming.innerHTML = '');
            elOutgoing && (elOutgoing.innerHTML = '');
            say('Please sign in to manage friends.');
        } else {
            loadLists();
        }
    });

    window.FriendsUI = { reload: loadLists };
})();
