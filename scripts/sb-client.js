/* scripts/sb-client.js
   PURPOSE
   - Create ONE Supabase v2 client and expose:
       getSB(): Supabase client instance (or null if misconfigured)
       hasSB(): boolean
   SAFETY
   - If config is missing, logs once and returns null (no spammy retries).
   REQUIREMENTS
   - <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> is loaded first.
   - scripts/config.js set window.PINGED_CONFIG with real values.
*/
(function () {
  let warnedMissing = false;
  let warnedUmd = false;

  function readConfig() {
    const c = window.PINGED_CONFIG || window.PINGED || {};
    return { url: c.SUPABASE_URL || "", key: c.SUPABASE_ANON_KEY || "" };
  }

  function create() {
    const { url, key } = readConfig();
    if (!url || !key) {
      if (!warnedMissing) {
        console.warn("[sb-client] Missing SUPABASE_URL or SUPABASE_ANON_KEY (check scripts/config.js).");
        warnedMissing = true;
      }
      return null;
    }
    if (!window.supabase?.createClient) {
      if (!warnedUmd) {
        console.warn("[sb-client] supabase-js UMD not loaded yet (check script order in HTML).");
        warnedUmd = true;
      }
      return null;
    }
    try {
      const client = window.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { headers: { "x-pinged-client": "web" } }
      });
      try { window.dispatchEvent(new CustomEvent("pinged:sb", { detail: { ok: true } })); } catch {}
      return client;
    } catch (e) {
      console.error("[sb-client] createClient failed:", e);
      return null;
    }
  }

  // Public API
  window.getSB = function getSB() {
    if (window.__sb) return window.__sb;
    window.__sb = create();
    return window.__sb;
  };

  window.hasSB = function hasSB() { return !!window.getSB(); };

  // On DOM ready, try once and hint if not configured
  document.addEventListener("DOMContentLoaded", () => {
    const sb = window.getSB();
    if (!sb) console.warn("[sb-client] Not initialized. Ensure config values and script order are correct.");
  });
})();
