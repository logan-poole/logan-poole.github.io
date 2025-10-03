/* Author: Logan Poole — 30083609
   FILE: /scripts/feed.js — Upload to Supabase Storage + posts insert
   - Keeps image_url on fallback inserts
   - Tries (with visibility) → (without visibility) → (no image_url column; put URL in body)
   - Normalizes profile avatar storage keys to public URLs
*/
(function () {
  'use strict';

  const $ = (s,r=document)=>r.querySelector(s);

  const feedList = $('#feed-list');
  const emptyEl  = $('#feed-empty');

  const form     = $('#post-form');
  const textEl   = $('#post-text');          // -> posts.body
  const fileEl   = $('#post-image-file');    // -> Supabase Storage upload
  const urlEl    = $('#post-image-url');     // -> posts.image_url (manual)
  const visEl    = $('#post-visibility');    // -> posts.visibility (if exists)
  const statusEl = $('#upload-status');
  const submitEl = $('#post-submit');

  const modal    = $('#imgModal');
  const modalImg = $('#imgModalImg');
  const modalCap = $('#imgCaption');
  const modalClose = $('#imgClose');

  const CFG   = window.PINGED_CONFIG || {};
  const T     = Object.assign({ POSTS:'posts', PROFILES:'profiles' }, (CFG.TABLES||{}));
  const AVATAR_COL = (CFG.PROFILE && CFG.PROFILE.AVATAR_COLUMN) || 'avatar_url';
  const NAME_KEYS  = (CFG.PROFILE && CFG.PROFILE.DISPLAY_NAME_KEYS) || ['display_name','username'];
  const AVATAR_BUCKET = CFG.AVATAR_BUCKET || CFG.STORAGE_BUCKET_AVATARS || 'avatars';
  const BUCKET = CFG.STORAGE_BUCKET_POSTS || CFG.STORAGE_BUCKET || 'post-images';

  // ---------- helpers ----------
  function getSBish() {
    if (typeof window.getSB === 'function') return window.getSB();
    if (window.__sb && window.__sb.auth) return window.__sb;
    if (window.supabase && window.supabase.auth) return window.supabase;
    return null;
  }

  const labelOf = (p={}) => {
    for (const k of NAME_KEYS) if (p[k]) return String(p[k]);
    return p.username || p.display_name || p.full_name || p.email || p.id || 'User';
  };

  function normalizeAvatarUrl(urlOrKey) {
    if (!urlOrKey) return null;
    const s = String(urlOrKey);
    if (/^https?:\/\//i.test(s)) return s;
    try {
      const sb = getSBish();
      const { data } = sb.storage.from(AVATAR_BUCKET).getPublicUrl(s);
      return data?.publicUrl || null;
    } catch { return null; }
  }

  const avatarOf = (p={}) =>
    normalizeAvatarUrl(p[AVATAR_COL] || p.avatar_url) ||
    p[AVATAR_COL] || p.avatar_url || 'assets/avatar.png';

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }
  function setBusy(b) { if (submitEl) submitEl.disabled = !!b; if (form) form.style.opacity = b ? .7 : 1; }

  function openModal(src, caption='') {
    if (!modal || !modalImg) return;
    modalImg.src = src || '';
    if (modalCap) modalCap.textContent = caption || '';
    modal.showModal ? modal.showModal() : (modal.open = true);
  }
  function closeModal() { if (modal) (modal.close ? modal.close() : (modal.open=false)); }
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  if (modalClose) modalClose.addEventListener('click', closeModal);

  const IMG_RX = /\bhttps?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:\?\S+)?/i;
  function pickImageFromBody(body='') { const m = String(body).match(IMG_RX); return m ? m[0] : null; }

  // ---------- Storage upload ----------
  async function uploadSelectedFile(userId) {
    const f = fileEl?.files?.[0];
    if (!f) return null;
    if (!/^image\//i.test(f.type)) throw new Error('Please choose an image file.');
    if (f.size > 8 * 1024 * 1024) throw new Error('Image is too large (max 8 MB).');

    const sb = getSBish();
    if (!sb?.storage) throw new Error('Storage client not ready.');

    const key = `${userId}/${new Date().toISOString().slice(0,10)}/${uuid()}-${(f.name||'upload').replace(/[^\w.\-]+/g,'_')}`;
    setStatus('Uploading image…');
    const { error: upErr } = await sb.storage.from(BUCKET).upload(key, f, {
      cacheControl: '3600', contentType: f.type, upsert: false
    });
    if (upErr) {
      if (String(upErr.message || '').toLowerCase().includes('not found')) {
        throw new Error(`Storage bucket "${BUCKET}" not found. Create it in Supabase Storage and allow public read.`);
      }
      throw upErr;
    }
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(key);
    if (!pub?.publicUrl) throw new Error('Could not get public URL for uploaded image.');
    return pub.publicUrl;
  }

  // ---------- Load & render feed ----------
  async function loadFeed() {
    let posts = [];
    try {
      posts = await sbRest.from(T.POSTS)
        .select('id,author_id,body,image_url,visibility,created_at')
        .order('created_at','desc').limit(50);
    } catch {
      posts = await sbRest.from(T.POSTS)
        .select('id,author_id,body,created_at')
        .order('created_at','desc').limit(50);
    }

    const ids = Array.from(new Set(posts.map(p => p.author_id).filter(Boolean)));
    let profiles = [];
    if (ids.length) {
      const inCsv = ids.map(id => `"${id}"`).join(',');
      profiles = await sbRest.from(T.PROFILES)
        .select(`id,username,${AVATAR_COL},${NAME_KEYS.join(',')}`)
        .in('id', inCsv);
    }
    const byId = new Map(profiles.map(p => [p.id, p]));
    renderFeed(posts, byId);
  }

  function renderFeed(posts, profilesById) {
    if (!feedList) return;
    feedList.innerHTML = '';
    let count = 0;

    for (const post of posts) {
      const author = profilesById.get(post.author_id) || {};
      const name = labelOf(author);
      const body = post.body || '';
      const imgUrl = (post.image_url) || pickImageFromBody(body);

      const li = document.createElement('li');
      li.className = 'feed-item';
      li.innerHTML = `
        <div class="header">
          <img class="avatar" src="${avatarOf(author)}" alt="">
          <div class="who">
            <div class="name">${name}</div>
            <div class="sub">@${author.username || post.author_id}</div>
          </div>
          <time class="ts">${new Date(post.created_at).toLocaleString()}</time>
        </div>
        <div class="body">
          <p class="text"></p>
          ${imgUrl ? `<img class="photo" src="${imgUrl}" alt="">` : ''}
        </div>
        ${'visibility' in post ? `<div class="meta"><span class="visibility">${post.visibility || 'public'}</span></div>` : ''}`;

      const textNode = li.querySelector('.text');
      if (textNode) {
        const cleaned = (imgUrl && !post.image_url) ? body.replace(imgUrl, '').trim() : body;
        textNode.textContent = cleaned;
      }

      const img = li.querySelector('.photo');
      if (img) img.addEventListener('click', () => openModal(imgUrl, name));

      feedList.appendChild(li);
      count++;
    }
    if (emptyEl) emptyEl.hidden = count !== 0;
  }

  // ---------- Submit ----------
  function looksLikeMissingCol(errMsg, col) {
    const m = String(errMsg || '').toLowerCase();
    return m.includes(`column "${col?.toLowerCase?.()}" does not exist`) ||
           m.includes(`unknown column`) ||
           m.includes(`cannot find column`) ||
           m.includes(`${col?.toLowerCase?.()} does not exist`);
  }
  function looksLikeBadEnum(errMsg, col) {
    const m = String(errMsg || '').toLowerCase();
    return m.includes('invalid input value for enum') || m.includes(`${col?.toLowerCase?.()}`) && m.includes('is not present');
  }

  async function safeInsertPost(baseRow, imageUrl, visibility) {
    // Try 1: with image_url + visibility (if provided)
    try {
      await sbRest.insert(T.POSTS, { ...baseRow, image_url: imageUrl ?? null, ...(visibility ? { visibility } : {}) });
      return { mode: 'full' };
    } catch (e1) {
      const msg1 = e1?.message || e1;
      // Try 2: if visibility is bad or column missing, retry WITH image_url but WITHOUT visibility
      if (visibility && (looksLikeBadEnum(msg1, 'visibility') || looksLikeMissingCol(msg1, 'visibility'))) {
        await sbRest.insert(T.POSTS, { ...baseRow, image_url: imageUrl ?? null });
        return { mode: 'no-visibility' };
      }
      // Try 3: if image_url column is missing, embed URL into body instead
      if (imageUrl && looksLikeMissingCol(msg1, 'image_url')) {
        const combined = [baseRow.body || '', imageUrl].filter(Boolean).join('\n');
        await sbRest.insert(T.POSTS, { ...baseRow, body: combined });
        return { mode: 'no-image-column-embedded' };
      }
      // Final fallback
      await sbRest.insert(T.POSTS, baseRow);
      return { mode: 'fallback-text-only' };
    }
  }

  async function handlePostSubmit(e) {
    e.preventDefault();
    setStatus('');
    const me = (window.sbUser || {});
    if (!me?.id) { setStatus('Please sign in.'); return; }

    const bodyText = (textEl?.value || '').trim();
    const urlText  = (urlEl?.value  || '').trim();

    if (!bodyText && !urlText && !(fileEl?.files?.length)) {
      setStatus('Write something or add an image.');
      return;
    }

    try {
      setBusy(true);

      // Upload if needed
      let finalImageUrl = null;
      if (fileEl?.files?.length)       finalImageUrl = await uploadSelectedFile(me.id);
      else if (urlText)                finalImageUrl = urlText;

      const vis = (visEl?.value || '').trim();
      const baseRow = { author_id: me.id, body: bodyText || null };

      await safeInsertPost(baseRow, finalImageUrl, vis);

      // reset & reload
      if (textEl) textEl.value = '';
      if (urlEl)  urlEl.value  = '';
      if (fileEl) fileEl.value = '';
      if (visEl)  visEl.value  = 'public';
      setStatus('');
      await loadFeed();
    } catch (err) {
      console.error(err);
      setStatus(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function boot() {
    try { if (window.guardRequireAuth) await window.guardRequireAuth({ redirectTo: (CFG.ROUTES && CFG.ROUTES.LOGIN) || 'index.html' }); }
    catch { return; }
    if (form) form.addEventListener('submit', handlePostSubmit);
    await loadFeed();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
