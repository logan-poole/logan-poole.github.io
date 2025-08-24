/* scripts/auth-modals.js — closes modal on auth, leaves navigation to auth-guard */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;

  // Focus trap
  let prevFocus = null, keyHandler = null;
  function trapFocus(root) {
    prevFocus = document.activeElement;
    const focusables = $$('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])', root)
      .filter(el => !el.hasAttribute('disabled'));
    if (!focusables.length) return;
    const [first, last] = [focusables[0], focusables[focusables.length - 1]];
    keyHandler = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    root.addEventListener('keydown', keyHandler);
  }
  function releaseFocus(root) { if (keyHandler) root.removeEventListener('keydown', keyHandler); keyHandler = null; try { prevFocus?.focus?.(); } catch { } }

  function open(kind) {
    $$('.auth-modal', overlay).forEach(s => s.hidden = true);
    const el = $('#modal-' + kind, overlay); if (!el) return;
    el.hidden = false; overlay.style.display = 'block'; overlay.setAttribute('aria-hidden', 'false');
    el.querySelector('input,button,select,textarea,[tabindex]:not([tabindex="-1"])')?.focus();
    trapFocus(el);
  }
  function close() {
    try { document.activeElement?.blur?.(); } catch { }
    const el = overlay.querySelector('.auth-modal:not([hidden])') || overlay;
    releaseFocus(el);
    $$('.auth-modal', overlay).forEach(s => s.hidden = true);
    overlay.style.display = 'none'; overlay.setAttribute('aria-hidden', 'true');
  }

  document.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-auth-open]'); if (openBtn) { e.preventDefault(); open(openBtn.getAttribute('data-auth-open')); }
    if (e.target.matches('[data-auth-close]')) { e.preventDefault(); close(); }
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => { if (overlay.getAttribute('aria-hidden') === 'false' && e.key === 'Escape') close(); });

  // Password toggle
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle="pw"]'); if (!t) return;
    const input = document.getElementById(t.getAttribute('data-target')); if (!input) return;
    const showing = input.type === 'text'; input.type = showing ? 'password' : 'text';
    t.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });

  // Supabase
  const sb = (window.getSB && window.getSB()) || null;
  const siForm = $('#signin-form'), suForm = $('#signup-form');
  const siMsg = $('#si-msg'), suMsg = $('#su-msg'), suHint = $('#su-hint');

  const msg = (el, t) => { if (!el) return; el.textContent = t || ''; el.hidden = !t; };

  // Close modal when any valid session exists; let auth-guard decide navigation.
  if (sb) {
    sb.auth.onAuthStateChange((_evt, session) => {
      if (session?.user) close();
    });
  }

  // Sign in
  siForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sb) return msg(siMsg, 'Auth is not configured.');
    const email = $('#si-email')?.value?.trim() || '';
    const password = $('#si-password')?.value || '';
    if (!email || !password) return msg(siMsg, 'Enter email and password.');
    const btn = $('#si-btn'); if (btn) btn.disabled = true; msg(siMsg, '');
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        if (String(error.message || '').toLowerCase().includes('confirm')) return msg(siMsg, 'Please confirm your email first (check your inbox).');
        return msg(siMsg, error.message || 'Sign in failed.');
      }
      // Navigation handled by auth-guard on SIGNED_IN
    } catch (err) { msg(siMsg, err?.message || 'Something went wrong.'); }
    finally { if (btn) btn.disabled = false; }
  });

  // Sign up
  suForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sb) return msg(suMsg, 'Auth is not configured.');
    const email = $('#su-email')?.value?.trim() || '';
    const password = $('#su-password')?.value || '';
    if (!email || !password) return msg(suMsg, 'Enter email and password.');
    if (password.length < 6) return msg(suMsg, 'Password must be at least 6 characters.');
    const btn = $('#su-btn'); if (btn) btn.disabled = true; msg(suMsg, ''); if (suHint) suHint.textContent = '';
    try {
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { emailRedirectTo: location.origin + '/dashboard.html' }
      });
      if (error) return msg(suMsg, error.message || 'Sign up failed.');
      if (data?.user?.identities?.length === 0) return msg(suMsg, 'That email is already registered.');
      if (suHint) suHint.textContent = 'Check your email to confirm your account. After confirming, you\'ll be taken to your dashboard.';
      $('#su-resend')?.removeAttribute('hidden');
    } catch (err) { msg(suMsg, err?.message || 'Something went wrong.'); }
    finally { if (btn) btn.disabled = false; }
  });

  // Magic link
  $('#si-magic')?.addEventListener('click', async () => {
    if (!sb) return msg(siMsg, 'Auth is not configured.');
    const email = $('#si-email')?.value?.trim() || '';
    if (!email) return msg(siMsg, 'Enter your email first.');
    msg(siMsg, '');
    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + '/dashboard.html' }
      });
      if (error) return msg(siMsg, error.message || 'Could not send magic link.');
      msg(siMsg, 'Magic link sent. Check your email.');
    } catch (e) { msg(siMsg, e?.message || 'Could not send magic link.'); }
  });

  // Resend verification
  $('#su-resend')?.addEventListener('click', async () => {
    if (!sb) return msg(suMsg, 'Auth is not configured.');
    const email = $('#su-email')?.value?.trim() || '';
    if (!email) return msg(suMsg, 'Enter your email first.');
    msg(suMsg, '');
    try {
      const { error } = await sb.auth.resend({ type: 'signup', email });
      if (error) return msg(suMsg, error.message || 'Could not resend email.');
      msg(suMsg, 'Verification email sent. Check your inbox.');
    } catch (e) { msg(suMsg, e?.message || 'Could not resend email.'); }
  });

  // Forgot password
  $('#si-forgot')?.addEventListener('click', async () => {
    if (!sb) return msg(siMsg, 'Auth is not configured.');
    const email = $('#si-email')?.value?.trim() || '';
    if (!email) return msg(siMsg, 'Enter your email first.');
    msg(siMsg, '');
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + '/dashboard.html'
      });
      if (error) return msg(siMsg, error.message || 'Could not send reset link.');
      msg(siMsg, 'Reset link sent. Check your email.');
    } catch (e) { msg(siMsg, e?.message || 'Could not send reset link.'); }
  });

  // Expose programmatic open/close
  window.AuthModals = {
    open, close,
    rememberNext() { try { localStorage.setItem('pinged_return_to', location.pathname + location.search + location.hash); } catch { } }
  };
})();
