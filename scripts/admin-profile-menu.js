/* Inject Admin links into the existing profile menu on pages that include sb-client + ui.js */
(function () {
    const ADDED_FLAG = "data-admin-links-added";
    function once(fn) { let ran = false; return (...a) => { if (ran) return; ran = true; return fn(...a); }; }

    async function isAdmin(sb) {
        const { data: s } = await sb.auth.getSession();
        if (!s?.session) return false;
        const { data, error } = await sb
            .from("user_roles")
            .select("role")
            .eq("user_id", s.session.user.id)
            .maybeSingle();
        if (error) { console.warn("[admin-profile-menu] role check:", error.message); return false; }
        return !!data && (data.role === "admin" || data.role === "super_admin");
    }

    function findMenuContainer() {
        return (
            document.querySelector("#profile-menu") ||
            document.querySelector(".profile-menu") ||
            document.querySelector("[data-profile-menu]") ||
            document.querySelector(".topnav .dropdown, .topnav .menu, nav .menu, nav .dropdown")
        );
    }

    function makeItem(href, label) {
        const a = document.createElement("a");
        a.href = href;
        a.textContent = label;
        a.className = "menu-item";
        a.style.display = "block";
        a.style.padding = "8px 12px";
        a.style.textDecoration = "none";
        return a;
    }

    function injectIntoMenu(menu) {
        if (!menu || menu.hasAttribute(ADDED_FLAG)) return;
        menu.setAttribute(ADDED_FLAG, "1");

        const hr = document.createElement("div");
        hr.style.borderTop = "1px solid var(--border, #1f2833)";
        hr.style.margin = "6px 0";
        hr.setAttribute("role", "separator");

        const adminHome = makeItem("admin/admin.html", "Admin Console");
        const manageUsers = makeItem("admin/users.html", "Manage Users");

        if (menu.tagName === "UL") {
            const liHr = document.createElement("li"); liHr.appendChild(hr.cloneNode());
            const li1 = document.createElement("li"); li1.appendChild(adminHome);
            const li2 = document.createElement("li"); li2.appendChild(manageUsers);
            menu.appendChild(liHr); menu.appendChild(li1); menu.appendChild(li2);
        } else {
            menu.appendChild(hr);
            menu.appendChild(adminHome);
            menu.appendChild(manageUsers);
        }
    }

    function injectFallbackNav() {
        const nav = document.querySelector(".topnav .nav-right, nav.nav-right");
        if (!nav || document.getElementById("nav-admin")) return;
        const a = document.createElement("a");
        a.id = "nav-admin";
        a.href = "admin/admin.html";
        a.textContent = "Admin";
        nav.insertBefore(a, nav.querySelector("#themeToggle") || nav.lastChild);
    }

    function startObservers() {
        const mo = new MutationObserver(() => {
            const menu = findMenuContainer();
            if (menu) injectIntoMenu(menu);
        });
        mo.observe(document.body, { childList: true, subtree: true });
        const menu = findMenuContainer();
        if (menu) injectIntoMenu(menu); else injectFallbackNav();
    }

    document.addEventListener("DOMContentLoaded", once(async () => {
        const sb = window.getSB?.();
        if (!sb) return;
        try { if (await isAdmin(sb)) startObservers(); }
        catch (e) { console.warn("[admin-profile-menu] cannot determine admin status:", e); }
    }));
})();
