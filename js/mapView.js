// Drawing the DM's shared map: the image, the fog of war over it, the places (labels) and everyone's tokens, all in
// one "stage" sized to the map in pixels so callers can pan and zoom it with a CSS transform. Used by the hub's minimap
// and full map (js/hubMap.js) and the Whiteboard's map editor (js/planner/mapsTab.js).
//
// The fog is a canvas at a modest resolution laid over the image: a soft mist with a little texture, with a clear
// circle (feathered at the edge) at every spot someone has uncovered. Players get fully opaque mist; the DM's is see-
// through so they can still work on the map underneath.

import { el } from "./components.js";
import { fileUrl, cachedFileUrl } from "./network.js";

const FOG_RES = 720;   // the fog canvas's longest side, in pixels

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
  const stage = el("div", { class: `mv-stage${opts.labels === false ? " no-labels" : ""}` }, [img, fog, marks]);
  let shownImage = "", fogSig = "";
  function update(m) {
    map = m;
    stage.style.width = `${m.w}px`; stage.style.height = `${m.h}px`;
    const key = m.image ? m.image.slice(0, 64) : m.fileId;
    if (key !== shownImage) { shownImage = key; mapImageSrc(m, img); }
    const sig = JSON.stringify([m.fog, m.reveals?.length, m.reveals?.[m.reveals.length - 1], m.w, m.h, opts.see]);
    if (sig !== fogSig) { fogSig = sig; drawFog(fog, m, { see: opts.see }); }
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
  return { stage, update, get map() { return map; }, tokenEl: (id) => marks.querySelector(`.mv-token[data-id="${CSS.escape(id)}"]`), pinEl: (id) => marks.querySelector(`.mv-pin[data-id="${CSS.escape(id)}"]`) };
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
  frame.addEventListener("wheel", (e) => { e.preventDefault(); const r = frame.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016)); }, { passive: false });
  return { view, apply, fit, zoomAt, centreOn, toMap, zoomBy: (f) => { const r = frame.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); } };
}
