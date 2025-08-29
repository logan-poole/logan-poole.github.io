/* scripts/wizard.js — helper actions for wizard.html (NEW)
   ACTIONS
   - Create user (signUp) → emailRedirectTo /verify.html.
   - Resend verification.
   - Send reset password to /reset.html.
*/
(function(){
  const $ = (s,r=document)=>r.querySelector(s);
  const sb=(typeof window.getSB==='function'?window.getSB():null);
  if(!sb){ console.error('[wizard] Supabase not initialized.'); }

  const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const say=(el,t,ok=false)=>{ el.textContent=t||''; el.className= ok?'ok':'err'; if(!t){ el.className='muted'; } };
  const redirectVerify = () => location.origin + '/verify.html';
  const redirectReset  = () => location.origin + '/reset.html';

  // Create account
  const suBtn=$('#w-su-btn'), suEmail=$('#w-su-email'), suPw=$('#w-su-pw'), suMsg=$('#w-su-msg');
  suBtn?.addEventListener('click', async ()=>{
    if(!sb) return say(suMsg,'Auth not configured.');
    const email=(suEmail.value||'').trim(), pw=suPw.value||'';
    if(!EMAIL_RE.test(email)) return say(suMsg,'Enter a valid email.');
    if(pw.length<6) return say(suMsg,'Password must be at least 6 characters.');
    suBtn.disabled=true; say(suMsg,'',true);
    try{
      const { data, error } = await sb.auth.signUp({ email, password: pw, options:{ emailRedirectTo: redirectVerify() } });
      console.warn('[wizard] signUp →',{data,error});
      if(error) return say(suMsg, error.message||'Sign up failed.');
      say(suMsg,'Verification email sent. Check your inbox.', true);
    }catch(e){ say(suMsg, e?.message||'Sign up failed.'); }
    finally{ suBtn.disabled=false; }
  });

  // Resend verification
  const vBtn=$('#w-v-btn'), vEmail=$('#w-v-email'), vMsg=$('#w-v-msg');
  vBtn?.addEventListener('click', async ()=>{
    if(!sb) return say(vMsg,'Auth not configured.');
    const email=(vEmail.value||'').trim();
    if(!EMAIL_RE.test(email)) return say(vMsg,'Enter a valid email.');
    vBtn.disabled=true; say(vMsg,'',true);
    try{
      const { data, error } = await sb.auth.resend({ type:'signup', email });
      console.warn('[wizard] resend →',{data,error});
      if(error) return say(vMsg, error.message||'Could not resend.');
      say(vMsg,'Verification email sent.', true);
    }catch(e){ say(vMsg, e?.message||'Could not resend.'); }
    finally{ vBtn.disabled=false; }
  });

  // Reset password
  const rBtn=$('#w-r-btn'), rEmail=$('#w-r-email'), rMsg=$('#w-r-msg');
  rBtn?.addEventListener('click', async ()=>{
    if(!sb) return say(rMsg,'Auth not configured.');
    const email=(rEmail.value||'').trim();
    if(!EMAIL_RE.test(email)) return say(rMsg,'Enter a valid email.');
    rBtn.disabled=true; say(rMsg,'',true);
    try{
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectReset() });
      if(error) return say(rMsg, error.message||'Could not send reset link.');
      say(rMsg,'Reset link sent. Check your inbox.', true);
    }catch(e){ say(rMsg, e?.message||'Could not send reset link.'); }
    finally{ rBtn.disabled=false; }
  });
})();
