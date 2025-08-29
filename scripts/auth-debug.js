/* scripts/auth-debug.js — probe Supabase wiring */
(function () {
  const out = document.getElementById('out');
  const log = (...a) => { console.log('[auth-debug]', ...a); out.textContent += '\n' + a.map(v=>typeof v==='string'?v:JSON.stringify(v,null,2)).join(' '); };
  const set = (s) => { out.textContent = s; };

  function sb() { return (typeof window.getSB === 'function' ? window.getSB() : null); }

  function ok(b){ return b? 'ok' : 'bad'; }

  async function ping() {
    set('Pinging client…');
    const client = sb();
    if (!client) { set('No client. Check script order and config.js'); return; }
    const cfg = window.PINGED_CONFIG || {};
    set(`Client: ${ok(!!client)}\nURL: ${cfg.SUPABASE_URL}\nAnon key: ${cfg.SUPABASE_ANON_KEY?.slice(0,8)}…`);
  }

  async function getSession() {
    const client = sb(); if (!client) return set('No client.');
    const { data, error } = await client.auth.getSession();
    set('getSession:\n' + JSON.stringify({ data, error }, null, 2));
  }

  async function getUser() {
    const client = sb(); if (!client) return set('No client.');
    const { data, error } = await client.auth.getUser();
    set('getUser:\n' + JSON.stringify({ data, error }, null, 2));
  }

  async function signIn() {
    const client = sb(); if (!client) return set('No client.');
    const email = document.getElementById('si-email').value.trim();
    const password = document.getElementById('si-password').value;
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    set('signInWithPassword:\n' + JSON.stringify({ data, error }, null, 2));
  }

  async function magic() {
    const client = sb(); if (!client) return set('No client.');
    const email = document.getElementById('si-email').value.trim();
    const { data, error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + '/dashboard.html' }
    });
    set('signInWithOtp:\n' + JSON.stringify({ data, error }, null, 2));
  }

  async function signUp() {
    const client = sb(); if (!client) return set('No client.');
    const email = document.getElementById('su-email').value.trim();
    const password = document.getElementById('su-password').value;
    const { data, error } = await client.auth.signUp({
      email, password,
      options: { emailRedirectTo: location.origin + '/dashboard.html' }
    });
    set('signUp:\n' + JSON.stringify({ data, error }, null, 2));
  }

  async function signOut() {
    const client = sb(); if (!client) return set('No client.');
    const { error } = await client.auth.signOut();
    set('signOut:\n' + JSON.stringify({ ok: !error, error }, null, 2));
  }

  document.getElementById('btnPing').onclick = ping;
  document.getElementById('btnSession').onclick = getSession;
  document.getElementById('btnUser').onclick = getUser;
  document.getElementById('btnSignOut').onclick = signOut;
  document.getElementById('si-go').onclick = signIn;
  document.getElementById('si-magic').onclick = magic;
  document.getElementById('su-go').onclick = signUp;

  // Event log
  const client = sb();
  if (client) {
    client.auth.onAuthStateChange((evt, session) => {
      log('EVENT', evt, !!session?.user && session.user.id);
    });
  }
})();
