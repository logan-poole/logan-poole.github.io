/* Author: Logan Poole — 30083609
   FILE: /scripts/reset.js
   Purpose: Request reset link (email) and handle hash-based password update.
*/
(function () {
  const $ = (s, r=document)=>r.querySelector(s);
  const form  = $('#reset-form');
  const email = $('#reset-email');
  const msg   = $('#reset-msg');

  function sb(){ return (typeof window.getSB === 'function' ? window.getSB() : (window.__sb || window.supabase)); }

  async function requestReset(ev) {
    ev.preventDefault();
    const addr = (email?.value || '').trim();
    if (!addr) { msg.textContent='Enter your email.'; return; }
    try {
      const { error } = await sb().auth.resetPasswordForEmail(addr, { redirectTo: location.origin + '/reset.html' });
      if (error) throw error;
      msg.textContent = 'Check your email for a reset link.';
    } catch (e) {
      msg.textContent = e.message || String(e);
    }
  }

  // If hash params present, show update form (optional if you have it)
  try {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('type') === 'recovery') {
      document.body.classList.add('recovery');
    }
  } catch {}

  form?.addEventListener('submit', requestReset);
})();
