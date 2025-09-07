/* FILE: scripts/chat.js  (COMPLETE, UPDATED)
   PURPOSE
   - Friends list (left) → DMs; New Group & Add People; messages with optional media.
   - Friends come from friendships (or your friend RPCs if present).
   - Start DM via RPC start_dm(other_id) if available; fallback creates conversation+participants.
   - Reads/writes public.messages; subscribes to realtime by conversation_id.
   - Uploads media to 'dm-media'/<conversation_id>/<filename> (adjust as needed).

   EXPECTED TABLES (align with config.js TABLES):
   - conversations(id uuid pk default gen_random_uuid(), is_group boolean default false, title text, created_at timestamptz default now())
   - conversation_participants(conversation_id uuid, user_id uuid, role text default 'member', created_at timestamptz default now(), primary key (conversation_id, user_id))
   - messages(id uuid pk default gen_random_uuid(), conversation_id uuid, author_id uuid, body text, media_url text, media_type text, created_at timestamptz default now())
   - friendships(user_low uuid, user_high uuid, status text, created_at timestamptz)  -- status = 'accepted'
   - profiles(user_id uuid pk, username text, display_name text, profile_pic text, ...)

   RLS (high level):
   - conversations: members can select
   - participants: members can select/insert (for self); maybe admins can invite
   - messages: members can select/insert to their conversation
   - storage: 'dm-media' bucket with object paths guarded by conversation membership (via signed URLs or policy)
*/

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // Storage buckets (object paths: dm-media/<conversation_id>/<filename>)
  const CHAT_BUCKETS = ['dm-media'];

  // DOM
  const friendsEl = $("#friends-list");
  const searchEl = $("#friend-search");
  const newGroupBtn = $("#new-group-btn");
  const addPeopleBtn = $("#add-people-btn");
  const participantsEl = $("#participants");
  const logEl = $("#chat-log");
  const formEl = $("#chat-form");
  const textEl = $("#chat-text");
  const filesEl = $("#chat-files");

  // Modal (create group)
  const modal = $("#group-modal");
  const modalClose = $("#group-close");
  const modalCancel = $("#group-cancel");
  const modalCreate = $("#group-create");
  const modalFriends = $("#group-friends");

  // State
  let sb = null, me = null;
  let activeConv = null;
  let channel = null;
  let allFriends = [];
  const seenMsgIds = new Set();

  const { TABLES, PROFILE } = window.PINGED_CONFIG || window.PINGED || {};
  const T_CONV = (TABLES && TABLES.CONVERSATIONS) || 'conversations';
  const T_PART = (TABLES && TABLES.PARTICIPANTS) || 'conversation_participants';
  const T_MSG = (TABLES && TABLES.MESSAGES) || 'messages';
  const T_PROF = (TABLES && TABLES.PROFILES) || 'profiles';
  const T_FSHIP = (TABLES && TABLES.FRIENDSHIPS) || 'friendships';
  const AVATAR_COL = (PROFILE && PROFILE.AVATAR_COLUMN) || 'profile_pic';

  // Helpers
  function labelFromProfile(p) {
    if (!p) return 'Unknown';
    if (p.display_name) return p.display_name;
    if (p.username) return '@' + p.username;
    return 'User';
  }

  function avatarFromProfile(p) {
    return p && p[AVATAR_COL] ? p[AVATAR_COL] : 'assets/icons/profile.png';
  }

  async function init() {
    sb = (typeof window.getSB === 'function' ? window.getSB() : window.__sb);
    if (!sb) { console.error('[chat] Missing Supabase client'); return; }

    const { data } = await sb.auth.getUser();
    me = data?.user || null;
    if (!me) {
      if (logEl) logEl.innerHTML = `<div class="muted" style="padding:10px">Please sign in.</div>`;
      return;
    }

    // Wire UI
    if (formEl) formEl.addEventListener('submit', onSend);
    if (filesEl) filesEl.addEventListener('change', onFilesChosen);
    if (newGroupBtn) newGroupBtn.addEventListener('click', openGroupModal);
    if (addPeopleBtn) addPeopleBtn.addEventListener('click', () => openGroupModal(activeConv));
    if (modalClose) modalClose.addEventListener('click', closeGroupModal);
    if (modalCancel) modalCancel.addEventListener('click', closeGroupModal);
    if (modalCreate) modalCreate.addEventListener('click', createGroupFromModal);
    if (searchEl) {
      searchEl.addEventListener('input', () => renderFriends(searchEl.value));
    }

    await loadFriends();
    subscribePresence(); // realtime messages for active conversation are attached via enterConversation
  }

  // ---- Friends ----

  async function loadFriends() {
    // Prefer RPCs if you created them (list_friends). Otherwise query friendships table.
    let rows = [];
    try {
      const { data, error } = await sb.rpc('list_friends'); // optional RPC
      if (!error && data) {
        rows = data; // expected: [{ id, username, display_name, email, profile_pic }, ...]
      } else {
        // fallback to friendships table: accepted pairs (user_low,user_high) with status='accepted'
        const { data: fs, error: e1 } = await sb
          .from(T_FSHIP)
          .select('*')
          .or(`user_low.eq.${me.id},user_high.eq.${me.id}`)
          .eq('status', 'accepted')
          .limit(200);

        if (e1) throw e1;

        // Map into friend user_ids (other side)
        const friendIds = [...new Set(
          (fs || []).map(r => r.user_low === me.id ? r.user_high : r.user_low)
        )];
        if (friendIds.length) {
          const { data: profs, error: e2 } = await sb
            .from(T_PROF)
            .select(`user_id, username, display_name, email, ${AVATAR_COL}`)
            .in('user_id', friendIds);
          if (e2) throw e2;
          rows = (profs || []).map(p => ({
            id: p.user_id,
            username: p.username,
            display_name: p.display_name,
            email: p.email,
            profile_pic: p[AVATAR_COL]
          }));
        }
      }
    } catch (err) {
      console.error('[chat] friends load error', err);
    }
    allFriends = rows || [];
    renderFriends();
  }

  function renderFriends(filterText = '') {
    if (!friendsEl) return;
    const q = (filterText || '').trim().toLowerCase();
    const items = allFriends
      .filter(f => {
        const hay = [f.username, f.display_name, f.email].filter(Boolean).join(' ').toLowerCase();
        return !q || hay.includes(q);
      })
      .sort((a, b) => (a.display_name || a.username || '').localeCompare(b.display_name || b.username || ''));

    friendsEl.innerHTML = '';
    if (items.length === 0) {
      friendsEl.innerHTML = `<div class="muted" style="padding:10px">No friends matched.</div>`;
      return;
    }
    items.forEach(f => {
      const btn = document.createElement('button');
      btn.className = 'friend';
      btn.type = 'button';
      btn.innerHTML = `
        <img src="${f.profile_pic || 'assets/icons/profile.png'}" width="32" height="32" style="border-radius:50%" alt="">
        <div class="meta">
          <div class="name">${f.display_name || '@' + f.username || f.email || 'Friend'}</div>
          <div class="sub muted">${f.username ? '@' + f.username : (f.email || '')}</div>
        </div>`;
      btn.addEventListener('click', () => openDM(f.id));
      friendsEl.appendChild(btn);
    });
  }

  // ---- Conversations ----

  async function openDM(otherUserId) {
    // Try your RPC if present
    let convId = null;
    try {
      const { data, error } = await sb.rpc('start_dm', { p_other_user_id: otherUserId });
      if (!error && data) convId = typeof data === 'string' ? data : data?.id;
    } catch (_) { }

    // Fallback: create/find client-side
    if (!convId) {
      const { data: existing, error: e0 } = await sb
        .from(T_CONV)
        .select('id')
        .eq('is_group', false)
        .in('id', sb.from(T_PART).select('conversation_id').eq('user_id', me.id)) // NOTE: supabase-js does not support subselect directly; best-effort fallback below
        .limit(1);
      // ^ Above subselect isn’t supported; fallback: fetch my conv ids then check participants for other.
      let myConvIds = [];
      if (!existing) {
        const { data: mineParts } = await sb.from(T_PART).select('conversation_id').eq('user_id', me.id).limit(1000);
        myConvIds = [...new Set((mineParts || []).map(r => r.conversation_id))];
        if (myConvIds.length) {
          const { data: cands } = await sb.from(T_CONV).select('id').eq('is_group', false).in('id', myConvIds);
          if (cands && cands.length) {
            // check if other user is in any
            for (const c of cands) {
              const { data: hasOther } = await sb.from(T_PART)
                .select('user_id').eq('conversation_id', c.id).eq('user_id', otherUserId).limit(1);
              if (hasOther && hasOther.length) { convId = c.id; break; }
            }
          }
        }
      }
      if (!convId) {
        // Create new conversation + two participants
        const { data: conv, error: e1 } = await sb.from(T_CONV).insert({ is_group: false }).select('id').single();
        if (e1) { console.error('[chat] create DM conv failed', e1); return; }
        convId = conv.id;
        const { error: e2 } = await sb.from(T_PART).insert([
          { conversation_id: convId, user_id: me.id, role: 'member' },
          { conversation_id: convId, user_id: otherUserId, role: 'member' }
        ]);
        if (e2) { console.error('[chat] add participants failed', e2); return; }
      }
    }

    await enterConversation(convId);
  }

  async function enterConversation(conversationId) {
    activeConv = conversationId;
    if (addPeopleBtn) addPeopleBtn.disabled = false;
    await renderParticipants(conversationId);
    await loadMessages(conversationId);
    subscribeMessages(conversationId);
  }

  async function renderParticipants(conversationId) {
    if (!participantsEl) return;
    const { data: parts, error } = await sb.from(T_PART).select('user_id').eq('conversation_id', conversationId);
    if (error) { console.error('[chat] participants error', error); return; }
    const ids = (parts || []).map(r => r.user_id);
    const { data: profs, error: e2 } = await sb
      .from(T_PROF)
      .select(`user_id, username, display_name, ${AVATAR_COL}`)
      .in('user_id', ids);
    if (e2) { console.error('[chat] participants profile error', e2); return; }

    participantsEl.innerHTML = '';
    (profs || []).forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `<img src="${avatarFromProfile(p)}" width="20" height="20" style="border-radius:50%;vertical-align:middle;margin-right:6px"> ${labelFromProfile(p)}`;
      participantsEl.appendChild(chip);
    });
  }

  // ---- Messages ----

  function messageBubble(msg, authorProfile) {
    const mine = msg.author_id === me.id;
    const wrap = document.createElement('div');
    wrap.className = `msg ${mine ? 'mine' : 'theirs'}`;

    if (!mine) {
      const avatar = document.createElement('img');
      avatar.src = avatarFromProfile(authorProfile);
      avatar.alt = '';
      avatar.width = 28; avatar.height = 28; avatar.style.borderRadius = '50%';
      wrap.appendChild(avatar);
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (msg.body) {
      const p = document.createElement('p');
      p.textContent = msg.body;
      bubble.appendChild(p);
    }

    if (msg.media_url) {
      if ((msg.media_type || '').startsWith('video/')) {
        const v = document.createElement('video');
        v.src = msg.media_url; v.controls = true; v.preload = 'metadata';
        v.style.maxWidth = '100%'; v.style.borderRadius = '8px'; v.style.marginTop = '6px';
        bubble.appendChild(v);
      } else {
        const i = document.createElement('img');
        i.src = msg.media_url; i.alt = '';
        i.loading = 'lazy';
        i.style.maxWidth = '100%'; i.style.borderRadius = '8px'; i.style.marginTop = '6px';
        bubble.appendChild(i);
      }
    }

    const ts = document.createElement('div');
    ts.className = 'ts';
    ts.textContent = new Date(msg.created_at).toLocaleString();
    bubble.appendChild(ts);

    wrap.appendChild(bubble);
    return wrap;
  }

  async function loadMessages(conversationId) {
    if (!logEl) return;
    logEl.innerHTML = '<div class="muted" style="padding:10px">Loading…</div>';

    const { data: rows, error } = await sb
      .from(T_MSG)
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(500);

    if (error) { console.error('[chat] load messages error', error); return; }

    // Collect author ids → profiles
    const authorIds = [...new Set((rows || []).map(r => r.author_id).filter(Boolean))];
    let authorMap = {};
    if (authorIds.length) {
      const { data: profs } = await sb
        .from(T_PROF)
        .select(`user_id, username, display_name, ${AVATAR_COL}`)
        .in('user_id', authorIds);
      (profs || []).forEach(p => { authorMap[p.user_id] = p; });
    }

    logEl.innerHTML = '';
    (rows || []).forEach(m => logEl.appendChild(messageBubble(m, authorMap[m.author_id])));
    logEl.scrollTop = logEl.scrollHeight;
  }

  function subscribeMessages(conversationId) {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel(`msgs-${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: T_MSG, filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const m = payload.new;
        if (!m || seenMsgIds.has(m.id)) return;
        seenMsgIds.add(m.id);
        appendIncoming(m);
      })
      .subscribe();
  }

  async function appendIncoming(m) {
    if (!logEl || !activeConv || m.conversation_id !== activeConv) return;
    // fetch author
    let author = null;
    const { data: profs } = await sb
      .from(T_PROF)
      .select(`user_id, username, display_name, ${AVATAR_COL}`)
      .eq('user_id', m.author_id)
      .limit(1);
    author = (profs && profs[0]) || null;
    logEl.appendChild(messageBubble(m, author));
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ---- Sending ----

  async function onFilesChosen() {
    if (!filesEl?.files?.length) return;
    // Just preview count; actual upload occurs on send
    // (You can add previews here if you like)
  }

  async function uploadMedia(conversationId, file) {
    const bucket = CHAT_BUCKETS[0];
    const path = `${conversationId}/${Date.now()}_${(file.name || 'file').replace(/\s+/g, '_')}`;
    const { data, error } = await sb.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
    if (error) throw error;
    // public URL or signed — adjust depending on your bucket policy:
    const { data: pub } = sb.storage.from(bucket).getPublicUrl(path);
    return { url: pub?.publicUrl || null, type: file.type || null };
  }

  async function onSend(e) {
    e.preventDefault();
    if (!activeConv) return alert('Open a conversation first.');
    const body = (textEl?.value || '').trim();
    let media_url = null, media_type = null;

    // If files selected, upload the first (you can extend to multiple)
    if (filesEl && filesEl.files && filesEl.files.length) {
      try {
        const up = await uploadMedia(activeConv, filesEl.files[0]);
        media_url = up.url; media_type = up.type;
      } catch (err) {
        console.error('[chat] upload failed', err);
        return alert('Could not upload media.');
      }
    }

    // Optimistic append (mine)
    if (logEl) {
      const optimistic = {
        id: 'optimistic-' + Date.now(),
        conversation_id: activeConv,
        author_id: me.id,
        body, media_url, media_type,
        created_at: new Date().toISOString()
      };
      seenMsgIds.add(optimistic.id);
      logEl.appendChild(messageBubble(optimistic, { username: 'you', display_name: 'You', [AVATAR_COL]: null }));
      logEl.scrollTop = logEl.scrollHeight;
    }

    const { error } = await sb.from(T_MSG).insert({
      conversation_id: activeConv,
      author_id: me.id,
      body: body || null,
      media_url, media_type
    });
    if (error) {
      console.error('[chat] send error', error);
      alert('Could not send message. Check RLS.');
    }

    // Reset inputs
    if (textEl) textEl.value = '';
    if (filesEl) filesEl.value = '';
  }

  // ---- Groups ----

  function openGroupModal(existingConversationId = null) {
    if (!modal) return;
    modal.dataset.mode = existingConversationId ? 'add' : 'create';
    modal.dataset.conversationId = existingConversationId || '';
    // render friend checkboxes
    if (modalFriends) {
      modalFriends.innerHTML = '';
      allFriends.forEach(f => {
        const id = `friend-${f.id}`;
        const li = document.createElement('label');
        li.className = 'friend-check';
        li.htmlFor = id;
        li.innerHTML = `
          <input type="checkbox" id="${id}" value="${f.id}">
          <img src="${f.profile_pic || 'assets/icons/profile.png'}" width="24" height="24" style="border-radius:50%">
          <span>${f.display_name || '@' + f.username || f.email || 'Friend'}</span>
        `;
        modalFriends.appendChild(li);
      });
    }
    modal.removeAttribute('hidden');
  }

  function closeGroupModal() {
    if (!modal) return;
    modal.setAttribute('hidden', '');
  }

  async function createGroupFromModal() {
    if (!modal) return;
    const mode = modal.dataset.mode || 'create';
    const selected = Array.from(modalFriends.querySelectorAll('input[type=checkbox]:checked')).map(i => i.value);
    if (!selected.length) return alert('Select at least one friend.');

    if (mode === 'create') {
      const { data: conv, error: e1 } = await sb.from(T_CONV).insert({ is_group: true }).select('id').single();
      if (e1) { console.error('[chat] create group failed', e1); return; }
      const convId = conv.id;
      const inserts = [{ conversation_id: convId, user_id: me.id, role: 'admin' }]
        .concat(selected.map(uid => ({ conversation_id: convId, user_id: uid, role: 'member' })));
      const { error: e2 } = await sb.from(T_PART).insert(inserts);
      if (e2) { console.error('[chat] add members failed', e2); return; }
      closeGroupModal();
      await enterConversation(convId);
    } else {
      // add to existing conversation
      const convId = modal.dataset.conversationId;
      if (!convId) return;
      const inserts = selected.map(uid => ({ conversation_id: convId, user_id: uid, role: 'member' }));
      const { error: e3 } = await sb.from(T_PART).insert(inserts);
      if (e3) { console.error('[chat] add members failed', e3); return; }
      closeGroupModal();
      await renderParticipants(convId);
    }
  }

  // ---- Realtime bootstrap ----
  function subscribePresence() {
    // Nothing here yet; per-conversation subscription happens in subscribeMessages()
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);
})();
