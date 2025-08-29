/* 
  scripts/auth-modals.js — robust overlay + email-only checks + signup avatar hook (UPDATED FINAL)
  -----------------------------------------------------------------------------------------------
  WHAT CHANGED
  1) Sign-up confirmation targets /verify.html so users land on your verify page.
  2) Email-only validation on Sign In / Magic Link / Reset / Resend (prevents username mistakes).
  3) Clear Supabase error messages + automatic fallback WITHOUT redirect if allowlist blocks it.
  4) After SIGNED_IN, if a file was chosen in #su-avatar, we upload it to `avatars/uid/...` and update profiles.avatar_url.
  5) No navigation logic here — auth-guard handles redirects predictably.

  ORDER (keep):
    @supabase/js → scripts/config.js → scripts/sb-client.js → scripts/page-flags.js → scripts/auth-guard.js → scripts/auth-modals.js

  Dashboard reminders:
    - Auth → URL Configuration: set Site URL to your dev origin (e.g. http://127.0.0.1:5500)
      and include http://127.0.0.1:5500/* (and/or http://localhost:5173/*) in Redirect URLs.
*/

(function () {
  // ---------- DOM + helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function injectMsgEl(form, idFallback) {
    let el = form.querySelector('[data-auth-msg]') || (idFallback ? form.querySelector('#' + idFallback) : null);
    if (!el) {
      el = document.createElement('p');
      el.setAttribute('data-auth-msg', 'true');
      el.style.marginTop = '10px';
      el.style.color = '#ff9ea1';
      const anchor = form.querySelector('button[type="submit"]')?.parentElement || form;
      anchor.appendChild(el);
    }
    return el;
  }
  function showMsg(form, idFallback, text, good = false) {
    const el = injectMsgEl(form, idFallback);
    el.textContent = text || '';
    el.hidden = !text;
    el.style.color = good ? '#9effb4' : '#ff9ea1';
  }
  const redirectVerify = () => location.origin + '/verify.html';
  const redirectDashboard = () => location.origin + '/dashboard.html';
  const redirectReset = () => location.origin + '/reset.html';

  // ---------- focus trap ----------
  let prevFocus = null, keyHandler = null;
  function trapFocus(root) {
    prevFocus = document.activeElement;
    const f = $$('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])', root).filter(el => !el.disabled && !el.hidden);
    if (!f.length) return;
    const [first, last] = [f[0], f[f.length - 1]];
    keyHandler = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    root.addEventListener('keydown', keyHandler);
  }
  function releaseFocus(root) {
    if (keyHandler) root.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    try { prevFocus?.focus?.(); } catch { }
  }

  function open(kind) {
    $$('.auth-modal', overlay).forEach(s => s.hidden = true);
    const el = $('#modal-' + kind, overlay);
    if (!el) return;
    el.hidden = false;
    overlay.style.display = 'block';
    overlay.setAttribute('aria-hidden', 'false');
    el.querySelector('input,button,select,textarea,[tabindex]:not([tabindex="-1"])')?.focus();
    trapFocus(el);
  }
  function close() {
    try { document.activeElement?.blur?.(); } catch { }
    const el = overlay.querySelector('.auth-modal:not([hidden])') || overlay;
    releaseFocus(el);
    $$('.auth-modal', overlay).forEach(s => s.hidden = true);
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
  }

  document.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-auth-open]'); if (openBtn) { e.preventDefault(); open(openBtn.getAttribute('data-auth-open')); }
    if (e.target.matches('[data-auth-close]')) { e.preventDefault(); close(); }
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (overlay.getAttribute('aria-hidden') === 'false' && e.key === 'Escape') close();
  });

  // ---------- password reveal ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle="pw"]'); if (!t) return;
    const input = document.getElementById(t.getAttribute('data-target')); if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    t.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });

  // ---------- Supabase wiring ----------
  const sb = (typeof window.getSB === 'function' ? window.getSB() : window.__sb);
  if (sb) {
    sb.auth.onAuthStateChange(async (evt, session) => {
      if (session?.user) {
        // Attempt to upload a selected sign-up avatar now that we have a session
        try { await uploadSignupAvatarIfAny(session.user); } catch (e) { console.warn('[auth] signup avatar failed:', e?.message || e); }
        close(); // let auth-guard decide navigation
      }
    });
  }

  const siForm = $('#signin-form');
  const suForm = $('#signup-form');

  function prettyErr(e) {
    const status = e?.status ? ` [${e.status}]` : '';
    const msg = (e?.message || e?.error_description || e?.error || 'Unknown error').trim();
    return `${msg}${status}`;
  }
  function looksRedirectError(e) {
    const m = (e?.message || '').toLowerCase();
    return m.includes('redirect') || m.includes('not allowed') || m.includes('invalid url') || [400, 422, 500].includes(e?.status);
  }

  // ---------- helper: signup avatar upload ----------
  async function uploadSignupAvatarIfAny(user) {
    const file = document.getElementById('su-avatar')?.files?.[0];
    if (!file || !user) return;

    // basic checks
    if (!/image\/(png|jpe?g|webp)/i.test(file.type)) return;
    if (file.size > 5 * 1024 * 1024) return;

    const ext = (file.name || '').toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1]?.replace('jpeg', 'jpg') || 'png';
    const path = `${user.id}/avatar_${Date.now()}.${ext}`;
    const store = sb.storage.from('avatars');

    const { error: upErr } = await store.upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upErr) throw upErr;

    const { data: pub } = store.getPublicUrl(path);
    const url = pub?.publicUrl;
    if (url) {
      const { error: dbErr } = await sb.from('profiles').update({ avatar_url: url }).eq('user_id', user.id);
      if (dbErr) throw dbErr;
      // Let Settings/header know a new avatar is available
      window.dispatchEvent(new CustomEvent('pinged:profile-updated'));
    }
  }

  // ---------- Sign in (EMAIL ONLY) ----------
  siForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const say = (t, ok = false) => showMsg(siForm, 'si-msg', t, ok);
    if (!sb) return say('Auth is not configured.');
    const email = $('#si-email')?.value?.trim() || '';
    const password = $('#si-password')?.value || '';
    if (!email || !password) return say('Enter email and password.');
    if (!EMAIL_RE.test(email)) return say('Use your email address (not a username).');

    const btn = $('#si-btn'); if (btn) btn.disabled = true; say('');
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      console.warn('[auth] signInWithPassword →', { data, error });
      if (error) return say(prettyErr(error));
      // success: auth-guard handles navigation
    } catch (err) {
      console.error('[auth] signInWithPassword threw →', err);
      say(prettyErr(err));
    } finally { if (btn) btn.disabled = false; }
  });

  // ---------- Sign up → verification email to /verify.html (with redirect fallback) ----------
  suForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const say = (t, ok = false) => showMsg(suForm, 'su-msg', t, ok);
    const hint = (t) => showMsg(suForm, 'su-hint', t, true);
    if (!sb) return say('Auth is not configured.');

    const email = $('#su-email')?.value?.trim() || '';
    const password = $('#su-password')?.value || '';
    if (!email || !password) return say('Enter email and password.');
    if (!EMAIL_RE.test(email)) return say('Enter a valid email address.');
    if (password.length < 6) return say('Password must be at least 6 characters.');

    const btn = $('#su-btn'); if (btn) btn.disabled = true; say(''); hint('');
    try {
      let { data, error } = await sb.auth.signUp({
        email, password,
        options: { emailRedirectTo: redirectVerify() }
      });
      console.warn('[auth] signUp (with redirect) →', { data, error });

      if (error && looksRedirectError(error)) {
        console.warn('[auth] signUp retry WITHOUT redirect (check Auth → Redirect URLs allowlist).');
        ({ data, error } = await sb.auth.signUp({ email, password }));
        console.warn('[auth] signUp (no redirect) →', { data, error });
      }

      if (data?.user?.identities?.length === 0) return say('That email is already registered.');
      if (error) return say(prettyErr(error));

      $('#su-resend')?.removeAttribute('hidden');
      hint('Check your email to confirm your account. After confirming, you’ll be taken to your dashboard.');
      // Avatar upload will occur automatically after SIGNED_IN (post-confirm) if a file is selected.
    } catch (err) {
      console.error('[auth] signUp threw →', err);
      say(prettyErr(err));
    } finally { if (btn) btn.disabled = false; }
  });

  // ---------- Magic link (EMAIL ONLY; with redirect fallback) ----------
  $('#si-magic')?.addEventListener('click', async () => {
    const say = (t, ok = false) => showMsg(siForm, 'si-msg', t, ok);
    if (!sb) return say('Auth is not configured.');
    const email = $('#si-email')?.value?.trim() || '';
    if (!EMAIL_RE.test(email)) return say('Enter your email address (not a username).');
    say('');
    try {
      let { data, error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectDashboard() } });
      console.warn('[auth] signInWithOtp (with redirect) →', { data, error });

      if (error && looksRedirectError(error)) {
        console.warn('[auth] OTP retry WITHOUT redirect.');
        ({ data, error } = await sb.auth.signInWithOtp({ email }));
        console.warn('[auth] signInWithOtp (no redirect) →', { data, error });
      }

      if (error) return say(prettyErr(error));
      say('Magic link sent. Check your email.', true);
    } catch (e) {
      console.error('[auth] signInWithOtp threw →', e);
      say(prettyErr(e));
    }
  });

  // ---------- Resend verification ----------
  $('#su-resend')?.addEventListener('click', async () => {
    const say = (t, ok = false) => showMsg(suForm, 'su-msg', t, ok);
    if (!sb) return say('Auth is not configured.');
    const email = $('#su-email')?.value?.trim() || '';
    if (!EMAIL_RE.test(email)) return say('Enter a valid email address.');
    say('');
    try {
      const { data, error } = await sb.auth.resend({ type: 'signup', email });
      console.warn('[auth] resend →', { data, error });
      if (error) return say(prettyErr(error));
      say('Verification email sent. Check your inbox.', true);
    } catch (e) {
      console.error('[auth] resend threw →', e);
      say(prettyErr(e));
    }
  });

  // ---------- Forgot password → /reset.html (EMAIL ONLY; with redirect fallback) ----------
  $('#si-forgot')?.addEventListener('click', async () => {
    const say = (t, ok = false) => showMsg(siForm, 'si-msg', t, ok);
    if (!sb) return say('Auth is not configured.');
    const email = $('#si-email')?.value?.trim() || '';
    if (!EMAIL_RE.test(email)) return say('Enter your email address (not a username).');
    say('');
    try {
      let { data, error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectReset() });
      console.warn('[auth] resetPasswordForEmail (with redirect) →', { data, error });

      if (error && looksRedirectError(error)) {
        console.warn('[auth] reset retry WITHOUT redirect.');
        ({ data, error } = await sb.auth.resetPasswordForEmail(email));
        console.warn('[auth] resetPasswordForEmail (no redirect) →', { data, error });
      }

      if (error) return say(prettyErr(error));
      say('Reset link sent. Check your email.', true);
    } catch (e) {
      console.error('[auth] reset threw →', e);
      say(prettyErr(e));
    }
  });

  // ---------- expose tiny API ----------
  window.AuthModals = {
    open, close,
    rememberNext() { try { localStorage.setItem('pinged_return_to', location.pathname + location.search + location.hash); } catch { } }
  };
})();
