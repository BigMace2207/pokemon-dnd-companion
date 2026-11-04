// The cosmic theme's stars drift with a little parallax on every page, like the hub's: each star layer (css/cosmic.css)
// moves at its own rate as you scroll the page or move the mouse, the faint dot grid least of all. It only sets two
// CSS variables, once per frame at most; off for prefers-reduced-motion.

export function mountCosmicParallax() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const root = document.documentElement;
  let mx = 0, my = 0, sc = 0, queued = false;
  const apply = () => {
    queued = false;
    root.style.setProperty("--cx", mx.toFixed(3));
    root.style.setProperty("--cy", my.toFixed(3));
    root.style.setProperty("--csc", String(Math.round(sc)));
  };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(apply); } };
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5;
    later();
  }, { passive: true });
  // the page scrolls inside <main>, not the window
  document.addEventListener("scroll", (e) => {
    const t = e.target;
    if (t && t.classList?.contains("main")) { sc = t.scrollTop; later(); }
  }, { passive: true, capture: true });
  window.addEventListener("hashchange", () => { sc = 0; later(); });
}
