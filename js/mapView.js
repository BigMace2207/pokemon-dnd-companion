// Drawing the DM's shared map: the image, the fog of war over it, the places (labels) and everyone's tokens, all in
// one "stage" sized to the map in pixels so callers can pan and zoom it with a CSS transform. Used by the hub's minimap
// and full map (js/hubMap.js) and the Whiteboard's map editor (js/planner/mapsTab.js).
//
// The fog is a canvas at a modest resolution laid over the image: a soft mist with a little texture, with a clear
// circle (feathered at the edge) at every spot someone has uncovered. Players get fully opaque mist; the DM's is see-
// through so they can still work on the map underneath.

import { el } from "./components.js";
import { fileUrl, cachedFileUrl } from "./network.js";
import { wheelIntent, wheelPx } from "./wheelIntent.js";

const FOG_RES = 720;   // the fog canvas's longest side, in pixels
const GRID_COLS = 12;   // the coordinate grid: this many columns across (A, B, C...), rows of the same size down (1, 2, 3...)

/** The map's coordinate grid: { cols, rows, cell } (cell in map pixels). */
export function mapGrid(map) {
  const cell = (map.w || 1) / GRID_COLS;
  return { cols: GRID_COLS, rows: Math.max(1, Math.round((map.h || 1) / cell)), cell };
}
export const colName = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
/** The grid square a point (map units 0-1) is in, e.g. "C4". */
export function gridRef(map, x, y) {
  const g = mapGrid(map);
  return `${colName(Math.min(g.cols - 1, Math.max(0, Math.floor(x * g.cols))))}${Math.min(g.rows, Math.max(1, Math.floor(y * g.rows) + 1))}`;
}
/** An area's corners (map units): its shape, or the four corners of an older rectangle. */
export const areaPoints = (a) => (a.pts?.length >= 3 ? a.pts : [[a.x, a.y], [a.x + a.w, a.y], [a.x + a.w, a.y + a.h], [a.x, a.y + a.h]]);
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** The DM's area a point (map units) is in: the smallest one holding it, or null. */
export function areaAt(map, x, y) {
  const hits = (map?.areas || []).filter((a) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h && inPolygon(x, y, areaPoints(a)));
  return hits.sort((a, b) => a.w * a.h - b.w * b.h)[0] || null;
}

export function mapImageSrc(map, img) {
  if (map.image) { img.src = map.image; return; }
  const cached = map.fileId && cachedFileUrl(map.fileId);
  if (cached) { img.src = cached; return; }
  if (map.fileId) fileUrl(map.fileId).then((url) => { if (url) img.src = url; });
}

export function drawFog(canvas, map, { see = false } = {}) {
  const fog = map.fog || {};
  canvas.hidden = !fog.enabled;
  if (!fog.enabled) return;
  const aspect = (map.h || 1) / (map.w || 1);
  const W = aspect > 1 ? Math.round(FOG_RES / aspect) : FOG_RES, H = aspect > 1 ? FOG_RES : Math.round(FOG_RES * aspect);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const g = canvas.getContext("2d");
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, W, H);
  const a = see ? 0.5 : 0.985;
  const base = g.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, `rgba(196, 202, 216, ${a})`);
  base.addColorStop(0.5, `rgba(168, 176, 194, ${a})`);
  base.addColorStop(1, `rgba(190, 196, 212, ${a})`);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  // a little cloudy texture, the same every time (seeded)
  let seed = 9301;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 160; i++) {
    const x = rnd() * W, y = rnd() * H, r = (0.04 + rnd() * 0.12) * Math.max(W, H);
    const blob = g.createRadialGradient(x, y, 0, x, y, r);
    const light = rnd() > 0.5;
    blob.addColorStop(0, light ? `rgba(255, 255, 255, ${0.16 * (see ? 0.5 : 1)})` : `rgba(120, 128, 150, ${0.12 * (see ? 0.5 : 1)})`);
    blob.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = blob;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // the cleared spots
  g.globalCompositeOperation = "destination-out";
  const R = (fog.radius || 0.08) * W;
  for (const [px, py] of map.reveals || []) {
    const x = px * W, y = py * H;
    const hole = g.createRadialGradient(x, y, R * 0.45, x, y, R);
    hole.addColorStop(0, "rgba(0, 0, 0, 1)");
    hole.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = hole;
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = "source-over";
}

const initials = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

// A stage for a map. opts.see: the DM's see-through fog. opts.labels: show place names (the minimap shows icons only).
// opts.meId: your own token gets a ring. Returns { stage, update(map), tokenEl(id), pinEl(id) }.
export function mapStage(map, opts = {}) {
  const img = el("img", { class: "mv-img", alt: map.name || "Map", draggable: "false" });
  const fog = el("canvas", { class: "mv-fog", "aria-hidden": "true" });
  const marks = el("div", { class: "mv-marks" });
  // the coordinate grid and the DM's areas sit on the picture, under the fog (an unexplored area stays hidden)
  const grid = el("div", { class: "mv-grid", "aria-hidden": "true" });
  const areas = el("div", { class: "mv-areas" });
  const NS = "http://www.w3.org/2000/svg";
  const areaSvg = document.createElementNS(NS, "svg");
  areaSvg.setAttribute("class", "mv-area-shapes");
  const stage = el("div", { class: `mv-stage${opts.labels === false ? " no-labels" : ""}` }, [img, grid, areas, fog, marks]);
  let shownImage = "", fogSig = "";
  function update(m) {
    map = m;
    stage.style.width = `${m.w}px`; stage.style.height = `${m.h}px`;
    const key = m.image ? m.image.slice(0, 64) : m.fileId;
    if (key !== shownImage) { shownImage = key; mapImageSrc(m, img); }
    const sig = JSON.stringify([m.fog, m.reveals?.length, m.reveals?.[m.reveals.length - 1], m.w, m.h, opts.see]);
    if (sig !== fogSig) { fogSig = sig; drawFog(fog, m, { see: opts.see }); }
    grid.style.backgroundSize = `${mapGrid(m).cell}px ${mapGrid(m).cell}px`;
    grid.hidden = opts.grid === false;
    // each area is its outline (an SVG polygon, so any shape) plus its name at the top-left of its box
    areaSvg.setAttribute("viewBox", `0 0 ${m.w} ${m.h}`); areaSvg.setAttribute("width", m.w); areaSvg.setAttribute("height", m.h);
    areaSvg.replaceChildren(...(m.areas || []).map((a) => {
      const poly = document.createElementNS(NS, "polygon");
      poly.setAttribute("points", areaPoints(a).map(([x, y]) => `${(x * m.w).toFixed(1)},${(y * m.h).toFixed(1)}`).join(" "));
      poly.setAttribute("class", "mv-area"); poly.dataset.id = a.id; poly.style.setProperty("--c", a.color || "#9b7be0");
      return poly;
    }));
    areas.replaceChildren(areaSvg, ...(m.areas || []).map((a) => el("span", { class: "mv-area-name", "data-id": a.id, style: `left:${a.x * m.w}px;top:${a.y * m.h}px;--c:${a.color || "#9b7be0"}` }, a.name)));
    marks.replaceChildren(
      ...(m.pins || []).map((p) => el("div", { class: `mv-pin${p.revealed === false ? " secret" : ""}`, "data-id": p.id, style: `left:${p.x * m.w}px;top:${p.y * m.h}px;--c:${p.color || "#ff4a22"}`, title: p.label || "" }, [
        el("span", { class: "mv-pin-dot" }, p.icon || "●"), p.label ? el("span", { class: "mv-pin-text" }, p.label) : null,
      ].filter(Boolean))),
      ...(m.tokens || []).map((t) => el("div", { class: `mv-token${t.id === opts.meId ? " me" : ""}`, "data-id": t.id, style: `left:${t.x * m.w}px;top:${t.y * m.h}px;--c:${t.color || "#5aa8f0"}`, title: t.name }, [
        el("span", { class: "mv-token-dot" }, initials(t.name)), el("span", { class: "mv-token-text" }, t.name),
      ])),
    );
  }
  update(map);
  return { stage, update, areasEl: areas, areaShape: (id) => areaSvg.querySelector(`[data-id="${CSS.escape(id)}"]`), get map() { return map; }, tokenEl: (id) => marks.querySelector(`.mv-token[data-id="${CSS.escape(id)}"]`), pinEl: (id) => marks.querySelector(`.mv-pin[data-id="${CSS.escape(id)}"]`) };
}

// Pan and zoom a stage inside a frame: drag to pan, wheel or pinch to zoom. onTap(mapPoint, event) for a press that
// didn't move; canDrag(target) lets a caller take over presses on its own things (a token being dragged).
export function panZoom(frame, stage, { getSize, minK = 0.05, maxK = 8, onTap = null, canDrag = null, onChange = null } = {}) {
  const view = { x: 0, y: 0, k: 1 };
  const apply = () => { stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`; frame.style.setProperty("--inv", String(1 / view.k)); onChange?.(view); };
  const fit = (pad = 0.94) => {
    const r = frame.getBoundingClientRect(), { w, h } = getSize();
    view.k = Math.max(minK, Math.min(maxK, Math.min(r.width / w, r.height / h) * pad));
    view.x = (r.width - w * view.k) / 2; view.y = (r.height - h * view.k) / 2; apply();
  };
  const zoomAt = (px, py, f) => { const k2 = Math.max(minK, Math.min(maxK, view.k * f)); const g = k2 / view.k; view.x = px - (px - view.x) * g; view.y = py - (py - view.y) * g; view.k = k2; apply(); };
  const centreOn = (mx, my, k = view.k) => { const r = frame.getBoundingClientRect(); view.k = k; view.x = r.width / 2 - mx * k; view.y = r.height / 2 - my * k; apply(); };
  const toMap = (cx, cy) => { const r = frame.getBoundingClientRect(), { w, h } = getSize(); return { x: (cx - r.left - view.x) / view.k / w, y: (cy - r.top - view.y) / view.k / h }; };
  const pts = new Map();
  let pan = null, pinch = null;
  frame.addEventListener("pointerdown", (e) => {
    if (canDrag?.(e)) return;
    try { frame.setPointerCapture(e.pointerId); } catch { /* gone */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k }; pan = null; }
    else pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  });
  frame.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; const r = frame.getBoundingClientRect(); zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, (pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d) / view.k); }
    else if (pan) {
      const dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
      if (!pan.moved && Math.hypot(dx, dy) < 4) return;
      pan.moved = true; view.x = pan.vx + dx; view.y = pan.vy + dy; apply();
    }
  });
  const end = (e) => {
    const was = pan;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) { pan = null; if (was && !was.moved && e.type === "pointerup") onTap?.(toMap(e.clientX, e.clientY), e); }
  };
  frame.addEventListener("pointerup", end);
  frame.addEventListener("pointercancel", end);
  frame.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (wheelIntent(e) === "pan") { view.x -= e.deltaX; view.y -= e.deltaY; apply(); return; }   // a touchpad scroll pans
    const r = frame.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-wheelPx(e) * (e.ctrlKey ? 0.01 : 0.0016)));
  }, { passive: false });
  return { view, apply, fit, zoomAt, centreOn, toMap, zoomBy: (f) => { const r = frame.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); } };
}

/**
 * The corners of an area being drawn, and its outline on an SVG laid over a map stage (the Map editor's Area tool).
 * tap(point, map, k) adds a corner; a tap within 14 screen pixels of the first corner (k = the stage's zoom) closes the
 * shape instead. Corners are in map units (0-1), like everything the server stores for an area.
 */
export function areaDraft(svg) {
  const NS = "http://www.w3.org/2000/svg";
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  let pts = [], hover = null;
  return {
    get count() { return pts.length; },
    /** "closed" (this tap closed the shape), "full" (60 corners already) or "added". */
    tap(pt, map, k = 1) {
      const p = [clamp01(pt.x), clamp01(pt.y)];
      if (pts.length >= 3) {
        const f = pts[0];
        if (Math.hypot((p[0] - f[0]) * map.w * k, (p[1] - f[1]) * map.h * k) < 14) return "closed";
      }
      if (pts.length >= 60) return "full";
      pts.push(p);
      return "added";
    },
    hover(pt) { hover = pt ? [clamp01(pt.x), clamp01(pt.y)] : null; },
    undo() { pts.pop(); },
    clear() { pts = []; hover = null; },
    points() { return pts.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]); },
    draw(map, k = 1) {
      svg.setAttribute("viewBox", `0 0 ${map.w} ${map.h}`); svg.setAttribute("width", map.w); svg.setAttribute("height", map.h);
      if (!pts.length) { svg.replaceChildren(); return; }
      const px = (p) => `${(p[0] * map.w).toFixed(1)},${(p[1] * map.h).toFixed(1)}`;
      const shape = document.createElementNS(NS, pts.length >= 3 ? "polygon" : "polyline");
      const points = [...pts, ...(hover ? [hover] : [])].map(px).join(" ");
      const halo = document.createElementNS(NS, pts.length >= 3 ? "polygon" : "polyline");
      halo.setAttribute("points", points); halo.setAttribute("class", "mv-area-halo");
      shape.setAttribute("points", points);
      shape.setAttribute("class", "mv-area-draft");
      const corners = pts.map((p, i) => {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", (p[0] * map.w).toFixed(1)); c.setAttribute("cy", (p[1] * map.h).toFixed(1)); c.setAttribute("r", ((i === 0 ? 8 : 5) / k).toFixed(2));
        c.setAttribute("class", `mv-area-corner${i === 0 ? " first" : ""}`);
        return c;
      });
      svg.replaceChildren(halo, shape, ...corners);
    },
  };
}
