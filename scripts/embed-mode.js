/* =======================================================================================
FILE: scripts/embed-mode.js  (FULL — UPDATED)
CHANGES
- Continues to add body.embed on DOM ready and post height to parent.
- Works alongside the early html.is-embed class so there’s no flicker.
======================================================================================= */
(function () {
    const isIframe = window.self !== window.top;
    const qp = new URLSearchParams(location.search);
    const inEmbed = isIframe || qp.get('embed') === '1';

    function postHeight() {
        try {
            const h = Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
            );
            window.parent.postMessage({ type: 'embedHeight', h }, '*');
        } catch { }
    }

    if (inEmbed) {
        document.addEventListener('DOMContentLoaded', () => {
            document.body.classList.add('embed');

            const ro = new ResizeObserver(() => {
                requestAnimationFrame(postHeight);
            });
            ro.observe(document.body);

            setTimeout(postHeight, 300);
            setTimeout(postHeight, 1200);
        });
    }
})();
