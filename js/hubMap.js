// The hub's map: a round minimap under the hub's title, showing the map the DM shares (only the places they've made
// visible), centred on your own token, under the fog of war. Drag it to look around; the button beside it brings it
// back to you. Click it for the full map: zoom and pan, a legend of places and players, and drag your own token to move
// (the mist clears round you as you go). The DM (with DM tools unlocked) sees everything, through a thinner mist, and
// can drag anyone.

import { el } from "./components.js";
import { getPartyMap, moveOnMap } from "./network.js";
import { mapStage, panZoom } from "./mapView.js";

const POLL_MS = 3000;
const MINI = 252;           // the minimap's diameter
const MINI_SPAN = 0.32;     // how much of the map (of its longest side) the minimap shows across

export function mountHubMap(root, { me, getDmToken, say }) {
  let map = null, sig = "", offset = { x: 0, y: 0 };
  const miniFrame = el("div", { class: "hub-mini-frame", role: "button", tabindex: "0", "aria-label": "Map: click to open, drag to look around" });
  const miniEmpty = el("span", { class: "hub-mini-empty" }, "No map yet");
  const recentre = el("button", { type: "button", class: "hub-round small hub-mini-centre", "aria-label": "Back to me", title: "Back to me" });
  recentre.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="8"/></svg>';
  const wrap = el("div", { class: "hub-mini" }, [miniFrame, recentre]);
  root.append(wrap);
  let mini = null, full = null;

  const myToken = () => map?.tokens?.find((t) => t.id === me.id) || null;
  function placeMini() {
    if (!mini || !map) return;
    const k = MINI / (MINI_SPAN * Math.max(map.w, map.h));
    const t = myToken();
    const cx = (t ? t.x * map.w : map.w / 2) + offset.x, cy = (t ? t.y * map.h : map.h / 2) + offset.y;
    mini.stage.style.transform = `translate(${MINI / 2 - cx * k}px, ${MINI / 2 - cy * k}px) scale(${k})`;
    miniFrame.style.setProperty("--inv", String(1 / k));
    recentre.classList.toggle("off", !offset.x && !offset.y);
  }
  recentre.addEventListener("click", () => { offset = { x: 0, y: 0 }; placeMini(); if (full) full.centreOnMe(); });

  // drag the minimap to look around; a press that doesn't move opens the full map
  let drag = null;
  miniFrame.addEventListener("pointerdown", (e) => { e.stopPropagation(); if (!map) return; drag = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y, moved: false }; try { miniFrame.setPointerCapture(e.pointerId); } catch { /* gone */ } });
  miniFrame.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const k = MINI / (MINI_SPAN * Math.max(map.w, map.h));
    offset = { x: drag.ox - dx / k, y: drag.oy - dy / k };
    placeMini();
  });
  miniFrame.addEventListener("pointerup", (e) => { const d = drag; drag = null; if (d && !d.moved) openFull(); void e; });
  miniFrame.addEventListener("click", () => { if (!map) say("The DM hasn't shared a map yet. They can pick one in the Whiteboard's Map editor."); });
  miniFrame.addEventListener("keydown", (e) => { if (e.key === "Enter") openFull(); });
  miniFrame.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

  async function load() {
    let m = null;
    try { m = await getPartyMap(getDmToken() || null, me.id); } catch { m = null; }
    const next = JSON.stringify(m);
    if (next === sig) return;
    sig = next; map = m;
    wrap.classList.toggle("empty", !map);
    if (!map) { mini = null; miniFrame.replaceChildren(miniEmpty); full?.close(); return; }
    if (!mini) { mini = mapStage(map, { labels: false, meId: me.id, see: !!getDmToken() }); miniFrame.replaceChildren(mini.stage); }
    else mini.update(map);
    placeMini();
    full?.update(map);
  }

  async function move(tokenId, x, y) {
    const res = await moveOnMap({ id: me.id, tokenId, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), color: me.color, token: getDmToken() || undefined });
    if (!res || res.error) { say(res?.error || "Couldn't move there. Check your connection."); return; }
    if (tokenId === me.id) offset = { x: 0, y: 0 };
    sig = ""; await load();
  }

  // ------------------------------------------------------------------ the full map
  function openFull() {
    if (!map || full) return;
    const dm = !!getDmToken();
    const st = mapStage(map, { labels: true, meId: me.id, see: dm });
    const frame = el("div", { class: "hub-map-frame" }, st.stage);
    const legend = el("aside", { class: "hub-map-legend" });
    const note = el("div", { class: "hub-map-note" });
    let placing = false;
    const btn = (label, aria, fn, cls = "") => { const b = el("button", { type: "button", class: `hub-zoom-btn ${cls}`, "aria-label": aria, title: aria }, label); b.addEventListener("click", fn); return b; };
    const close = el("button", { type: "button", class: "hub-round small", "aria-label": "Close the map", title: "Close (Esc)" }, "×");
    const panel = el("div", { class: "hub-map-full", role: "dialog", "aria-label": `Map: ${map.name}` }, [
      el("div", { class: "hub-map-main" }, [frame, el("div", { class: "hub-map-tools" }, [
        btn("−", "Zoom out", () => pz.zoomBy(1 / 1.3)), btn("+", "Zoom in", () => pz.zoomBy(1.3)), btn("⤢", "Fit the map", () => pz.fit()), btn("◎", "Centre on me", () => centreOnMe()),
      ])]),
      legend,
      el("div", { class: "hub-map-close" }, close),
    ]);
    root.append(panel);
    requestAnimationFrame(() => panel.classList.add("open"));
    // presses on the full map never reach the board underneath
    for (const ev of ["pointerdown", "pointermove", "pointerup", "wheel", "dragover", "drop"]) panel.addEventListener(ev, (e) => e.stopPropagation());

    // dragging a token: your own, or anyone's for the DM
    let tokDrag = null;
    const pz = panZoom(frame, st.stage, {
      getSize: () => ({ w: st.map.w, h: st.map.h }), minK: 0.02, maxK: 8,
      canDrag: (e) => {
        const t = e.target.closest(".mv-token");
        if (!t || (t.dataset.id !== me.id && !dm)) return false;
        tokDrag = { node: t, id: t.dataset.id, moved: false };
        try { frame.setPointerCapture(e.pointerId); } catch { /* gone */ }
        return true;
      },
      onTap: (pt, e) => {
        const pin = e.target.closest?.(".mv-pin");
        if (pin) { showPlace(pin.dataset.id); return; }
        if (placing) { placing = false; panel.classList.remove("placing"); move(me.id, pt.x, pt.y); drawLegend(); }
      },
    });
    frame.addEventListener("pointermove", (e) => {
      if (!tokDrag) return;
      tokDrag.moved = true;
      const pt = pz.toMap(e.clientX, e.clientY);
      tokDrag.node.style.left = `${Math.max(0, Math.min(1, pt.x)) * st.map.w}px`;
      tokDrag.node.style.top = `${Math.max(0, Math.min(1, pt.y)) * st.map.h}px`;
      tokDrag.pt = pt;
    });
    frame.addEventListener("pointerup", () => { const d = tokDrag; tokDrag = null; if (d?.moved && d.pt) move(d.id, d.pt.x, d.pt.y); });

    function centreOnMe() {
      const t = st.map.tokens?.find((x) => x.id === me.id);
      if (t) pz.centreOn(t.x * st.map.w, t.y * st.map.h, Math.max(pz.view.k, Math.min(frame.clientWidth / st.map.w, frame.clientHeight / st.map.h) * 2.5));
      else pz.fit();
    }
    function showPlace(id) {
      const p = st.map.pins.find((x) => x.id === id);
      if (!p) return;
      pz.centreOn(p.x * st.map.w, p.y * st.map.h);
      st.pinEl(id)?.classList.add("flash");
      setTimeout(() => st.pinEl(id)?.classList.remove("flash"), 1500);
      note.replaceChildren(el("strong", {}, `${p.icon || "●"} ${p.label || "Place"}`), p.note ? el("p", {}, p.note) : el("p", { class: "hub-menu-note" }, "No notes about this place."));
    }
    function drawLegend() {
      const m = st.map, mine = myToken();
      const placeBtn = el("button", { type: "button", class: "hub-pill solid" }, mine ? "Drag your token to move" : placing ? "Click the map…" : "Put me on the map");
      if (!mine) placeBtn.addEventListener("click", () => { placing = !placing; panel.classList.toggle("placing", placing); drawLegend(); });
      legend.replaceChildren(
        el("div", { class: "hub-map-head" }, [el("strong", {}, m.name || "Map"), el("span", { class: "hub-menu-note" }, m.fog?.enabled ? (m.fog.shared ? "Fog of war: shared" : "Fog of war: you see what you've explored") : "No fog of war")]),
        placeBtn,
        el("h4", {}, `Places (${m.pins.length})`),
        el("div", { class: "hub-map-list" }, m.pins.length ? m.pins.map((p) => {
          const b = el("button", { type: "button", class: "hub-map-row" }, [el("span", { class: "mv-pin-dot small", style: `--c:${p.color}` }, p.icon || "●"), el("span", {}, p.label || "(unnamed)"), dm && p.revealed === false ? el("small", {}, "hidden") : null].filter(Boolean));
          b.addEventListener("click", () => showPlace(p.id));
          return b;
        }) : [el("p", { class: "hub-menu-note" }, dm ? "No places yet. Add them in the Whiteboard's Map editor." : "The DM hasn't revealed any places yet.")]),
        el("h4", {}, `Players (${(m.tokens || []).length})`),
        el("div", { class: "hub-map-list" }, (m.tokens || []).length ? m.tokens.map((t) => {
          const b = el("button", { type: "button", class: "hub-map-row" }, [el("span", { class: "mv-token-dot small", style: `--c:${t.color}` }, (t.name || "?").slice(0, 1).toUpperCase()), el("span", {}, `${t.name}${t.id === me.id ? " (you)" : ""}`)]);
          b.addEventListener("click", () => pz.centreOn(t.x * m.w, t.y * m.h));
          return b;
        }) : [el("p", { class: "hub-menu-note" }, "Nobody is on the map yet.")]),
        note,
      );
    }
    drawLegend();
    requestAnimationFrame(() => { pz.fit(); if (myToken()) centreOnMe(); });
    const onKey = (e) => { if (e.key === "Escape") doClose(); };
    document.addEventListener("keydown", onKey);
    function doClose() { document.removeEventListener("keydown", onKey); panel.classList.remove("open"); setTimeout(() => panel.remove(), 220); full = null; }
    close.addEventListener("click", doClose);
    full = { update: (m) => { st.update(m); drawLegend(); }, close: doClose, centreOnMe };
  }

  load();
  const timer = setInterval(() => { if (!document.body.contains(root)) { clearInterval(timer); return; } if (!document.hidden) load(); }, POLL_MS);
  return { refresh: () => { sig = ""; return load(); } };
}
