/* 
  scripts/feed.js — Friend-aware feed with optimistic posts (RLS-first, FINAL)
  ----------------------------------------------------------------------------
  WHAT THIS DOES
  - Loads posts you’re allowed to see via RLS (your own + accepted friends).
  - No “friends” query gymnastics: RLS/SQL handles visibility.
  - Composer binds to: #post-text, #post-image-url, #post-submit  (no visibility field).
  - Optimistically prepends your new post, then refreshes from the DB.
  - Uses the one Supabase client exposed globally as window.__sb.
  - Subscribes to realtime INSERT/UPDATE/DELETE on posts and refreshes on change.

  YOUR SCHEMA
  - public.posts(author_id uuid, text text, image_url text, visibility text, created_at timestamptz)
  - profiles: PK user_id; avatar column is 'profile_pic' (object key in 'avatars' bucket)
*/

(function (sb) {
  if (!sb) { console.error('[feed] Supabase client missing (window.__sb)'); return; }

  const CFG = window.PINGED_CONFIG || {};
  const POSTS = CFG.TABLES?.POSTS || 'posts';
  const PROFILES = CFG.TABLES?.PROFILES || 'profiles';
  const AVATAR_COL = CFG?.PROFILE?.AVATAR_COLUMN || 'profile_pic';

  // ---- DOM elements ---------------------------------------------------------
  const feedList = document.getElementById('feed-list');
  const emptyMsg = document.getElementById('feed-empty');
  const txtEl    = document.getElementById('post-text');
  const imgEl    = document.getElementById('post-image-url');
  const btnPost  = document.getElementById('post-submit');

  // ---- helpers --------------------------------------------------------------
  const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

  async function ensureUser(maxMs = 4000) {
    if (window.__loadUser instanceof Promise) {
      await Promise.race([window.__loadUser, sleep(maxMs)]);
      if (window.__currentUser) return window.__currentUser;
    }
    const { data: { session } } = await sb.auth.getSession();
    return session?.user ?? null;
  }

  function setEmpty(text) {
    if (!emptyMsg) return;
    emptyMsg.textContent = text || '';
    emptyMsg.classList.toggle('hidden', !text);
  }

  function avatarUrlFromKey(key) {
    if (!key) return 'assets/avatar-default.png';
    return `${CFG.SUPABASE_URL}/storage/v1/object/public/avatars/${encodeURIComponent(key)}`;
  }

  function postCard(row, author) {
    const name = author?.display_name || author?.username || 'someone';
    const avatarKey = author?.[AVATAR_COL] || null;
    const avatar = avatarUrlFromKey(avatarKey);
    const when = row.created_at ? new Date(row.created_at).toLocaleString() : '';

    const el = document.createElement('article');
    el.className = 'card';
    el.style.border = '1px solid #1f1f1f';
    el.style.borderRadius = '10px';
    el.style.padding = '12px';
    el.style.margin = '10px 0';

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.gap = '10px';
    head.style.alignItems = 'center';
    head.style.marginBottom = '8px';
    head.innerHTML = `
      <img src="${avatar}" alt="${name} avatar" style="width:32px;height:32px;border-radius:50%;object-fit:cover" referrerpolicy="no-referrer">
      <div><strong>${name}</strong> <span class="muted">• ${when}</span></div>
    `;

    const body = document.createElement('p');
    body.innerHTML = (row.text || '').trim().replace(/\n/g, '<br>');

    el.appendChild(head);
    el.appendChild(body);

    if (row.image_url) {
      const img = document.createElement('img');
      img.src = row.image_url;
      img.alt = 'attachment';
      img.loading = 'lazy';
      img.style.maxWidth = '100%';
      img.style.borderRadius = '8px';
      img.style.marginTop = '8px';
      el.appendChild(img);
    }
    return el;
  }

  async function fetchAuthorMap(authorIds) {
    if (!authorIds.length) return {};
    const { data, error, status } = await sb
      .from(PROFILES)
      .select(`user_id, username, display_name, ${AVATAR_COL}`)
      .in('user_id', authorIds);
    if (error) {
      console.warn('[feed] fetch profiles failed:', status, error.message);
      return Object.fromEntries(authorIds.map(id => [id, { username: id.slice(0, 8) }]));
    }
    const map = {};
    (data || []).forEach(p => { map[p.user_id] = p; });
    return map;
  }

  // ---- main ops -------------------------------------------------------------
  async function loadFeed() {
    const user = await ensureUser();
    if (!user) {
      setEmpty('Please sign in to view your feed.');
      feedList && (feedList.innerHTML = '');
      return;
    }
    if (!feedList) { console.warn('[feed] #feed-list not found'); return; }

    setEmpty('Loading…');

    // RLS should return: your own + friends’ posts (and not blocked)
    const { data, error, status } = await sb
      .from(POSTS)
      .select('id, author_id, text, image_url, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[feed] select posts:', status, error.message);
      setEmpty(error.message || 'Could not load feed.');
      return;
    }

    if (!data?.length) {
      feedList.innerHTML = '';
      setEmpty('No posts yet. Be the first to share something!');
      return;
    }
    setEmpty('');

    // hydrate authors
    const authorIds = Array.from(new Set(data.map(r => r.author_id).filter(Boolean)));
    const authors = await fetchAuthorMap(authorIds);

    // render
    feedList.innerHTML = '';
    data.forEach(row => {
      const card = postCard(row, authors[row.author_id]);
      feedList.appendChild(card);
    });
  }

  async function addPost() {
    const me = await ensureUser();
    if (!me) return alert('Please sign in to post.');

    const text = (txtEl?.value || '').trim();
    const image_url = (imgEl?.value || '').trim() || null;
    if (!text && !image_url) return alert('Write something or add an image URL.');

    // optimistic UI
    const optimistic = {
      id: 'optimistic-' + Date.now(),
      author_id: me.id,
      text, image_url,
      created_at: new Date().toISOString()
    };
    if (feedList) {
      const card = postCard(optimistic, { username: 'You', [AVATAR_COL]: null });
      feedList.prepend(card);
      setEmpty('');
    }

    // persist
    const { error, status } = await sb
      .from(POSTS)
      .insert({ author_id: me.id, text, image_url, visibility: 'friends' });

    if (error) {
      console.error('[feed] insert post:', status, error.message);
      alert(error.message || 'Could not publish post.');
      await loadFeed(); // reconcile optimistic
      return;
    }

    // clear inputs & refresh authoritatively
    if (txtEl) txtEl.value = '';
    if (imgEl) imgEl.value = '';
    await loadFeed();
  }

  function bindComposer() {
    if (!btnPost) return;
    btnPost.addEventListener('click', (e) => { e.preventDefault(); addPost(); });
  }

  function subscribeRealtime() {
    try {
      sb.channel('posts-stream')
        .on('postgres_changes', { event: '*', schema: 'public', table: POSTS }, () => loadFeed())
        .subscribe((status) => console.log('[feed] realtime status:', status));
    } catch (e) {
      console.warn('[feed] realtime subscribe failed:', e?.message || e);
    }
  }

  // ---- boot ----------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    await ensureUser();
    bindComposer();
    await loadFeed();
    subscribeRealtime();

    sb.auth.onAuthStateChange((_evt, session) => {
      if (!session?.user) {
        if (feedList) feedList.innerHTML = '';
        setEmpty('Please sign in to view your feed.');
      } else {
        loadFeed();
      }
    });
  });

})(window.__sb);
