/* Author: Logan Poole — 30083609
   File: /scripts/ui.js
   Purpose: Header/profile dropdown logic. Never show protected UI on public pages.
*/

(function () {
  "use strict";

  // ----- helpers -----
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function getSBish() {
    if (typeof window.getSB === "function") return window.getSB();
    if (window.__sb && window.__sb.auth) return window.__sb;
    if (window.supabase && window.supabase.auth) return window.supabase;
    return null;
  }

  function initialsAvatarData(nameOrEmail, bg, fg) {
    nameOrEmail = nameOrEmail || "";
    bg = bg || "#E6F7F3";
    fg = fg || "#0d7f6e";
    var token = (nameOrEmail || "").trim();
    var name = token.split("@")[0] || token;
    var parts = name.replace(/[_\-.]+/g, " ").trim().split(/\s+/).filter(Boolean);
    var initials = (parts[0] ? parts[0][0] : "U").toUpperCase();
    if (parts.length > 1) initials += (parts[1][0] || "").toUpperCase();

    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'>" +
      "<circle cx='48' cy='48' r='46' fill='" + bg + "' stroke='" + fg + "' stroke-width='2' />" +
      "<text x='50%' y='56%' text-anchor='middle' font-family='Inter, Arial, sans-serif' font-size='42' fill='" + fg + "'>" + initials + "</text>" +
      "</svg>";
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  // ----- profile menu template (protected only) -----
  function profileMenuHTML() {
    return (
      '<div class="profile-menu" data-auth="protected" hidden aria-hidden="true">' +
        '<button id="profileMenuBtn" class="profile-btn" aria-haspopup="true" aria-expanded="false">' +
          '<img id="nav-avatar" class="avatar" alt="Profile" />' +
          '<span id="nav-name" class="nav-name"></span>' +
          '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>' +
        '</button>' +
        '<ul id="nav-dropdown" class="dropdown" role="menu" hidden>' +
          '<li role="none"><button id="dropdownThemeToggle" role="menuitem" type="button">Toggle theme</button></li>' +
          '<li role="none" data-admin="true" hidden><a href="admin/admin.html" role="menuitem">Admin</a></li>' +
          '<li role="none"><button id="signOutBtn" role="menuitem" type="button">Sign out</button></li>' +
        '</ul>' +
      '</div>'
    );
  }

  function ensureProfileContainer(navRight) {
    var existing = qs(".profile-menu", navRight);
    if (existing) return existing;
    navRight.insertAdjacentHTML("beforeend", profileMenuHTML());
    return qs(".profile-menu", navRight);
  }

  // ----- main render -----
  async function loadProfileIntoHeader() {
    var navRight = qs(".nav-right");
    if (!navRight) return;

    var isPublicOnly = (document.body && document.body.getAttribute("data-public-only") === "true");

    // On public pages, force-hide all protected items up-front (no flicker)
    if (isPublicOnly) {
      qsa('[data-auth="protected"]').forEach(function (el) {
        el.hidden = true;
        el.setAttribute("aria-hidden", "true");
      });
    }

    var sb = getSBish();
    var sessionRes = null, user = null;
    try { sessionRes = await sb?.auth?.getSession(); } catch (e) {}
    user = sessionRes && sessionRes.data && sessionRes.data.session && sessionRes.data.session.user || null;

    // Public page policy: NEVER show the profile menu on index.html
    if (isPublicOnly) {
      var pm = qs(".profile-menu", navRight);
      if (pm) { pm.hidden = true; pm.setAttribute("aria-hidden", "true"); }
      return;
    }

    // Protected pages: only show when authenticated
    var wrap = ensureProfileContainer(navRight);
    if (!user) {
      wrap.hidden = true;
      wrap.setAttribute("aria-hidden", "true");
      return;
    }

    // Unhide for authenticated users
    wrap.hidden = false;
    wrap.removeAttribute("aria-hidden");

    var btn = qs("#profileMenuBtn", wrap);
    var list = qs("#nav-dropdown", wrap);
    var nameEl = qs("#nav-name", wrap);
    var avatarEl = qs("#nav-avatar", wrap);
    var adminLi = qs('li[data-admin="true"]', wrap);

    var display =
      (user.user_metadata && (user.user_metadata.display_name || user.user_metadata.name || user.user_metadata.username)) ||
      user.email || "You";

    if (nameEl) nameEl.textContent = display;
    if (avatarEl) {
      var url = user.user_metadata && user.user_metadata.avatar_url;
      avatarEl.src = url || initialsAvatarData(display);
    }

    var allowEmails = (window.__PINGED_ADMIN_EMAILS || []).map(function (s) { return String(s).toLowerCase(); });
    var allowDomains = (window.__PINGED_ADMIN_DOMAINS || []).map(function (s) { return String(s).toLowerCase(); });
    var email = String(user.email || "").toLowerCase();
    var domain = email.split("@")[1] || "";
    var isAdmin = allowEmails.indexOf(email) >= 0 || allowDomains.indexOf(domain) >= 0;
    if (adminLi) adminLi.hidden = !isAdmin;

    if (btn && list) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var open = !list.hidden;
        list.hidden = open;
        btn.setAttribute("aria-expanded", String(!open));
      });
      document.addEventListener("click", function (e) {
        if (!wrap.contains(e.target)) { list.hidden = true; btn.setAttribute("aria-expanded", "false"); }
      });
      var themeBtn = list.querySelector("#dropdownThemeToggle");
      if (themeBtn) themeBtn.addEventListener("click", function () {
        var topBtn = document.getElementById("themeToggle"); if (topBtn) topBtn.click();
      });
      var signOutBtn = list.querySelector("#signOutBtn");
      if (signOutBtn) signOutBtn.addEventListener("click", async function () {
        try { await sb?.auth?.signOut(); } catch (e) {}
        window.location.replace("index.html");
      });
    }
  }

  // ----- boot & auth reactivity -----
  function boot() {
    loadProfileIntoHeader(); // run now
    if (!window.__pingedAuthHooked) {
      window.__pingedAuthHooked = true;
      var sb = getSBish();
      try {
        sb && sb.auth && sb.auth.onAuthStateChange && sb.auth.onAuthStateChange(function () {
          loadProfileIntoHeader();
        });
      } catch (e) {}
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.__pingedUiHeader = { loadProfileIntoHeader: loadProfileIntoHeader, initialsAvatarData: initialsAvatarData };
})();
