// ============================================================================
// FILE: scripts/dashboard.js  (COMPLETE, UPDATED)
// WHAT THIS DOES
// - Waits for auth-guard/ui to initialise, then renders the dashboard grid.
// - Shows a friendly message if the user is not signed in (auth-guard should
//   already redirect, but this avoids a blank state if that is disabled).
// - Hooks the "Friends" & "Settings" buttons to open the modals from ui.js.
// - Ensures dashboard cards/icons actually navigate (works for <a> or <div>).
// ============================================================================

(function () {
    const $ = (sel, root = document) => root.querySelector(sel);

    // Normalise Supabase client access
    function getSB() {
        if (window.getSB) return window.getSB();
        return window.__sb || null;
    }

    // Make cards/icons navigate:
    // - Supports elements with data-link="/page.html"
    // - Upgrades non-anchor .dash-card to navigate to its inner <a href> or data-link
    // - Leaves normal <a href> links alone (no preventDefault)
    function installNavigationDelegates() {
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-link], .dash-card, a.card, a[href]');
            if (!el) return;

            // If it's an anchor with href (and not explicitly SPA), let browser handle it.
            if (el.tagName === 'A' && el.hasAttribute('href') && !el.hasAttribute('data-spa')) {
                return; // default navigation
            }

            // Prefer explicit data-link on the clicked element
            let href = el.getAttribute?.('data-link');

            // If it's a card without data-link, see if it has an inner anchor
            if (!href && (el.matches('.dash-card') || el.matches('[data-link]') || el.matches('a.card'))) {
                const innerA = el.querySelector?.('a[href]');
                if (innerA?.getAttribute) href = innerA.getAttribute('href');
            }

            if (!href) return; // nothing to do

            e.preventDefault();
            window.location.href = href;
        }, false);
    }

    async function boot() {
        const status = $('#dash-status');
        const grid = $('#dash-grid');

        // Wait for any UI bootstrap that might set profile/UI bits
        try { await window.__loadUser; } catch { /* ignore */ }

        const sb = getSB();
        let authed = false;

        try {
            if (sb?.auth?.getUser) {
                const { data: { user } = {} } = await sb.auth.getUser();
                authed = !!user;
            }
        } catch {
            // If we can't verify, assume not authed and fall back to redirect below
        }

        if (!authed) {
            if (status) {
                status.classList.add('danger');
                status.textContent = 'You are not signed in. Redirecting to Home…';
            }
            setTimeout(() => location.replace('index.html?signin=1'), 600);
            return;
        }

        // Authed: reveal grid
        if (status) status.hidden = true;
        if (grid) grid.style.opacity = '1';

        // Wire modal-ish buttons
        document.querySelectorAll('[data-open="settings"]').forEach((b) =>
            b.addEventListener('click', () => {
                if (window.pingedUI?.openAuthModal) window.pingedUI.openAuthModal('Account');
                else window.open('settings.html', '_self');
            })
        );

        document.querySelectorAll('[data-open="friends"]').forEach((b) =>
            b.addEventListener('click', () => window.open('friends.html', '_self'))
        );

        // Keep UI in sync if auth state changes out from under us
        window.addEventListener('pinged:auth', (e) => {
            if (!e?.detail?.authed) location.replace('index.html?signin=1');
        });

        // Ensure cards/icons navigate
        installNavigationDelegates();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
