// Lava Tower theme: the ambient layer (#lavaFx) and the top-bar toggle.
//
// css/lava.css restyles the app while <html data-theme="lava">. This module builds the parts
// CSS can't: procedurally drawn cracks with light pouring out of them, a ragged crumbling edge
// on the tower, falling chunks of masonry, rising embers. It is created when the theme turns on
// and removed when it turns off. Nothing here touches the app's own DOM except one button in
// the top bar, so views that re-render never disturb it.

import { startTower, stopTower, setFloor as setTowerFloor } from "./lavaTower.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const FX_ID = "lavaFx";

// small seeded PRNG so a window resize redraws the *same* cracks instead of new ones
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const px = (name, fallback) => {
  const root = document.documentElement;
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;width:${`var(${name})`}`;
  root.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w || fallback;
};

// ---- cracks -------------------------------------------------------------------------

// A jagged polyline that wanders in roughly one direction, sometimes forking.
function crackLines(rnd, x, y, angle, length, depth = 0) {
  const lines = [];
  const pts = [[x, y]];
  let cx = x, cy = y, a = angle, walked = 0;
  while (walked < length) {
    const step = 6 + rnd() * 11;
    a += (rnd() - 0.5) * 1.5;
    cx += Math.cos(a) * step;
    cy += Math.sin(a) * step;
    walked += step;
    pts.push([cx, cy]);
    if (depth < 2 && rnd() < 0.13 && walked > 24) {
      const side = rnd() < 0.5 ? -1 : 1;
      lines.push(...crackLines(rnd, cx, cy, a + side * (0.55 + rnd() * 0.5), (length - walked) * (0.35 + rnd() * 0.3) + 20, depth + 1));
    }
  }
  lines.unshift(pts);
  return lines;
}

// A transparent SVG of cracks (three stacked strokes each: soft glow, orange body, hot core).
function buildCrackSvg(w, h, seeds, seed) {
  const rnd = mulberry32(seed);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "lava-cracks");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("aria-hidden", "true");
  seeds.forEach(([sx, sy, ang, len], i) => {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "lava-crack");
    group.style.setProperty("--d", `${(i * 0.9 + rnd() * 1.4).toFixed(2)}s`);
    const lines = crackLines(rnd, sx, sy, ang, len * 0.7);
    for (const kind of ["glow", "body", "core"]) {
      const sub = document.createElementNS(SVG_NS, "g");
      sub.setAttribute("class", kind);
      for (const pts of lines) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("class", kind);
        path.setAttribute("pathLength", "1");
        path.setAttribute("d", `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")}`);
        sub.appendChild(path);
      }
      group.appendChild(sub);
    }
    svg.appendChild(group);
  });
  return svg;
}

const DOWN = Math.PI / 2, UP = -Math.PI / 2;
// cracks in the open wall, in a w x h tile that repeats as the wall turns
function wallSeeds(w, h) {
  const seeds = [
    [w * 0.12, h * 0.1, DOWN + 0.3, 230], [w * 0.28, h * 0.62, DOWN - 0.2, 210], [w * 0.5, h * 0.05, DOWN - 0.15, 200],
    [w * 0.66, h * 0.7, UP + 0.1, 250], [w * 0.8, h * 0.2, DOWN + 0.25, 300], [w * 0.92, h * 0.85, UP - 0.2, 200], [w * 0.4, h * 0.95, UP - 0.25, 170],
  ];
  if (w > 1700) seeds.push([w * 0.2, h * 0.4, DOWN + 0.4, 240], [w * 0.75, h * 0.55, UP + 0.3, 260]);
  if (w > 2600) seeds.push([w * 0.35, h * 0.3, DOWN, 280], [w * 0.6, h * 0.9, UP, 300]);
  return seeds;
}
// cracks on the tower face, in a tw x th tile
function towerSeeds(tw, th) {
  return [[tw * 0.3, th * 0.08, DOWN + 0.15, 280], [tw * 0.78, th * 0.42, DOWN - 0.25, 240], [tw * 0.22, th * 0.92, UP + 0.2, 230], [tw * 0.9, th * 0.78, UP - 0.1, 170]];
}

// 2 x 2 copies of a tile so it can slide in any direction and wrap without a seam
function tiled(svg, w, h) {
  const box = el("div", "lava-tiles");
  box.style.cssText = `width:${w * 2}px;height:${h * 2}px;`;
  for (let i = 0; i < 4; i++) {
    const c = i === 0 ? svg : svg.cloneNode(true);
    c.style.cssText = `position:absolute;left:${(i % 2) * w}px;top:${Math.floor(i / 2) * h}px;`;
    box.appendChild(c);
  }
  return box;
}

// ---- the tower's ragged right edge --------------------------------------------------

function towerClip(rnd) {
  const pts = [[0, 0]];
  let y = 0;
  while (y < 100) {
    const notch = rnd() < 0.16;
    const x = notch ? 86 + rnd() * 5 : 93.5 + rnd() * 6.5;
    pts.push([x, y]);
    y += notch ? 1.2 + rnd() * 1.6 : 2.2 + rnd() * 3;
    if (notch) pts.push([x + 0.5 + rnd() * 2, Math.min(100, y)]);
  }
  pts.push([100, 100], [0, 100]);
  return `polygon(${pts.map(([x, yy]) => `${x.toFixed(2)}% ${yy.toFixed(2)}%`).join(",")})`;
}

// ---- assembly -----------------------------------------------------------------------

function el(tag, cls, style) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (style) n.style.cssText = style;
  return n;
}

function buildFx() {
  const fx = el("div");
  fx.id = FX_ID;
  fx.setAttribute("aria-hidden", "true");
  const w = window.innerWidth, h = window.innerHeight;
  const topbar = px("--topbar-h", 48);
  const sidenav = w > 780 ? px("--sidenav-w", 185) : 0;
  const rnd = mulberry32(0xBADA55);

  // the wall: bricks that slide as the tower "turns", with cracks that move with them
  const wall = el("div", "lava-wall");
  fx.appendChild(wall);
  const wallCracks = el("div", "lava-layer lava-wall-cracks");
  wallCracks.appendChild(tiled(buildCrackSvg(w, h, wallSeeds(w, h), 0xC0FFEE), w, h));
  fx.appendChild(wallCracks);
  fx.appendChild(el("div", "lava-spin-shade"));

  // the tower face the menu sits on: nearer than the wall, so it turns faster
  const tw = Math.round(sidenav + 14), th = Math.max(300, h - topbar);
  const wrap = el("div", "lava-tower-wrap");
  const tower = el("div", "lava-tower");
  tower.style.setProperty("--tower-clip", towerClip(rnd));
  const towerBricks = el("div", "lava-tower-bricks");
  const towerCracks = el("div", "lava-layer");
  towerCracks.appendChild(tiled(buildCrackSvg(tw, th, towerSeeds(tw, th), 0xFACADE), tw, th));
  tower.append(towerBricks, el("div", "lava-tower-shade"), towerCracks);
  wrap.appendChild(tower);
  fx.appendChild(wrap);

  fx.appendChild(el("div", "lava-heat"));
  fx.appendChild(el("div", "lava-pool"));
  fx.__layers = { wall, wallCracks: wallCracks.firstChild, spin: fx.querySelector(".lava-spin-shade"), towerBricks, towerCracks: towerCracks.firstChild, pool: fx.querySelector(".lava-pool"), heat: fx.querySelector(".lava-heat"), tile: { w, h, tw, th } };

  // embers
  const embers = Math.max(10, Math.min(44, Math.round(w / 55)));
  for (let i = 0; i < embers; i++) {
    const size = 2 + rnd() * 3.5;
    const dur = 7 + rnd() * 9;
    fx.appendChild(el("i", "lava-ember", `left:${(rnd() * 100).toFixed(1)}%;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;--dur:${dur.toFixed(1)}s;--delay:-${(rnd() * dur).toFixed(1)}s;--dx:${Math.round((rnd() - 0.5) * 120)}px`));
  }

  // chunks of masonry coming off the tower's edge
  const debris = el("div", "lava-debris");
  for (let i = 0; i < 18; i++) {
    const dur = 2.3 + rnd() * 3.2;
    debris.appendChild(el("i", `lava-chunk${rnd() < 0.22 ? " hot" : ""}`,
      `--y:${(4 + rnd() * 92).toFixed(1)}%;--w:${(4 + rnd() * 6).toFixed(1)}px;--h:${(3 + rnd() * 5).toFixed(1)}px;--dx:${Math.round(6 + rnd() * 34)}px;--dy:${Math.round(90 + rnd() * 150)}px;--rot:${Math.round((rnd() - 0.5) * 640)}deg;--dur:${dur.toFixed(2)}s;--delay:-${(rnd() * dur * 2).toFixed(2)}s`));
  }
  for (let i = 0; i < 7; i++) {
    const dur = 4 + rnd() * 3;
    debris.appendChild(el("i", "lava-dust", `--y:${(6 + rnd() * 88).toFixed(1)}%;--dur:${dur.toFixed(1)}s;--delay:-${(rnd() * dur).toFixed(1)}s`));
  }
  fx.appendChild(debris);
  return fx;
}

// ---- scrolling: the camera descends the tower ----------------------------------------
//
// The page scrolls inside <main>. Scrolling down lowers the camera: the wall slides up and
// round (as if the tower is turning), the nearer tower face turns faster, and the fire at the
// foot of the page grows and glows as you get deeper. All of it is transform/opacity on the
// fixed #lavaFx layer, eased in a requestAnimationFrame loop that stops when things settle.

const mod = (n, m) => ((n % m) + m) % m;
let cur = 0, target = 0, raf = 0, bound = null;

function motionAllowed() {
  return !matchMedia("(prefers-reduced-motion: reduce)").matches && document.documentElement.getAttribute("data-lava-fx") !== "calm";
}

function applyScroll(fx, s) {
  const L = fx.__layers;
  if (!L) return;
  const { w, h, tw, th } = L.tile;
  const main = document.getElementById("mainView");
  const max = main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0;
  const depth = max > 0 ? Math.min(1, s / max) : Math.min(1, s / 2400);
  // wall: far away, slow; it drifts sideways as it falls, which reads as the tower turning
  const wx = mod(s * 0.22, 600), wy = mod(s * 0.5, 248);
  L.wall.style.transform = `translate3d(${-wx}px, ${-wy}px, 0)`;
  L.wallCracks.style.transform = `translate3d(${-mod(s * 0.22, w)}px, ${-mod(s * 0.5, h)}px, 0)`;
  // a soft band of light and shadow slides across the wall, as if it were curved and rotating
  L.spin.style.transform = `translate3d(${-mod(s * 0.6, w)}px, 0, 0)`;
  // the fire rises and brightens the deeper you go
  L.pool.style.transform = `scaleY(${(0.55 + depth * 1.25).toFixed(3)})`;
  L.pool.style.opacity = String((0.72 + depth * 0.28).toFixed(3));
  L.heat.style.opacity = String((0.25 + depth * 0.75).toFixed(3));
}

// Each page is a floor of the tower: move the camera there (0 is the roof). The page's own scroll starts again from the top.
export function goToFloor(index, count, initial = false) {
  setTowerFloor(index, count, initial);   // first, so the tower can fold the old scroll offset into its camera
  cur = target = 0;
  const fx = document.getElementById(FX_ID);
  if (fx) applyScroll(fx, 0);
}

function tick() {
  const fx = document.getElementById(FX_ID);
  if (!fx) { raf = 0; return; }
  cur += (target - cur) * 0.14;
  if (Math.abs(target - cur) < 0.4) cur = target;
  applyScroll(fx, cur);
  raf = cur !== target ? requestAnimationFrame(tick) : 0;
}

function onScroll() {
  const main = document.getElementById("mainView");
  if (!main || !document.getElementById(FX_ID)) return;
  target = motionAllowed() ? main.scrollTop : 0;
  if (!raf) raf = requestAnimationFrame(tick);
}

function bindScroll() {
  const main = document.getElementById("mainView");
  if (!main || bound === main) return;
  bound = main;
  main.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("hashchange", () => setTimeout(onScroll, 60));
}

let resizeTimer = null;
function rebuild() {
  document.getElementById(FX_ID)?.remove();
  if (document.documentElement.getAttribute("data-theme") !== "lava") return;
  const fx = buildFx();
  // the WebGL tower canvas (when running) sits first in <body>; the effects layer goes right after it
  const tower = document.getElementById("lavaTower");
  document.body.insertBefore(fx, tower ? tower.nextSibling : document.body.firstChild);
  bindScroll();
  cur = target = 0;
  onScroll();
  applyScroll(fx, motionAllowed() ? (document.getElementById("mainView")?.scrollTop || 0) : 0);
}

// Call whenever the theme attribute may have changed.
export function syncLavaFx() {
  const on = document.documentElement.getAttribute("data-theme") === "lava";
  const existing = document.getElementById(FX_ID);
  const root = document.documentElement;
  if (on && !document.getElementById("lavaTower") && !root.classList.contains("lava-gl-failed")) {
    // a real rotating cylinder when WebGL is available; the flat parallax wall in lava.css otherwise
    const ok = startTower({
      getScroll: () => cur,
      motionOK: motionAllowed,
      onLost: () => { root.classList.remove("lava-gl"); root.classList.add("lava-gl-failed"); },
    });
    root.classList.toggle("lava-gl", ok);
    if (!ok) root.classList.add("lava-gl-failed");
  }
  if (on && !existing) rebuild();
  else if (!on && existing) existing.remove();
  if (!on) { stopTower(); root.classList.remove("lava-gl"); }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", on ? "#1b0f0b" : "#14161b");
  const t = document.getElementById("themeToggle");
  if (t) { t.setAttribute("aria-pressed", String(on)); t.title = on ? "Leave the lava tower" : "Enter the lava tower"; }
}

window.addEventListener("resize", () => {
  if (document.documentElement.getAttribute("data-theme") !== "lava") return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(rebuild, 350);
});

// ---- the top-bar toggle -------------------------------------------------------------

const FLAME = '<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 3c1 5-4 7-4 12 0 2 .8 3.4 2 4.2-.3-3 2-4.2 3-6.2 2 2 4 4.200 4 7.600 0 4-3.400 7.400-8 7.400S6 24.600 6 20.600C6 13 15 10 16 3Z" fill="currentColor" opacity=".9"/><path d="M16 17c.6 2.400-2 3.400-2 6 0 1.600 1 2.800 2.400 2.800 1.600 0 2.800-1.200 2.800-3 0-2-1.600-3-3.200-5.800Z" fill="#ffd45a"/></svg>';

export function mountLavaToggle({ get, set }) {
  if (document.getElementById("themeToggle")) return;
  const btn = document.createElement("button");
  btn.id = "themeToggle";
  btn.type = "button";
  btn.className = "theme-toggle";
  btn.setAttribute("aria-label", "Toggle the lava tower theme");
  btn.innerHTML = FLAME;
  btn.addEventListener("click", () => set(get() === "lava" ? "previous" : "lava"));
  const chip = document.getElementById("accountChip");
  const bar = chip?.parentElement || document.querySelector(".topbar");
  if (!bar) return;
  btn.style.marginLeft = "auto";
  bar.insertBefore(btn, chip || null);
  if (chip) chip.style.marginLeft = "0";
  syncLavaFx();
}
