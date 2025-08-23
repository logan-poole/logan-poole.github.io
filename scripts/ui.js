/* =============================================================================
FILE: scripts/ui.js  (COMPLETE, UPDATED)
WHAT CHANGED
- Removed previous interception that forced Map into a modal. Now links simply
  navigate to the dedicated pages from the Dashboard (as you requested).
- Kept profile dropdown, auth helpers, toasts, and navbar public/protected toggle.
- Dropdown trimmed to: Dashboard, Settings, Help, Sign out (pages open normally).

REQUIRED
- scripts/config.js must define window.PINGED_CONFIG with SUPABASE keys.
- Include @supabase/supabase-js BEFORE this file.
============================================================================= */

const SUPABASE_URL = (window.PINGED_CONFIG && window.PINGED_CONFIG.SUPABASE_URL) || 'https://upacsqjjvlssyxiasbzw.supabase.co';
const SUPABASE_ANON_KEY = (window.PINGED_CONFIG && window.PINGED_CONFIG.SUPABASE_ANON_KEY) || 'sb_publishable_rxU-cW_q6U1yslbSDGa-fw_JXf3Tm3U';

/* One-and-only Supabase client */
const sb = (window.__sb ||= window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));

/* Hydration state exposed for other pages/scripts */
let __resolveLoadUser;
window.__loadUser = new Promise((res) => { __resolveLoadUser = res; });
window.__currentUser = null;
window.__currentProfile = null;

/* DOM helpers */
const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);

/* Toast */
function showToast(message, variant = 'success', ms = 2200) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = message;
  t.classList.remove('success', 'error'); t.classList.add(variant);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

/* Initials avatar fallback */
function initialsAvatarData(nameOrEmail = '', bg = '#E6F7F3', fg = '#0d7f6e') {
  const s = String(nameOrEmail).trim();
  let initials = '?';
  if (s.includes('@')) initials = s[0]?.toUpperCase() || '?';
  else {
    const [a = '', b = ''] = s.split(/\s+/).filter(Boolean);
    initials = ((a[0] || '') + (b[0] || '')).toUpperCase() || (s[0]?.toUpperCase() || '?');
  }
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>
      <rect width='100%' height='100%' rx='48' fill='${bg}'/>
      <text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle'
        font-family='Verdana,Segoe UI,Arial' font-size='42' fill='${fg}'>${initials}</text>
    </svg>`
  );
  return `data:image/svg+xml;charset=UTF-8,${svg}`;
}

/* ---------------- Header shell + dropdown host ---------------- */
function ensureNavShell() {
  const top = qs('.topnav');
  if (top) {
    top.style.position = top.style.position || 'relative';
    top.style.zIndex = '10050';
  }

  const right = qs('.topnav .nav-right');
  if (!right) return;

  if (!qs('.profile-menu', right)) {
    const wrap = document.createElement('div');
    wrap.className = 'profile-menu';
    wrap.style.position = 'relative';

    const btn = document.createElement('button');
    btn.id = 'profile-trigger';
    btn.className = 'avatar-btn';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');

    const img = document.createElement('img');
    img.id = 'nav-avatar'; img.className = 'avatar-sm'; img.alt = 'Profile';
    btn.appendChild(img);

    const name = document.createElement('span');
    name.id = 'nav-name'; name.className = 'nav-name';

    const list = document.createElement('ul');
    list.id = 'nav-dropdown';
    list.className = 'dropdown hidden';
    list.setAttribute('role', 'menu');
    list.style.zIndex = '10060';

    wrap.append(btn, name, list);
    right.appendChild(wrap);

    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown(); });
    document.addEventListener('click', (e) => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (open && !wrap.contains(e.target)) closeDropdown();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDropdown(); } });
  }
}
function toggleDropdown(force) {
  const btn = $('profile-trigger'), menu = $('nav-dropdown');
  if (!btn || !menu) return;
  const willOpen = typeof force === 'boolean' ? force : (btn.getAttribute('aria-expanded') !== 'true');
  btn.setAttribute('aria-expanded', String(willOpen));
  menu.classList.toggle('hidden', !willOpen);
}
function closeDropdown() { toggleDropdown(false); }

/* ---------------- Dropdown builder ---------------- */
function buildDropdown(sessionUser) {
  const list = $('nav-dropdown'); if (!list) return;
  list.innerHTML = '';

  const addItem = (text, glyph, onClick, danger = false) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'menu-item' + (danger ? ' menu-danger' : ''); b.setAttribute('role', 'menuitem');
    const ic = document.createElement('span'); ic.className = 'menu-icon'; ic.textContent = glyph;
    b.append(ic, document.createTextNode(' ' + text));
    b.addEventListener('click', () => { onClick?.(); closeDropdown(); });
    li.appendChild(b); list.appendChild(li);
  };
  const divider = () => { const d = document.createElement('div'); d.className = 'divider'; const li = document.createElement('li'); li.appendChild(d); list.appendChild(li); };

  if (!sessionUser) {
    addItem('Sign in', '🔑', () => openAuthModal('Sign in'));
    addItem('Sign up', '✍️', () => openAuthModal('Sign up'));
    divider();
    addItem('Help', '❓', openHelpModal);
    return;
  }

  addItem('Dashboard', '🏠', () => location.href = 'dashboard.html');
  addItem('Settings', '⚙️', () => location.href = 'settings.html');
  divider();
  addItem('Help', '❓', openHelpModal);
  addItem('Sign out', '🚪', signOut, true);
}

/* ---------------- Modals (auth/help) ---------------- */
function openModal(title, html) {
  let host = document.getElementById('modal-backdrop');
  if (!host) {
    host = document.createElement('div');
    host.id = 'modal-backdrop'; host.className = 'modal-backdrop hidden';
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-header">
          <h3 id="modal-title" class="modal-title"></h3>
          <button class="modal-close" type="button" aria-label="Close">✕</button>
        </div>
        <div id="modal-body" class="modal-body"></div>
      </div>`;
    document.body.appendChild(host);
    host.addEventListener('click', (e) => { if (e.target === host) closeModal(); });
  }
  const body = $('modal-body'), tt = $('modal-title');
  tt.textContent = title || ''; body.innerHTML = html || '';
  host.classList.remove('hidden'); host.setAttribute('aria-hidden', 'false');
  host.querySelector('.modal-close').onclick = closeModal;
}
function closeModal() { const host = $('modal-backdrop'); if (!host) return; host.classList.add('hidden'); host.setAttribute('aria-hidden', 'true'); }

function openAuthModal(title) {
  openModal(title || 'Account', `
    <div class="card">
      <p class="muted">Sign in or create an account.</p>
      <div class="form-grid">
        <div><label>Email</label><input id="email" type="email" placeholder="you@example.com"></div>
        <div class="input-with-action">
          <label>Password</label>
          <input id="password" type="password" placeholder="••••••••">
          <button class="icon-btn" type="button" data-toggle="#password">👁</button>
        </div>
      </div>
      <div class="btns">
        <button id="btn-signin" class="primary">Sign in</button>
        <button id="btn-signup">Sign up</button>
        <button id="btn-magic">Email me a magic link</button>
        <button id="btn-reset">Forgot password</button>
      </div>
    </div>
  `);
  $('btn-signin')?.addEventListener('click', signIn);
  $('btn-signup')?.addEventListener('click', signUp);
  $('btn-magic')?.addEventListener('click', magicLink);
  $('btn-reset')?.addEventListener('click', resetPassword);

  document.querySelectorAll('.icon-btn[data-toggle]').forEach(btn => {
    const sel = btn.getAttribute('data-toggle'); const input = document.querySelector(sel);
    if (!input) return;
    btn.addEventListener('click', () => {
      input.type = (input.type === 'password') ? 'text' : 'password';
      btn.setAttribute('aria-pressed', input.type === 'text');
    });
  });
}

function openHelpModal() {
  openModal('Help', `<div class="card"><p>See <a href="faq.html">FAQs</a>, <a href="privacy.html">Privacy</a>, <a href="terms.html">Terms</a>, <a href="support.html">Support</a>.</p></div>`);
}

/* ---------------- Auth actions ---------------- */
async function signUp() {
  const email = $('email')?.value?.trim();
  const password = $('password')?.value;
  if (!email || !password) return alert('Enter email and password');
  const { error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: window.location.origin + '/dashboard.html' }
  });
  if (error) return alert(error.message);
  showToast('Check your email to verify.');
}
async function signIn() {
  const email = $('email')?.value?.trim();
  const password = $('password')?.value;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  showToast(`Signed in as ${data?.user?.email ?? email}`);
  closeModal();
  await loadProfileIntoHeader();
  location.href = 'dashboard.html';
}
async function magicLink() {
  const email = $('email')?.value?.trim();
  if (!email) return alert('Enter your email first');
  const { error } = await sb.auth.signInWithOtp({
    email, options: { emailRedirectTo: window.location.origin + '/dashboard.html' }
  });
  if (error) return alert(error.message);
  showToast('Magic link sent. Check your email.');
}
async function resetPassword() {
  const email = $('email')?.value?.trim();
  if (!email) return alert('Enter your email first');
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/dashboard.html'
  });
  if (error) return alert(error.message);
  showToast('Password reset email sent.');
}
async function signOut() {
  await sb.auth.signOut();
  await loadProfileIntoHeader();
  showToast('Signed out');
  if (!location.pathname.endsWith('/index.html')) location.href = 'index.html';
}

/* ---------------- Nav gating ---------------- */
function applyAuthNav(isAuthed) {
  document.querySelectorAll('[data-auth="guest"]').forEach(a => a.classList.toggle('hidden', !!isAuthed));
  document.querySelectorAll('[data-auth="authed"]').forEach(a => a.classList.toggle('hidden', !isAuthed));
  document.querySelectorAll('[data-auth="public"]').forEach(a => a.hidden = !!isAuthed);
  document.querySelectorAll('[data-auth="protected"]').forEach(a => a.hidden = !isAuthed);
}

/* ---------------- Header/profile rendering ---------------- */
async function loadProfileIntoHeader() {
  ensureNavShell();

  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user || null;
  window.__currentUser = user;

  applyAuthNav(!!user);

  const img = $('nav-avatar'), nameEl = $('nav-name');

  if (!user) {
    window.__currentProfile = null;
    if (img) img.src = initialsAvatarData('P');
    if (nameEl) nameEl.textContent = '';
    buildDropdown(null);
    __resolveLoadUser?.();
    return;
  }

  const meta = user.user_metadata || {};
  const metaDisplayName = meta.display_name || meta.username || user.email || '';
  const metaAvatar = meta.profile_pic || meta.avatar_url || initialsAvatarData(metaDisplayName || user.email || 'P');
  if (img) img.src = metaAvatar;
  if (nameEl) nameEl.textContent = metaDisplayName;

  try {
    const { data, error } = await sb.from('users')
      .select('id,username,display_name,profile_pic,visibility,website,bio')
      .eq('id', user.id)
      .maybeSingle();
    if (!error && data) {
      window.__currentProfile = data;
      const displayName = data.display_name || data.username || metaDisplayName;
      const avatarSrc = data.profile_pic || metaAvatar;
      if (img) img.src = avatarSrc;
      if (nameEl) nameEl.textContent = displayName;
    } else {
      window.__currentProfile = {
        id: user.id, username: meta.username || null, display_name: meta.display_name || null,
        profile_pic: metaAvatar, visibility: meta.visibility || 'friends',
        website: meta.website || null, bio: meta.bio || null
      };
    }
  } catch {
    window.__currentProfile = {
      id: user.id, username: meta.username || null, display_name: meta.display_name || null,
      profile_pic: metaAvatar, visibility: meta.visibility || 'friends',
      website: meta.website || null, bio: meta.bio || null
    };
  }

  buildDropdown(user);
  __resolveLoadUser?.();
}

/* ---------------- Auth helpers for pages ---------------- */
async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) { openAuthModal('Sign in'); showToast('Please sign in to continue', 'error'); return false; }
  return true;
}
async function ensureAuthedOrModal() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) { openAuthModal('Sign in'); return false; }
  return true;
}

/* ---------------- Boot ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  ensureNavShell();
  await loadProfileIntoHeader();
  sb.auth.onAuthStateChange(async () => { await loadProfileIntoHeader(); });
});

window.pingedUI = { showToast, openAuthModal, requireAuth, ensureAuthedOrModal };
