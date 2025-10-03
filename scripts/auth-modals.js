/* Author: Logan Poole — 30083609
   FILE: /scripts/auth-modals.js
   Purpose: Auth overlay controller matching index.html DOM (ES5-safe).
*/
(function () {
  // Short helpers
  function $(s, r){ return (r||document).querySelector(s); }
  function $$(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }

  var CFG = window.PINGED_CONFIG || {};
  var ROUTE_DASH = (CFG.ROUTES && CFG.ROUTES.DASHBOARD) || 'dashboard.html';

  // DOM from index.html
  var overlay     = $('#auth-overlay');
  var modalSignin = $('#modal-signin');
  var modalSignup = $('#modal-signup');

  // Sign-in elements
  var formSI  = $('#signin-form');
  var siEmail = $('#si-email');
  var siPass  = $('#si-password');
  var siMsg   = $('#si-msg');
  var siBtn   = $('#si-btn');
  var siMagic = $('#si-magic');
  var siForgot= $('#si-forgot');

  // Sign-up elements
  var formSU = $('#signup-form');
  var suEmail = $('#su-email');
  var suPass  = $('#su-password');
  var suMsg   = $('#su-msg');
  var suBtn   = $('#su-btn');

  // Locate Supabase client safely regardless of namespace order
  function getSB() {
    try {
      if (typeof window.getSB === 'function') return window.getSB();
      if (window.__sb && window.__sb.auth) return window.__sb;
      if (window.supabase && window.supabase.auth) return window.supabase;
    } catch (e) {}
    return null;
  }

  // Show/Hide helpers
  function show(el){ if (el) el.removeAttribute('hidden'); }
  function hide(el){ if (el) el.setAttribute('hidden',''); }

  function openOverlay(){
    if (!overlay) return;
    // IMPORTANT: CSS expects aria-hidden="false" (not removed)
    overlay.setAttribute('aria-hidden', 'false');
    show(overlay);
  }

  function closeOverlay(){
    if (!overlay) return;
    overlay.setAttribute('aria-hidden','true');
    hide(modalSignin);
    hide(modalSignup);
    hide(overlay);
  }

  function clearMsgs(){
    if (siMsg){ siMsg.textContent=''; siMsg.hidden=true; }
    if (suMsg){ suMsg.textContent=''; suMsg.hidden=true; }
  }

  function open(which){
    if (which !== 'signup') which = 'signin';
    clearMsgs();
    openOverlay();
    if (which === 'signup'){ hide(modalSignin); show(modalSignup); }
    else { hide(modalSignup); show(modalSignin); }
    // animate in
    requestAnimationFrame(function(){
      var el = which === 'signup' ? modalSignup : modalSignin;
      if (el) el.classList.add('is-open');
    });
  }

  // Wire up open/close triggers (idempotent)
  function wireOpeners(){
    // Direct listeners for existing buttons
    $$( '[data-auth-open]' ).forEach(function(btn){
      if (btn.__wiredAuthOpen) return;
      btn.__wiredAuthOpen = true;
      btn.addEventListener('click', function(e){
        e.preventDefault();
        var t = btn.getAttribute('data-auth-open');
        open(t === 'signup' ? 'signup' : 'signin');
      });
    });

    // Delegated listener (catches future DOM nodes)
    if (!document.__wiredAuthDelegation) {
      document.__wiredAuthDelegation = true;
      document.addEventListener('click', function(e){
        var target = e.target || e.srcElement;
        var el = target && target.closest ? target.closest('[data-auth-open]') : null;
        if (!el) return;
        e.preventDefault();
        var t = el.getAttribute('data-auth-open');
        open(t === 'signup' ? 'signup' : 'signin');
      });
    }

    // Close triggers (buttons and backdrop)
    $$( '[data-auth-close]' ).forEach(function(btn){
      if (btn.__wiredAuthClose) return;
      btn.__wiredAuthClose = true;
      btn.addEventListener('click', function(e){
        e.preventDefault();
        closeOverlay();
      });
    });

    if (overlay && !overlay.__wiredBackdrop) {
      overlay.__wiredBackdrop = true;
      overlay.addEventListener('click', function(e){
        if (e.target === overlay) closeOverlay();
      });
    }
  }

  // Password visibility toggles (delegated, idempotent)
  function wirePwToggles(){
    if (document.__wiredPwToggle) return;
    document.__wiredPwToggle = true;
    document.addEventListener('click', function(e){
      var target = e.target || e.srcElement;
      var btn = target && target.closest ? target.closest('[data-toggle="pw"]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-target');
      var input = document.getElementById(id);
      if (!input) return;
      var next = input.type === 'password' ? 'text' : 'password';
      input.type = next;
      btn.setAttribute('aria-label', next === 'password' ? 'Show password' : 'Hide password');
    });
  }

  // Sign in
  async function handleSignin(ev){
    ev.preventDefault();
    if (siMsg){ siMsg.textContent=''; siMsg.hidden=true; }
    var email = (siEmail && siEmail.value || '').trim();
    var password = (siPass && siPass.value || '').trim();
    if (!email || !password){
      if (siMsg){ siMsg.textContent = 'Please enter your email and password.'; siMsg.hidden=false; }
      return;
    }
    var sb = getSB();
    if (!sb || !sb.auth || !sb.auth.signInWithPassword){
      if (siMsg){ siMsg.textContent = 'Auth not available. Please reload.'; siMsg.hidden=false; }
      return;
    }
    try {
      if (siBtn) siBtn.disabled = true;
      var res = await sb.auth.signInWithPassword({ email: email, password: password });
      if (res && res.error) throw res.error;
      location.href = ROUTE_DASH + '?signedin=1';
    } catch (e){
      if (siMsg){ siMsg.textContent = (e && e.message) || String(e); siMsg.hidden=false; }
    } finally {
      if (siBtn) siBtn.disabled = false;
    }
  }

  // Magic link (optional)
  async function handleMagic(ev){
    ev.preventDefault();
    var email = (siEmail && siEmail.value || '').trim();
    if (!email){
      if (siMsg){ siMsg.textContent = 'Enter your email to receive a sign-in link.'; siMsg.hidden=false; }
      return;
    }
    var sb = getSB();
    if (!sb || !sb.auth || !sb.auth.signInWithOtp){
      if (siMsg){ siMsg.textContent = 'Auth not available. Please reload.'; siMsg.hidden=false; }
      return;
    }
    try{
      if (siMagic) siMagic.disabled = true;
      var res = await sb.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: location.origin + '/verify.html' }
      });
      if (res && res.error) throw res.error;
      if (siMsg){ siMsg.textContent = 'Check your inbox for a sign-in link.'; siMsg.hidden=false; }
    }catch(e){
      if (siMsg){ siMsg.textContent = (e && e.message) || String(e); siMsg.hidden=false; }
    }finally{
      if (siMagic) siMagic.disabled = false;
    }
  }

  // Forgot password
  async function handleForgot(ev){
    ev.preventDefault();
    var email = (siEmail && siEmail.value || '').trim();
    if (!email){
      if (siMsg){ siMsg.textContent = 'Enter your email to reset your password.'; siMsg.hidden=false; }
      return;
    }
    var sb = getSB();
    if (!sb || !sb.auth || !sb.auth.resetPasswordForEmail){
      if (siMsg){ siMsg.textContent = 'Auth not available. Please reload.'; siMsg.hidden=false; }
      return;
    }
    try{
      if (siForgot) siForgot.disabled = true;
      var res = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/reset.html' });
      if (res && res.error) throw res.error;
      if (siMsg){ siMsg.textContent='Password reset link sent.'; siMsg.hidden=false; }
    }catch(e){
      if (siMsg){ siMsg.textContent = (e && e.message) || String(e); siMsg.hidden=false; }
    }finally{
      if (siForgot) siForgot.disabled = false;
    }
  }

  // Sign up
  async function handleSignup(ev){
    ev.preventDefault();
    if (suMsg){ suMsg.textContent=''; suMsg.hidden=true; }
    var email = (suEmail && suEmail.value || '').trim();
    var password = (suPass && suPass.value || '').trim();
    if (!email || !password){
      if (suMsg){ suMsg.textContent='Please enter an email and password.'; suMsg.hidden=false; }
      return;
    }
    var sb = getSB();
    if (!sb || !sb.auth || !sb.auth.signUp){
      if (suMsg){ suMsg.textContent='Auth not available. Please reload.'; suMsg.hidden=false; }
      return;
    }
    try{
      if (suBtn) suBtn.disabled = true;
      var res = await sb.auth.signUp({
        email: email,
        password: password,
        options:{ emailRedirectTo: location.origin + '/verify.html' }
      });
      if (res && res.error) throw res.error;
      if (suMsg){ suMsg.textContent = 'Check your email to confirm your account.'; suMsg.hidden=false; }
    }catch(e){
      if (suMsg){ suMsg.textContent = (e && e.message) || String(e); suMsg.hidden=false; }
    }finally{
      if (suBtn) suBtn.disabled = false;
    }
  }

  // Wire form handlers (idempotent)
  function wireForms(){
    if (formSI && !formSI.__wired) { formSI.__wired = true; formSI.addEventListener('submit', handleSignin); }
    if (siMagic && !siMagic.__wired) { siMagic.__wired = true; siMagic.addEventListener('click', handleMagic); }
    if (siForgot && !siForgot.__wired) { siForgot.__wired = true; siForgot.addEventListener('click', handleForgot); }
    if (formSU && !formSU.__wired) { formSU.__wired = true; formSU.addEventListener('submit', handleSignup); }
  }

  function init(){
    wireOpeners();
    wirePwToggles();
    wireForms();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
