// The hub's map: a round minimap under the hub's title, showing the map the DM shares (only the places they've made
// visible), centred on your own token, under the fog of war. Drag it to look around; the button beside it brings it
// back to you. Click it for the full map: zoom and pan, a legend of places and players, and drag your own token to move
// (the mist clears round you as you go). The DM (with DM tools unlocked) sees everything, through a thinner mist, and
// can drag anyone.
//
// The minimap wears a cosmic ring with the name of the area you're standing in written round its foot (the DM's
// areas, or the map's name outside them). The full map has a coordinate grid with letters along the top and numbers
// down the left that follow the pan and zoom, and the DM can section the map into named areas of any shape (Draw an
// area: click the corners one by one, then click the first one again, or Finish, to close it and name it).

import { el } from "./components.js";
import { getPartyMap, moveOnMap, setMapAreas } from "./network.js";
import { mapStage, panZoom, mapGrid, colName, areaAt, gridRef } from "./mapView.js";

const POLL_MS = 3000;
const MINI = 252;           // the minimap's diameter
const MINI_SPAN = 0.32;     // how much of the map (of its longest side) the minimap shows across
const AREA_COLOURS = ["#9b7be0", "#5aa8f0", "#7bc96f", "#e8a33a", "#f07ab8", "#17a5a5", "#e05a5a", "#e0c05a"];

export function mountHubMap(root, { me, getDmToken, say, playerView = false, openEditor = null }) {
  // playerView (D&D): everyone sees the map as a player does, the DM included: only the places that were revealed, the
  // fog as players get it, your own token, and no area tools. The DM's way in is the Map editor: pressing the map sends them there.
  const dmView = () => !playerView && !!getDmToken();
  let map = null, sig = "", offset = { x: 0, y: 0 };
  const miniFrame = el("div", { class: "hub-mini-frame", role: "button", tabindex: "0", "aria-label": "Map: click to open, drag to look around" });
  const miniEmpty = el("span", { class: "hub-mini-empty" }, "No map yet");
  const recentre = el("button", { type: "button", class: "hub-round small hub-mini-centre", "aria-label": "Back to me", title: "Back to me" });
  recentre.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="8"/></svg>';
  // the area's name, written round the foot of the ring (an SVG text on a circular path)
  const NS = "http://www.w3.org/2000/svg";
  const areaSvg = document.createElementNS(NS, "svg");
  areaSvg.setAttribute("class", "hub-mini-area"); areaSvg.setAttribute("viewBox", "0 0 200 200"); areaSvg.setAttribute("aria-hidden", "true");
  const arcId = `hub-mini-arc-${Math.random().toString(36).slice(2, 8)}`;
  areaSvg.innerHTML = `<defs><path id="${arcId}" d="M 18 100 A 82 82 0 0 0 182 100"/></defs><text><textPath href="#${arcId}" startOffset="50%" text-anchor="middle"></textPath></text>`;
  const areaText = areaSvg.querySelector("textPath");
  const ring = el("div", { class: "hub-mini-ring" }, [miniFrame, areaSvg]);
  const wrap = el("div", { class: "hub-mini" }, [ring, recentre]);
  let shownArea = null;
  function drawArea() {
    const t = myToken();
    const a = map && t ? areaAt(map, t.x, t.y) : null;
    const name = a ? a.name : map ? (map.name || "Map") : "";
    if (name === shownArea) return;
    shownArea = name;
    areaText.textContent = name.length > 22 ? `${name.slice(0, 21)}…` : name;
    ring.title = a ? `You're in ${a.name}${t ? ` (${gridRef(map, t.x, t.y)})` : ""}` : name;
    areaSvg.classList.remove("changed"); void areaSvg.getBoundingClientRect(); areaSvg.classList.add("changed");
  }
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
  miniFrame.addEventListener("pointerup", (e) => { const d = drag; drag = null; if (d && !d.moved) openMap(); void e; });
  miniFrame.addEventListener("click", () => { if (!map) openMap(); });
  // pressing the map (or the hub's Map button): the full map, or for a D&D DM the Map editor
  function openMap() {
    if (playerView && openEditor && getDmToken()) { openEditor(); return; }
    if (map) openFull();
    else say(getDmToken() ? "No map on the hub yet. Pick one in the Map editor (the map button at the top) and choose Show on the hub." : "The DM hasn't shared a map yet.");
  }
  miniFrame.addEventListener("keydown", (e) => { if (e.key === "Enter") openFull(); });
  miniFrame.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

  async function load() {
    let m = null;
    try { m = await getPartyMap(dmView() ? getDmToken() : null, me.id); } catch { m = null; }
    const next = JSON.stringify(m);
    if (next === sig) return;
    if (full?.busy) return;   // a token is being dragged: the next poll brings the change
    sig = next; map = m;
    wrap.classList.toggle("empty", !map);
    if (!map) { mini = null; miniFrame.replaceChildren(miniEmpty); full?.close(); shownArea = null; areaText.textContent = ""; return; }
    if (!mini) { mini = mapStage(map, { labels: false, grid: false, meId: me.id, see: dmView() }); miniFrame.replaceChildren(mini.stage); }
    else mini.update(map);
    placeMini();
    drawArea();
    full?.update(map);
  }

  async function move(tokenId, x, y) {
    const res = await moveOnMap({ id: me.id, tokenId, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), color: me.color, token: dmView() ? getDmToken() : undefined });
    if (!res || res.error) { say(res?.error || "Couldn't move there. Check your connection."); return; }
    if (tokenId === me.id) offset = { x: 0, y: 0 };
    sig = ""; await load();
  }

  // ------------------------------------------------------------------ the full map
  function openFull() {
    if (!map || full) return;
    const dm = dmView();
    const st = mapStage(map, { labels: true, meId: me.id, see: dm });
    const frame = el("div", { class: "hub-map-frame" }, st.stage);
    const rulerTop = el("div", { class: "hub-map-ruler top", "aria-hidden": "true" });
    const rulerLeft = el("div", { class: "hub-map-ruler left", "aria-hidden": "true" });
    let areaMode = false, draft = [];   // the corners of the area being drawn (map units)
    let hoverPt = null;                  // where the mouse is, for the rubber-band line to the next corner
    // the letters and numbers follow the map: each sits over the middle of its column / row as you pan and zoom
    function drawRulers(v) {
      const m = st.map, g = mapGrid(m), step = g.cell * v.k;
      const every = step < 18 ? Math.ceil(18 / step) : 1;   // zoomed far out: label every other one (or fewer)
      const top = [], left = [];
      for (let i = 0; i < g.cols; i += every) top.push(el("span", { style: `left:${(v.x + (i + 0.5) * step).toFixed(1)}px` }, colName(i)));
      for (let j = 0; j < g.rows; j += every) left.push(el("span", { style: `top:${(v.y + (j + 0.5) * step).toFixed(1)}px` }, String(j + 1)));
      rulerTop.replaceChildren(...top); rulerLeft.replaceChildren(...left);
    }
    const legend = el("aside", { class: "hub-map-legend" });
    const note = el("div", { class: "hub-map-note" });
    // (D&D) a place's card over the map: its name and type, what it's known for, the area it is in (only if it is in one),
    // and its description. It follows the live map, so it changes when the DM edits the place and goes if they hide it.
    const placeCard = el("aside", { class: "hub-place-card", role: "dialog", "aria-label": "About this place", hidden: "" });
    let openPlace = null;
    let placing = false;
    const btn = (label, aria, fn, cls = "") => { const b = el("button", { type: "button", class: `hub-zoom-btn ${cls}`, "aria-label": aria, title: aria }, label); b.addEventListener("click", fn); return b; };
    const close = el("button", { type: "button", class: "hub-round small", "aria-label": "Close the map", title: "Close (Esc)" }, "×");
    const panel = el("div", { class: "hub-map-full", role: "dialog", "aria-label": `Map: ${map.name}` }, [
      el("div", { class: "hub-map-main" }, [el("div", { class: "hub-map-corner" }), rulerTop, rulerLeft, frame, placeCard, el("div", { class: "hub-map-tools" }, [
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
      onChange: (v) => { drawRulers(v); drawDraft(); },
      canDrag: (e) => {
        const t = e.target.closest(".mv-token");
        if (!t || (t.dataset.id !== me.id && !dm)) return false;
        const tok = st.map.tokens?.find((q) => q.id === t.dataset.id);
        if (!tok) return false;
        tokDrag = { node: t, id: tok.id, moved: false, sx: e.clientX, sy: e.clientY, x0: tok.x, y0: tok.y };
        try { frame.setPointerCapture(e.pointerId); } catch { /* gone */ }
        return true;
      },
      onTap: (pt, e) => {
        if (areaMode && dm) { addCorner(pt); return; }
        const pin = e.target.closest?.(".mv-pin");
        if (pin) { showPlace(pin.dataset.id); return; }
        if (playerView && openPlace) closePlaceCard();
        if (placing) { placing = false; panel.classList.remove("placing"); move(me.id, pt.x, pt.y); drawLegend(); }
      },
    });
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    // ---- drawing an area: each tap adds a corner; tapping near the first corner (or Finish / Enter) closes the shape
    const NS = "http://www.w3.org/2000/svg";
    const draftSvg = document.createElementNS(NS, "svg");
    draftSvg.setAttribute("class", "mv-area-shapes");
    st.stage.append(draftSvg);
    function drawDraft() {
      const m = st.map, k = pz?.view?.k || 1;
      draftSvg.setAttribute("viewBox", `0 0 ${m.w} ${m.h}`); draftSvg.setAttribute("width", m.w); draftSvg.setAttribute("height", m.h);
      if (!areaMode || !draft.length) { draftSvg.replaceChildren(); return; }
      const px = (p) => `${(p[0] * m.w).toFixed(1)},${(p[1] * m.h).toFixed(1)}`;
      const shape = document.createElementNS(NS, draft.length >= 3 ? "polygon" : "polyline");
      shape.setAttribute("points", [...draft, ...(hoverPt ? [hoverPt] : [])].map(px).join(" "));
      shape.setAttribute("class", "mv-area-draft");
      const corners = draft.map((p, i) => {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", (p[0] * m.w).toFixed(1)); c.setAttribute("cy", (p[1] * m.h).toFixed(1)); c.setAttribute("r", ((i === 0 ? 8 : 5) / k).toFixed(2));
        c.setAttribute("class", `mv-area-corner${i === 0 ? " first" : ""}`);
        return c;
      });
      draftSvg.replaceChildren(shape, ...corners);
    }
    function addCorner(pt) {
      const p = [clamp01(pt.x), clamp01(pt.y)];
      if (draft.length >= 3) {   // close to the first corner (on screen): that finishes the shape
        const k = pz.view.k, f = draft[0];
        if (Math.hypot((p[0] - f[0]) * st.map.w * k, (p[1] - f[1]) * st.map.h * k) < 14) { finishArea(); return; }
      }
      if (draft.length >= 60) { say("An area can have up to 60 corners: Finish it, or Undo a corner."); return; }
      draft.push(p);
      drawDraft(); drawLegend();
    }
    function finishArea() {
      if (draft.length < 3) { say("Click at least three corners to make an area."); return; }
      const pts = draft.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]);
      draft = []; hoverPt = null; drawDraft();
      const name = prompt("Name this area (e.g. Greenmantle Forest):", "");
      if (name && name.trim()) saveAreas([...(st.map.areas || []), { id: `a${Date.now().toString(36)}`, name: name.trim().slice(0, 60), pts, color: AREA_COLOURS[(st.map.areas || []).length % AREA_COLOURS.length] }]);
      else drawLegend();
    }
    function stopDrawing() { areaMode = false; draft = []; hoverPt = null; panel.classList.remove("areas"); drawDraft(); drawLegend(); }
    frame.addEventListener("pointermove", (e) => {
      if (areaMode && draft.length && e.pointerType === "mouse") { const p = pz.toMap(e.clientX, e.clientY); hoverPt = [clamp01(p.x), clamp01(p.y)]; drawDraft(); }
      if (!tokDrag) return;
      // it moves by how far the pointer moved (never jumping to centre on it), by translate alone, once a frame
      const dx = e.clientX - tokDrag.sx, dy = e.clientY - tokDrag.sy;
      if (!tokDrag.moved) { if (Math.hypot(dx, dy) < 5) return; tokDrag.moved = true; }
      const m = st.map, k = pz.view.k;
      const nx = clamp01(tokDrag.x0 + dx / k / m.w), ny = clamp01(tokDrag.y0 + dy / k / m.h);
      tokDrag.pt = { x: nx, y: ny };
      if (!tokDrag.raf) tokDrag.raf = requestAnimationFrame(() => { const d = tokDrag; if (!d) return; d.raf = 0; d.node.style.translate = `${(d.pt.x - d.x0) * m.w}px ${(d.pt.y - d.y0) * m.h}px`; });
    });
    frame.addEventListener("pointerleave", () => { if (hoverPt) { hoverPt = null; drawDraft(); } });
    frame.addEventListener("pointerup", () => {
      const d = tokDrag; tokDrag = null;
      if (d?.raf) cancelAnimationFrame(d.raf);
      if (d?.moved && d.pt) { d.node.style.left = `${d.pt.x * st.map.w}px`; d.node.style.top = `${d.pt.y * st.map.h}px`; d.node.style.translate = ""; move(d.id, d.pt.x, d.pt.y); }
      else if (d) d.node.style.translate = "";
    });
    async function saveAreas(areas) {
      const res = await setMapAreas(getDmToken(), areas.map(({ id, name, x, y, w, h, pts, color }) => (pts ? { id, name, pts, color } : { id, name, x, y, w, h, color })));
      if (!res || res.error) { say(res?.error || "Couldn't save the areas."); return; }
      sig = ""; await load();
    }

    function centreOnMe() {
      const t = st.map.tokens?.find((x) => x.id === me.id);
      if (t) pz.centreOn(t.x * st.map.w, t.y * st.map.h, Math.max(pz.view.k, Math.min(frame.clientWidth / st.map.w, frame.clientHeight / st.map.h) * 2.5));
      else pz.fit();
    }
    function drawPlaceCard(p) {
      const m = st.map, area = areaAt(m, p.x, p.y);
      const close = el("button", { type: "button", class: "hub-round small", "aria-label": "Close", title: "Close" }, "×");
      close.addEventListener("click", closePlaceCard);
      const paras = String(p.note || "").split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
      placeCard.replaceChildren(...[
        el("header", { class: "hub-place-head" }, [
          el("span", { class: "hub-place-icon", style: `--c:${p.color || "#c8402f"}`, "aria-hidden": "true" }, p.icon || "●"),
          el("div", { class: "hub-place-title" }, [el("h3", {}, p.label || "Place"), el("p", {}, [p.kind, gridRef(m, p.x, p.y)].filter(Boolean).join(" · "))]),
          close,
        ]),
        p.known ? el("p", { class: "hub-place-known" }, p.known) : null,
        el("div", { class: "hub-place-desc" }, [
          area ? el("p", { class: "hub-place-area" }, `In ${area.name}.`) : null,
          ...(paras.length ? paras.map((t) => el("p", {}, t)) : [area || p.known ? null : el("p", { class: "hub-menu-note" }, "No one has written anything about this place yet.")]),
        ].filter(Boolean)),
      ].filter(Boolean));   // (an empty slot would be written out as the word "null")
      placeCard.hidden = false;
    }
    function closePlaceCard() { openPlace = null; placeCard.hidden = true; }
    function showPlace(id) {
      const p = st.map.pins.find((x) => x.id === id);
      if (!p) return;
      // (a player's view keeps the label in the upper part of the map, clear of its card)
      pz.centreOn(p.x * st.map.w, p.y * st.map.h + (playerView ? (frame.clientHeight * 0.2) / pz.view.k : 0));
      st.pinEl(id)?.classList.add("flash");
      setTimeout(() => st.pinEl(id)?.classList.remove("flash"), 1500);
      if (playerView) { openPlace = id; drawPlaceCard(p); return; }
      note.replaceChildren(el("strong", {}, `${p.icon || "●"} ${p.label || "Place"}`), p.note ? el("p", {}, p.note) : el("p", { class: "hub-menu-note" }, "No notes about this place."));
    }
    function drawLegend() {
      const m = st.map, mine = myToken();
      const placeBtn = el("button", { type: "button", class: "hub-pill solid" }, mine ? "Drag your token to move" : placing ? "Click the map…" : "Put me on the map");
      if (!mine) placeBtn.addEventListener("click", () => { placing = !placing; panel.classList.toggle("placing", placing); drawLegend(); });
      legend.replaceChildren(
        el("div", { class: "hub-map-head" }, [el("strong", {}, m.name || "Map"), el("span", { class: "hub-menu-note" }, m.fog?.enabled ? (m.fog.shared ? "Fog of war: shared" : "Fog of war: you see what you've explored") : "No fog of war")]),
        placeBtn,
        el("h4", {}, `Areas (${(m.areas || []).length})`),
        ...(dm ? (areaMode ? [
          el("p", { class: "hub-menu-note" }, draft.length ? `${draft.length} corner${draft.length === 1 ? "" : "s"}. Keep clicking round the area, then click the first corner (or Finish) to close it.` : "Click the map to place the area's first corner, then each corner round it. Drag to move the map."),
          el("div", { class: "hub-map-area-tools" }, [
            (() => { const b = el("button", { type: "button", class: "hub-pill solid", ...(draft.length < 3 ? { disabled: "" } : {}) }, "Finish"); b.addEventListener("click", finishArea); return b; })(),
            (() => { const b = el("button", { type: "button", class: "hub-pill", ...(draft.length ? {} : { disabled: "" }) }, "Undo corner"); b.addEventListener("click", () => { draft.pop(); drawDraft(); drawLegend(); }); return b; })(),
            (() => { const b = el("button", { type: "button", class: "hub-pill" }, "Stop drawing"); b.addEventListener("click", stopDrawing); return b; })(),
          ]),
        ] : [(() => { const b = el("button", { type: "button", class: "hub-pill" }, "Draw an area"); b.addEventListener("click", () => { areaMode = true; draft = []; panel.classList.add("areas"); drawLegend(); }); return b; })()]) : []),
        el("div", { class: "hub-map-list" }, (m.areas || []).length ? m.areas.map((a) => {
          const go = el("button", { type: "button", class: "hub-map-row" }, [el("span", { class: "mv-token-dot small", style: `--c:${a.color}` }, "▦"), el("span", {}, a.name), el("small", {}, `${gridRef(m, a.x, a.y)}–${gridRef(m, a.x + a.w, a.y + a.h)}`)]);
          go.addEventListener("click", () => { pz.centreOn((a.x + a.w / 2) * m.w, (a.y + a.h / 2) * m.h); const n = st.areaShape(a.id); n?.classList.add("picked"); setTimeout(() => n?.classList.remove("picked"), 1500); });
          if (!dm) return go;
          const ren = el("button", { type: "button", class: "hub-bag-mini", title: "Rename" }, "Rename");
          ren.addEventListener("click", () => { const name = prompt("Rename the area:", a.name); if (name && name.trim()) saveAreas(m.areas.map((x) => (x.id === a.id ? { ...x, name: name.trim().slice(0, 60) } : x))); });
          const del = el("button", { type: "button", class: "hub-bag-mini", title: "Delete" }, "×");
          del.addEventListener("click", () => { if (confirm(`Delete the area "${a.name}"?`)) saveAreas(m.areas.filter((x) => x.id !== a.id)); });
          return el("div", { class: "hub-map-area-row" }, [go, ren, del]);
        }) : [el("p", { class: "hub-menu-note" }, dm ? "None yet: Draw an area to section the map (towns, forests, routes). Each player's minimap shows the area they're in." : "The DM hasn't marked any areas.")]),
        el("h4", {}, `Places (${m.pins.length})`),
        el("div", { class: "hub-map-list" }, m.pins.length ? m.pins.map((p) => {
          const b = el("button", { type: "button", class: "hub-map-row" }, [el("span", { class: "mv-pin-dot small", style: `--c:${p.color}` }, p.icon || "●"), el("span", {}, p.label || "(unnamed)"), dm && p.revealed === false ? el("small", {}, "hidden") : null].filter(Boolean));
          b.addEventListener("click", () => showPlace(p.id));
          return b;
        }) : [el("p", { class: "hub-menu-note" }, dm ? "No places yet. Add them in the Map editor." : "The DM hasn't revealed any places yet.")]),
        el("h4", {}, `Players (${(m.tokens || []).length})`),
        el("div", { class: "hub-map-list" }, (m.tokens || []).length ? m.tokens.map((t) => {
          const b = el("button", { type: "button", class: "hub-map-row" }, [el("span", { class: "mv-token-dot small", style: `--c:${t.color}` }, (t.name || "?").slice(0, 1).toUpperCase()), el("span", {}, `${t.name}${t.id === me.id ? " (you)" : ""}`), el("small", {}, [areaAt(m, t.x, t.y)?.name, gridRef(m, t.x, t.y)].filter(Boolean).join(" · "))]);
          b.addEventListener("click", () => pz.centreOn(t.x * m.w, t.y * m.h));
          return b;
        }) : [el("p", { class: "hub-menu-note" }, "Nobody is on the map yet.")]),
        note,
      );
    }
    drawLegend();
    requestAnimationFrame(() => { pz.fit(); if (myToken()) centreOnMe(); });
    const onKey = (e) => {
      if (areaMode && !e.target.closest?.("input, textarea")) {
        if (e.key === "Enter") { e.preventDefault(); finishArea(); return; }
        if (e.key === "Backspace" && draft.length) { e.preventDefault(); draft.pop(); drawDraft(); drawLegend(); return; }
        if (e.key === "Escape") { stopDrawing(); return; }
      }
      if (e.key === "Escape") { if (openPlace) closePlaceCard(); else doClose(); }
    };
    document.addEventListener("keydown", onKey);
    function doClose() { document.removeEventListener("keydown", onKey); panel.classList.remove("open"); setTimeout(() => panel.remove(), 220); full = null; }
    close.addEventListener("click", doClose);
    full = { showPlace, update: (m) => {
      st.update(m); drawLegend(); drawRulers(pz.view); drawDraft();
      if (openPlace) { const p = st.map.pins.find((x) => x.id === openPlace); if (p) drawPlaceCard(p); else closePlaceCard(); }   // edited, or hidden again
    }, close: doClose, centreOnMe, get busy() { return !!tokDrag?.moved; } };
  }

  load();
  const timer = setInterval(() => { if (!document.body.contains(root)) { clearInterval(timer); return; } if (!document.hidden) load(); }, POLL_MS);
  return { refresh: () => { sig = ""; return load(); }, open: () => openMap(), openPlace: async (id) => { await openMap(); setTimeout(() => full?.showPlace?.(id), 350); } };
}
