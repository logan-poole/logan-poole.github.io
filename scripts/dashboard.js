/* =======================================================================================
FILE: scripts/dashboard.js  (FULL — UPDATED)
CHANGES
- No external title management (we removed the heading).
- Loads feed/map with ?embed=1 to suppress inner nav/footer.
- Auto-resizes iframe height for feed using postMessage (embed-mode.js).
- Map view uses CSS aspect-ratio; we clear any inline height that feed might have set.
======================================================================================= */
(function () {
    const stage = document.getElementById('stage');
    const frame = document.getElementById('stage-frame');
    const dockItems = Array.from(document.querySelectorAll('.dock .card[data-view]'));

    if (!stage || !frame) return;

    const SRC = {
        feed: 'feed.html?embed=1',
        map: 'map.html?embed=1'
    };

    function setMode(mode) {
        stage.classList.remove('mode-feed', 'mode-map');
        stage.classList.add(`mode-${mode}`);

        if (mode === 'feed') {
            frame.src = SRC.feed;
            // let feed control its own height (posted up to parent)
            frame.style.height = '';
            stage.style.height = '';
        } else {
            frame.src = SRC.map;
            // map uses aspect-ratio on the stage
            stage.style.height = '';
            frame.style.height = '100%';
        }
    }

    // Dock interactions
    dockItems.forEach(el => {
        el.addEventListener('click', () => {
            const view = el.getAttribute('data-view');
            if (view === 'settings') { window.openSettingsModal?.(); return; }
            if (view === 'friends') { window.openFriendsModal?.(); return; }
            if (view === 'feed') { setMode('feed'); return; }
            if (view === 'map') { setMode('map'); return; }
        });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
        });
    });

    // Auto-height for FEED iframe
    window.addEventListener('message', (evt) => {
        const data = evt?.data || {};
        if (data.type === 'embedHeight') {
            const min = 420;
            const max = Math.round(window.innerHeight * 0.85);
            const h = Math.max(min, Math.min(max, Number(data.h) || min));
            frame.style.height = `${h}px`;
            stage.style.height = `${h}px`;
        }
    });

    // Default entry
    setMode('feed');
})();
