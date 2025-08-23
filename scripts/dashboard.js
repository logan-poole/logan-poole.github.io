// ============================================================================
// FILE: scripts/dashboard.js  (COMPLETE, NEW)
// WHAT THIS DOES
// - Waits for auth-guard/ui to initialise, then renders the dashboard grid.
// - Shows a friendly message if the user is not signed in (auth-guard should
//   already redirect, but this avoids a blank state if that is disabled).
// - Hooks the "Friends" & "Settings" buttons to open the modals from ui.js.
// ============================================================================
(function () {
    const $ = (sel, root = document) => root.querySelector(sel);

    async function boot() {
        const status = $('#dash-status');
        const grid = $('#dash-grid');

        // Wait for ui.js to resolve user/profile if present
        try { await window.__loadUser; } catch { }

        // If auth-guard didn't redirect, make sure user exists
        const sb = window.__sb;
        let authed = false;
        try {
            const { data: { user } } = await sb.auth.getUser();
            authed = !!user;
        } catch { }

        if (!authed) {
            if (status) {
                status.classList.add('danger');
                status.textContent = 'You are not signed in. Redirecting to Home…';
            }
            setTimeout(() => location.replace('index.html?signin=1'), 600);
            return;
        }

        if (status) status.hidden = true;
        if (grid) grid.style.opacity = '1';

        // Wire modal buttons
        document.querySelectorAll('[data-open="settings"]').forEach(b => b.addEventListener('click', () => window.pingedUI?.openAuthModal ? window.pingedUI.openAuthModal('Account') : window.open('privacy.html', '_self')));
        document.querySelectorAll('[data-open="friends"]').forEach(b => b.addEventListener('click', () => window.open('feed.html', '_self')));

        // Keep UI in sync with future auth changes
        window.addEventListener('pinged:auth', (e) => {
            if (!e?.detail?.authed) location.replace('index.html?signin=1');
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
