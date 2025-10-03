/* Author: Logan Poole — 30083609
   FILE: /scripts/auth-debug.js
   Purpose: Probe Supabase wiring and print session to #out.
*/
(function () {
  const out = document.getElementById('out');
  function sb(){ return (typeof window.getSB === 'function' ? window.getSB() : (window.__sb || window.supabase)); }
  function print(o){ if (out) out.textContent = (typeof o==='string') ? o : JSON.stringify(o, null, 2); }

  async function boot(){
    try{
      const supa = sb();
      const se = await supa?.auth?.getSession();
      print({ hasClient: !!supa, session: se?.data?.session || null });
    }catch(e){ print('Error: ' + (e.message||String(e))); }
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
