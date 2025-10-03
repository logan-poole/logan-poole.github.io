/* Author: Logan Poole — 30083609
   FILE: /scripts/profile-bootstrap.js
   Purpose: Load current user's profile, hydrate navbar, toggle admin UI, normalize avatar URL */
(function () {
  'use strict';

  const $ = (s,r=document)=>r.querySelector(s);
  const CFG = window.PINGED_CONFIG || {};
  const T = Object.assign({ PROFILES:'profiles' }, (CFG.TABLES||{}));
  const NAME_KEYS  = (CFG.PROFILE && CFG.PROFILE.DISPLAY_NAME_KEYS) || ['display_name','username'];
  const AVATAR_COL = (CFG.PROFILE && CFG.PROFILE.AVATAR_COLUMN)      || 'avatar_url';
  const AVATAR_BUCKET = CFG.AVATAR_BUCKET || CFG.STORAGE_BUCKET_AVATARS || 'avatars';

  const navNameEl  = $('.nav-name') || $('#nav-name');
  const avatarImg  = $('.avatar-sm') || $('#nav-avatar');

  function labelOf(p = {}) {
    for (const k of NAME_KEYS) if (p[k]) return String(p[k]);
    return p.username || p.full_name || p.email || p.id || 'User';
  }

  function normalizeAvatarUrl(urlOrKey) {
    if (!urlOrKey) return null;
    const s = String(urlOrKey);
    if (/^https?:\/\//i.test(s)) return s;
    try {
      const sb = (typeof window.getSB === 'function') ? window.getSB() : null;
      const { data } = sb.storage.from(AVATAR_BUCKET).getPublicUrl(s);
      return data?.publicUrl || null;
    } catch { return null; }
  }

  function showAdminUI(isAdmin) {
    const adminEls = document.querySelectorAll('[data-admin], #nav-admin');
    adminEls.forEach(el => { el.hidden = !isAdmin; el.style.display = isAdmin ? '' : el.style.display; });
    if (isAdmin) document.body.setAttribute('data-role', 'admin');
  }

  function cacheKey(uid){ return `pinged.profile.${uid}`; }

  async function getProfile(uid) {
    try {
      const raw = localStorage.getItem(cacheKey(uid));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.__ts && (Date.now() - parsed.__ts) < 120000) return parsed;
      }
    } catch {}
    const rows = await sbRest.from(T.PROFILES)
      .select(`id,username,${NAME_KEYS.join(',')},${AVATAR_COL},role,is_admin,full_name,email`)
      .eq('id', uid)
      .limit(1);
    const prof = rows && rows[0] ? rows[0] : { id: uid };
    try { localStorage.setItem(cacheKey(uid), JSON.stringify({ ...prof, __ts: Date.now() })); } catch {}
    return prof;
  }

  async function boot() {
    // wait for sb-client to publish session
    await new Promise(res => {
      if (typeof window.sbUser !== 'undefined') return res();
      window.addEventListener('sb:ready', res, { once: true });
    });
    const uid = window.sbUser && window.sbUser.id;
    if (!uid) return;

    const me = await getProfile(uid);
    window.meProfile = me;

    const display = labelOf(me);
    const rawAvatar = me[AVATAR_COL] || (window.sbUser?.user_metadata?.avatar_url) || null;
    const finalAvatar = normalizeAvatarUrl(rawAvatar) || rawAvatar;

    if (navNameEl) navNameEl.textContent = display;
    if (avatarImg && finalAvatar) avatarImg.src = finalAvatar;

    const isAdmin = !!(me.is_admin || (me.role && String(me.role).toLowerCase() === 'admin'));
    showAdminUI(isAdmin);

    window.dispatchEvent(new CustomEvent('profile:ready', { detail: { profile: me }}));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
