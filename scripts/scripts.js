/* =========================================================
   Pinged - Shared UI (header avatar + dropdown + modals)
   Uses Supabase UMD as window.supabase
   ========================================================= */

const SUPABASE_URL = 'https://upacsqjjvlssyxiasbzw.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYWNzcWpqdmxzc3l4aWFzYnp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI0NTM5MzksImV4cCI6MjA2ODAyOTkzOX0.iJ_ykF_SSsRylvccCo7u9KC7-vQBf7G8lPUaFUrPgn4';

// Create/reuse a single client
const sb = window.__sb || (window.__sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));

const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);

function showToast(message, variant = 'success', ms = 2200) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.classList.remove('success', 'error'); t.classList.add(variant);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

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

/* ---------------- Header shell + modal host ---------------- */
function ensureNavShell() {
  const right = qs('.topnav .nav-right');
  if (!right) return;

  if (!qs('.profile-menu', right)) {
    const wrap = document.createElement('div');
    wrap.className = 'profile-menu';

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
    list.id = 'nav-dropdown'; list.className = 'dropdown hidden';
    list.setAttribute('role', 'menu');

    wrap.append(btn, name, list);
    right.appendChild(wrap);

    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown(); });
    document.addEventListener('click', (e) => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (!open) return;
      if (!wrap.contains(e.target)) closeDropdown();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeDropdown(); closeModal(); }
    });
  }

  if (!$('modal-backdrop')) {
    const host = document.createElement('div');
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
    qs('.modal-close', host).addEventListener('click', closeModal);
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

/* ---------------- Dropdown (no top name label) ---------------- */
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

  addItem('Feed', '📰', () => location.href = 'feed.html');
  addItem('Map', '🗺️', () => location.href = 'map.html');
  addItem('Settings', '⚙️', openSettingsModal);
  addItem('Friends', '👥', openFriendsModal);
  addItem('Messages', '💬', openMessagesModal);
  divider();
  addItem('Help', '❓', openHelpModal);
  addItem('Sign out', '🚪', signOut, true);
}

/* ---------------- Modals ---------------- */
function openModal(title, html) {
  const host = $('modal-backdrop'), body = $('modal-body'), tt = $('modal-title');
  if (!host || !body || !tt) return;
  tt.textContent = title || '';
  body.innerHTML = html || '';
  host.classList.remove('hidden');
  host.setAttribute('aria-hidden', 'false');
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
  // eye toggle
  document.querySelectorAll('.icon-btn[data-toggle]').forEach(btn => {
    const sel = btn.getAttribute('data-toggle'); const input = document.querySelector(sel);
    if (!input) return;
    btn.addEventListener('click', () => {
      input.type = (input.type === 'password') ? 'text' : 'password';
      btn.setAttribute('aria-pressed', input.type === 'text');
    });
  });
}

function openSettingsModal() {
  openModal('Settings', `
    <div class="card" id="profile-card">
      <div class="form-grid">
        <div><label>Username</label><input id="username" type="text"></div>
        <div><label>Display name</label><input id="display_name" type="text"></div>
        <div><label>Website</label><input id="website" type="text" placeholder="https://example.com"></div>
        <div>
          <label>Visibility</label>
          <select id="visibility">
            <option value="public">public</option>
            <option value="friends">friends</option>
            <option value="private">private</option>
          </select>
        </div>
        <div style="grid-column:1 / -1">
          <label>Bio</label><textarea id="bio" placeholder="A short bio…"></textarea>
        </div>
      </div>

      <div class="section avatar-wrap">
        <img id="avatar" class="avatar" alt="Avatar">
        <input id="avatar-file" type="file" accept="image/png,image/jpeg">
      </div>

      <div class="btns">
        <button id="btn-save" class="primary">Save</button>
      </div>
    </div>
  `);

  // load current profile into the modal fields
  (async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const m = user.user_metadata || {};
    const username = m.username || (user.email ? user.email.split('@')[0] : '');
    const display = m.display_name || username;

    const set = (id, val) => { const el = $(id); if (el) el.value = val ?? ''; };
    set('username', username);
    set('display_name', display);
    set('website', m.website || '');
    set('bio', m.bio || '');
    if ($('visibility')) $('visibility').value = m.visibility || 'friends';
    if ($('avatar')) $('avatar').src = m.profile_pic || m.avatar_url || initialsAvatarData(display || user.email || '');
  })();

  $('btn-save')?.addEventListener('click', async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return showToast('Not signed in', 'error');

    const payload = {
      username: $('username')?.value?.trim() || null,
      website: $('website')?.value?.trim() || null,
      bio: $('bio')?.value?.trim() || null,
      display_name: $('display_name')?.value?.trim() || null,
      visibility: $('visibility')?.value || 'friends'
    };

    // save to auth metadata (for quick reads)
    await sb.auth.updateUser({ data: payload });

    // also mirror username/visibility into your public.users table
    await sb.from('users')
      .upsert({ id: user.id, username: payload.username, visibility: payload.visibility }, { onConflict: 'id' });

    showToast('Saved', 'success');
    await refreshNav();
    closeModal();
  });

  $('avatar-file')?.addEventListener('change', () => showToast('Avatar upload not wired yet', 'error'));
}
function openFriendsModal() { openModal('Friends', `<div class="card"><p class="muted">Friends UI placeholder.</p></div>`); }
function openMessagesModal() { openModal('Messages', `<div class="card"><p class="muted">Messages placeholder.</p></div>`); }
function openHelpModal() { openModal('Help', `<div class="card"><p>See <a href="faq.html">FAQs</a>, <a href="privacy.html">Privacy</a>, <a href="terms.html">Terms</a>, <a href="support.html">Support</a>.</p></div>`); }

/* ---------------- Auth actions ---------------- */
async function signUp() {
  const email = $('email')?.value?.trim();
  const password = $('password')?.value;
  if (!email || !password) return alert('Enter email and password');
  const { error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: window.location.origin + '/feed.html' }
  });
  if (error) return alert(error.message);
  showToast('Check your email to verify.', 'success');
}
async function signIn() {
  const email = $('email')?.value?.trim();
  const password = $('password')?.value;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  showToast(`Signed in as ${data?.user?.email ?? email}`, 'success');
  closeModal();
  location.href = 'feed.html';
}
async function magicLink() {
  const email = $('email')?.value?.trim();
  if (!email) return alert('Enter your email first');
  const { error } = await sb.auth.signInWithOtp({
    email, options: { emailRedirectTo: window.location.origin + '/feed.html' }
  });
  if (error) return alert(error.message);
  showToast('Magic link sent. Check your email.', 'success');
}
async function resetPassword() {
  const email = $('email')?.value?.trim();
  if (!email) return alert('Enter your email first');
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/feed.html'
  });
  if (error) return alert(error.message);
  showToast('Password reset email sent.', 'success');
}
async function signOut() {
  await sb.auth.signOut();
  showToast('Signed out');
  await refreshNav();
  location.href = 'index.html';
}

/* ---------------- Nav refresh ---------------- */
async function refreshNav() {
  ensureNavShell();
  const { data: { user } } = await sb.auth.getUser();
  const img = $('nav-avatar'), nameEl = $('nav-name');

  if (user) {
    const m = user.user_metadata || {};
    const display = m.display_name || m.username || user.email || '';
    img.src = m.profile_pic || m.avatar_url || initialsAvatarData(display || user.email || '');
    nameEl.textContent = display;
    buildDropdown(user);
  } else {
    img.src = initialsAvatarData('P');
    nameEl.textContent = '';
    buildDropdown(null);
  }
}

/* ---------------- Boot ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  ensureNavShell();
  await refreshNav();

  sb.auth.onAuthStateChange(async () => { await refreshNav(); });
});
