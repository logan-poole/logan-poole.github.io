/* 
  scripts/reset.js — robust password recovery handler (UPDATED FINAL)
  -------------------------------------------------------------------
  WHAT CHANGED (vs your current file)
  - Handles Supabase hash errors like:
      #error=access_denied&error_code=otp_expired&error_description=...
    and shows a friendly message + an in-page "Resend reset link" form.
  - Detects recovery via query or hash AND presence of access/refresh tokens.
  - Waits for Supabase to hydrate the recovery session from the URL hash.
  - Safely creates missing DOM nodes (#hint / #msg) so it won’t crash if absent.
  - Keeps the original “set new password” flow and clears the hash on success.

  HOW IT BEHAVES
  - Valid recovery link → shows password form → sb.auth.updateUser({ password }) → redirect dashboard.
  - Expired/invalid link → shows reason and a mini form to re-send a fresh reset email to /reset.html.

  REQUIREMENTS
  - Include on reset.html AFTER:
      supabase-js v2 → scripts/config.js → scripts/sb-client.js → scripts/page-flags.js → scripts/auth-guard.js
  - reset.html should have (or this script will create messages if missing):
      <p id="hint">...</p>
      <form id="reset-form" hidden> with #pw1, #pw2, #go, and <p id="msg">
*/

(function () {
  // ---------- tiny DOM helpers ----------
  const $ = (s, r=document)=>r.querySelector(s);
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

  // Base elements (create fallback message nodes if missing)
  const form = $('#reset-form');
  let   hint = $('#hint');
  let   msg  = $('#msg');
  const pw1  = $('#pw1');
  const pw2  = $('#pw2');

  if (!hint) { hint = document.createElement('p'); hint.id='hint'; (document.body || document.documentElement).prepend(hint); }
  if (form && !msg) { msg = document.createElement('p'); msg.id='msg'; msg.className='muted'; msg.style.marginTop='10px'; form.appendChild(msg); }

  // ---------- URL parsing ----------
  function params() {
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    return { q, h };
  }
  function isRecoveryURL() {
    const { q, h } = params();
    if (q.get('type') === 'recovery' || h.get('type') === 'recovery') return true;
    // Tokens placed by Supabase during recovery/magic links
    return ['access_token','refresh_token'].some(k => h.has(k));
  }
  function readHashError() {
    const { h } = params();
    const error = h.get('error') || '';
    const code  = h.get('error_code') || '';
    const desc  = h.get('error_description') || '';
    if (!error && !code && !desc) return null;
    return { error, code, desc };
  }

  // ---------- Supabase client / session ----------
  function sb() { return (typeof window.getSB==='function' ? window.getSB() : null); }

  async function waitSession(timeout=2500) {
    const client = sb(); if (!client) return { client:null, session:null };
    const start = Date.now();
    while (Date.now()-start < timeout) {
      const { data } = await client.auth.getSession();
      if (data?.session) return { client, session: data.session };
      await sleep(80);
    }
    return { client, session: null };
  }

  // ---------- UI helpers ----------
  function setHint(text, cls='muted') { if (!hint) return; hint.textContent = text || ''; hint.className = cls; }
  function setMsg(text, ok=false) { if (!msg) return; msg.textContent = text || ''; msg.className = ok ? 'ok' : 'err'; }
  function showForm(on) { if (!form) return; form.hidden = !on; }

  // Build a small “resend link” UI if the link is expired/invalid
  function ensureResendUI() {
    if (document.getElementById('reset-resend-host')) return;
    const host = document.createElement('div');
    host.id = 'reset-resend-host';
    host.style.marginTop = '14px';

    const label = document.createElement('label');
    label.textContent = 'Email to resend reset link';
    label.style.display = 'block';
    label.style.margin = '.6rem 0 .2rem';

    const input = document.createElement('input');
    input.type = 'email';
    input.id = 'reset-resend-email';
    input.placeholder = 'you@example.com';
    input.autocomplete = 'email';
    input.style.width = '100%';
    input.style.padding = '.7rem';
    input.style.borderRadius = '10px';
    input.style.border = '1px solid #333';
    input.style.background = '#12161d';
    input.style.color = '#fff';

    const btn = document.createElement('button');
    btn.id = 'reset-resend-btn';
    btn.textContent = 'Send new reset link';
    btn.style.marginTop = '10px';
    btn.style.padding = '.6rem 1rem';
    btn.style.borderRadius = '10px';
    btn.style.border = '1px solid #334';
    btn.style.background = '#1a2030';
    btn.style.color = '#fff';
    btn.style.cursor = 'pointer';

    const note = document.createElement('p');
    note.id = 'reset-resend-msg';
    note.className = 'muted';
    note.style.marginTop = '8px';

    host.appendChild(label);
    host.appendChild(input);
    host.appendChild(btn);
    host.appendChild(note);

    (hint?.parentElement || document.body).appendChild(host);

    btn.onclick = async () => {
      const client = sb();
      if (!client) { note.textContent = 'Auth not initialized.'; note.className='err'; return; }
      note.textContent = ''; note.className='muted';
      const email = (input.value || '').trim();
      if (!email) { note.textContent = 'Enter your email.'; note.className='err'; return; }
      btn.disabled = true;
      try {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + '/reset.html'
        });
        if (error) { note.textContent = error.message || 'Could not send reset email.'; note.className='err'; return; }
        note.textContent = 'Reset link sent. Check your inbox.'; note.className='ok';
      } catch (e) {
        note.textContent = e?.message || 'Could not send reset email.'; note.className='err';
      } finally {
        btn.disabled = false;
      }
    };
  }

  // ---------- boot ----------
  async function boot() {
    const client = sb();
    if (!client) {
      setHint('Auth not initialized. Check script order and config.', 'err');
      showForm(false);
      return;
    }

    // If Supabase appended an error in the hash (e.g., otp_expired)
    const hashErr = readHashError();
    if (hashErr) {
      showForm(false);
      const isExpired = /otp_expired/i.test(hashErr.code) || /expired/i.test(hashErr.desc || hashErr.error);
      setHint(
        isExpired
          ? 'This password reset link has expired or was already used.'
          : (hashErr.desc || 'The reset link is invalid.'),
        'err'
      );
      ensureResendUI();
      return;
    }

    // No explicit error → check for a valid recovery URL
    if (!isRecoveryURL()) {
      setHint('This page expects a password reset link. Use “Forgot password” to request a new email.', 'muted');
      showForm(false);
      return;
    }

    // Wait a moment for SDK to hydrate session from URL
    setHint('Checking recovery link…', 'muted');
    const { session } = await waitSession(3000);
    if (!session) {
      setHint('Recovery session missing or expired. Request a new reset link.', 'err');
      showForm(false);
      ensureResendUI();
      return;
    }

    // Valid recovery → show password form
    setHint('Enter a new password below.', 'muted');
    showForm(true);

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      setMsg('');
      const a = pw1?.value || '', b = pw2?.value || '';
      if (a.length < 6) return setMsg('Password must be at least 6 characters.');
      if (a !== b)     return setMsg('Passwords do not match.');

      const go = $('#go'); if (go) go.disabled = true;
      try {
        const { error } = await client.auth.updateUser({ password: a });
        if (error) throw error;
        setMsg('Password updated. Redirecting…', true);
        // Clear hash so auth-guard no longer sees recovery state
        history.replaceState({}, '', location.pathname);
        setTimeout(()=>location.replace('dashboard.html'), 600);
      } catch (err) {
        setMsg(err?.message || 'Could not update password.');
      } finally {
        if (go) go.disabled = false;
      }
    });

    // Belt & suspenders: react if SDK emits PASSWORD_RECOVERY after hydration
    client.auth.onAuthStateChange((evt) => {
      if (evt === 'PASSWORD_RECOVERY') {
        setHint('Enter a new password below.', 'muted');
        showForm(true);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
