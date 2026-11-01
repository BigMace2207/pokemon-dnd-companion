// The Party map: the map the DM shares with the table. Players see the places the DM has revealed and where the DM has put
// everyone; unrevealed places are never sent to a player's device at all (the server filters them). Refreshes while open.

import { el, chip } from "../systems/dnd5e/ui.js";
import { getPartyMap } from "../network.js";

export function renderPartyMapTab(panel) {
  const host = el("div", { class: "pl-party-map" });
  panel.append(host);
  let timer = null, last = "";
  const view = { x: 0, y: 0, k: 1, fit: 1 };
  let opened = null;

  async function load() {
    let map = null;
    try { map = await getPartyMap(null); } catch { map = null; }
    const sig = JSON.stringify([map?.updated, map?.name]);
    if (sig === last && host.childElementCount) return;   // nothing new: keep the view where the player left it
    last = sig;
    draw(map);
  }

  function draw(map) {
    if (!map) { host.replaceChildren(el("p", { class: "view-sub" }, "Your DM hasn't shared a map yet. When they do, it appears here, and places show up as they reveal them.")); return; }
    const wrap = el("div", { class: "pl-map-wrap" });
    const stage = el("div", { class: "pl-map-stage", style: `width:${map.w}px;height:${map.h}px` });
    const img = el("img", { src: map.image, alt: map.name, draggable: "false" });
    img.style.cssText = "width:100%;height:100%;display:block;user-select:none;pointer-events:none";
    stage.append(img);
    for (const p of map.pins) {
      const n = el("div", { class: "pl-pin", style: `left:${p.x * map.w}px;top:${p.y * map.h}px;--c:${p.color}`, tabindex: "0", role: "button", "aria-label": p.label || "Place" }, [el("span", { class: "pl-pin-dot" }, p.icon || "●"), el("span", { class: "pl-pin-text" }, p.label)]);
      n.addEventListener("pointerdown", (e) => e.stopPropagation());
      n.addEventListener("click", () => { opened = p.id; showNote(p); });
      stage.append(n);
    }
    for (const t of map.tokens) stage.append(el("div", { class: "pl-token", style: `left:${t.x * map.w}px;top:${t.y * map.h}px;--c:${t.color}`, "data-tip": t.name, "data-tip-title": "Player" }, [el("span", { class: "pl-token-dot" }, (t.name || "?").trim().slice(0, 2).toUpperCase()), el("span", { class: "pl-pin-text" }, t.name)]));
    wrap.append(stage);
    const note = el("div", { class: "card pl-party-note" });
    const showNote = (p) => note.replaceChildren(el("h4", {}, p.label || "Place"), p.note ? el("p", {}, p.note) : el("p", { class: "dnd-small dnd-muted" }, "The DM hasn't written anything about this place yet."));
    const shown = map.pins.find((p) => p.id === opened);
    if (shown) showNote(shown); else note.append(el("p", { class: "dnd-small dnd-muted" }, map.pins.length ? "Tap a place on the map to read about it." : "No places revealed yet."));
    host.replaceChildren(
      el("div", { class: "dnd-row between" }, [el("strong", {}, map.name), chip(`${map.pins.length} place${map.pins.length === 1 ? "" : "s"} revealed`)]),
      wrap, note,
    );

    const apply = () => { stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`; wrap.style.setProperty("--inv", String(1 / view.k)); };
    const fit = () => { const r = wrap.getBoundingClientRect(); view.fit = Math.min(r.width / map.w, r.height / map.h); view.k = view.fit; view.x = (r.width - map.w * view.k) / 2; view.y = (r.height - map.h * view.k) / 2; };
    requestAnimationFrame(() => { fit(); apply(); });
    const zoomAt = (px, py, f) => { const k2 = Math.max(view.fit * 0.5, Math.min(10, view.k * f)); const g = k2 / view.k; view.x = px - (px - view.x) * g; view.y = py - (py - view.y) * g; view.k = k2; apply(); };
    const pts = new Map(); let pan = null, pinch = null;
    wrap.addEventListener("pointerdown", (e) => { try { wrap.setPointerCapture(e.pointerId); } catch { /* gone */ } pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k }; pan = null; } else pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; });
    wrap.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; const r = wrap.getBoundingClientRect(); zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, (pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d) / view.k); }
      else if (pan) { view.x = pan.vx + e.clientX - pan.sx; view.y = pan.vy + e.clientY - pan.sy; apply(); }
    });
    const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) pan = null; };
    wrap.addEventListener("pointerup", end); wrap.addEventListener("pointercancel", end);
    wrap.addEventListener("wheel", (e) => { e.preventDefault(); const r = wrap.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016)); }, { passive: false });
  }

  load();
  timer = setInterval(() => { if (!document.body.contains(host)) { clearInterval(timer); return; } if (!document.hidden) load(); }, 12000);
}
