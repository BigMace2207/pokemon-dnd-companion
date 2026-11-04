// The cosmic starfield, drawn on one screen-sized canvas. It replaces several CSS layers of repeating star tiles that
// were each many screens big (so they could slide and wrap): on a phone those took hundreds of MB of graphics memory and
// all had to be composited every frame. Here every layer is a small list of stars that repeats on its own tile, drawn
// straight onto one canvas: each star twinkles on its own rhythm, each layer rises slowly, and the owner moves and
// scales the layers (parallax for a pan, the board's zoom) with setOffsets / setScale.
//
// Pace follows the graphics setting (js/gfx.js): high draws every frame, medium every other frame (30 a second), low
// only when the view changes (a still sky). It stops while the tab is hidden or the canvas is gone, and stays still for
// prefers-reduced-motion.

import { getGfx } from "./gfx.js";

// The star patterns (fractions of the tile, brightness, radius in px). The first four match the hub's old CSS layers.
export const HUB_STAR_LAYERS = [
  { tile: 520, rise: 80, stars: [[0.324, 0.151, 0.63, 1.1], [0.536, 0.366, 0.92, 1.1], [0.215, 0.086, 0.62, 1.4], [0.091, 0.425, 0.93, 1.1], [0.631, 0.583, 0.8, 1.1], [0.397, 0.976, 0.79, 1.1], [0.133, 0.419, 0.8, 1.1], [0.56, 0.682, 0.8, 1.1], [0.639, 0.372, 0.8, 1.1]] },
  { tile: 430, rise: 96, stars: [[0.619, 0.496, 0.72, 1.2], [0.466, 0.923, 0.55, 1.2], [0.794, 0.699, 0.48, 0.9], [0.3, 0.495, 0.71, 1.2], [0.288, 0.98, 0.63, 0.9], [0.165, 0.342, 0.6, 1.2], [0.962, 0.078, 0.57, 1.2], [0.35, 0.497, 0.47, 1.2]] },
  { tile: 610, rise: 64, stars: [[0.094, 0.27, 0.72, 1.6], [0.701, 0.647, 0.79, 2.0], [0.386, 0.669, 0.98, 1.6], [0.355, 0.611, 0.72, 2.0], [0.768, 0.129, 0.82, 1.6], [0.917, 0.497, 0.83, 1.6]] },
  { tile: 370, rise: 110, stars: [[0.549, 0.883, 0.61, 1.0], [0.278, 0.415, 0.55, 1.0], [0.38, 0.231, 0.4, 0.8], [0.232, 0.233, 0.6, 1.0], [0.182, 0.282, 0.48, 0.8], [0.369, 0.566, 0.56, 0.8], [0.515, 0.618, 0.49, 0.8], [0.871, 0.952, 0.47, 1.0], [0.394, 0.482, 0.37, 1.0], [0.067, 0.209, 0.38, 0.8]] },
];

const TAU = Math.PI * 2;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createStarCanvas(layers, className = "") {
  const canvas = document.createElement("canvas");
  canvas.className = `star-canvas ${className}`.trim();
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d", { alpha: true });
  // every star gets its own twinkle speed and phase, fixed per pattern so the sky is the same each visit
  const L = layers.map((layer, li) => ({
    ...layer,
    stars: layer.stars.map(([fx, fy, a, r], si) => ({ fx, fy, a, r, sp: 2.4 + ((si * 7 + li * 3) % 9) * 0.55, ph: (si * 2.39 + li * 1.7) % TAU })),
  }));
  const offsets = layers.map(() => ({ x: 0, y: 0 }));
  let scale = 1, w = 0, h = 0, dpr = 1, raf = 0, dirty = true, frame = 0, active = true;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const cap = { high: 2, medium: 1.5, low: 1 }[getGfx()] || 1.5;   // fewer pixels on the lower settings
    dpr = Math.min(window.devicePixelRatio || 1, cap);
    w = r.width; h = r.height;
    canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
    dirty = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  function draw(now) {
    const t = now / 1000;
    const moving = getGfx() !== "low" && !reduced();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    const k = scale, rk = Math.min(2.2, Math.max(0.55, k));   // stars grow and shrink with the zoom, within reason
    L.forEach((layer, i) => {
      const T = layer.tile * k;
      const rise = moving ? ((t / layer.rise) % 1) * T : 0;
      const ox = (((offsets[i].x % T) + T) % T) - T;
      const oy = ((((offsets[i].y - rise) % T) + T) % T) - T;
      for (const s of layer.stars) {
        const tw = moving ? 0.6 + 0.4 * Math.sin(t * TAU / s.sp + s.ph) : 0.85;
        ctx.globalAlpha = s.a * tw;
        const rad = s.r * rk;
        for (let x = ox + s.fx * T; x < w + rad; x += T) {
          for (let y = oy + s.fy * T; y < h + rad; y += T) {
            if (rad < 1.05) ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
            else { ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill(); }
          }
        }
      }
    });
    ctx.globalAlpha = 1;
    dirty = false;
  }

  function loop(now) {
    raf = 0;
    if (!canvas.isConnected) { ro.disconnect(); return; }   // the page went away
    if (document.hidden || !active) return;                  // picked up again on visibilitychange / setActive
    const level = getGfx(), moving = level !== "low" && !reduced();
    frame++;
    if (dirty || (moving && (level === "high" || frame % 2 === 0))) draw(now);
    if (moving || dirty) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  document.addEventListener("visibilitychange", kick);
  window.addEventListener("gfx-changed", () => { resize(); kick(); });

  return {
    canvas,
    /** Where each layer sits (screen px): the pattern's origin, before it wraps. */
    setOffsets(list) { list.forEach((o, i) => { if (o && offsets[i]) { offsets[i].x = o.x; offsets[i].y = o.y; } }); dirty = true; kick(); },
    /** How big the stars are drawn (the board's zoom on the hub). */
    setScale(k) { if (k !== scale) { scale = k; dirty = true; kick(); } },
    start: kick,
    /** Pause (false) while the stars aren't visible, e.g. under the hub's backdrop map. */
    setActive(on) { active = !!on; if (on) { dirty = true; kick(); } },
  };
}
