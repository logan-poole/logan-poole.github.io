/* Author: Logan Poole — 30083609
   File: /scripts/scripts.js
   Purpose: Public pages header logic (compat-safe)
   - Hides profile & theme toggle when signed out
   - Safe admin check
   - Adds "Admin" badge when applicable
*/

/* ---------------- Tiny helpers ---------------- */
function initialsAvatarData(nameOrEmail, bg, fg) {
  if (nameOrEmail === void 0) nameOrEmail = "";
  if (bg === void 0) bg = "#E6F7F3";
  if (fg === void 0) fg = "#0d7f6e";
  var s = String(nameOrEmail).trim();
  var initials = "?";
  if (s.indexOf("@") !== -1) {
    initials = (s[0] || "?").toUpperCase();
  } else {
    var parts = s.split(/\s+/).filter(Boolean);
    var a = parts[0] || "", b = parts[1] || "";
    initials = ((a[0] || "") + (b[0] || "")).toUpperCase() || (s[0] || "?").toUpperCase();
  }
  var svg = encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>\
      <rect width='100%' height='100%' rx='48' fill='"+bg+"'/>\
      <text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle'\
        font-family='Verdana,Segoe UI,Arial' font-size='42' fill='"+fg+"'>"+initials+"</text>\
    </svg>"
  );
  return "data:image/svg+xml;charset=UTF-8," + svg;
}

function qs(sel, root){ return (root||document).querySelector(sel); }
function qsa(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }

function showAuthProtected(show) {
  qsa('[data-auth="protected"]').forEach(function(el){ el.hidden = !show; });
  qsa('[data-auth="public"]').forEach(function(el){ el.hidden = show; });
}

function getSBish() {
  try {
    if (typeof window.getSB === "function") return window.getSB();
    if (window.__sb && window.__sb.auth) return window.__sb;
    if (window.supabase && window.supabase.auth) return window.supabase;
  } catch (e) {}
  return null;
}

/* ---------------- Header shell (appears when signed in) ---------------- */
function ensureNavShell() {
  var right = qs(".topnav .nav-right");
  if (!right) return;

  if (!qs(".profile-menu", right)) {
    var wrap = document.createElement("div");
    wrap.className = "profile-menu";
    wrap.style.position = "relative";
    wrap.setAttribute("data-auth", "protected");
    wrap.hidden = true;

    var btn = document.createElement("button");
    btn.id = "profileMenuBtn";
    btn.className = "avatar-btn";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.type = "button";

    var img = document.createElement("img");
    img.id = "nav-avatar";
    img.className = "avatar-sm";
    img.alt = "Profile";
    btn.appendChild(img);

    var name = document.createElement("span");
    name.id = "nav-name";
    name.className = "nav-name";

    var list = document.createElement("ul");
    list.id = "nav-dropdown";
    list.className = "dropdown hidden";
    list.setAttribute("role", "menu");
    list.innerHTML = '\
      <li><a href="dashboard.html" role="menuitem">Dashboard</a></li>\
      <li><a href="profile.html" role="menuitem">Profile</a></li>\
      <li data-admin="true" hidden><a href="admin/admin.html" role="menuitem">Admin</a></li>\
      <li><hr class="sep"></li>\
      <li><button type="button" class="linklike" id="nav-signout" role="menuitem">Sign out</button></li>';

    wrap.appendChild(btn);
    wrap.appendChild(name);
    wrap.appendChild(list);
    right.appendChild(wrap);

    // Dropdown behaviour
    btn.addEventListener("click", function () {
      var expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      if (expanded) list.classList.add("hidden"); else list.classList.remove("hidden");
    });
    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) {
        btn.setAttribute("aria-expanded", "false");
        list.classList.add("hidden");
      }
    });

    // Sign out
    var signoutBtn = list.querySelector("#nav-signout");
    if (signoutBtn) {
      signoutBtn.addEventListener("click", async function () {
        try {
          var sb = getSBish();
          if (sb && sb.auth && typeof sb.auth.signOut === 'function') {
            await sb.auth.signOut();
          }
        } catch (e) { console.warn("[signout]", e); }
        window.location.replace("index.html");
      });
    }
  }
}

/* ---------------- Admin check (safe) ---------------- */
async function userIsAdmin(sb, user) {
  if (!user || !user.id) return false;

  var roles = ((user.user_metadata && user.user_metadata.roles) || []).map(function(r){ return String(r).toLowerCase(); });
  var byMeta = roles.indexOf("admin") !== -1 || roles.indexOf("super_admin") !== -1;

  var allowEmails = (window.__PINGED_ADMIN_EMAILS || []).map(function(s){ return String(s).toLowerCase(); });
  var allowDomains = (window.__PINGED_ADMIN_DOMAINS || []).map(function(s){ return String(s).toLowerCase(); });
  var email = String(user.email || "").toLowerCase();
  var domain = email.split("@")[1] || "";
  var byAllow = allowEmails.indexOf(email) !== -1 || allowDomains.indexOf(domain) !== -1;

  async function fetchBy(col){
    try{
      var PROFILE_TABLE = window.__PINGED_PROFILE_TABLE || "profiles";
      var q = sb && sb.from ? sb.from(PROFILE_TABLE).select("*").eq("user_id", user.id).maybeSingle() : null;
      var res = q ? await q : null;
      var data = res ? res.data : null;
      return !!(data && (data.role === "admin" || data.role === "super_admin" || data[col] === true));
    }catch(e){
      return false;
    }
  }

  return byMeta || byAllow || (await fetchBy("is_admin"));
}

/* ---------------- Load header state ---------------- */
async function loadProfileIntoHeader() {
  ensureNavShell();

  var sb = getSBish();
  var user = null;
  try{
    if (sb && sb.auth && typeof sb.auth.getUser === 'function') {
      var got = await sb.auth.getUser();
      user = got && got.data ? got.data.user : null;
    }
  }catch(e){}

  showAuthProtected(!!user);

  var avatarEl = qs("#nav-avatar");
  var nameEl = qs("#nav-name");
  var adminLi = qs('li[data-admin="true"]');

  if (!user) {
    if (avatarEl) avatarEl.src = "assets/avatar-default.png";
    if (nameEl) nameEl.textContent = "";
    if (adminLi) adminLi.hidden = true;
    return;
  }

  var display =
    (user.user_metadata && (user.user_metadata.display_name || user.user_metadata.name || user.user_metadata.username)) ||
    user.email || "You";

  if (avatarEl) {
    var url = user.user_metadata && user.user_metadata.avatar_url;
    avatarEl.src = url || initialsAvatarData(display);
  }

  var isAdmin = false;
  try { isAdmin = await userIsAdmin(sb, user); } catch(e){ isAdmin = false; }
  window.__pingedIsAdmin = isAdmin;
  try { window.dispatchEvent(new CustomEvent("user:isAdmin", { detail: isAdmin })); } catch(e){}

  if (nameEl) {
    nameEl.textContent = display;
    if (isAdmin) {
      nameEl.insertAdjacentHTML("beforeend", ' <span class="role-badge" title="Admin">Admin</span>');
    }
  }
  if (adminLi) adminLi.hidden = !isAdmin;
}

document.addEventListener("DOMContentLoaded", loadProfileIntoHeader);

if (!window.__pingedAuthHooked) {
  window.__pingedAuthHooked = true;
  var sbHook = getSBish();
  try {
    if (sbHook && sbHook.auth && typeof sbHook.auth.onAuthStateChange === 'function') {
      sbHook.auth.onAuthStateChange(function(){
        try { window.dispatchEvent(new Event("pinged:auth")); } catch(e){}
      });
    }
  } catch (e) {}
}
window.addEventListener("pinged:auth", loadProfileIntoHeader);

// Export (optional)
window.__pingedHeader = { loadProfileIntoHeader: loadProfileIntoHeader, initialsAvatarData: initialsAvatarData };
