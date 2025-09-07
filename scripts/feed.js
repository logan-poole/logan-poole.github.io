/* 
  scripts/feed.js — Friend-aware feed with optimistic posts (RLS-first, FINAL)
  ----------------------------------------------------------------------------
  WHAT THIS DOES
  - Loads posts you’re allowed to see via RLS (your own + accepted friends).
  - Composer binds to: #post-text, #post-image-url, #post-submit.
  - Optimistically prepends your new post, then refreshes from the DB.
  - Subscribes to realtime INSERT/UPDATE/DELETE on posts and refreshes on change.

  YOUR SCHEMA (expected)
  - public.posts(author_id uuid, text text, image_url text, visibility text, created_at timestamptz default now())
  - public.profiles(user_id uuid PK, username text, display_name text, profile_pic text, ...)
  - RLS policy should allow: post owner, and accepted friends can SELECT when visibility in ('friends','public')
*/

(function () {
  const sb = (typeof window.getSB === 'function' ? window.getSB() : window.__sb);
  if (!sb) { console.error('[feed] Supabase client missing'); return; }

  const { PROFILE, TABLES } = window.PINGED_CONFIG || window.PINGED || {};
  const PROFILES = (TABLES && TABLES.PROFILES) || 'profiles';
  const POSTS = (TABLES && TABLES.POSTS) || 'posts';
  const AVATAR_COL = (PROFILE && PROFILE.AVATAR_COLUMN) || 'profile_pic';

  const form = document.getElementById('post-form');
  const textEl = document.getElementById('post-text');
  const imgEl = document.getElementById('post-image-url');
  const feedList = document.getElementById('feed-list');
  const emptyEl = document.getElementById('feed-empty');

  function setEmpty(msg) {
    if (!emptyEl) return;
    emptyEl.textContent = msg || '';
    emptyEl.style.display = msg ? 'block' : 'none';
  }

  function avatarUrlFromProfile(p) {
    // If using Storage + RLS: you might resolve signed URL here instead.
    // For now we simply treat AVATAR_COL as a public URL or object key resolved server-side.
    return p && p[AVATAR_COL] ? p[AVATAR_COL] : null;
  }

  function authorLabel(p) {
    if (!p) return 'Unknown';
    if (p.display_name) return p.display_name;
    if (p.username) return '@' + p.username;
    return 'User';
  }

  function postCard(post, author) {
    const el = document.createElement('div');
    el.className = 'post';
    const meta = document.createElement('div');
    meta.className = 'post-meta';

    const img = document.createElement('img');
    img.alt = 'avatar';
    img.referrerPolicy = 'no-referrer';
    img.src = avatarUrlFromProfile(author) || 'assets/icons/profile.png';
    img.width = 36; img.height = 36; img.style.borderRadius = '50%';
    img.loading = 'lazy';

    const name = document.createElement('div');
    name.className = 'post-author';
    name.textContent = authorLabel(author);

    const time = document.createElement('time');
    time.className = 'post-time';
    time.dateTime = post.created_at;
    time.textContent = new Date(post.created_at).toLocaleString();

    meta.append(img, name, time);

    const body = document.createElement('div');
    body.className = 'post-body';
    if (post.text) {
      const p = document.createElement('p');
      p.textContent = post.text;
      body.appendChild(p);
    }
    if (post.image_url) {
      const photo = document.createElement('img');
      photo.src = post.image_url;
      photo.alt = '';
      photo.loading = 'lazy';
      photo.style.maxWidth = '100%';
      photo.style.borderRadius = '8px';
      photo.style.marginTop = '8px';
      body.appendChild(photo);
    }

    el.append(meta, body);
    return el;
  }

  async function fetchAuthorMap(authorIds) {
    if (!authorIds.length) return {};
    const { data, error } = await sb
      .from(PROFILES)
      .select(`user_id, username, display_name, ${AVATAR_COL}`)
      .in('user_id', authorIds);
    if (error) { console.error('[feed] profiles error', error); return {}; }
    const m = {};
    (data || []).forEach(p => { m[p.user_id] = p; });
    return m;
  }

  async function loadFeed() {
    const { data: me } = await sb.auth.getUser();
    if (!me?.user) {
      setEmpty('Please sign in to view your feed.');
      if (feedList) feedList.innerHTML = '';
      return;
    }

    const { data, error } = await sb
      .from(POSTS)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[feed] load posts error', error);
      setEmpty('Could not load posts.');
      return;
    }

    if (!data || data.length === 0) {
      if (feedList) feedList.innerHTML = '';
      setEmpty('No posts yet. Say hi!');
      return;
    }

    // hydrate authors
    const ids = [...new Set(data.map(p => p.author_id).filter(Boolean))];
    const authorMap = await fetchAuthorMap(ids);

    if (feedList) {
      feedList.innerHTML = '';
      data.forEach(post => feedList.appendChild(postCard(post, authorMap[post.author_id])));
      setEmpty('');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const { data: meRes } = await sb.auth.getUser();
    const me = meRes?.user;
    if (!me) return alert('Please sign in.');

    const text = (textEl?.value || '').trim();
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
      // Minimal author card as "You"
      feedList.prepend(postCard(optimistic, { username: 'you', display_name: 'You', [AVATAR_COL]: null }));
      setEmpty('');
    }

    const { error } = await sb.from(POSTS).insert({
      author_id: me.id,
      text, image_url,
      visibility: 'friends'    // adjust if you prefer default 'public'
    });
    if (error) {
      console.error('[feed] insert error', error);
      alert('Could not post. Check RLS or connection.');
    }

    // Reset + reload from DB to replace optimistic entry
    if (textEl) textEl.value = '';
    if (imgEl) imgEl.value = '';
    await loadFeed();
  }

  function subscribeRealtime() {
    // Listen to all post changes affecting your RLS view
    const ch = sb.channel('feed-posts')
      .on('postgres_changes', { event: '*', schema: 'public', table: POSTS }, () => {
        // simple strategy: reload the feed on any change
        loadFeed();
      })
      .subscribe();
    // No cleanup here because page is single-purpose; on SPA you’d keep a ref to unsubscribe.
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (form) form.addEventListener('submit', handleSubmit);
    loadFeed();
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

})();
