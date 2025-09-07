/* scripts/sb-client.js
   PURPOSE
   - Create ONE Supabase v2 client and expose helpers:
       window.getSB()            -> Supabase client or null
       window.hasSB()            -> boolean
       window.sbAuthedFetch(url, opts) -> fetch with Bearer <JWT>
       window.callSupabaseFn(name, { method, query, body, headers }) -> call Edge Functions with JWT
       window.getSignedAvatarUrl(path) -> signed URL for avatars bucket
   - Attaches the instance to window.__sb (and window.sb for convenience).

   REQUIREMENTS
   - scripts/config.js loaded first (sets window.PINGED_CONFIG = { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTIONS_BASE? })
   - <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
*/
(function () {
  let instance = null;
  let warned = false;

  function ensureSupabaseUMD() {
    if (window.supabase && typeof window.supabase.createClient === "function") return true;
    if (!warned) {
      console.error("[sb-client] @supabase/supabase-js v2 UMD not found. Include it BEFORE this script.");
      warned = true;
    }
    return false;
  }

  function ensureConfig() {
    const cfg = window.PINGED_CONFIG || window.PINGED || {};
    const url = cfg.SUPABASE_URL;
    const key = cfg.SUPABASE_ANON_KEY;
    if (!url || !key) {
      if (!warned) console.error("[sb-client] Missing SUPABASE_URL or SUPABASE_ANON_KEY in scripts/config.js");
      warned = true;
      return null;
    }
    return {
      url,
      key,
      functionsBase: cfg.FUNCTIONS_BASE || "/functions/v1", // absolute domain preferred in prod; path ok for local proxy
      buckets: cfg.BUCKETS || {},
    };
  }

  function create() {
    const cfg = ensureConfig();
    if (!cfg) return null;
    if (!ensureSupabaseUMD()) return null;

    try {
      const sb = window.supabase.createClient(cfg.url, cfg.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: "pinged-auth", // namespace to avoid collisions
        },
        global: { headers: { "x-client-info": "PingedWeb/1.0" } }
      });

      // Save base + buckets for helper functions
      sb.__functionsBase = cfg.functionsBase;
      sb.__buckets = cfg.buckets;
      return sb;
    } catch (e) {
      console.error("[sb-client] createClient failed:", e);
      return null;
    }
  }

  // Public: get/create singleton
  window.getSB = function getSB() {
    if (instance) return instance;
    instance = create();
    window.__sb = instance;
    window.sb = instance; // convenience alias in DevTools
    return instance;
  };

  // Public: quick boolean
  window.hasSB = function hasSB() {
    return !!window.getSB();
  };

  // Helper: fetch with JWT from current session
  window.sbAuthedFetch = async function sbAuthedFetch(url, opts = {}) {
    const sb = window.getSB();
    if (!sb) throw new Error("Supabase not initialised");
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;

    const headers = new Headers(opts.headers || {});
    if (!headers.has("Content-Type") && opts.body && typeof opts.body === "object") {
      headers.set("Content-Type", "application/json");
    }
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const init = { ...opts, headers };
    if (init.body && headers.get("Content-Type") === "application/json" && typeof init.body !== "string") {
      init.body = JSON.stringify(init.body);
    }
    return fetch(url, init);
  };

  // Helper: call an Edge Function by name with JWT and optional query/body
  window.callSupabaseFn = async function callSupabaseFn(name, { method = "GET", query = {}, body = null, headers = {} } = {}) {
    const sb = window.getSB();
    if (!sb) throw new Error("Supabase not initialised");
    const base = sb.__functionsBase || "/functions/v1";
    const isAbsolute = /^https?:\/\//i.test(base);

    // Build URL: absolute base (functions domain) or relative path (local proxy)
    const full = isAbsolute ? `${base.replace(/\/+$/, "")}/${name}` : `${base.replace(/\/+$/, "")}/${name}`;
    const url = new URL(full, isAbsolute ? undefined : window.location.origin);
    Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));

    const res = await window.sbAuthedFetch(url.toString(), { method, headers, body });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (!res.ok) {
      const err = new Error(json?.error || `Function ${name} failed (${res.status})`);
      err.status = res.status;
      err.details = json?.details || json?.raw || null;
      throw err;
    }
    return json;
  };

  // Helper: signed avatar URL from Storage (1h)
  window.getSignedAvatarUrl = async function getSignedAvatarUrl(path) {
    if (!path) return null;
    const sb = window.getSB?.();
    const bucket = (sb?.__buckets?.AVATARS) || "avatars";
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
    if (error) { console.warn("[avatar] sign failed:", error.message); return null; }
    return data?.signedUrl ?? null;
  };

  // Warn if not initialised once DOM is ready (helps catch script order issues)
  document.addEventListener("DOMContentLoaded", () => {
    if (!window.getSB()) {
      console.warn("[sb-client] Not initialised. Check script order and config values.");
    }
  });
})();
