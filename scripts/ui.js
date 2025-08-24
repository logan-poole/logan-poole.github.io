
/* Profile avatar/dropdown + small helpers; uses getSB() from sb-client.js */
    (function () {
  const $  = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);

    /* ---------- Supabase client (lazy) ---------- */
    function sbClient() {
    // ⚠️ call the getter, don't return the function
    if (typeof window.getSB === 'function') return window.getSB();
    return window.__sb || null;
  }

    /* ---------- Toast ---------- */
    function showToast(message, variant = 'success', ms = 2200) {
      let t = document.querySelector('.toast');
    if (!t) {t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = message;
    t.classList.remove('success','error'); t.classList.add(variant);
    requestAnimationFrame(()=> t.classList.add('show'));
    clearTimeout(t._h); t._h = setTimeout(()=> t.classList.remove('show'), ms);
  }

    /* ---------- Avatar fallback ---------- */
    function initialsAvatarData(nameOrEmail = '', bg = '#E6F7F3', fg = '#0d7f6e') {
    const s = String(nameOrEmail).trim();
    let initials = '?';
    if (s.includes('@')) initials = s[0]?.toUpperCase() || '?';
    else {
      const [a='', b=''] = s.split(/\s+/).filter(Boolean);
    initials = ((a[0]||'')+(b[0]||'')).toUpperCase() || (s[0]?.toUpperCase() || '?');
    }
    const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>
      <rect width='100%' height='100%' rx='48' fill='${bg}' />
      <text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle'
        font-family='Verdana,Segoe UI,Arial' font-size='42' fill='${fg}'>${initials}</text>
    </svg>`
    );
    return `data:image/svg+xml;charset=UTF-8,${svg}`;
  }

    /* ---------- Header shell ---------- */
    function ensureNavShell() {
    const right = qs('.topnav .nav-right'); if (!right) return;
    if (!qs('.profile-menu', right)) {
      const wrap = document.createElement('div'); wrap.className = 'profile-menu'; wrap.style.position='relative';
    const btn  = document.createElement('button'); btn.id='profile-trigger'; btn.className='avatar-btn';
    btn.setAttribute('aria-haspopup','true'); btn.setAttribute('aria-expanded','false');
    const img  = document.createElement('img'); img.id='nav-avatar'; img.className='avatar-sm'; img.alt='Profile'; btn.appendChild(img);
    const name = document.createElement('span'); name.id='nav-name'; name.className='nav-name';
    const list = document.createElement('ul');  list.id='nav-dropdown'; list.className='dropdown hidden'; list.setAttribute('role','menu');
    wrap.append(btn, name, list); right.appendChild(wrap);
      btn.addEventListener('click', (e)=>{e.stopPropagation(); toggleDropdown(); });
      document.addEventListener('click', (e)=>{ const open = btn.getAttribute('aria-expanded')==='true'; if (open && !wrap.contains(e.target)) closeDropdown(); });
      document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') closeDropdown(); });
    }
  }
    function toggleDropdown(force){
    const btn=$('profile-trigger'), menu=$('nav-dropdown'); if(!btn||!menu) return;
    const willOpen = typeof force==='boolean' ? force : (btn.getAttribute('aria-expanded')!=='true');
    btn.setAttribute('aria-expanded', String(willOpen)); menu.classList.toggle('hidden', !willOpen);
  }
    function closeDropdown(){toggleDropdown(false); }

    function openModal(title, html){
      let host = $('modal-backdrop');
    if (!host) {
      host = document.createElement('div'); host.id='modal-backdrop'; host.className='modal-backdrop hidden'; host.setAttribute('aria-hidden','true');
    host.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-header"><h3 id="modal-title" class="modal-title"></h3>
        <button class="modal-close" type="button" aria-label="Close">✕</button></div>
      <div id="modal-body" class="modal-body"></div></div>`;
    document.body.appendChild(host);
      host.addEventListener('click', (e)=>{ if(e.target===host) closeModal(); });
    }
    $('modal-title').textContent = title||''; $('modal-body').innerHTML = html||'';
    host.classList.remove('hidden'); host.setAttribute('aria-hidden','false');
    host.querySelector('.modal-close').onclick = closeModal;
  }
    function closeModal(){ const host=$('modal-backdrop'); if(!host) return; host.classList.add('hidden'); host.setAttribute('aria-hidden','true'); }
    function openHelpModal(){openModal('Help', `<div class="card"><p>See <a href="faq.html">FAQs</a>, <a href="privacy.html">Privacy</a>, <a href="terms.html">Terms</a>, <a href="support.html">Support</a>.</p></div>`); }

    async function signOut(){ const sb = sbClient(); if (!sb) return showToast('Auth not ready','error'); try {await sb.auth.signOut(); } catch { } showToast('Signed out'); if (!location.pathname.endsWith('/index.html')) location.href='index.html'; }

    function buildDropdown(user){
    const list = $('nav-dropdown'); if(!list) return; list.innerHTML='';
    const addItem=(text,glyph,onClick,danger=false)=>{const li=document.createElement('li'); const b=document.createElement('button'); b.type='button'; b.className='menu-item'+(danger?' menu-danger':''); const ic=document.createElement('span'); ic.className='menu-icon'; ic.textContent=glyph; b.append(ic, document.createTextNode(' '+text)); b.addEventListener('click', ()=>{onClick?.(); closeDropdown(); }); li.appendChild(b); list.appendChild(li);};
    const divider=()=>{ const d=document.createElement('div'); d.className='divider'; const li=document.createElement('li'); li.appendChild(d); list.appendChild(li); };

    if (!user) {addItem('Sign in', '🔑', () => window.AuthModals?.open?.('signin')); addItem('Sign up','✍️',()=>window.AuthModals?.open?.('signup')); divider(); addItem('Help','❓',openHelpModal); return; }
    addItem('Dashboard','🏠',()=>location.href='dashboard.html'); addItem('Settings','⚙️',()=>location.href='settings.html'); divider(); addItem('Help','❓',openHelpModal); addItem('Sign out','🚪',signOut,true);
  }

    async function loadProfileIntoHeader(){
      ensureNavShell();
    const img = $('nav-avatar'), nameEl = $('nav-name');
    const sb = sbClient();

    if (!sb) { if (img) img.src = initialsAvatarData('P'); if (nameEl) nameEl.textContent=''; buildDropdown(null); return; }

    let user = null;
    try { const {data, error} = await sb.auth.getUser(); user = (!error && data?.user) ? data.user : null; } catch { }

    if (!user) { if (img) img.src=initialsAvatarData('P'); if (nameEl) nameEl.textContent=''; buildDropdown(null); return; }

    const meta = user.user_metadata || { };
    const display = meta.display_name || meta.full_name || meta.username || meta.name || user.email || '';
    const avatar  = meta.profile_pic || meta.avatar_url || initialsAvatarData(display || user.email || 'P');
    if (img) img.src = avatar; if (nameEl) nameEl.textContent = display;

    // Optional: hydrate from a profile table if you've configured it
    const cfg = window.PINGED_CONFIG?.PROFILE;
    if (cfg?.TABLE && cfg?.ID_COLUMN) {
      try {
        const fields = cfg.FIELDS || 'display_name,username,profile_pic,avatar_url';
    const {data, error} = await sb.from(cfg.TABLE).select(fields).eq(cfg.ID_COLUMN, user.id).maybeSingle();
    if (!error && data) {
          const name = data.display_name || data.username || display;
    const pic  = data.profile_pic || data.avatar_url || avatar;
    if (img) img.src = pic; if (nameEl) nameEl.textContent = name;
        }
      } catch { }
    }
    buildDropdown(user);
  }

  // Boot & keep in sync
  window.__loadUser = (async () => {
    try {await loadProfileIntoHeader(); } catch { }
    const sb = sbClient();
    try {
      const {data, error} = sb ? await sb.auth.getUser() : {data: null, error: true };
    const user = (!error && data?.user) ? data.user : null;
    window.dispatchEvent(new CustomEvent('pinged:auth', {detail: {authed: !!user, user } }));
    } catch {
      window.dispatchEvent(new CustomEvent('pinged:auth', { detail: { authed: false } }));
    }
  })();

    window.addEventListener('pinged:auth', loadProfileIntoHeader);

    // Theme button (works with your theme-toggle.js too)
    (function applySavedTheme(){
    try { const t = localStorage.getItem('theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch { }
  })();

    window.pingedUI = {showToast, openHelpModal};
})();

