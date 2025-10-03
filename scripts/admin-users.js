/* Author: Logan Poole — 30083609
   FILE: /scripts/admin-users.js
   Purpose: Admin users list (profiles) + create via Edge Function if available.
*/
(function () {
  const $ = (s, r=document)=>r.querySelector(s);

  const CFG = window.PINGED_CONFIG || {};
  const T   = Object.assign({ PROFILES:'profiles' }, CFG.TABLES || {});
  const AVATAR_COL = (CFG.PROFILE && CFG.PROFILE.AVATAR_COLUMN) || 'avatar_url';

  const listRoot = $('#admin-users');
  const pageInfo = $('#page-info');
  const qInput   = $('#q');
  const hint     = $('#auth-hint');
  const prevBtn  = $('#prev');
  const nextBtn  = $('#next');
  const createForm = $('#create-user-form');

  let supa, me, page=0, limit=20, total=0;

  function label(p){ return p.display_name || (p.username ? '@'+p.username : (p.email || 'User')); }
  function avatar(p){ return p[AVATAR_COL] || 'assets/avatar-default.png'; }
  function sb(){ return (typeof window.getSB === 'function' ? window.getSB() : (window.__sb || window.supabase)); }

  async function isAdmin() {
    const roles = ['admin','owner','super','superadmin','staff'];
    const meta  = me?.app_metadata || me?.user_metadata || {};
    if (meta?.is_admin || roles.includes(String(meta?.role||'').toLowerCase())) return true;
    try {
      const { data } = await supa.from(T.PROFILES).select('role,is_admin').or(`id.eq.${me.id},user_id.eq.${me.id}`).limit(1).maybeSingle();
      return data?.is_admin === true || roles.includes(String(data?.role||'').toLowerCase());
    } catch { return false; }
  }

  async function fetchPage() {
    const q = (qInput?.value || '').trim();
    const from = page*limit;
    let query = supa.from(T.PROFILES).select('*', { count:'exact' }).order('created_at', { ascending:false }).range(from, from+limit-1);
    if (q) query = query.ilike('display_name', `%${q}%`);
    const { data, count, error } = await query;
    if (error) { listRoot.innerHTML = `<div class="muted">Error: ${error.message}</div>`; return; }
    total = count || 0;
    pageInfo && (pageInfo.textContent = `${total} total • page ${page+1}`);
    listRoot.innerHTML='';
    for (const p of (data || [])) {
      const row = document.createElement('div'); row.className = 'user-row';
      row.innerHTML = `<img class="avatar" src="${avatar(p)}" alt=""><div class="meta"><div class="name">${label(p)}</div><div class="sub muted">${p.email||''}</div></div>`;
      listRoot.appendChild(row);
    }
  }

  async function fn(path){ const base = CFG.FUNCTIONS_BASE || `${CFG.SUPABASE_URL}/functions/v1`; return `${base}/${path}`; }

  async function createUser(email, password) {
    try {
      const { data: { session } } = await supa.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(await fn('admin-users?op=create'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) throw new Error(`Function error (${res.status})`);
      return await res.json();
    } catch (e) { return { error: e.message || String(e) }; }
  }

  async function boot() {
    supa = sb();
    const se = await supa?.auth?.getSession(); me = se?.data?.session?.user || null; if (!me) return;
    if (!(await isAdmin())) { hint && (hint.textContent = 'You are not an admin.'); return; }
    await fetchPage();

    qInput?.addEventListener('input', ()=>{ page=0; fetchPage(); });
    prevBtn?.addEventListener('click', ()=>{ if (page>0){ page--; fetchPage(); }});
    nextBtn?.addEventListener('click', ()=>{ if ((page+1)*limit < total){ page++; fetchPage(); }});

    createForm?.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const email = (createForm.querySelector('#new-email')?.value||'').trim();
      const pass  = (createForm.querySelector('#new-password')?.value||'').trim();
      if (!email || !pass) return;
      const res = await createUser(email, pass);
      hint && (hint.textContent = res?.error ? ('Create failed: ' + res.error) : 'User created (function).');
      fetchPage();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
