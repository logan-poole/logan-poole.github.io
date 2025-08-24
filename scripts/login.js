// scripts/login.js
// PURPOSE
// - Handle the index login form in a resilient way.
// - Give clear error messages in UI + console.
// USAGE
// - Ensure index.html has: <form id="login-form"> with #email and #password inputs
// - Include after the Supabase UMD bundle, config.js, and auth-guard.js

(function () {
  function qs(sel, root = document) { return root.querySelector(sel); }

  // Pre-flight checks
  const cfg = window.PINGED_CONFIG || {};
  const URL = cfg.SUPABASE_URL || "";
  const KEY = cfg.SUPABASE_ANON_KEY || "";
  if (!URL || !KEY) {
    console.error("[login] Missing SUPABASE_URL or SUPABASE_ANON_KEY in scripts/config.js");
  }
  if (!window.__sb) {
    if (!window.supabase || !window.supabase.createClient) {
      console.error("[login] supabase-js not loaded. Include UMD before this file.");
      return;
    }
    window.__sb = window.supabase.createClient(URL, KEY);
  }
  const sb = window.__sb;

  const form = qs("#login-form");
  const emailEl = qs("#email");
  const passEl  = qs("#password");
  const msgEl   = qs("#login-msg");

  if (!form || !emailEl || !passEl) {
    console.error("[login] Missing form or input elements (#login-form, #email, #password).");
    return;
  }

  function showMsg(text, isError = false) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.style.display = "block";
    msgEl.className = "notice" + (isError ? " warn" : " ok");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (msgEl) msgEl.style.display = "none";

    const email = (emailEl.value || "").trim();
    const password = passEl.value || "";

    if (!email || !password) {
      showMsg("Please enter your email and password.", true);
      return;
    }

    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        console.error("[login] signInWithPassword error:", error);
        showMsg(error.message || "Login failed. Please check your credentials.", true);
        return;
      }
      // Success → route to next or dashboard
      const params = new URLSearchParams(location.search);
      const next = params.get("next") || "dashboard.html";
      showMsg("Signed in. Redirecting…");
      location.replace(next);
    } catch (err) {
      console.error("[login] Unexpected error:", err);
      showMsg("Unexpected error during login. See console for details.", true);
    }
  });

  // If already logged in, show a small notice at the top of the page
  sb.auth.getSession().then(({ data }) => {
    if (data?.session) {
      const notice = document.createElement("div");
      notice.className = "notice ok";
      notice.style.margin = "0 auto 16px";
      notice.textContent = "You're already signed in — use Dashboard, Feed, or Map.";
      const host = qs("main") || document.body;
      host.prepend(notice);
    }
  });
})();
