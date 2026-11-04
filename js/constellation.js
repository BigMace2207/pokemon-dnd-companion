// Rayquaza as a constellation in the cosmic sky, drawn like an old star chart: the whole figure as a faint, glowing
// outline (sprites/sky/rayquaza-lines.png, from a line drawing), with a few bright gold stars along its body joined by
// one thin line, and a soft glow behind. One SVG, so it moves as a single GPU layer with the rest of the sky
// (js/cosmicParallax.js, the hub's starfield in js/views/hub.js, and the sign-in page).
// Coordinates are the line drawing's own pixels; the viewBox frames the figure.

const VIEW = [180, 25, 355, 320];
const ART = { href: "sprites/sky/rayquaza-lines.png", x: 189.5, y: 34.5, w: 333, h: 300 };

// [x, y, size] along the body: head, neck, chest, round the coil, and down the tail
const STARS = [
  [206, 147, 0.8],  // 0 the jaws
  [236, 137, 1],    // 1 the eye
  [268, 108, 0.75], // 2 the crest
  [366, 62, 0.9],   // 3 the horn's tip
  [302, 160, 0.6],  // 4 the neck
  [346, 176, 0.85], // 5 the chest
  [352, 232, 0.65], // 6 the belly
  [330, 272, 0.7],  // 7 the coil's right
  [276, 304, 0.9],  // 8 the coil's foot
  [207, 262, 0.75], // 9 the coil's left
  [226, 212, 0.6],  // 10 the coil's crown
  [396, 198, 0.65], // 11 the back
  [446, 238, 0.7],  // 12 along the tail
  [512, 288, 1],    // 13 the tail's tip
];
const LINES = [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [5, 11], [11, 12], [12, 13]];

const NS = "http://www.w3.org/2000/svg";
const make = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
// a four-point star, the chart's way of drawing a bright one
const sparkle = (x, y, r) => `M${x} ${y - r}Q${x + r * 0.16} ${y - r * 0.16} ${x + r} ${y}Q${x + r * 0.16} ${y + r * 0.16} ${x} ${y + r}Q${x - r * 0.16} ${y + r * 0.16} ${x - r} ${y}Q${x - r * 0.16} ${y - r * 0.16} ${x} ${y - r}Z`;

let uid = 0;
/** An <svg class="constellation"> of Rayquaza. Size and place it with CSS. */
export function rayquazaConstellation(extraClass = "") {
  const id = `con${++uid}`;
  const svg = make("svg", { viewBox: VIEW.join(" "), class: `constellation ${extraClass}`.trim(), "aria-hidden": "true", focusable: "false" });
  const defs = make("defs");
  const glow = make("radialGradient", { id: `${id}g` });
  glow.append(make("stop", { offset: "0", "stop-color": "#8f7cff", "stop-opacity": ".22" }), make("stop", { offset: "1", "stop-color": "#8f7cff", "stop-opacity": "0" }));
  const halo = make("radialGradient", { id: `${id}h` });
  halo.append(make("stop", { offset: "0", "stop-color": "#ffe9a8", "stop-opacity": ".55" }), make("stop", { offset: "1", "stop-color": "#ffe9a8", "stop-opacity": "0" }));
  defs.append(glow, halo);
  svg.append(defs);
  // the soft light behind the figure, a little brighter round the coil
  svg.append(make("ellipse", { cx: 330, cy: 190, rx: 190, ry: 165, fill: `url(#${id}g)`, class: "con-glow" }));
  // the figure itself, faint
  svg.append(make("image", { href: ART.href, x: ART.x, y: ART.y, width: ART.w, height: ART.h, class: "con-art", preserveAspectRatio: "xMidYMid meet" }));
  const lines = make("g", { class: "con-lines" });
  for (const [a, b] of LINES) lines.append(make("line", { x1: STARS[a][0], y1: STARS[a][1], x2: STARS[b][0], y2: STARS[b][1] }));
  const stars = make("g", { class: "con-stars" });
  STARS.forEach(([x, y, m], i) => {
    stars.append(make("circle", { cx: x, cy: y, r: (6 + m * 7).toFixed(1), fill: `url(#${id}h)`, class: "con-halo" }));
    stars.append(make("path", { d: sparkle(x, y, 3.2 + m * 3.6), class: `con-star${i % 3 === 1 ? " tw" : ""}`, style: `--d:${(2.8 + (i % 4) * 0.9).toFixed(1)}s` }));
  });
  svg.append(lines, stars);
  return svg;
}
