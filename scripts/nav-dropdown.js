/* scripts/nav-dropdown.js (v17)
   Single avatar → dropdown with role, links, theme toggle & logout.
   - Forces header theme button hidden (lives in the menu instead)
   - Robust avatar source (config column, user_metadata, fallback)
*/
(() => {
  const CFG = window.PINGED_CONFIG || {};
  const TBL_PROFILES = CFG.TABLES?.PROFILES || 'profiles';
  const AVATAR_COL   = (CFG.PROFILE && CFG.PROFILE.AVATAR_COLUMN) || 'avatar_url';
  const ORDER = ['Dashboard','Map','Chat','Feed','Friends','Settings'];

  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => [...r.querySelectorAll(s)];
  const cap = s => (s||'').slice(0,1).toUpperCase() + (s||'').slice(1);

  function roleFromProfile(p){
    const raw = String(p?.role || '').trim().toLowerCase();
    if (p?.is_admin || raw === 'admin') return 'Admin';
    if (raw) return cap(raw);
    return 'Member';
  }

  // Only clean old bits; keep our wrapper
  function clean(navRight, keepWrap){
    qsa('.nav-name, img.avatar-sm, .avatar-btn, .profile-menu', navRight)
      .forEach(n => { if (!keepWrap || (n !== keepWrap && !keepWrap.contains(n))) n.remove(); });
  }

  function buildMenuItem(href, label, extraNode){
    const li = document.createElement('li');
    const a  = document.createElement('a');
    a.href = href; a.textContent = label; a.setAttribute('role','menuitem');
    li.appendChild(a);
    if (extraNode){ extraNode.style.marginLeft='6px'; a.appendChild(extraNode); }
    return li;
  }

  // Theme helpers
  const getTheme  = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const setTheme  = (t) => { document.documentElement.setAttribute('data-theme', t); try{localStorage.setItem('PINGED_THEME', t);}catch{} };
  const toggleTheme = () => {
    const legacy = qs('#themeToggle');
    if (legacy) { legacy.click(); return; } // reuse existing logic if present
    setTheme(getTheme()==='dark' ? 'light' : 'dark');
  };

  async function getSession(){
    try { const { data } = await getSB().auth.getSession(); return data?.session || null; }
    catch { return null; }
  }

  async function getProfileRow(id){
    try{
      const cols = `id,username,display_name,full_name,role,is_admin,${AVATAR_COL}`;
      const rows = await sbRest.from(TBL_PROFILES).select(cols).eq('id', id).limit(1);
      return rows?.[0] || null;
    } catch { return null; }
  }

  // Pick best avatar source
  function pickAvatar(profile, session){
    const meta = session?.user?.user_metadata || {};
    return (
      profile?.[AVATAR_COL] ||
      meta.avatar_url ||
      meta.picture ||
      meta.image ||
      'assets/avatar.png'
    );
  }

  function mount(navRight){
    // 1) Hide header text links & header theme toggle
    const protectedLinks = qsa('a[data-auth="protected"]', navRight);
    protectedLinks.forEach(a => (a.hidden = true));

    const legacyThemeBtn = qs('#themeToggle', navRight);
    if (legacyThemeBtn) {
      legacyThemeBtn.hidden = true;
      legacyThemeBtn.style.display = 'none';
      legacyThemeBtn.setAttribute('aria-hidden','true');
    }

    // 2) Build wrapper
    const wrap = document.createElement('div');
    wrap.className = 'profile-menu';

    // Avatar button
    const btn = document.createElement('button');
    btn.id = 'profileMenuBtn';
    btn.type = 'button';
    btn.className = 'avatar-btn';
    btn.setAttribute('aria-haspopup','menu');
    btn.setAttribute('aria-expanded','false');
    btn.setAttribute('aria-label','Open profile menu');

    const img = document.createElement('img');
    img.id = 'navAvatar';
    img.className = 'avatar-sm';
    img.alt = '';
    img.src = 'assets/avatar.png';
    img.onerror = () => { img.onerror = null; img.src = 'assets/avatar.png'; };
    btn.appendChild(img);

    // Role pill (always visible in header)
    const rolePill = document.createElement('span');
    rolePill.id = 'navRolePill';
    rolePill.className = 'role-badge role-pill';
    rolePill.textContent = '…';
    rolePill.style.marginLeft = '8px';

    // Dropdown
    const menu = document.createElement('ul');
    menu.id = 'profileMenuList';
    menu.className = 'dropdown';
    menu.setAttribute('role','menu');
    menu.hidden = true;

    const header = document.createElement('li');
    header.className = 'menu-heading';
    header.innerHTML = `<strong>Loading…</strong>`;
    menu.appendChild(header);

    const div0 = document.createElement('li'); div0.className = 'divider'; menu.appendChild(div0);

    // Links in menu
    protectedLinks
      .sort((a,b) => ORDER.indexOf(a.textContent.trim()) - ORDER.indexOf(b.textContent.trim()))
      .forEach(a => {
        const txt = a.textContent.trim();
        let badge = null;
        if (/friends/i.test(txt)){
          const nb = document.getElementById('nav-friends-badge');
          if (nb) badge = nb.cloneNode(true);
        }
        menu.appendChild(buildMenuItem(a.href, txt, badge));
      });

    // Optional Admin link if present
    const adminA = qs('#nav-admin') || qsa('a', navRight).find(a => /admin/i.test(a.textContent));
    if (adminA) menu.appendChild(buildMenuItem(adminA.href || 'admin.html', 'Admin'));

    const div1 = document.createElement('li'); div1.className = 'divider'; menu.appendChild(div1);

    // Theme toggle INSIDE the menu
    const liTheme = document.createElement('li');
    const btnTheme = document.createElement('button');
    btnTheme.type = 'button';
    btnTheme.className = 'menu-item';
    const setThemeLabel = () => {
      const mode = getTheme();
      btnTheme.textContent = (mode === 'dark') ? 'Switch to Light mode' : 'Switch to Dark mode';
    };
    setThemeLabel();
    btnTheme.addEventListener('click', () => { toggleTheme(); setThemeLabel(); });
    liTheme.appendChild(btnTheme);
    menu.appendChild(liTheme);

    // Logout
    const liLogout = document.createElement('li');
    const btnLogout = document.createElement('button');
    btnLogout.type = 'button';
    btnLogout.id = 'navLogout';
    btnLogout.className = 'menu-item menu-danger';
    btnLogout.textContent = 'Log out';
    liLogout.appendChild(btnLogout);
    menu.appendChild(liLogout);

    // Insert
    navRight.appendChild(wrap);
    wrap.appendChild(btn);
    wrap.appendChild(rolePill);
    wrap.appendChild(menu);

    // Open/close
    const open  = () => { menu.hidden = false; btn.setAttribute('aria-expanded','true'); };
    const close = () => { menu.hidden = true;  btn.setAttribute('aria-expanded','false'); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden ? open() : close(); });
    document.addEventListener('click', (e) => {
      if (menu.hidden) return;
      if (btn.contains(e.target) || menu.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // Fill profile (avatar + role + header info)
    (async () => {
      const session = await getSession();
      const sid = session?.user?.id;
      // Try bootstrap globals first (if your other script already fetched it)
      const boot = window.PINGED_PROFILE || window.PINGED_ME || null;

      let profile = boot && sid && (boot.id === sid) ? boot : null;
      if (!profile && sid) profile = await getProfileRow(sid);

      const display = profile?.display_name || profile?.full_name || session?.user?.user_metadata?.name || profile?.username || 'Me';
      const roleLabel = roleFromProfile(profile);
      rolePill.textContent = roleLabel;

      // avatar src (with robust fallbacks)
      const src = pickAvatar(profile, session);
      if (src) img.src = src;

      header.innerHTML =
        `<div style="display:flex;align-items:center;gap:8px;">
           <img src="${img.src}" alt="" class="avatar-sm" style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border);" />
           <div style="display:flex;flex-direction:column;">
             <strong>${display}</strong>
             <span class="muted">@${profile?.username || session?.user?.user_metadata?.preferred_username || 'user'}</span>
           </div>
           <span class="role-badge" style="margin-left:auto;">${roleLabel}</span>
         </div>`;
    })();

    // Logout
    btnLogout.addEventListener('click', async () => {
      try { await getSB().auth.signOut(); } catch {}
      location.href = 'index.html';
    });

    // Keep only one menu & keep header theme button hidden if anything toggles it later
    const mo = new MutationObserver(() => {
      clean(navRight, wrap);
      const t = qs('#themeToggle', navRight);
      if (t) { t.hidden = true; t.style.display = 'none'; t.setAttribute('aria-hidden','true'); }
    });
    mo.observe(navRight, { childList:true, subtree:true });

    // Initial clean sweep
    clean(navRight, wrap);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const navRight = qs('.topnav .nav-right');
    if (!navRight) return;
    // Defer a tick to let other deferred scripts run
    setTimeout(() => mount(navRight), 0);
  });
})();
