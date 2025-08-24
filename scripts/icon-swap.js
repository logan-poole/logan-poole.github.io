/* =======================================================================================
scripts/icon-swap.js
======================================================================================= */
(function () {
  function canHover() {
    return window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  }
  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const imgs = Array.from(document.querySelectorAll('.icon-img[data-anim]'));

    // Always ensure we start on the still image
    for (const img of imgs) {
      const still = img.getAttribute('data-still') || img.getAttribute('src');
      if (still) img.src = still;
    }

    // If device cannot hover or user prefers reduced motion – keep static
    if (!canHover() || reduceMotion()) return;

    // Preload animated sources
    imgs.forEach(img => {
      const anim = img.getAttribute('data-anim');
      if (!anim) return;
      const pre = new Image();
      pre.src = anim;
      img._preloaded = pre;
    });

    // Swap handlers on hover only (desktop)
    imgs.forEach(img => {
      const still = img.getAttribute('data-still') || img.src;
      const anim  = img.getAttribute('data-anim');
      if (!anim) return;

      img.addEventListener('mouseenter', () => { img.src = anim; });
      img.addEventListener('mouseleave', () => { img.src = still; });

      // Optional: if you want keyboard focus to animate, uncomment below:
      // img.addEventListener('focus', () => { img.src = anim; });
      // img.addEventListener('blur',  () => { img.src = still; });
    });

    // If the hover-capability changes (rare), reset appropriately
    window.matchMedia('(hover:hover) and (pointer:fine)').addEventListener?.('change', (e) => {
      if (!e.matches) {
        imgs.forEach(img => {
          const still = img.getAttribute('data-still') || img.src;
          img.src = still;
        });
      }
    });
  });
})();
