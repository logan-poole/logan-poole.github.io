/* Feed image upload helper (Supabase Storage)
 * - Click 📎 to choose an image.
 * - Shows an upload strip with indeterminate progress.
 * - On success, fills #post-image-url with the public URL.
 */
(function () {
  const $ = (s) => document.querySelector(s);

  const fileInput = $('#post-file');
  const uploadBtn = $('#post-upload-btn');
  const urlInput  = $('#post-image-url');
  const strip     = $('#post-upload-strip');
  const nameEl    = strip?.querySelector('.file-chip .name');
  const bar       = strip?.querySelector('.progress .bar');
  const msgEl     = $('#post-upload-msg');
  const removeBtn = $('#post-remove-file');
  const submitBtn = $('#post-submit');

  const CFG = window.PINGED_CONFIG || {};
  const BUCKET = (CFG.STORAGE && CFG.STORAGE.BUCKET) || 'chat'; // reuse same bucket as chat

  function getSB() {
    if (typeof window.getSB === 'function') return window.getSB();
    if (window.__sb && window.__sb.auth)   return window.__sb;
    if (window.supabase && window.supabase.auth) return window.supabase;
    return null;
  }

  function slugify(name) {
    return String(name)
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9._-]/g, '');
  }

  function showStrip(fileName, uploading = true, text = '') {
    if (!strip) return;
    if (nameEl) nameEl.textContent = fileName || '';
    strip.style.display = 'grid';
    strip.classList.toggle('is-uploading', !!uploading);
    if (bar) bar.style.width = uploading ? '0%' : '100%';
    if (msgEl) msgEl.textContent = text || (uploading ? 'Uploading…' : 'Uploaded');
    submitBtn && (submitBtn.disabled = !!uploading);
  }

  function hideStrip() {
    if (!strip) return;
    strip.style.display = 'none';
    strip.classList.remove('is-uploading');
    if (bar) bar.style.width = '0%';
    if (msgEl) msgEl.textContent = '';
    submitBtn && (submitBtn.disabled = false);
  }

  async function uploadFile(file) {
    const sb = getSB();
    if (!sb || !file) return;

    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const path = `feed/${user.id}/${Date.now()}-${slugify(file.name)}`;

      showStrip(file.name, true, 'Uploading…');

      // Supabase Storage upload (indeterminate progress)
      const { error } = await sb.storage.from(BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream'
      });
      if (error) throw error;

      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
      if (!pub?.publicUrl) throw new Error('No public URL returned');

      urlInput.value = pub.publicUrl;
      showStrip(file.name, false, 'Uploaded');

    } catch (e) {
      console.error('[feed-upload] upload error:', e);
      showStrip('Upload failed', false, e.message || 'Upload failed');
      setTimeout(hideStrip, 3000);
    } finally {
      fileInput.value = ''; // reset chooser
      submitBtn && (submitBtn.disabled = false);
    }
  }

  // Events
  uploadBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    showStrip(file.name, true, 'Uploading…');
    uploadFile(file);
  });

  removeBtn?.addEventListener('click', () => {
    urlInput.value = '';
    hideStrip();
  });
})();
