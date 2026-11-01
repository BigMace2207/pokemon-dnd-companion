// Maps: import your own map images and label them in the app. Pan with a drag, zoom with the wheel, the buttons or a
// pinch; add a label with "+ Label" (or double-click the map), drag labels to move them, click one to edit its text,
// icon, colour and note. Images stay on this device (mapStore.js); a map's name and labels are saved with the plan, and
// Export / Import map pack moves a whole map (image and labels) to another device or to a friend.

import { el, btn, chip, textInput, selectEl, field, toast, confirmDialog, promptDialog, modal, download, pickFile, checkbox } from "../systems/dnd5e/ui.js";
import { getPlan, mutatePlan, newMap, uid } from "./store.js";
import { readAsDataUrl, imageSize, putImage, getImage, deleteImage } from "./mapStore.js";
import { getDmToken } from "../systems/dnd5e/dmAccess.js";
import { getAllPlans, publishPartyMap, updatePartyMapLive, clearPartyMap } from "../network.js";

// Shrink a map image so it is small enough to share with the table (a JPEG up to 1600 px on its longest side).
async function shrinkImage(dataUrl, max = 1600, limit = 2_300_000) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't read that image.")); i.src = dataUrl; });
  let k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  for (let q = 0.85; ; q -= 0.12, k *= 0.85) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL("image/jpeg", Math.max(0.4, q));
    if (out.length <= limit || q < 0.4) return out;
  }
}

const ICONS = [["●", "Pin"], ["⌂", "Town"], ["♖", "Castle / gym"], ["☠", "Danger"], ["◆", "Treasure"], ["!", "Quest"], ["▲", "Camp / cave"], ["⚔", "Battle"], ["≈", "Water"], ["✚", "Healing / Poké Center"], ["?", "Mystery"], ["★", "Important"]];
const COLORS = [["#ff4a22", "Red"], ["#f0b45a", "Gold"], ["#6fcf6a", "Green"], ["#5aa8f0", "Blue"], ["#c27aef", "Purple"], ["#f0f0f0", "White"], ["#9a8a7a", "Grey"]];
const MAX_BYTES = 25 * 1024 * 1024;

export function renderMapsTab(panel, shared = {}, arg = null) {
  const dm = !!shared.dm;
  let pendingFocus = arg?.pinId || null;     // asked to open on a particular label (from a whiteboard node's map link)
  let selected = (arg?.mapId && getPlan().maps.some((m) => m.id === arg.mapId) ? arg.mapId : null) || getPlan().maps[0]?.id || null;
  let mode = "pan";            // "pan" or "add"
  let showLabels = true;
  let imageUrl = null;
  const view = { x: 0, y: 0, k: 1, fit: 1 };

  const listHost = el("div", { class: "dnd-list" });
  const viewerHost = el("div", { class: "pl-map-viewer" });
  const pinsHost = el("div", { class: "card pl-map-pins" });
  const maps = () => getPlan().maps;
  const current = () => maps().find((m) => m.id === selected) || null;

  // ------------------------------------------------------------ importing and managing maps
  async function importFile(file) {
    if (!file) return;
    try {
      if (/\.json$/i.test(file.name)) return importPack(file);
      if (file.size > MAX_BYTES) { toast("That image is over 25 MB.", "bad"); return; }
      const url = await readAsDataUrl(file);
      const { w, h } = await imageSize(url);
      const m = newMap(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
      m.w = w; m.h = h; m.hasImage = true;
      await putImage(m.id, url);
      mutatePlan((p) => { p.maps.unshift(m); });
      selected = m.id; imageUrl = url;
      drawList(); drawViewer();
      toast(`Imported ${m.name} (${w}×${h}).`, "good");
    } catch (err) { toast(err.message || "Couldn't import that file.", "bad"); }
  }

  async function importPack(file) {
    const data = JSON.parse(await file.text());
    if (data.kind !== "pokemon-dnd-map-v1" || !data.map || typeof data.image !== "string" || !data.image.startsWith("data:image/")) throw new Error("That isn't a map pack from this app.");
    const m = newMap(String(data.map.name || "Imported map").slice(0, 80));
    m.w = Number(data.map.w) || 0; m.h = Number(data.map.h) || 0; m.hasImage = true;
    m.pins = (Array.isArray(data.map.pins) ? data.map.pins : []).slice(0, 500).map((p) => ({ id: uid(), x: clamp01(p.x), y: clamp01(p.y), label: String(p.label || "").slice(0, 80), note: String(p.note || "").slice(0, 2000), icon: String(p.icon || "●").slice(0, 2), color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#ff4a22" }));
    await putImage(m.id, data.image);
    mutatePlan((p) => { p.maps.unshift(m); });
    selected = m.id; imageUrl = data.image;
    drawList(); drawViewer();
    toast(`Imported the map pack "${m.name}".`, "good");
  }

  async function exportPack(m) {
    const image = await getImage(m.id);
    if (!image) { toast("This device doesn't have that map's image.", "bad"); return; }
    download(`${m.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "map"}.map.json`, JSON.stringify({ kind: "pokemon-dnd-map-v1", map: { name: m.name, w: m.w, h: m.h, pins: m.pins }, image }));
  }

  const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
  // The DM's changes to the shared map (a label revealed, a player moved) reach the table a moment later.
  let liveTimer = null;
  const pushLive = () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      const m = maps().find((x) => x.shared), t = getDmToken();
      if (m && t) { try { await updatePartyMapLive(t, m.pins, m.tokens || []); } catch { /* offline: it goes next time */ } }
    }, 350);
  };
  const patchMap = (id, fn) => { mutatePlan((p) => { const m = p.maps.find((x) => x.id === id); if (m) fn(m); }); if (dm) pushLive(); };

  function drawList() {
    const rows = maps();
    listHost.replaceChildren(...(rows.length ? rows.map((m) => {
      const b = el("button", { type: "button", class: `dnd-list-item${m.id === selected ? " active" : ""}`, role: "option", "aria-selected": String(m.id === selected) }, [
        el("span", { class: "dnd-grow" }, m.name || "Map"), el("span", { class: "meta" }, `${m.pins.length} label${m.pins.length === 1 ? "" : "s"}`),
      ]);
      b.addEventListener("click", async () => { selected = m.id; imageUrl = null; drawList(); await drawViewer(); });
      return b;
    }) : [el("p", { class: "view-sub", style: "padding:12px" }, "No maps yet. Import an image to start labelling it.")]));
  }

  // ------------------------------------------------------------ the viewer
  async function drawViewer() {
    const m = current();
    pinsHost.replaceChildren();
    if (!m) {
      viewerHost.replaceChildren(el("div", { class: "pl-map-empty" }, [el("h4", {}, "Maps"), el("p", { class: "view-sub" }, "Import a map of your world, a dungeon, a town or a route. You can then label places on it, and the labels stay put as you zoom."), btn("Import a map", () => pickFile("image/*,.json").then(importFile), "btn")]));
      return;
    }
    if (!imageUrl) { try { imageUrl = await getImage(m.id); } catch { imageUrl = null; } }
    if (!imageUrl) {
      viewerHost.replaceChildren(el("div", { class: "pl-map-empty" }, [el("h4", {}, m.name), el("p", { class: "view-sub" }, "This map's image isn't on this device (images aren't synced). Your labels are safe. Import the image again, or an exported map pack."), btn("Re-import the image", async () => {
        const f = await pickFile("image/*"); if (!f) return;
        const url = await readAsDataUrl(f); const sz = await imageSize(url);
        await putImage(m.id, url); patchMap(m.id, (x) => { x.w = sz.w; x.h = sz.h; x.hasImage = true; }); imageUrl = url; drawViewer();
      }, "btn")]));
      drawPins(m);
      return;
    }
    const wrap = el("div", { class: "pl-map-wrap" });
    const stage = el("div", { class: "pl-map-stage", style: `width:${m.w}px;height:${m.h}px` });
    const img = el("img", { src: imageUrl, alt: m.name, draggable: "false" });
    img.style.cssText = "width:100%;height:100%;display:block;user-select:none;pointer-events:none";
    stage.append(img);
    wrap.append(stage);
    const tools = el("div", { class: "pl-map-tools" }, [
      btn("+", () => zoomBy(1.3), "btn secondary tiny", { "aria-label": "Zoom in", title: "Zoom in" }),
      btn("−", () => zoomBy(1 / 1.3), "btn secondary tiny", { "aria-label": "Zoom out", title: "Zoom out" }),
      btn("Fit", () => { fit(); apply(); }, "btn secondary tiny"),
      btn(mode === "add" ? "Click the map…" : "+ Label", () => { mode = mode === "add" ? "pan" : "add"; wrap.classList.toggle("adding", mode === "add"); addBtn.textContent = mode === "add" ? "Click the map…" : "+ Label"; addBtn.classList.toggle("secondary", mode !== "add"); }, "btn secondary tiny", { id: "pl-add" }),
      btn(showLabels ? "Hide text" : "Show text", () => { showLabels = !showLabels; wrap.classList.toggle("no-text", !showLabels); labelsBtn.textContent = showLabels ? "Hide text" : "Show text"; }, "btn secondary tiny"),
    ]);
    const addBtn = tools.children[3], labelsBtn = tools.children[4];
    wrap.classList.toggle("adding", mode === "add"); wrap.classList.toggle("no-text", !showLabels);
    viewerHost.replaceChildren(...[
      el("div", { class: "dnd-row between", style: "margin-bottom:8px" }, [
        el("strong", {}, `${m.name}`),
        el("div", { class: "dnd-row tight" }, [
          btn("Rename", async () => { const n = await promptDialog("Rename map", "Name", m.name); if (n) { patchMap(m.id, (x) => { x.name = n.trim().slice(0, 80) || x.name; }); drawList(); drawViewer(); } }, "btn secondary tiny"),
          btn("Replace image", async () => { const f = await pickFile("image/*"); if (!f) return; const url = await readAsDataUrl(f); const sz = await imageSize(url); await putImage(m.id, url); patchMap(m.id, (x) => { x.w = sz.w; x.h = sz.h; }); imageUrl = url; drawViewer(); }, "btn secondary tiny"),
          btn("Export pack", () => exportPack(m), "btn secondary tiny"),
          btn("Delete", async () => { if (await confirmDialog(`Delete the map "${m.name}" and its ${m.pins.length} labels?`, { ok: "Delete", danger: true })) { await deleteImage(m.id).catch(() => {}); mutatePlan((p) => { p.maps = p.maps.filter((x) => x.id !== m.id); }); selected = maps()[0]?.id || null; imageUrl = null; drawList(); drawViewer(); } }, "btn danger tiny"),
        ]),
      ]),
      dm ? shareBar(m) : null,
      el("div", { class: "pl-map-frame" }, [wrap, tools]),
      el("p", { class: "dnd-small dnd-muted" }, "Drag to pan, scroll or pinch to zoom, double-click to add a label, drag a label to move it."),
    ].filter(Boolean));

    // transform handling
    function fit() { const r = wrap.getBoundingClientRect(); view.fit = Math.min(r.width / m.w, r.height / m.h); view.k = view.fit; view.x = (r.width - m.w * view.k) / 2; view.y = (r.height - m.h * view.k) / 2; }
    function apply() {
      stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
      wrap.style.setProperty("--inv", String(1 / view.k));
    }
    function zoomAt(px, py, factor) {
      const k2 = Math.max(view.fit * 0.4, Math.min(10, view.k * factor));
      const f = k2 / view.k;
      view.x = px - (px - view.x) * f; view.y = py - (py - view.y) * f; view.k = k2; apply();
    }
    function zoomBy(f) { const r = wrap.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); }
    const toMap = (cx, cy) => { const r = wrap.getBoundingClientRect(); return { x: ((cx - r.left - view.x) / view.k) / m.w, y: ((cy - r.top - view.y) / view.k) / m.h }; };
    requestAnimationFrame(() => { fit(); apply(); });

    // pins and (for the DM) the players' tokens on the stage
    function drawStagePins() {
      stage.querySelectorAll(".pl-pin, .pl-token").forEach((n) => n.remove());
      const cur = current();
      for (const p of cur.pins) stage.append(pinEl(cur, p));
      if (dm) for (const t of cur.tokens || []) stage.append(tokenEl(cur, t));
    }
    function tokenEl(cur, t) {
      const n = el("div", { class: "pl-token", style: `left:${t.x * cur.w}px;top:${t.y * cur.h}px;--c:${t.color || "#5aa8f0"}`, "data-tip": `${t.name} (drag to move)`, "data-tip-title": "Player" }, [el("span", { class: "pl-token-dot" }, (t.name || "?").trim().slice(0, 2).toUpperCase()), el("span", { class: "pl-pin-text" }, t.name)]);
      let drag = null;
      n.addEventListener("pointerdown", (e) => { e.stopPropagation(); n.setPointerCapture(e.pointerId); drag = { sx: e.clientX, sy: e.clientY, moved: false }; });
      n.addEventListener("pointermove", (e) => {
        if (!drag) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
        drag.moved = true; const pt = toMap(e.clientX, e.clientY);
        n.style.left = `${clamp01(pt.x) * cur.w}px`; n.style.top = `${clamp01(pt.y) * cur.h}px`; drag.pt = pt;
      });
      n.addEventListener("pointerup", async () => {
        if (!drag) return;
        if (drag.moved && drag.pt) patchMap(cur.id, (x) => { const r = (x.tokens || []).find((q) => q.id === t.id); if (r) { r.x = clamp01(drag.pt.x); r.y = clamp01(drag.pt.y); } });
        else if (await confirmDialog(`Take ${t.name} off the map?`, { ok: "Remove" })) { patchMap(cur.id, (x) => { x.tokens = (x.tokens || []).filter((q) => q.id !== t.id); }); drawStagePins(); drawShare?.(); }
        drag = null;
      });
      return n;
    }
    function pinEl(cur, p) {
      const n = el("div", { class: `pl-pin${dm && !p.revealed ? " secret" : ""}`, style: `left:${p.x * cur.w}px;top:${p.y * cur.h}px;--c:${p.color}`, "data-id": p.id, title: p.note || p.label }, [el("span", { class: "pl-pin-dot" }, p.icon || "●"), el("span", { class: "pl-pin-text" }, p.label || "")]);
      let drag = null;
      n.addEventListener("pointerdown", (e) => { e.stopPropagation(); n.setPointerCapture(e.pointerId); drag = { sx: e.clientX, sy: e.clientY, moved: false }; });
      n.addEventListener("pointermove", (e) => {
        if (!drag) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
        drag.moved = true;
        const pt = toMap(e.clientX, e.clientY);
        n.style.left = `${clamp01(pt.x) * cur.w}px`; n.style.top = `${clamp01(pt.y) * cur.h}px`; drag.pt = pt;
      });
      n.addEventListener("pointerup", () => {
        if (!drag) return;
        if (drag.moved && drag.pt) patchMap(cur.id, (x) => { const r = x.pins.find((q) => q.id === p.id); if (r) { r.x = clamp01(drag.pt.x); r.y = clamp01(drag.pt.y); } });
        else editPin(cur.id, p.id);
        drag = null;
      });
      return n;
    }
    drawStagePins();
    drawPins(m, (id) => focusPin(id));

    function focusPin(id) {
      const p = current().pins.find((q) => q.id === id); if (!p) return;
      const r = wrap.getBoundingClientRect();
      view.k = Math.max(view.k, view.fit * 2.2);
      view.x = r.width / 2 - p.x * m.w * view.k; view.y = r.height / 2 - p.y * m.h * view.k; apply();
      stage.querySelectorAll(".pl-pin").forEach((n) => n.classList.toggle("flash", n.dataset.id === id));
      setTimeout(() => stage.querySelectorAll(".pl-pin.flash").forEach((n) => n.classList.remove("flash")), 1600);
    }

    // pointer interaction: pan, pinch, add a label
    const pts = new Map();
    let panning = null, pinch = null;
    wrap.addEventListener("pointerdown", (e) => {
      wrap.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k }; panning = null; }
      else panning = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const r = wrap.getBoundingClientRect();
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const target = pinch.k * (d / pinch.d);
        zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, target / view.k);
      } else if (panning) {
        const dx = e.clientX - panning.sx, dy = e.clientY - panning.sy;
        if (!panning.moved && Math.hypot(dx, dy) < 4) return;
        panning.moved = true; view.x = panning.vx + dx; view.y = panning.vy + dy; apply();
      }
    });
    const end = (e) => {
      const was = panning;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (was && !was.moved && mode === "add" && pts.size === 0) { addPinAt(e.clientX, e.clientY); }
      if (pts.size === 0) panning = null;
    };
    wrap.addEventListener("pointerup", end);
    wrap.addEventListener("pointercancel", end);
    wrap.addEventListener("dblclick", (e) => { if (!e.target.closest(".pl-pin")) addPinAt(e.clientX, e.clientY); });
    wrap.addEventListener("wheel", (e) => { e.preventDefault(); const r = wrap.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016)); }, { passive: false });
    window.addEventListener("resize", () => { if (document.body.contains(wrap)) { fit(); apply(); } }, { once: true });

    function addPinAt(cx, cy) {
      const pt = toMap(cx, cy);
      if (pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) return;
      const p = { id: uid(), x: pt.x, y: pt.y, label: "", note: "", icon: "●", color: "#ff4a22", revealed: false };
      patchMap(m.id, (x) => { x.pins.push(p); });
      mode = "pan"; wrap.classList.remove("adding"); addBtn.textContent = "+ Label"; addBtn.classList.add("secondary");
      drawStagePins(); drawList();
      editPin(m.id, p.id, true);
    }
    viewerHost.__redraw = () => { drawStagePins(); drawPins(current(), focusPin); drawList(); };
    if (pendingFocus) { const id = pendingFocus; pendingFocus = null; requestAnimationFrame(() => requestAnimationFrame(() => focusPin(id))); }
  }

  // ------------------------------------------------------------ sharing the map with the table (DM)
  let drawShare = null;
  function shareBar(m) {
    const host = el("div", { class: "card pl-share" });
    const token = getDmToken();
    drawShare = async () => {
      const mm = current(); if (!mm) return;
      const shown = mm.pins.filter((p) => p.revealed).length;
      const status = mm.shared ? chip(`Shared with players · ${shown} of ${mm.pins.length} places revealed`, "good") : chip("Not shared", "");
      const pick = el("select", { "aria-label": "Player to place on the map" });
      let people = [];
      try { people = (await getAllPlans(token)) || []; } catch { people = []; }
      const placed = new Set((mm.tokens || []).map((t) => t.id));
      pick.append(...people.filter((p) => !placed.has(p.id)).map((p) => el("option", { value: p.id }, p.name || "Player")));
      const addToken = (id, name) => {
        patchMap(mm.id, (x) => { x.tokens = x.tokens || []; x.tokens.push({ id, name: name.slice(0, 40), x: 0.5, y: 0.5, color: ["#5aa8f0", "#6fcf6a", "#c27aef", "#f0b45a", "#ff6a8a", "#43b7ae"][x.tokens.length % 6] }); });
        viewerHost.__redraw?.(); drawShare();
      };
      host.replaceChildren(
        el("div", { class: "dnd-row between" }, [
          el("div", { class: "dnd-row tight" }, [el("strong", {}, "Party map"), status]),
          el("div", { class: "dnd-row tight" }, [
            btn(mm.shared ? "Update shared image" : "Share with players", async () => {
              if (!token) { toast("Unlock DM tools first.", "bad"); return; }
              try {
                const image = await getImage(mm.id);
                if (!image) { toast("This device doesn't have that map's image.", "bad"); return; }
                await publishPartyMap(token, { name: mm.name, image: await shrinkImage(image), w: mm.w, h: mm.h, pins: mm.pins, tokens: mm.tokens || [] });
                mutatePlan((p) => { p.maps.forEach((x) => { x.shared = x.id === mm.id; }); });
                toast("Shared. Players see only the places you reveal.", "good"); drawShare(); drawList();
              } catch (err) { toast(`Couldn't share it: ${err.message || err}`, "bad"); }
            }, "btn small"),
            mm.shared ? btn("Stop sharing", async () => { try { await clearPartyMap(token); } catch { /* ignore */ } mutatePlan((p) => { p.maps.forEach((x) => { x.shared = false; }); }); drawShare(); drawList(); }, "btn secondary small") : null,
          ]),
        ]),
        el("p", { class: "dnd-small dnd-muted" }, "Places start hidden. Reveal one with its eye button in the label list and it appears for players. Drag a player's token to put them on the map."),
        el("div", { class: "dnd-row tight" }, [
          pick.options.length ? pick : null,
          pick.options.length ? btn("Place player", () => { const o = pick.selectedOptions[0]; if (o) addToken(o.value, o.textContent); }, "btn secondary small") : null,
          btn("Place a custom token", async () => { const n = await promptDialog("Place a token", "Name (a player, a party, a monster...)", ""); if (n?.trim()) addToken(`custom-${uid()}`, n.trim()); }, "btn secondary small"),
        ].filter(Boolean)),
      );
    };
    drawShare();
    return host;
  }

  // ------------------------------------------------------------ the label list and the label editor
  function drawPins(m, onPick) {
    const q = el("input", { type: "search", placeholder: "Find a label…", autocomplete: "off", "aria-label": "Find a label" });
    const rows = el("div", { class: "pl-pin-rows" });
    const draw = () => {
      const needle = q.value.toLowerCase();
      const hits = m.pins.filter((p) => !needle || `${p.label} ${p.note}`.toLowerCase().includes(needle));
      rows.replaceChildren(...(hits.length ? hits.map((p) => {
        const b = el("button", { type: "button", class: "pl-pin-row" }, [el("span", { class: "pl-pin-dot", style: `--c:${p.color}` }, p.icon || "●"), el("span", { class: "dnd-grow" }, [el("strong", {}, p.label || "(no name)"), p.note ? el("div", { class: "dnd-small dnd-muted" }, p.note.slice(0, 80)) : null].filter(Boolean))]);
        b.addEventListener("click", () => onPick?.(p.id));
        b.addEventListener("dblclick", () => editPin(m.id, p.id));
        if (!dm) return b;
        const eye = el("button", { type: "button", class: `pl-eye${p.revealed ? " on" : ""}`, "aria-pressed": String(!!p.revealed), "data-tip": p.revealed ? "Revealed to players. Click to hide again." : "Hidden from players. Click to reveal.", "aria-label": p.revealed ? "Hide from players" : "Reveal to players" }, p.revealed ? "Revealed" : "Hidden");
        eye.addEventListener("click", (e) => { e.stopPropagation(); patchMap(m.id, (x) => { const r = x.pins.find((q) => q.id === p.id); if (r) r.revealed = !r.revealed; }); viewerHost.__redraw?.(); drawShare?.(); });
        return el("div", { class: "pl-pin-line" }, [b, eye]);
      }) : [el("p", { class: "dnd-small dnd-muted" }, m.pins.length ? "No label matches." : "No labels yet. Use “+ Label” or double-click the map.")]));
    };
    q.addEventListener("input", draw);
    pinsHost.replaceChildren(el("div", { class: "dnd-section-head" }, [el("h4", {}, `Labels (${m.pins.length})`)]), q, rows);
    draw();
  }

  function editPin(mapId, pinId, isNew = false) {
    const m = maps().find((x) => x.id === mapId); const p = m?.pins.find((x) => x.id === pinId);
    if (!p) return;
    const label = textInput(p.label, () => {}, { placeholder: "e.g. Pewter City, The Rusty Anchor, Trap!", ariaLabel: "Label" });
    const note = textInput(p.note, () => {}, { multiline: true, rows: 4, placeholder: "Notes about this place (optional)", ariaLabel: "Note" });
    const icon = selectEl(ICONS.map(([v, l]) => [v, `${v}  ${l}`]), p.icon || "●", () => {});
    const color = selectEl(COLORS.map(([v, l]) => [v, l]), p.color, () => {});
    const reveal = checkbox("Revealed to players (they see this place on the shared map)", !!p.revealed, () => {});
    modal({
      title: isNew ? "New label" : "Edit label", body: [field("Label", label), el("div", { class: "dnd-grid-2" }, [field("Icon", icon), field("Colour", color)]), field("Note", note), dm ? reveal : null],
      actions: [
        { label: "Delete", cls: "btn danger", onClick: () => { patchMap(mapId, (x) => { x.pins = x.pins.filter((q) => q.id !== pinId); }); viewerHost.__redraw?.(); } },
        { label: isNew ? "Discard" : "Cancel", onClick: () => { if (isNew && !p.label) { patchMap(mapId, (x) => { x.pins = x.pins.filter((q) => q.id !== pinId); }); viewerHost.__redraw?.(); } } },
        { label: "Save", cls: "btn", onClick: () => { patchMap(mapId, (x) => { const r = x.pins.find((q) => q.id === pinId); if (r) Object.assign(r, { label: label.value.trim().slice(0, 80), note: note.value.slice(0, 2000), icon: icon.value, color: color.value, ...(dm ? { revealed: reveal.querySelector("input").checked } : {}) }); }); viewerHost.__redraw?.(); drawShare?.(); } },
      ],
    });
    setTimeout(() => label.focus(), 40);
  }

  // ------------------------------------------------------------ layout
  const importBtn = btn("+ Import map", async () => importFile(await pickFile("image/*,.json")), "btn small");
  const drop = el("div", { class: "pl-drop", role: "button", tabindex: "0", "aria-label": "Import a map: click, or drop an image here" }, [el("strong", {}, "Drop a map image here"), el("span", { class: "dnd-small dnd-muted" }, "PNG, JPG, WebP or a map pack (.json)")]);
  drop.addEventListener("click", async () => importFile(await pickFile("image/*,.json")));
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => importFile(e.dataTransfer.files[0]));

  panel.append(
    el("p", { class: "pl-banner" }, "Map images stay on this device. Labels are saved with your plan. Use “Export pack” to move a map to another device."),
    el("div", { class: "pl-map-layout" }, [
      el("div", { class: "pl-map-side" }, [el("div", { class: "card" }, [el("div", { class: "dnd-row between" }, [el("h4", {}, "Your maps"), importBtn]), listHost, drop]), pinsHost]),
      viewerHost,
    ]),
  );
  drawList();
  drawViewer();
  void chip;
}
