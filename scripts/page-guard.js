(() => {
  const cfg = window.PINGED_CONFIG || {};
  const client =
    window.__sb ||
    (window.supabase && window.supabase.createClient && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
      ? (window.__sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY))
      : null);

  function goHome() {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `index.html?signin=1&next=${next}`;
  }

  if (!client || !client.auth) {
    console.warn('[page-guard] No Supabase client. Redirecting.');
    goHome();
    return;
  }

  client.auth.getSession().then(({ data }) => {
    if (!data?.session) goHome();
  }).catch(() => goHome());
})();