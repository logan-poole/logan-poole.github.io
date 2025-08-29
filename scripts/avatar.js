/* scripts/avatar.js
   PURPOSE
   - Let a signed-in user set/change/remove their profile picture.
   - Stores files at: avatars/${user.id}/avatar_<timestamp>.<ext>
   - Updates public.profiles.avatar_url with a public URL.
   NOTES
   - Free plan global per-file cap is 50MB; we also enforce a 5MB client limit for avatars.
   - If you ever change the bucket to private, swap getPublicUrl → createSignedUrl.
*/
(function () {
  const sb = (typeof window.getSB === 'function' ? window.getSB() : window.__sb);
  if (!sb) { console.warn('[avatar] Supabase client missing'); return; }

  const $ = (s,r=document)=>r.querySelector(s);
  const input   = $('#avatar-input');
  const btnSave = $('#avatar-save');
  const btnRem  = $('#avatar-remove');
  const img     = $('#avatar-preview');
  const msgEl   = $('#avatar-msg');

  function say(t, ok=false) {
    if (!msgEl) return;
    msgEl.textContent = t || '';
    msgEl.style.color = ok ? '#9effb4' : '#ff9ea1';
    msgEl.hidden = !t;
    window.pingedUI?.showToast?.(t);
  }

  function fileOk(file) {
    if (!file) { say('Choose an image to upload.'); return false; }
    const okType = /image\/(png|jpe?g|webp)/i.test(file.type);
    if (!okType) { say('Please pick a PNG, JPG, or WebP.'); return false; }
    if (file.size > 5 * 1024 * 1024) { say('Please keep avatar under 5 MB.'); return false; }
    return true;
  }

  function extOf(file) {
    const m = (file.name || '').toLowerCase().match(/\.(png|jpe?g|webp)$/);
    return m ? m[1].replace('jpeg','jpg') : 'png';
  }

  async function getMe() {
    const { data: { session } } = await sb.auth.getSession();
    return session?.user || null;
  }

  async function loadCurrent() {
    const me = await getMe(); if (!me) return;
    const { data, error } = await sb
      .from('profiles')
      .select('avatar_url')
      .eq('user_id', me.id)
      .maybeSingle();
    if (!error && data?.avatar_url) {
      img && (img.src = data.avatar_url);
    }
  }

  async function uploadAvatar() {
    const me = await getMe();
    if (!me) return say('Please sign in.');

    const file = input?.files?.[0];
    if (!fileOk(file)) return;

    // path: <uid>/avatar_<ts>.<ext>
    const path = `${me.id}/avatar_${Date.now()}.${extOf(file)}`;
    const store = sb.storage.from('avatars');

    btnSave && (btnSave.disabled = true); say('Uploading…');
    try {
      // Upload (upsert = true to overwrite same path if user clicks fast)
      const { error: upErr } = await store.upload(path, file, { upsert: true, cacheControl: '3600' });
      if (upErr) throw upErr;

      // Public URL (bucket is public per our SQL)
      const { data: pub } = store.getPublicUrl(path);
      const url = pub?.publicUrl;

      // Save on profile
      const { error: dbErr } = await sb
        .from('profiles')
        .update({ avatar_url: url })
        .eq('user_id', me.id);
      if (dbErr) throw dbErr;

      // Update UI
      if (img && url) img.src = url + `#${Date.now()}`; // bust cache
      say('Avatar updated.', true);
    } catch (e) {
      console.error('[avatar] upload failed:', e);
      say(e?.message || 'Upload failed.');
    } finally {
      btnSave && (btnSave.disabled = false);
    }
  }

  async function removeAvatar() {
    const me = await getMe();
    if (!me) return say('Please sign in.');
    if (!confirm('Remove your profile picture?')) return;

    btnRem && (btnRem.disabled = true);
    try {
      const { error } = await sb
        .from('profiles')
        .update({ avatar_url: null })
        .eq('user_id', me.id);
      if (error) throw error;

      // (Optional) you could also delete old files under `${me.id}/` here
      // by listing and removing them. We keep files to avoid breaking old URLs.

      if (img) img.src = 'assets/avatar-default.png';
      if (input) input.value = '';
      say('Avatar removed.', true);
    } catch (e) {
      say(e?.message || 'Could not remove avatar.');
    } finally {
      btnRem && (btnRem.disabled = false);
    }
  }

  btnSave?.addEventListener('click', uploadAvatar);
  btnRem?.addEventListener('click', removeAvatar);

  document.addEventListener('DOMContentLoaded', loadCurrent);
  sb.auth.onAuthStateChange((_e, sess) => { if (sess?.user) loadCurrent(); });
})();
