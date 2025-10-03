// scripts/nav-dropdown.js
(() => {
  const byTextOrder = ['Dashboard','Map','Chat','Feed','Friends','Settings'];

  function buildMenuItem(href, label, extraNode) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.setAttribute('role', 'menuitem');
    a.href = href;
    a.textContent = label;
    li.appendChild(a);
    if (extraNode) {
      extraNode.style.marginLeft = '6px';
      a.appendChild(extraNode);
    }
    return li;
  }

  function open(menu, btn)  { menu.hidden = false;  btn.setAttribute('aria-expanded', 'true'); }
  function close(menu, btn) { menu.hidden = true;   btn.setAttribute('aria-expanded', 'false'); }

  async function getSession() {
    try { const { data } = await getSB().auth.getSession(); return data?.session || null; }
    catch { return null; }
  }

  async function getAvatarUrl(userId) {
    try {
      const T = (window.PINGED_CONFIG?.TABLES?.PROFILES) || 'profiles';
      const rows = await sbRest.from(T).select('avatar_url').eq('id', userId).limit(1);
      return rows?.[0]?.avatar_url || null;
    } catch { return null; }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const navRight = document.querySelector('.topnav .nav-right');
    if (!navRight) return;

    const session = await getSession();
    const isAuthed = !!session?.user;

    // Collect the links that are marked as protected
    const protectedLinks = [...navRight.querySelectorAll('a[data-auth="protected"]')];

    // If not authed or there are no protected links, do nothing (public pages stay as-is)
    if (!isAuthed || !protectedLinks.length) return;

    // Hide original protected links
    protectedLinks.forEach(a => (a.hidden = true));

    // Build profile menu container (if not already present)
    let profileWrap = navRight.querySelector('.profile-menu');
    if (!profileWrap) {
      profileWrap = document.createElement('div');
      profileWrap.className = 'profile-menu';
      navRight.appendChild(profileWrap);
    }

    // Button (avatar)
    const btn = document.createElement('button');
    btn.id = 'profileMenuBtn';
    btn.type = 'button';
    btn.className = 'avatar-btn';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Open profile menu');

    const img = document.createElement('img');
    img.id = 'navAvatar';
    img.className = 'avatar-sm';
    img.alt = '';
    img.src = 'assets/avatar.png';
    btn.appendChild(img);

    // Menu
    const menu = document.createElement('ul');
    menu.id = 'profileMenuList';
    menu.className = 'dropdown';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    // Section label
    const labelItem = document.createElement('li');
    labelItem.className = 'menu-label';
    labelItem.textContent = 'Navigation';
    menu.appendChild(labelItem);

    // Build items from existing protected links (preferred order)
    protectedLinks
      .sort((a,b) => byTextOrder.indexOf(a.textContent.trim()) - byTextOrder.indexOf(b.textContent.trim()))
      .forEach(a => {
        const txt = a.textContent.trim();
        // carry over the friends badge if present
        let badge = null;
        if (txt.toLowerCase().includes('friends')) {
          const navBadge = document.getElementById('nav-friends-badge');
          if (navBadge) badge = navBadge.cloneNode(true);
        }
        menu.appendChild(buildMenuItem(a.href, txt, badge));
      });

    // Divider + Logout
    const div1 = document.createElement('li'); div1.className = 'divider'; menu.appendChild(div1);

    const liLogout = document.createElement('li');
    const btnLogout = document.createElement('button');
    btnLogout.id = 'navLogout';
    btnLogout.className = 'menu-item menu-danger';
    btnLogout.type = 'button';
    btnLogout.setAttribute('role', 'menuitem');
    btnLogout.textContent = 'Log out';
    liLogout.appendChild(btnLogout);
    menu.appendChild(liLogout);

    // Wire up open/close behavior
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden ? open(menu, btn) : close(menu, btn);
    });

    document.addEventListener('click', (e) => {
      if (menu.hidden) return;
      if (btn.contains(e.target) || menu.contains(e.target)) return;
      close(menu, btn);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(menu, btn);
    });

    // Insert elements
    profileWrap.appendChild(btn);
    profileWrap.appendChild(menu);

    // Fill avatar
    const avatarUrl = await getAvatarUrl(session.user.id);
    if (avatarUrl) img.src = avatarUrl;

    // Logout
    btnLogout.addEventListener('click', async () => {
      try { await getSB().auth.signOut(); } catch {}
      location.href = 'index.html';
    });

    // Finally, ensure the whole profile block is visible
    profileWrap.hidden = false;
  });
})();
