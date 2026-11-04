// The cosmic theme's stars drift with a little parallax on every page, like the hub's: each star layer moves at its
// own rate as you scroll or move the mouse, the dot grid least of all.
//
// Smoothness (apple-design §11, animation-performance): the layers are their own fixed elements (#cosmicSky) that only
// ever change `transform`, so the GPU moves them and nothing repaints. Nothing is written to the page root (writing a
// CSS variable on <html> on every mouse move restyled the whole page each time, which is what made it stutter on a
// computer and not on a phone, where there is no mouse). The offsets glide towards where the mouse says they should be
// (exponential smoothing, frame-rate independent), so the motion stays continuous between mouse events. Scrolling wraps
// each layer by its own tile size, so the layers never run out. Off for prefers-reduced-motion.

import { rayquazaConstellation } from "./constellation.js";
import { nebulaLayer } from "./nebula.js";

const LAYERS = [
  // [CSS background, tile size (px), mouse travel (px), scroll rate]
  ["radial-gradient(circle at 12% 18%, rgba(255,255,255,.8) 0 1px, transparent 1.6px)", 300, 14, 0.12],
  ["radial-gradient(circle at 63% 72%, rgba(255,255,255,.55) 0 1px, transparent 1.5px)", 380, 24, 0.2],
  ["radial-gradient(circle at 38% 46%, rgba(255,255,255,.45) 0 .8px, transparent 1.3px)", 220, 8, 0.07],
  ["radial-gradient(circle at 86% 29%, rgba(255,255,255,.7) 0 1.1px, transparent 1.7px)", 460, 34, 0.3],
  ["radial-gradient(circle at 1px 1px, rgba(255,255,255,.07) 1px, transparent 1.4px)", 28, 4, 0.04],
];
const SMOOTH_MS = 140;
const CON_AMP = 20, CON_RATE = 0.1;   // the Rayquaza constellation: a far-off layer, it never wraps (there's only one)   // how quickly the stars catch up with the mouse (time constant)

export function mountCosmicParallax() {
  if (document.getElementById("cosmicSky")) return;
  const sky = document.createElement("div");
  sky.id = "cosmicSky";
  sky.setAttribute("aria-hidden", "true");
  const layers = LAYERS.map(([bg, tile]) => {
    const l = document.createElement("div");
    l.className = "sky-layer";
    l.style.backgroundImage = bg;
    l.style.backgroundSize = `${tile}px ${tile}px`;
    sky.append(l);
    return l;
  });
  sky.prepend(nebulaLayer());   // the violet smoke and light, behind the star layers
  const con = rayquazaConstellation("sky-constellation");
  sky.append(con);
  document.body.prepend(sky);
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  let mx = 0, my = 0, sc = 0;            // where the input says the sky should be
  const cur = LAYERS.map(() => ({ x: 0, y: 0 }));
  const conAt = { x: 0, y: 0 };
  let raf = 0, last = 0;
  const frame = (now) => {
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    const k = 1 - Math.exp(-dt / SMOOTH_MS);
    let moving = false;
    LAYERS.forEach(([, tile, amp, rate], i) => {
      const tx = -mx * amp, ty = -my * amp - sc * rate;
      const c = cur[i];
      c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
      if (Math.abs(tx - c.x) > 0.05 || Math.abs(ty - c.y) > 0.05) moving = true;
      const wrapY = (((c.y % tile) + tile) % tile) - tile;   // the pattern repeats, so wrap by one tile
      layers[i].style.transform = `translate3d(${c.x.toFixed(2)}px, ${wrapY.toFixed(2)}px, 0)`;
    });
    const cx = -mx * CON_AMP, cy = -my * CON_AMP - sc * CON_RATE;   // glides like the star layers
    conAt.x += (cx - conAt.x) * k; conAt.y += (cy - conAt.y) * k;
    con.style.transform = `translate3d(${conAt.x.toFixed(2)}px, ${conAt.y.toFixed(2)}px, 0)`;
    raf = moving ? requestAnimationFrame(frame) : 0;
    if (!raf) last = 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5;
    kick();
  }, { passive: true });
  // the page scrolls inside <main>, not the window
  document.addEventListener("scroll", (e) => {
    if (e.target?.classList?.contains("main")) { sc = e.target.scrollTop; kick(); }
  }, { passive: true, capture: true });
  window.addEventListener("hashchange", () => { sc = 0; kick(); });
}
