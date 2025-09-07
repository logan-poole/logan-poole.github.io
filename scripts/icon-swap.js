/* Swap tile icon image to animated GIF when the entire tile is hovered/focused */
(function () {
  function swapImages(tile, toAnim) {
    const imgs = tile.querySelectorAll("img.icon-img");
    imgs.forEach(img => {
      const still = img.getAttribute("data-still");
      const anim  = img.getAttribute("data-anim");
      if (!still || !anim) return;
      img.src = toAnim ? anim : still;
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const tiles = document.querySelectorAll(".tiles .tile");
    tiles.forEach(tile => {
      swapImages(tile, false);
      tile.addEventListener("mouseenter", () => swapImages(tile, true));
      tile.addEventListener("mouseleave", () => swapImages(tile, false));
      tile.addEventListener("focusin", () => swapImages(tile, true));
      tile.addEventListener("focusout", () => swapImages(tile, false));
      tile.addEventListener("touchstart", () => swapImages(tile, true), { passive: true });
    });
  });
})();
