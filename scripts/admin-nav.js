// scripts/admin-nav.js — show Admin nav only for admins (Edge Function first; fallback local)
(function(){
  const CFG = window.PINGED_CONFIG || {};
  const SUPABASE_URL = CFG.SUPABASE_URL || '';
  const FN_BASE = (CFG.FUNCTIONS_BASE && CFG.FUNCTIONS_BASE.replace(/\/+$/,'')) ||
                  (SUPABASE_URL ? SUPABASE_URL.replace(/\/+$/,'') + '/functions/v1' : '');

  function getSB() {
    return (typeof window.getSB === 'function' ? window.getSB() : (window.__sb || window.supabase));
  }
  async function authFetch(url) {
    const sb = getSB();
    const { data: sess } = await sb.auth.getSession();
    const token = sess?.session?.access_token || '';
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    return fetch(url, { headers, mode: 'cors', credentials: 'omit' });
  }

  async function localIsAdmin(sb, user) {
    try {
      const { data } = await sb.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
      if (data && ['admin','super_admin'].includes(String(data.role))) return true;
    } catch {}
    try {
      const { data } = await sb.from((CFG.TABLES?.PROFILES||'profiles')).select('is_admin, role').eq('id', user.id).maybeSingle();
      if (data?.is_admin) return true;
      if (['admin','owner','super','superadmin','staff'].includes(String(data?.role||'').toLowerCase())) return true;
    } catch {}
    return false;
  }

  async function decide() {
    const link = document.getElementById('nav-admin');
    const tile = document.getElementById('tile-admin');
    const sb = getSB();
    const { data: sess } = await sb.auth.getSession();
    const user = sess?.session?.user;

    const hide = () => { if (link) link.style.display='none'; if (tile) tile.style.display='none'; };
    const show = () => { if (link) link.style.display='';    if (tile) tile.style.display='';    };

    if (!user) return hide();

    // Prefer Edge Function (bypasses RLS reliably)
    if (FN_BASE) {
      try {
        const r = await authFetch(`${FN_BASE}/admin-users?who=1`);
        if (r.ok) {
          const who = await r.json().catch(()=>null);
          const role = String(who?.role || '').toLowerCase();
          return (role === 'admin' || role === 'super_admin') ? show() : hide();
        }
      } catch { /* next fallback */ }
    }

    // Local fallback
    const ok = await localIsAdmin(sb, user);
    ok ? show() : hide();
  }

  const sb = getSB();
  if (sb?.auth?.onAuthStateChange) sb.auth.onAuthStateChange(() => decide());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decide);
  else decide();
})();
