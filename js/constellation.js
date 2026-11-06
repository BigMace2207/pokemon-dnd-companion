// Pokémon as constellations in the cosmic sky, drawn like an old star chart: the whole figure as a faint, glowing
// outline (sprites/sky/<name>-lines.png, traced with tools/make_constellation_lines.py), a few bright gold stars along
// its body joined by thin lines, and a soft glow behind. One SVG per figure, so each moves as a single GPU layer with the
// rest of the sky (js/cosmicParallax.js, the hub's starfield in js/views/hub.js, and the sign-in page).
// Coordinates are each line drawing's own pixels; the viewBox frames the figure.

const FIGURES = {
  rayquaza: {
    view: [180, 25, 355, 320], art: { href: "sprites/sky/rayquaza-lines.png", x: 189.5, y: 34.5, w: 333, h: 300 }, glow: [330, 190, 190, 165],
    // head, neck, chest, round the coil, and down the tail
    stars: [[206, 147, 0.8], [236, 137, 1], [268, 108, 0.75], [366, 62, 0.9], [302, 160, 0.6], [346, 176, 0.85], [352, 232, 0.65], [330, 272, 0.7], [276, 304, 0.9], [207, 262, 0.75], [226, 212, 0.6], [396, 198, 0.65], [446, 238, 0.7], [512, 288, 1]],
    lines: [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [5, 11], [11, 12], [12, 13]],
  },
  charizard: {
    view: [0, 0, 700, 560], art: { href: "sprites/sky/charizard-lines.png", x: 0, y: 0, w: 700, h: 560 }, glow: [350, 290, 330, 260],
    // 0 snout, 1 horn, 2 neck, 3 chest, 4 belly, 5 left wing's top, 6 left wing's tip, 7 right wing's top, 8 right wing's
    // tip, 9 left hand, 10 right hand, 11 left foot, 12 right foot, 13 the tail's flame
    stars: [[268, 42, 0.9], [410, 96, 0.7], [378, 196, 0.65], [372, 290, 0.8], [372, 410, 0.7], [222, 64, 0.75], [38, 296, 0.9], [530, 80, 0.75], [660, 345, 0.9], [212, 310, 0.6], [518, 322, 0.6], [214, 518, 0.75], [508, 506, 0.75], [608, 318, 1]],
    lines: [[0, 2], [1, 2], [2, 3], [3, 4], [3, 9], [9, 5], [5, 6], [3, 10], [10, 7], [7, 8], [4, 11], [4, 12], [12, 13]],
  },
  entei: {
    view: [0, 0, 548, 548], art: { href: "sprites/sky/entei-lines.png", x: 0, y: 0, w: 548, h: 548 }, glow: [280, 290, 250, 240],
    // 0 crest, 1 eye, 2 jaw, 3 mane, 4 back spike, 5 tail spike, 6 rump, 7 smoke tail, 8 front paw, 9 middle paw,
    // 10 back paw, 11 belly
    stars: [[134, 28, 0.8], [140, 96, 1], [96, 132, 0.65], [112, 252, 0.75], [390, 126, 0.8], [456, 206, 0.7], [418, 332, 0.65], [496, 316, 0.9], [62, 488, 0.75], [276, 504, 0.7], [396, 494, 0.75], [300, 330, 0.6]],
    lines: [[0, 1], [1, 2], [1, 3], [3, 8], [3, 11], [11, 9], [1, 4], [4, 5], [5, 6], [6, 7], [6, 10], [11, 6]],
  },
};
export const CONSTELLATIONS = Object.keys(FIGURES);

const NS = "http://www.w3.org/2000/svg";
const make = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
// a four-point star, the chart's way of drawing a bright one
const sparkle = (x, y, r) => `M${x} ${y - r}Q${x + r * 0.16} ${y - r * 0.16} ${x + r} ${y}Q${x + r * 0.16} ${y + r * 0.16} ${x} ${y + r}Q${x - r * 0.16} ${y + r * 0.16} ${x - r} ${y}Q${x - r * 0.16} ${y - r * 0.16} ${x} ${y - r}Z`;

let uid = 0;
/** An <svg class="constellation con-<name>"> of one figure (rayquaza, charizard, entei). Size and place it with CSS. */
export function constellation(name, extraClass = "") {
  const f = FIGURES[name] || FIGURES.rayquaza;
  const id = `con${++uid}`;
  const svg = make("svg", { viewBox: f.view.join(" "), class: `constellation con-${name} ${extraClass}`.trim(), "aria-hidden": "true", focusable: "false" });
  const defs = make("defs");
  const glow = make("radialGradient", { id: `${id}g` });
  glow.append(make("stop", { offset: "0", "stop-color": "#8f7cff", "stop-opacity": ".22" }), make("stop", { offset: "1", "stop-color": "#8f7cff", "stop-opacity": "0" }));
  const halo = make("radialGradient", { id: `${id}h` });
  halo.append(make("stop", { offset: "0", "stop-color": "#ffe9a8", "stop-opacity": ".55" }), make("stop", { offset: "1", "stop-color": "#ffe9a8", "stop-opacity": "0" }));
  defs.append(glow, halo);
  svg.append(defs);
  const [gx, gy, rx, ry] = f.glow;
  svg.append(make("ellipse", { cx: gx, cy: gy, rx, ry, fill: `url(#${id}g)`, class: "con-glow" }));
  // the figure itself, faint
  svg.append(make("image", { href: f.art.href, x: f.art.x, y: f.art.y, width: f.art.w, height: f.art.h, class: "con-art", preserveAspectRatio: "xMidYMid meet" }));
  const lines = make("g", { class: "con-lines" });
  for (const [a, b] of f.lines) lines.append(make("line", { x1: f.stars[a][0], y1: f.stars[a][1], x2: f.stars[b][0], y2: f.stars[b][1] }));
  const stars = make("g", { class: "con-stars" });
  const unit = f.view[2] / 355;   // star sizes were tuned on Rayquaza's frame: scale them to this figure's
  f.stars.forEach(([x, y, m], i) => {
    stars.append(make("circle", { cx: x, cy: y, r: ((6 + m * 7) * unit).toFixed(1), fill: `url(#${id}h)`, class: "con-halo" }));
    stars.append(make("path", { d: sparkle(x, y, (3.2 + m * 3.6) * unit), class: `con-star${i % 3 === 1 ? " tw" : ""}`, style: `--d:${(2.8 + (i % 4) * 0.9).toFixed(1)}s` }));
  });
  svg.append(lines, stars);
  return svg;
}
/** Rayquaza (the sign-in page's and the sky's first figure). */
export const rayquazaConstellation = (extraClass = "") => constellation("rayquaza", extraClass);
