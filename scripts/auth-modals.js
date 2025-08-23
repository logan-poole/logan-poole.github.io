/* Simple, robust modal controller + Supabase auth
   - Redirects to dashboard (or ?next/localStorage) after SIGN IN
   - Magic link / email confirmations land on dashboard too
   - Adds a "Resend verification email" button after successful sign-up
   - Works with your existing modal markup and data-auth buttons
*/
(function () {
  const DEFAULT_AFTER_LOGIN = 'dashboard.html';

  // ===== Helpers =====
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function getAfterLoginTarget() {
    const qp = new URLSearchParams(location.search);
    const next = qp.get('next');
    if (next) return next;
    try {
      const ret = localStorage.getItem('pinged_return_to');
      if (ret) {
        localStorage.removeItem('pinged_return_to');
        return ret;
      }
    } catch {}
    return DEFAULT_AFTER_LOGIN;
  }
  function showErr(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.classList.toggle('show', !!msg);
  }

  // ===== Overlay / Modals =====
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;

  function open(kind) {
    $$('.auth-modal', overlay).forEach(s => s.hidden = true);
    const el = $('#modal-' + kind, overlay);
    if (!el) return;
    el.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.style.display = 'block';
    const first = el.querySelector('input,button,select,textarea,[tabindex]:not([tabindex="-1"])');
    first?.focus();
    trapFocus(el);
  }
  function close() {
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.display = 'none';
    $$('.auth-modal', overlay).forEach(s => s.hidden = true);
    releaseFocus();
  }
  window.AuthModals = { open, close };

  document.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-auth-open]');
    if (openBtn) { e.preventDefault(); open(openBtn.getAttribute('data-auth-open')); }
    if (e.target.matches('[data-auth-close]')) { e.preventDefault(); close(); }
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (overlay.getAttribute('aria-hidden') === 'false' && e.key === 'Escape') close();
  });

  // ===== Show / hide password =====
  function togglePwById(id, btn) {
    const input = document.getElementById(id);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    if (btn) btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle="pw"]');
    if (t) togglePwById(t.getAttribute('data-target'), t);
  });
  $('#si-show')?.addEventListener('change', () => togglePwById('si-password'));
  $('#su-show')?.addEventListener('change', () => togglePwById('su-password'));

  // ===== Supabase client (reuse or create; prefer existing from auth-guard) =====
  const NS  = window.supabase;
  const cfg = window.PINGED_CONFIG || {};
  const sb = (function getClient() {
    try {
      if (window.__sb) return window.__sb;
      if (NS?.createClient && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
        window.__sb = NS.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
        return window.__sb;
      }
    } catch {}
    return null;
  })();

  // ===== Forms & messages =====
  const siForm = $('#signin-form');
  const suForm = $('#signup-form');
  const siMsg  = $('#si-msg');
  const suMsg  = $('#su-msg');
  const suHint = $('#su-hint');

  // Create a "Resend verification" button dynamically
  let suResendBtn = document.getElementById('su-resend');
  if (!suResendBtn && suForm) {
    suResendBtn = document.createElement('button');
    suResendBtn.id = 'su-resend';
    suResendBtn.type = 'button';
    suResendBtn.className = 'btn ghost';
    suResendBtn.textContent = 'Resend verification email';
    suResendBtn.hidden = true;
    suForm.querySelector('.auth-actions')?.appendChild(suResendBtn);
  }

  // ===== Sign In =====
  async function onSignIn(e) {
    e.preventDefault();
    if (!sb) return showErr(siMsg, 'Auth is not configured.');
    const email = $('#si-email')?.value?.trim() || '';
    const password = $('#si-password')?.value || '';
    const btn = $('#si-btn');
    if (!email || !password) { showErr(siMsg, 'Enter email and password.'); return; }

    btn && (btn.disabled = true); showErr(siMsg, '');
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return showErr(siMsg, error.message || 'Sign in failed.');
      close();
      const target = getAfterLoginTarget();
      location.replace(target);
    } catch (err) {
      showErr(siMsg, err?.message || 'Something went wrong.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ===== Sign Up =====
  async function onSignUp(e) {
    e.preventDefault();
    if (!sb) return showErr(suMsg, 'Auth is not configured.');
    const email = $('#su-email')?.value?.trim() || '';
    const password = $('#su-password')?.value || '';
    const btn = $('#su-btn');
    if (!email || !password) { showErr(suMsg, 'Enter email and password.'); return; }
    if (password.length < 6) { showErr(suMsg, 'Password must be at least 6 characters.'); return; }

    btn && (btn.disabled = true); showErr(suMsg, ''); if (suHint) suHint.textContent = '';
    try {
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { emailRedirectTo: location.origin + '/dashboard.html' }
      });
      if (error) return showErr(suMsg, error.message || 'Sign up failed.');
      if (data?.user?.identities?.length === 0) {
        return showErr(suMsg, 'That email is already registered.');
      }
      if (suHint) suHint.textContent = 'Check your email to confirm your account. After confirming, you\'ll be taken to your dashboard.';
      if (suResendBtn) suResendBtn.hidden = false;
    } catch (err) {
      showErr(suMsg, err?.message || 'Something went wrong.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ===== Resend confirmation email =====
  suResendBtn?.addEventListener('click', async () => {
    if (!sb) return;
    const email = $('#su-email')?.value?.trim() || '';
    if (!email) { if (suHint) suHint.textContent = 'Enter your email first.'; return; }
    try {
      suResendBtn.disabled = true;
      await sb.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: location.origin + '/dashboard.html' }
      });
      if (suHint) suHint.textContent = 'Verification email re-sent.';
    } catch (e) {
      if (suHint) suHint.textContent = e?.message || 'Could not resend email.';
    } finally {
      suResendBtn.disabled = false;
    }
  });

  // ===== Magic link & Reset password =====
  $('#si-magic')?.addEventListener('click', async () => {
    if (!sb) return showErr(siMsg, 'Auth is not configured.');
    const email = $('#si-email')?.value?.trim() || '';
    if (!email) return showErr(siMsg, 'Enter your email first.');
    showErr(siMsg, '');
    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + '/dashboard.html' }
      });
      if (error) return showErr(siMsg, error.message || 'Could not send magic link.');
      showErr(siMsg, 'Magic link sent. Check your email.');
    } catch (e) {
      showErr(siMsg, e?.message || 'Could not send magic link.');
    }
  });

  $('#si-forgot')?.addEventListener('click', async () => {
    if (!sb) return showErr(siMsg, 'Auth is not configured.');
    const email = $('#si-email')?.value?.trim() || '';
    if (!email) return showErr(siMsg, 'Enter your email first.');
    showErr(siMsg, '');
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + '/dashboard.html'
      });
      if (error) return showErr(siMsg, error.message || 'Could not send reset link.');
      showErr(siMsg, 'Reset link sent. Check your email.');
    } catch (e) {
      showErr(siMsg, e?.message || 'Could not send reset link.');
    }
  });

  // ===== Wire handlers =====
  $('#signin-form')?.addEventListener('submit', onSignIn);
  $('#signup-form')?.addEventListener('submit', onSignUp);

  // ===== Focus trap =====
  let prevFocus = null;
  function trapFocus(root) {
    prevFocus = document.activeElement;
    const focusables = $$('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])', root);
    const first = focusables[0], last = focusables[focusables.length - 1];
    function loop(e) {
      if (e.key !== 'Tab') return;
      if (!focusables.length) return;
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
    root.addEventListener('keydown', loop);
    root.__trapLoop = loop;
  }
  function releaseFocus() {
    const open = overlay.querySelector('.auth-modal:not([hidden])');
    if (open?.__trapLoop) open.removeEventListener('keydown', open.__trapLoop);
    prevFocus?.focus();
  }
})();
