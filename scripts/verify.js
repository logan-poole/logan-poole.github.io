/* scripts/verify.js — confirm-email handler (NEW)
   WHAT IT DOES
   - Detects Supabase hash params (#type=signup, access_token, etc.).
   - If valid: shows success and keeps session; buttons to go dashboard or sign out.
   - If invalid/expired: shows error and a form to resend a new verification email.
*/
(function () {
  const $ = (s,r=document)=>r.querySelector(s);
  const hint = $('#hint');
  const okBox = $('#success');
  const errBox = $('#errorbox');
  const errMsg = $('#errmsg');
  const vEmail = $('#v-email');
  const vMsg   = $('#v-msg');

  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const sb = (typeof window.getSB==='function'?window.getSB():null);

  function parseHash(){
    const h=new URLSearchParams((location.hash||'').replace(/^#/,''));
    return { type:h.get('type'), error:h.get('error'), code:h.get('error_code'), desc:h.get('error_description') };
  }
  async function waitSession(timeout=3000){
    if(!sb) return null; const t0=Date.now();
    while(Date.now()-t0<timeout){ const {data}=await sb.auth.getSession(); if(data?.session) return data.session; await sleep(80); }
    return null;
  }
  function showOk(){
    hint.textContent=''; okBox.hidden=false; errBox.hidden=true;
    $('#go-dash')?.addEventListener('click',()=>location.replace('dashboard.html'));
    $('#sign-out')?.addEventListener('click', async()=>{ try{ await sb?.auth?.signOut(); }catch{} location.replace('index.html'); });
  }
  function showErr(text){
    hint.textContent=''; okBox.hidden=true; errBox.hidden=false; errMsg.textContent=text||'Verification link invalid.';
  }

  async function boot(){
    if(!sb){ hint.textContent='Auth not initialized. Check config and script order.'; return; }

    // If Supabase provided an error in the hash
    const h=parseHash();
    if(h.error||h.code){
      showErr(h.desc||'Verification link is invalid or has expired.');
      return wireResend();
    }

    // Otherwise, wait for session hydration (link includes tokens)
    hint.textContent='Finalizing verification…';
    const session=await waitSession(3500);
    if(session?.user){ showOk(); return; }

    // No session even though we’re on verify page → treat as invalid
    showErr('Could not establish your session from the link. It may have expired.');
    wireResend();
  }

  function wireResend(){
    const btn=$('#v-resend'); if(!btn) return;
    btn.onclick=async()=>{
      vMsg.textContent='';
      const email=(vEmail?.value||'').trim();
      if(!email) { vMsg.textContent='Enter your email.'; return; }
      btn.disabled=true;
      try{
        const { error } = await sb.auth.resend({ type:'signup', email });
        if(error){ vMsg.textContent=error.message||'Could not resend verification.'; return; }
        vMsg.textContent='Verification email sent. Check your inbox.'; vMsg.className='ok';
      }catch(e){ vMsg.textContent=e?.message||'Could not resend verification.'; }
      finally{ btn.disabled=false; }
    };
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
