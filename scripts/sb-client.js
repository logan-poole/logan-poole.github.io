
(function () {
  let warned = false;

  function warnOnce(msg){ if(!warned){ console.warn(msg); warned = true; } }

  function readConfig() {
    // Accept either namespace for backwards-compat
    const a = window.PINGED_CONFIG || window.PINGED || {};
    return {
      SUPABASE_URL: a.SUPABASE_URL,
      SUPABASE_ANON_KEY: a.SUPABASE_ANON_KEY
    };
  }

  function makeClient() {
    const cfg = readConfig();
    const NS = window.supabase;
    if (!NS?.createClient) {
      warnOnce('[sb-client] supabase-js not loaded yet (check CDN script order).');
      return null;
    }
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      warnOnce('[sb-client] Missing SUPABASE_URL or SUPABASE_ANON_KEY in scripts/config.js');
      return null;
    }
    try {
      return NS.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    } catch (e) {
      console.warn('[sb-client] createClient failed:', e);
      return null;
    }
  }

  window.getSB = function getSB() {
    if (window.__sb) return window.__sb;
    window.__sb = makeClient();
    if (window.__sb) {
      try { window.dispatchEvent(new CustomEvent('pinged:sb', { detail: { ok: true } })); } catch {}
    }
    return window.__sb;
  };

  window.hasSB = function hasSB() { return !!window.getSB(); };

  // Eagerly build the client so auth-guard has it immediately
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.hasSB()) console.warn('[sb-client] Not initialized. Check load order & config.');
  });
})();
