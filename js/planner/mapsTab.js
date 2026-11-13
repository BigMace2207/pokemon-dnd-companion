// The Map editor (the DM's; players get the same tools for their own maps). One map can be shown on the hub: it
// becomes the minimap and full map every player has (js/hubMap.js), with the places you reveal, everyone's tokens and,
// if you turn it on, the fog of war. For that map this editor works on the live copy: tokens are where players have
// actually moved them, the mist is drawn over the image (see-through for you), and "Brush away mist" clears it where you
// drag.
//
// Maps: import your own map images and label them in the app. Pan with a drag, zoom with the wheel, the buttons or a
// pinch; add a label with "+ Label" (or double-click the map), drag labels to move them, click one to edit its text,
// icon, colour and note. Images are uploaded to the server (one file per map, in this campaign: 10 maps of up to 15 MB
// for most accounts, no limit for accounts the admin allows), so they follow you to every device you sign in on; a
// map's name and labels are saved with the plan. Maps made before that kept their image on the device (mapStore.js)
// and offer to upload it. Export / Import map pack still moves a whole map to a friend.

import { el, btn, chip, textInput, selectEl, field, toast, confirmDialog, promptDialog, modal, download, pickFile, checkbox } from "../systems/dnd5e/ui.js";
import { getPlan, mutatePlan, newMap, uid } from "./store.js";
import { readAsDataUrl, imageSize, getImage, deleteImage } from "./mapStore.js";
import { getDmToken } from "../systems/dnd5e/dmAccess.js";
import { uploadFile, fileUrl, fileBlob, deleteFile, listFiles } from "../network.js";

// Upload an image (a File or Blob) as a map file in this campaign. Resolves to the file record, or throws with the
// server's reason (a full quota, a file over the size limit, ...).
async function uploadMap(blob, name) {
  const res = await uploadFile("map", blob, { name: name || "map" });
  if (res.error) throw new Error(res.error);
  return res.file;
}
const dataUrlToBlob = async (url) => (await fetch(url)).blob();

// The image to show for a map: its server file, or (older maps) the copy on this device.
async function mapImageUrl(m) {
  if (m.fileId) return fileUrl(m.fileId);
  return getImage(m.id).catch(() => null);
}
import { publishPartyMap, updatePartyMapLive, clearPartyMap, getRoster, getPartyMap, moveOnMap, setMapFog, setMapAreas } from "../network.js";
import { drawFog, areaPoints, areaDraft, mapGrid, colName, areaAt, gridRef } from "../mapView.js";
import { placeNodes, placeOnMaps, pinFields, nodeForPin } from "./places.js";
import { syncPlacePins } from "./placeSync.js";
import { mountMapChrome } from "./mapChrome.js";
import { wheelIntent, wheelPx } from "../wheelIntent.js";

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
const AREA_COLOURS = ["#d9a032", "#c8402f", "#4f8f4a", "#3d86d6", "#8b5cc4", "#e07a22", "#1d9a99", "#9a5b32"];   // gold, red, green, blue... for new areas (strong enough to read on a pale map)

export function renderMapsTab(panel, shared = {}, arg = null) {
  const dm = !!shared.dm;
  let pendingFocus = arg?.pinId || null;     // asked to open on a particular label (from a whiteboard node's map link)
  let selected = (arg?.mapId && getPlan().maps.some((m) => m.id === arg.mapId) ? arg.mapId : null) || getPlan().maps[0]?.id || null;
  let mode = "pan";            // "pan", "add" (a label) or "reveal" (brush the fog away, on the hub's map)
  let live = null;             // the hub's copy of this map (DM view) when the selected map is the one on the hub
  let liveTimer2 = null;
  let showLabels = true;
  let imageUrl = null;
  const view = { x: 0, y: 0, k: 1, fit: 1 };
  // The D&D editor: the map fills the page and a toolbar runs along the bottom (js/planner/mapChrome.js).
  const dndUi = !!(shared.hubLayout && shared.system === "dnd5e");
  let chrome = null;
  const changed = () => chrome?.refresh();

  const listHost = el("div", { class: "dnd-list" });
  const viewerHost = el("div", { class: "pl-map-viewer" });
  const pinsHost = el("div", { class: "card pl-map-pins" });
  const rightHost = el("div", { class: "pl-map-side right" });   // the hub, fog, players and markers
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
      toast("Uploading the map…");
      const rec = await uploadMap(file, file.name);
      m.w = w; m.h = h; m.hasImage = true; m.fileId = rec.id;
      mutatePlan((p) => { p.maps.unshift(m); });
      selected = m.id; imageUrl = await fileUrl(rec.id) || url; drawUsage();
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
    m.fileId = (await uploadMap(await dataUrlToBlob(data.image), `${m.name}.png`)).id;
    mutatePlan((p) => { p.maps.unshift(m); });
    selected = m.id; imageUrl = data.image; drawUsage();
    drawList(); drawViewer();
    toast(`Imported the map pack "${m.name}".`, "good");
  }

  async function exportPack(m) {
    const blob = m.fileId ? (await fileBlob(m.fileId))?.blob : null;
    const image = blob ? await readAsDataUrl(blob) : await getImage(m.id).catch(() => null);
    if (!image) { toast("Couldn't get that map's image.", "bad"); return; }
    download(`${m.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "map"}.map.json`, JSON.stringify({ kind: "pokemon-dnd-map-v1", map: { name: m.name, w: m.w, h: m.h, pins: m.pins }, image }));
  }

  const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
  // The DM's changes to the shared map (a label revealed, a player moved) reach the table a moment later.
  let liveTimer = null;
  const pushLive = () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      const m = maps().find((x) => x.shared), t = getDmToken();
      // tokens: everyone on the hub's map (players may have put themselves there) plus any you've just placed
      const tokens = live ? [...live.tokens, ...(m?.tokens || []).filter((x) => !live.tokens.some((y) => y.id === x.id))] : m?.tokens || [];
      if (m && t) { try { await updatePartyMapLive(t, m.pins, tokens); } catch { /* offline: it goes next time */ } }
    }, 350);
  };
  const patchMap = (id, fn) => { mutatePlan((p) => { const m = p.maps.find((x) => x.id === id); if (m) fn(m); }); if (dndUi) syncPinAreas(); if (dm) pushLive(); };

  // ------------------------------------------------------------ places (D&D): Whiteboard cards dragged onto the map as labels
  // A label remembers the area it is in (only if it is in one) so the Whiteboard card can say so; players are told the area
  // from the live map when they open the label (js/hubMap.js).
  function syncPinAreas() {
    const m = current();
    if (!m || !dm) return;
    const areas = m.shared && live ? live.areas || [] : [];
    const changes = m.pins.map((p) => [p.id, areaAt({ areas }, p.x, p.y)?.name || ""]).filter(([id, name]) => (m.pins.find((p) => p.id === id).area || "") !== name);
    if (!changes.length) return;
    mutatePlan((pl) => {
      const mm = pl.maps.find((x) => x.id === m.id);
      for (const [id, name] of changes) { const pin = mm?.pins.find((q) => q.id === id); if (!pin) continue; if (name) pin.area = name; else delete pin.area; }
    });
  }
  // Drop a place on the map: a label linked to it (or move the one already here). Hidden from players until revealed.
  function placeOnMap(nodeId, pt) {
    const m = current();
    const found = placeNodes(getPlan()).find(({ node }) => node.id === nodeId);
    if (!m || !found) return;
    const at = { x: clamp01(pt.x), y: clamp01(pt.y) };
    const here = m.pins.find((p) => p.placeId === nodeId);
    let pinId = here?.id;
    if (here) patchMap(m.id, (x) => { const r = x.pins.find((q) => q.id === here.id); if (r) Object.assign(r, at); });
    else { pinId = uid(); patchMap(m.id, (x) => { x.pins.push({ id: pinId, ...at, ...pinFields(found.node), revealed: false, placeId: nodeId }); }); }
    // the card remembers where it is, so its pin button opens the map there
    mutatePlan((p) => { const n = p.boards.find((b) => b.id === found.board.id)?.nodes.find((x) => x.id === nodeId); if (n) n.mapLink = { mapId: m.id, pinId }; });
    viewerHost.__redraw?.(); drawList(); changed();
    toast(here ? `Moved ${found.node.title || "the place"}.` : `${found.node.title || "The place"} is on the map, hidden from players until you show it.`);
  }
  // Take a place's label off this map (the card on the Whiteboard stays).
  function removePlacePin(pinId) {
    const m = current(), pin = m?.pins.find((p) => p.id === pinId);
    if (!m || !pin) return;
    patchMap(m.id, (x) => { x.pins = x.pins.filter((q) => q.id !== pinId); });
    if (pin.placeId) mutatePlan((p) => { for (const b of p.boards) for (const n of b.nodes) if (n.id === pin.placeId && n.mapLink?.pinId === pinId) delete n.mapLink; });
    viewerHost.__redraw?.(); drawList(); drawShare?.(); changed();
  }
  // The place cards, and where each is: on this map, on another one, or nowhere yet.
  function placesState() {
    if (!dndUi || !dm) return [];
    const plan = getPlan(), here = current();
    return placeNodes(plan).map(({ node, board }) => {
      const hit = placeOnMaps(plan, node.id, here?.id);
      const onThis = hit && hit.map.id === here?.id ? hit.pin : null;
      return { node, board, onThis, elsewhere: hit && !onThis ? hit : null };
    });
  }

  async function loadLive() {
    const m = current(), t = getDmToken();
    live = m?.shared && dm && t ? await getPartyMap(t).catch(() => null) : null;
    viewerHost.__live?.();
    drawShare?.();
    if (dndUi) syncPinAreas();
    changed();
  }
  function startLive() {
    clearInterval(liveTimer2);
    loadLive();
    liveTimer2 = setInterval(() => { if (!document.body.contains(viewerHost)) { clearInterval(liveTimer2); return; } if (!document.hidden && !viewerHost.__busy) loadLive(); }, 4000);
  }

  function drawList() {
    const rows = maps();
    listHost.replaceChildren(...(rows.length ? rows.map((m) => {
      const b = el("button", { type: "button", class: `dnd-list-item${m.id === selected ? " active" : ""}`, role: "option", "aria-selected": String(m.id === selected) }, [
        el("span", { class: "dnd-grow" }, m.name || "Map"), el("span", { class: "meta" }, `${m.pins.length} label${m.pins.length === 1 ? "" : "s"}`),
      ]);
      b.addEventListener("click", () => selectMap(m.id));
      return b;
    }) : [el("p", { class: "view-sub", style: "padding:12px" }, "No maps yet. Import an image to start labelling it.")]));
    changed();
  }
  async function selectMap(id) { selected = id; imageUrl = null; setMode("pan"); drawList(); await drawViewer(); startLive(); }

  // The tool in use: "pan", "add" (a label), "area" (corners of an area on the hub's map) or "reveal" (brush the mist away).
  function setMode(next) {
    mode = next;
    const w = viewerHost.__wrap;
    if (w) { w.classList.toggle("adding", mode === "add"); w.classList.toggle("brushing", mode === "reveal"); w.classList.toggle("drawing-area", mode === "area"); }
    if (mode !== "area") viewerHost.__area?.cancel();
    changed();
  }

  // ------------------------------------------------------------ map actions (the classic bar and the D&D toolbar both use these)
  async function renameMap(m) { const n = await promptDialog("Rename map", "Name", m.name); if (n) { patchMap(m.id, (x) => { x.name = n.trim().slice(0, 80) || x.name; }); drawList(); drawViewer(); } }
  async function replaceImage(m) {
    const f = await pickFile("image/*"); if (!f) return;
    try {
      const url = await readAsDataUrl(f); const sz = await imageSize(url);
      const old = m.fileId, rec = await uploadMap(f, f.name);
      patchMap(m.id, (x) => { x.w = sz.w; x.h = sz.h; x.fileId = rec.id; });
      if (old) deleteFile(old);
      imageUrl = url; drawViewer();
    } catch (err) { toast(err.message || "Couldn't upload it.", "bad"); }
  }
  async function deleteMap(m) {
    if (!(await confirmDialog(`Delete the map "${m.name}" and its ${m.pins.length} labels?`, { ok: "Delete", danger: true }))) return;
    await deleteImage(m.id).catch(() => {}); if (m.fileId) await deleteFile(m.fileId);
    mutatePlan((p) => { p.maps = p.maps.filter((x) => x.id !== m.id); });
    drawUsage(); selected = maps()[0]?.id || null; imageUrl = null; drawList(); drawViewer();
  }
  async function publishMap() {
    const mm = current(), token = getDmToken();
    if (!mm) return;
    if (!token) { toast("Unlock DM tools first.", "bad"); return; }
    try {
      let sharedMap = null;
      if (mm.fileId) sharedMap = await publishPartyMap(token, { name: mm.name, fileId: mm.fileId, w: mm.w, h: mm.h, pins: mm.pins, tokens: mm.tokens || [] });
      else {
        const image = await getImage(mm.id).catch(() => null);
        if (!image) { toast("This device doesn't have that map's image.", "bad"); return; }
        sharedMap = await publishPartyMap(token, { name: mm.name, image: await shrinkImage(image), w: mm.w, h: mm.h, pins: mm.pins, tokens: mm.tokens || [] });
      }
      if (!sharedMap || sharedMap.error) { toast(sharedMap?.error || "Couldn't put it on the hub. Check that DM tools are unlocked.", "bad"); return; }
      mutatePlan((p) => { p.maps.forEach((x) => { x.shared = x.id === mm.id; }); });
      toast("It's the hub's map now. Players see only the places you make visible.", "good");
      drawList(); await drawViewer(); startLive();
    } catch (err) { toast(`Couldn't share it: ${err.message || err}`, "bad"); }
  }
  async function unpublishMap() {
    try { await clearPartyMap(getDmToken()); } catch { /* ignore */ }
    mutatePlan((p) => { p.maps.forEach((x) => { x.shared = false; }); });
    live = null; drawList(); await drawViewer();
  }
  async function setFog(patch, op = null) {
    const res = await setMapFog(getDmToken(), patch, op);
    if (!res || res.error) { toast(res?.error || "Couldn't change the fog.", "bad"); return; }
    await loadLive();
  }
  async function saveAreas(list) {
    const res = await setMapAreas(getDmToken(), list.map(({ id, name, x, y, w, h, pts, color }) => (pts ? { id, name, pts, color } : { id, name, x, y, w, h, color })));
    if (!res || res.error) { toast(res?.error || "Couldn't save the areas.", "bad"); return false; }
    await loadLive();
    return true;
  }
  // the campaign's players, fetched at most every 30 seconds (the Hub map panel used to ask for them each time it drew)
  let rosterCache = null;
  async function rosterCached(force = false) {
    if (!force && rosterCache && Date.now() - rosterCache.at < 30000) return rosterCache.list;
    let list = [];
    try { list = (await getRoster()) || []; } catch { list = rosterCache?.list || []; }
    rosterCache = { at: Date.now(), list };
    return list;
  }
  function addToken(id, name, at = null) {
    const mm = current(); if (!mm) return;
    patchMap(mm.id, (x) => { x.tokens = (mm.shared && live ? live.tokens : x.tokens || []).map((t) => ({ ...t })); x.tokens.push({ id, name: name.slice(0, 40), x: at ? clamp01(at.x) : 0.5, y: at ? clamp01(at.y) : 0.5, color: ["#5aa8f0", "#6fcf6a", "#c27aef", "#f0b45a", "#ff6a8a", "#43b7ae"][x.tokens.length % 6] }); });
    setTimeout(loadLive, 600);
    viewerHost.__redraw?.(); drawShare?.(); changed();
  }
  function removeToken(id) {
    const cur = current(); if (!cur) return;
    if (live) live.tokens = live.tokens.filter((q) => q.id !== id);
    patchMap(cur.id, (x) => { x.tokens = (x.tokens || []).filter((q) => q.id !== id); });
    viewerHost.__redraw?.(); drawShare?.(); changed();
  }

  // ------------------------------------------------------------ the viewer
  async function drawViewer() { await drawViewerInner(); changed(); }
  async function drawViewerInner() {
    const m = current();
    pinsHost.replaceChildren();
    if (!m) {
      rightHost.replaceChildren();
      viewerHost.replaceChildren(el("div", { class: "pl-map-empty" }, [el("h4", {}, "Maps"), el("p", { class: "view-sub" }, "Import a map of your world, a dungeon, a town or a route. You can then label places on it, and the labels stay put as you zoom."), btn("Import a map", () => pickFile("image/*,.json").then(importFile), "btn")]));
      return;
    }
    if (!imageUrl) imageUrl = await mapImageUrl(m);
    if (!imageUrl) {
      viewerHost.replaceChildren(el("div", { class: "pl-map-empty" }, [el("h4", {}, m.name), el("p", { class: "view-sub" }, m.fileId ? "Couldn't load this map's image from the server. Check your connection, or upload the image again." : "This map's image was kept on another device before maps were stored on the server. Your labels are safe: upload the image again and it will be on every device."), btn("Upload the image", async () => {
        const f = await pickFile("image/*"); if (!f) return;
        try {
          const url = await readAsDataUrl(f); const sz = await imageSize(url);
          const rec = await uploadMap(f, f.name);
          patchMap(m.id, (x) => { x.w = sz.w; x.h = sz.h; x.hasImage = true; x.fileId = rec.id; }); imageUrl = url; drawViewer(); drawUsage();
        } catch (err) { toast(err.message || "Couldn't upload it.", "bad"); }
      }, "btn")]));
      drawPins(m);
      return;
    }
    if (!m.fileId) {
      // An older map whose image is only on this device: move it to the server so other devices get it too.
      setTimeout(async () => {
        try {
          const rec = await uploadMap(await dataUrlToBlob(imageUrl), `${m.name}.png`);
          patchMap(m.id, (x) => { x.fileId = rec.id; });
          deleteImage(m.id).catch(() => {});
          drawUsage();
        } catch { /* over the limit or offline: it stays on this device for now */ }
      }, 0);
    }
    rightHost.replaceChildren(...(dndUi ? [] : dm ? [shareBar(m)] : [el("div", { class: "card" }, [el("h4", {}, "Your map"), el("p", { class: "dnd-small dnd-muted" }, "Label places as you find them. The DM's map on the hub is in “Hub map”.")])]));
    const wrap = el("div", { class: "pl-map-wrap" });
    const stage = el("div", { class: "pl-map-stage", style: `width:${m.w}px;height:${m.h}px` });
    const img = el("img", { src: imageUrl, alt: m.name, draggable: "false" });
    img.style.cssText = "width:100%;height:100%;display:block;user-select:none;pointer-events:none";
    const fogCv = el("canvas", { class: "mv-fog", "aria-hidden": "true" });
    stage.append(img, fogCv);
    wrap.append(stage);
    const drawLiveFog = () => { if (live && current()?.shared) drawFog(fogCv, { ...live, w: m.w, h: m.h }, { see: true }); else fogCv.hidden = true; };
    drawLiveFog();
    // (D&D) the hub map's areas and the Area tool's draft sit on the picture, under the labels
    const NS = "http://www.w3.org/2000/svg";
    const areaLayer = el("div", { class: "mv-areas" });
    const areaShapes = document.createElementNS(NS, "svg"); areaShapes.setAttribute("class", "mv-area-shapes");
    const draftSvg = document.createElementNS(NS, "svg"); draftSvg.setAttribute("class", "mv-area-shapes");
    const draft = areaDraft(draftSvg);
    const areaList = () => (dndUi && dm && m.shared && live ? live.areas || [] : []);
    function drawAreas() {
      if (!dndUi) return;
      areaShapes.setAttribute("viewBox", `0 0 ${m.w} ${m.h}`); areaShapes.setAttribute("width", m.w); areaShapes.setAttribute("height", m.h);
      const list = areaList();
      // each outline has a light halo under it, so it shows on a dark map and a pale one
      areaShapes.replaceChildren(...list.flatMap((a) => {
        const points = areaPoints(a).map(([x, y]) => `${(x * m.w).toFixed(1)},${(y * m.h).toFixed(1)}`).join(" ");
        const halo = document.createElementNS(NS, "polygon"); halo.setAttribute("points", points); halo.setAttribute("class", "mv-area-halo");
        const poly = document.createElementNS(NS, "polygon"); poly.setAttribute("points", points);
        poly.setAttribute("class", "mv-area"); poly.dataset.id = a.id; poly.style.setProperty("--c", a.color || "#d9a032");
        return [halo, poly];
      }));
      areaLayer.replaceChildren(areaShapes, ...list.map((a) => el("span", { class: "mv-area-name", "data-id": a.id, style: `left:${a.x * m.w}px;top:${a.y * m.h}px;--c:${a.color || "#e9c27a"}` }, a.name)));
    }
    if (dndUi) { stage.insertBefore(areaLayer, fogCv); stage.append(draftSvg); drawAreas(); }
    // the same coordinate grid as the hub's full map: columns A, B, C... along the top, rows 1, 2, 3... down the left
    if (dndUi) {
      const g = mapGrid(m);
      const grid = el("div", { class: "mv-grid", "aria-hidden": "true" });
      grid.style.backgroundSize = `${g.cell}px ${g.cell}px`;
      stage.insertBefore(grid, areaLayer);
      stage.append(el("div", { class: "mv-coords", "aria-hidden": "true" }, [
        ...Array.from({ length: g.cols }, (_, i) => el("span", { class: "mv-col", style: `left:${((i + 0.5) * g.cell).toFixed(1)}px` }, colName(i))),
        ...Array.from({ length: g.rows }, (_, j) => el("span", { class: "mv-row", style: `top:${((j + 0.5) * g.cell).toFixed(1)}px` }, String(j + 1))),
      ]));
    }
    const tools = el("div", { class: "pl-map-tools" }, [
      btn("+", () => zoomBy(1.3), "btn secondary tiny", { "aria-label": "Zoom in", title: "Zoom in" }),
      btn("−", () => zoomBy(1 / 1.3), "btn secondary tiny", { "aria-label": "Zoom out", title: "Zoom out" }),
      btn("Fit", () => { fit(); apply(); }, "btn secondary tiny"),
      btn(mode === "add" ? "Click the map…" : "+ Label", () => { mode = mode === "add" ? "pan" : "add"; wrap.classList.toggle("adding", mode === "add"); addBtn.textContent = mode === "add" ? "Click the map…" : "+ Label"; addBtn.classList.toggle("secondary", mode !== "add"); }, "btn secondary tiny", { id: "pl-add" }),
      btn(showLabels ? "Hide text" : "Show text", () => { showLabels = !showLabels; wrap.classList.toggle("no-text", !showLabels); labelsBtn.textContent = showLabels ? "Hide text" : "Show text"; }, "btn secondary tiny"),
      dm && m.shared ? btn(mode === "reveal" ? "Brushing: drag on the map" : "Brush away mist", () => { mode = mode === "reveal" ? "pan" : "reveal"; wrap.classList.toggle("brushing", mode === "reveal"); brushBtn.textContent = mode === "reveal" ? "Brushing: drag on the map" : "Brush away mist"; brushBtn.classList.toggle("secondary", mode !== "reveal"); }, "btn secondary tiny") : null,
    ].filter(Boolean));
    const brushBtn = tools.children[5] || null;
    wrap.classList.toggle("brushing", mode === "reveal");
    const addBtn = tools.children[3], labelsBtn = tools.children[4];
    wrap.classList.toggle("adding", mode === "add"); wrap.classList.toggle("no-text", !showLabels);
    viewerHost.replaceChildren(...[
      el("div", { class: "dnd-row between pl-map-head", style: "margin-bottom:8px" }, [
        el("strong", { class: "pl-map-name" }, `${m.name}`),
        el("div", { class: "dnd-row tight pl-map-actions" }, [
          btn("Rename", () => renameMap(m), "btn secondary tiny"),
          btn("Replace image", () => replaceImage(m), "btn secondary tiny"),
          btn("Export pack", () => exportPack(m), "btn secondary tiny"),
          btn("Delete", () => deleteMap(m), "btn danger tiny"),
        ]),
      ]),
      el("div", { class: "pl-map-frame" }, [wrap, tools]),
      el("p", { class: "dnd-small dnd-muted pl-map-hint" }, "Drag to pan, scroll or pinch to zoom, double-click to add a label, drag a label to move it."),
    ].filter(Boolean));
    if (dndUi) viewerHost.replaceChildren(el("div", { class: "pl-map-frame" }, wrap));
    viewerHost.__wrap = wrap;

    // transform handling
    // (the hub layout fits the map a little smaller, so there's sky round it)
    function fit() {
      const r = wrap.getBoundingClientRect();
      if (dndUi) {   // the clear space between the top bar and the toolbar
        const top = 84, bottom = 104, availH = Math.max(120, r.height - top - bottom);
        view.fit = Math.min((r.width - 32) / m.w, availH / m.h); view.k = view.fit;
        view.x = (r.width - m.w * view.k) / 2; view.y = top + (availH - m.h * view.k) / 2;
        return;
      }
      view.fit = Math.min(r.width / m.w, r.height / m.h) * (shared.hubLayout ? 0.84 : 1); view.k = view.fit; view.x = (r.width - m.w * view.k) / 2; view.y = (r.height - m.h * view.k) / 2;
    }
    function apply() {
      stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
      wrap.style.setProperty("--inv", String(1 / view.k));
      viewerHost.__onView?.(view.k / view.fit);
      if (dndUi) draft.draw(m, view.k);
    }
    function zoomAt(px, py, factor) {
      const k2 = Math.max(view.fit * 0.4, Math.min(10, view.k * factor));
      const f = k2 / view.k;
      view.x = px - (px - view.x) * f; view.y = py - (py - view.y) * f; view.k = k2; apply();
    }
    function zoomBy(f) { const r = wrap.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); }
    const toMap = (cx, cy) => { const r = wrap.getBoundingClientRect(); return { x: ((cx - r.left - view.x) / view.k) / m.w, y: ((cy - r.top - view.y) / view.k) / m.h }; };
    // Fit straight away when the viewer already has its size, and keep the map hidden until it's fitted, so it never
    // shows at full size first and then shrinks (a page transition or a background tab could catch that frame).
    stage.style.visibility = "hidden";
    const fitNow = () => { if (wrap.clientWidth && wrap.clientHeight) { fit(); apply(); stage.style.visibility = ""; return true; } return false; };
    if (!fitNow()) requestAnimationFrame(function again() { if (document.body.contains(wrap) && !fitNow()) requestAnimationFrame(again); });

    // pins and (for the DM) the players' tokens on the stage
    // The labels and tokens are rebuilt only when what they show changes (the hub's copy is polled every few seconds), and not
    // while one is being dragged: rebuilding the element under your hand is what made labels lag and drop.
    let openPin = null, pinsSig = "", pendingDraw = false;
    function drawStagePins(force = false) {
      const cur = current();
      const tokens = dm ? ((cur.shared && live ? live.tokens : cur.tokens) || []) : [];
      const sig = JSON.stringify([cur.id, cur.w, cur.h, dm, openPin, openPin ? areaList() : 0, cur.pins, tokens]);
      if (!force && sig === pinsSig) return;
      if (viewerHost.__dragging) { pendingDraw = true; return; }
      pinsSig = sig; pendingDraw = false;
      stage.querySelectorAll(".pl-pin, .pl-token").forEach((n) => n.remove());
      for (const p of cur.pins) stage.append(pinEl(cur, p));
      for (const t of tokens) stage.append(tokenEl(cur, t));
    }
    viewerHost.__openPin = openPinCard; viewerHost.__closePin = closePinCard; viewerHost.__hasPin = () => !!openPin;
    viewerHost.__live = () => { if (document.body.contains(stage)) { drawLiveFog(); drawStagePins(); drawAreas(); } };
    // Drag a label or a token: it moves by how far the pointer moves (so it never jumps to centre on the pointer), by `translate`
    // alone (no layout), once a frame, and stays on the map. A press that doesn't move is a tap.
    function draggable(n, cur, pos, { onDrop, onTap }) {
      let drag = null, raf = 0;
      const paint = () => { raf = 0; if (drag?.moved) n.style.translate = `${drag.tx}px ${drag.ty}px`; };
      n.addEventListener("pointerdown", (e) => {
        if (e.button > 0) return;
        e.stopPropagation();
        try { n.setPointerCapture(e.pointerId); } catch { /* that pointer is already gone */ }
        drag = { sx: e.clientX, sy: e.clientY, moved: false, x: pos().x, y: pos().y, tx: 0, ty: 0 };
      });
      n.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (!drag.moved) { if (Math.hypot(dx, dy) < 5) return; drag.moved = true; n.classList.add("dragging"); viewerHost.__dragging = true; }
        drag.nx = clamp01(drag.x + dx / view.k / cur.w); drag.ny = clamp01(drag.y + dy / view.k / cur.h);
        drag.tx = (drag.nx - drag.x) * cur.w; drag.ty = (drag.ny - drag.y) * cur.h;
        if (!raf) raf = requestAnimationFrame(paint);
      });
      const finish = async (cancelled) => {
        const d = drag; drag = null;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        if (!d) return;
        n.classList.remove("dragging");
        if (d.moved && !cancelled && d.nx !== undefined) {
          n.style.left = `${d.nx * cur.w}px`; n.style.top = `${d.ny * cur.h}px`; n.style.translate = "";
          viewerHost.__dragging = false;
          await onDrop(d.nx, d.ny);
        } else {
          n.style.translate = "";
          viewerHost.__dragging = false;
          if (!d.moved && !cancelled) await onTap?.();
        }
        if (pendingDraw) drawStagePins();
      };
      n.addEventListener("pointerup", () => finish(false));
      n.addEventListener("pointercancel", () => finish(true));
    }
    function tokenEl(cur, t) {
      const n = el("div", { class: "pl-token", style: `left:${t.x * cur.w}px;top:${t.y * cur.h}px;--c:${t.color || "#5aa8f0"}`, "data-tip": `${t.name} (drag to move)`, "data-tip-title": "Player" }, [el("span", { class: "pl-token-dot" }, (t.name || "?").trim().slice(0, 2).toUpperCase()), el("span", { class: "pl-pin-text" }, t.name)]);
      draggable(n, cur, () => t, {
        async onDrop(x, y) {
          if (cur.shared && live) {
            // the hub's map: move it there (the mist clears round a player where they land)
            const res = await moveOnMap({ id: t.id, tokenId: t.id, x, y, token: getDmToken() });
            if (!res || res.error) toast(res?.error || "Couldn't move it.", "bad");
            patchMap(cur.id, (m2) => { const r = (m2.tokens || []).find((q) => q.id === t.id); if (r) { r.x = x; r.y = y; } });
            loadLive();
          } else patchMap(cur.id, (m2) => { const r = (m2.tokens || []).find((q) => q.id === t.id); if (r) { r.x = x; r.y = y; } });
        },
        async onTap() { if (await confirmDialog(`Take ${t.name} off the map?`, { ok: "Remove" })) removeToken(t.id); },
      });
      return n;
    }
    // (D&D) a label's card: press a label and its description opens beside it, press again, or the map, to close it
    function pinCard(cur, p) {
      const area = areaAt({ areas: areaList() }, p.x, p.y)?.name || "";   // only if it is in one
      const secret = dm && p.placeId ? nodeForPin(getPlan(), p)?.dmNotes : "";
      const paras = String(p.note || "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
      const sy = view.y + p.y * cur.h * view.k;
      const x = el("button", { type: "button", class: "pl-pin-card-x", "aria-label": "Close", title: "Close" }, "×");
      x.addEventListener("click", closePinCard);
      const acts = [btn("Edit", () => { closePinCard(); editPin(cur.id, p.id); }, "btn secondary tiny")];
      if (dm) acts.push(btn(p.revealed ? "Hide from players" : "Show to players", () => { patchMap(cur.id, (m2) => { const r = m2.pins.find((q) => q.id === p.id); if (r) r.revealed = !r.revealed; }); drawShare?.(); changed(); }, "btn secondary tiny"));
      const card = el("div", { class: `pl-pin-card${sy > wrap.clientHeight * 0.55 ? " up" : ""}`, role: "dialog", "aria-label": p.label || "Place" }, [
        el("div", { class: "pl-pin-card-head" }, [el("strong", {}, p.label || "(no name)"), x]),
        el("p", { class: "pl-pin-meta" }, [p.kind, gridRef(cur, p.x, p.y)].filter(Boolean).join(" · ")),
        p.known ? el("p", { class: "pl-pin-known" }, p.known) : null,
        el("div", { class: "pl-pin-desc" }, [
          area ? el("p", { class: "pl-pin-area" }, `In ${area}.`) : null,
          ...(paras.length ? paras.map((t) => el("p", {}, t)) : [area ? null : el("p", { class: "pl-pin-none" }, "No description yet.")]),
        ].filter(Boolean)),
        secret ? el("div", { class: "me-secret" }, [el("strong", {}, "Your notes (only you see these)"), el("p", {}, secret)]) : null,
        dm ? el("p", { class: "pl-pin-vis" }, p.revealed ? "Visible to players" : "Hidden from players") : null,
        el("div", { class: "pl-pin-card-acts" }, acts),
      ].filter(Boolean));
      // presses and the wheel inside the card are the card's own: they don't drag the label or zoom the map
      card.addEventListener("pointerdown", (e) => e.stopPropagation());
      card.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
      return card;
    }
    function openPinCard(id) { openPin = id; drawStagePins(true); }
    function closePinCard() { if (openPin) { openPin = null; drawStagePins(true); changed(); } }
    function pinEl(cur, p) {
      const open = dndUi && openPin === p.id;
      const n = el("div", {
        class: `pl-pin${dm && !p.revealed ? " secret" : ""}${open ? " open" : ""}`, style: `left:${p.x * cur.w}px;top:${p.y * cur.h}px;--c:${p.color}`, "data-id": p.id,
        ...(dndUi ? { role: "button", "aria-expanded": String(open), "aria-label": p.label || "Place" } : { title: p.note || p.label }),
      }, [el("span", { class: "pl-pin-dot" }, p.icon || "●"), el("span", { class: "pl-pin-text" }, p.label || "")]);
      if (open) n.append(pinCard(cur, p));
      draggable(n, cur, () => p, {
        onDrop(x, y) { patchMap(cur.id, (m2) => { const r = m2.pins.find((q) => q.id === p.id); if (r) { r.x = x; r.y = y; } }); },
        onTap() { if (dndUi) { if (openPin === p.id) closePinCard(); else openPinCard(p.id); } else editPin(cur.id, p.id); },
      });
      return n;
    }
    drawStagePins();
    drawPins(m, (id) => { focusPin(id); if (dndUi) openPinCard(id); });

    function focusPin(id) {
      const p = current().pins.find((q) => q.id === id); if (!p) return;
      const r = wrap.getBoundingClientRect();
      view.k = Math.max(view.k, view.fit * 2.2);
      view.x = r.width / 2 - p.x * m.w * view.k; view.y = r.height / 2 - p.y * m.h * view.k; apply();
      stage.querySelectorAll(".pl-pin").forEach((n) => n.classList.toggle("flash", n.dataset.id === id));
      setTimeout(() => stage.querySelectorAll(".pl-pin.flash").forEach((n) => n.classList.remove("flash")), 1600);
    }

    // pointer interaction: pan, pinch, add a label, brush the fog away
    let brushPts = [], brushTimer = null;
    async function flushBrush() {
      const send = brushPts.splice(0, 400);
      if (send.length) await setMapFog(getDmToken(), {}, "reveal", send).catch(() => null);
      if (!brushPts.length) { viewerHost.__busy = false; }
    }
    const pts = new Map();
    let panning = null, pinch = null;
    wrap.addEventListener("pointerdown", (e) => {
      try { wrap.setPointerCapture(e.pointerId); } catch { /* that pointer is already gone */ }
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
      } else if (panning && mode === "reveal" && live) {
        const pt = toMap(e.clientX, e.clientY);
        if (pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) return;
        brushPts.push([pt.x, pt.y]);
        live.reveals = [...(live.reveals || []), [pt.x, pt.y]];
        viewerHost.__busy = true;
        drawLiveFog();
        clearTimeout(brushTimer);
        brushTimer = setTimeout(flushBrush, 250);
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
      if (was && !was.moved && mode === "area" && pts.size === 0 && e.type === "pointerup") areaCorner(e.clientX, e.clientY);
      if (was && !was.moved && openPin && pts.size === 0 && e.type === "pointerup") closePinCard();
      if (pts.size === 0) panning = null;
    };
    wrap.addEventListener("pointerup", end);
    wrap.addEventListener("pointercancel", end);
    wrap.addEventListener("pointermove", (e) => {
      if (mode !== "area" || !draft.count || e.pointerType !== "mouse" || pts.size) return;
      draft.hover(toMap(e.clientX, e.clientY)); draft.draw(m, view.k);
    });
    wrap.addEventListener("pointerleave", () => { viewerHost.__onCursor?.(null); if (dndUi && draft.count) { draft.hover(null); draft.draw(m, view.k); } });
    // where the pointer is, as a grid square (the chrome shows it)
    wrap.addEventListener("pointermove", (e) => {
      if (!dndUi || !viewerHost.__onCursor || e.pointerType !== "mouse") return;
      const pt = toMap(e.clientX, e.clientY);
      viewerHost.__onCursor(pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1 ? null : { ...pt, map: m });
    });
    wrap.addEventListener("dblclick", (e) => { if (!e.target.closest(".pl-pin")) addPinAt(e.clientX, e.clientY); });
    if (dndUi) {   // a place dragged in from the Places drawer
      const isPlace = (e) => [...(e.dataTransfer?.types || [])].includes("application/x-map-place");
      wrap.addEventListener("dragover", (e) => { if (isPlace(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; wrap.classList.add("drop-place"); } });
      wrap.addEventListener("dragleave", () => wrap.classList.remove("drop-place"));
      wrap.addEventListener("drop", (e) => {
        wrap.classList.remove("drop-place");
        const id = e.dataTransfer?.getData("application/x-map-place");
        if (!id) return;
        e.preventDefault();
        const pt = toMap(e.clientX, e.clientY);
        if (pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) { toast("Drop it on the map."); return; }
        placeOnMap(id, pt);
      });
    }
    wrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (wheelIntent(e) === "pan") { view.x -= e.deltaX; view.y -= e.deltaY; apply(); return; }   // a touchpad scroll pans
      const r = wrap.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-wheelPx(e) * (e.ctrlKey ? 0.01 : 0.0016)));
    }, { passive: false });
    window.addEventListener("resize", () => { if (document.body.contains(wrap)) { fit(); apply(); } }, { once: true });

    // ---- the Area tool: each click adds a corner; the first corner (or Finish, or Enter) closes the shape and names it
    function areaCorner(cx, cy) {
      const pt = toMap(cx, cy);
      if (pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) return;
      const r = draft.tap(pt, m, view.k);
      if (r === "closed") { areaFinish(); return; }
      if (r === "full") toast("An area can have up to 60 corners. Finish it, or undo a corner.");
      draft.draw(m, view.k); changed();
    }
    async function areaFinish() {
      if (draft.count < 3) { toast("Place at least three corners."); return; }
      const pts = draft.points();
      const name = await promptDialog("Name this area", "Name (a forest, a town, a road)", "");
      if (!name || !name.trim()) return;   // the corners stay, so you can try again
      draft.clear(); draft.hover(null); draft.draw(m, view.k);
      const list = areaList();
      await saveAreas([...list, { id: `a${Date.now().toString(36)}`, name: name.trim().slice(0, 60), pts, color: AREA_COLOURS[list.length % AREA_COLOURS.length] }]);
      changed();
    }
    viewerHost.__area = {
      get corners() { return draft.count; },
      finish: areaFinish,
      undo() { draft.undo(); draft.draw(m, view.k); changed(); },
      cancel() { if (draft.count) { draft.clear(); draft.hover(null); draft.draw(m, view.k); } },
    };
    viewerHost.__ctl = {
      zoomBy, fit() { fit(); apply(); }, focusPin,
      toggleText() { showLabels = !showLabels; wrap.classList.toggle("no-text", !showLabels); return showLabels; },
      middle() { const r = wrap.getBoundingClientRect(); return toMap(r.left + r.width / 2, r.top + r.height / 2); },
      centreOn(pt) { const r = wrap.getBoundingClientRect(); view.x = r.width / 2 - pt.x * m.w * view.k; view.y = r.height / 2 - pt.y * m.h * view.k; apply(); },
    };
    apply();

    function addPinAt(cx, cy) {
      const pt = toMap(cx, cy);
      if (pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) return;
      const p = { id: uid(), x: pt.x, y: pt.y, label: "", note: "", icon: "●", color: "#ff4a22", revealed: false };
      patchMap(m.id, (x) => { x.pins.push(p); });
      setMode("pan"); wrap.classList.remove("adding"); addBtn.textContent = "+ Label"; addBtn.classList.add("secondary");
      drawStagePins(); drawList();
      editPin(m.id, p.id, true);
    }
    viewerHost.__redraw = () => { drawStagePins(); drawPins(current(), focusPin); drawList(); };
    if (pendingFocus) { const id = pendingFocus; pendingFocus = null; requestAnimationFrame(() => requestAnimationFrame(() => focusPin(id))); }
  }

  // ------------------------------------------------------------ the map on the hub (DM)
  let drawShare = null, lastShareSig = "";
  function shareBar(m) {
    const host = el("div", { class: "card pl-share" });
    const token = getDmToken();
    drawShare = async () => {
      const mm = current(); if (!mm || !document.body.contains(host)) return;
      const shown = mm.pins.filter((p) => p.revealed).length;
      const sig = JSON.stringify([mm.id, mm.shared, shown, mm.pins.length, live?.fog, ((mm.shared && live ? live.tokens : mm.tokens) || []).map((t) => t.id), rosterCache?.at]);
      if (sig === lastShareSig && host.childElementCount) return;   // polled every few seconds: nothing changed, nothing to redraw
      lastShareSig = sig;
      const status = mm.shared ? chip(`On the hub · ${shown} of ${mm.pins.length} places visible`, "good") : chip("Not on the hub", "");
      const publish = () => publishMap();
      const rows = [
        el("div", { class: "dnd-row between" }, [
          el("div", { class: "dnd-row tight" }, [el("strong", {}, "Hub map"), status]),
          el("div", { class: "dnd-row tight" }, [
            btn(mm.shared ? "Update the hub's copy" : "Show on the hub", publish, "btn small"),
            mm.shared ? btn("Take it off the hub", () => unpublishMap(), "btn secondary small") : null,
          ].filter(Boolean)),
        ]),
        el("p", { class: "dnd-small dnd-muted" }, "Players see this as the minimap on the hub and the full map behind it. Places start hidden: make one visible with its eye button in the label list."),
      ];
      if (mm.shared && live) {
        // ---- fog of war
        const fog = live.fog || {};
        const explain = el("p", { class: "dnd-small dnd-muted" }, fog.shared === false ? "Each player sees only the areas they've explored themselves, and only their own token." : "Everyone sees every area anyone has explored, and where every player is.");
        const onOff = checkbox("Fog of war: the map starts hidden in mist, which clears where players go", !!fog.enabled, (v) => setFog({ enabled: v }));
        const sharedSel = selectEl([["shared", "Shared: everyone sees it all"], ["private", "Private: each sees their own"]], fog.shared === false ? "private" : "shared", (v) => setFog({ shared: v === "shared" }));
        const radius = el("input", { type: "range", min: "2", max: "30", value: String(Math.round((fog.radius || 0.08) * 100)), "aria-label": "How far players see" });
        radius.addEventListener("change", () => setFog({ radius: Number(radius.value) / 100 }));
        rows.push(el("div", { class: "pl-fog" }, [
          el("h4", {}, "Fog of war"), onOff,
          fog.enabled ? field("Who sees what", sharedSel) : null,
          fog.enabled ? explain : null,
          fog.enabled ? field("How far players see", radius) : null,
          fog.enabled ? el("div", { class: "dnd-row tight" }, [
            el("span", { class: "dnd-small dnd-muted" }, "Use “Brush away mist” on the map to clear an area yourself."),
            btn("Cover it all again", async () => { if (await confirmDialog("Cover the whole map in mist again? Players keep only the patch where they're standing.", { ok: "Cover it" })) setFog({}, "reset"); }, "btn secondary small"),
          ]) : null,
        ].filter(Boolean)));
      }
      // ---- players and markers on the map
      const pick = el("select", { "aria-label": "Player to place on the map" });
      let people = [];
      people = rosterCache?.list || [];
      if (!rosterCache || Date.now() - rosterCache.at > 30000) rosterCached().then(() => { lastShareSig = ""; drawShare?.(); });   // the player picker fills in a moment later
      const placed = new Set(((mm.shared && live ? live.tokens : mm.tokens) || []).map((t) => t.id));
      pick.append(...people.filter((p) => !placed.has(p.id)).map((p) => el("option", { value: p.id }, p.name || "Player")));
      rows.push(el("div", { class: "dnd-row tight" }, [
        pick.options.length ? pick : null,
        pick.options.length ? btn("Place player", () => { const o = pick.selectedOptions[0]; if (o) addToken(o.value, o.textContent); }, "btn secondary small") : null,
        btn("Place a marker", async () => { const n = await promptDialog("Place a marker", "Name (a party, a monster, a ship...)", ""); if (n?.trim()) addToken(`custom-${uid()}`, n.trim()); }, "btn secondary small"),
      ].filter(Boolean)));
      if (mm.shared) rows.push(el("p", { class: "dnd-small dnd-muted" }, "Players can move their own token on the hub's map. Drag any token here to move it; click one to take it off."));
      host.replaceChildren(...rows);
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
        const b = el("button", { type: "button", class: "pl-pin-row" }, [el("span", { class: "pl-pin-dot", style: `--c:${p.color}` }, p.icon || "●"), el("span", { class: "dnd-grow" }, [el("strong", {}, p.label || "(no name)"), (p.kind || p.area || p.note) ? el("div", { class: "dnd-small dnd-muted" }, [p.kind, p.area ? `in ${p.area}` : null].filter(Boolean).join(" · ") || p.note.slice(0, 80)) : null].filter(Boolean))]);
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

  // a label made from a Whiteboard place: its details live on the card, so here you only choose who sees it
  function editLinkedPin(m, p) {
    const reveal = checkbox("Show it to players", !!p.revealed, () => {});
    const secret = nodeForPin(getPlan(), p)?.dmNotes;   // only the DM is ever in this editor, and their notes never reach a label
    modal({
      title: p.label || "Place",
      body: [
        [p.kind, p.known].filter(Boolean).length ? el("p", { class: "dnd-muted" }, [p.kind, p.known].filter(Boolean).join(" · ")) : null,
        p.note ? el("p", {}, p.note) : null,
        p.area ? el("p", { class: "dnd-small dnd-muted" }, `In ${p.area}`) : null,
        secret ? el("div", { class: "me-secret" }, [el("strong", {}, "Your notes (only you see these)"), el("p", {}, secret)]) : null,
        el("p", { class: "dnd-small dnd-muted" }, "Change its name, type, description and your private notes on its card on the Whiteboard. This label follows it."),
        reveal,
      ].filter(Boolean),
      actions: [
        { label: "Take off the map", cls: "btn danger", onClick: () => removePlacePin(p.id) },
        { label: "Cancel" },
        { label: "Open the Whiteboard", onClick: () => { location.hash = "planner"; } },
        { label: "Save", cls: "btn", onClick: () => { patchMap(m.id, (x) => { const r = x.pins.find((q) => q.id === p.id); if (r) r.revealed = reveal.querySelector("input").checked; }); viewerHost.__redraw?.(); drawShare?.(); changed(); } },
      ],
    });
  }

  function editPin(mapId, pinId, isNew = false) {
    const m = maps().find((x) => x.id === mapId); const p = m?.pins.find((x) => x.id === pinId);
    if (!p) return;
    if (p.placeId && dndUi && nodeForPin(getPlan(), p)) return editLinkedPin(m, p);
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
  // How many maps this account keeps in the campaign, against its limit.
  const usageHost = el("p", { class: "pl-banner" }, "Map images are stored on the server, so they're on every device you sign in on.");
  async function drawUsage() {
    const res = await listFiles("map");
    if (!res) return;
    const cap = res.limits.mapsPerCampaign, mb = Math.round(res.limits.mapBytes / 1048576);
    usageHost.textContent = cap == null
      ? `Map images are stored on the server and follow you to every device. ${res.files.length} map${res.files.length === 1 ? "" : "s"} here, no limit, up to ${mb} MB each.`
      : `Map images are stored on the server and follow you to every device. ${res.files.length} of ${cap} maps used in this campaign, up to ${mb} MB each.`;
  }
  drawUsage();
  const importBtn = btn("+ Import map", async () => importFile(await pickFile("image/*,.json")), "btn small");
  const drop = el("div", { class: "pl-drop", role: "button", tabindex: "0", "aria-label": "Import a map: click, or drop an image here" }, [el("strong", {}, "Drop a map image here"), el("span", { class: "dnd-small dnd-muted" }, "PNG, JPG, WebP or a map pack (.json)")]);
  drop.addEventListener("click", async () => importFile(await pickFile("image/*,.json")));
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => importFile(e.dataTransfer.files[0]));

  if (dndUi) {
    chrome = mountMapChrome(panel, chromeApi());
  } else if (shared.hubLayout) {
    mountHubLayout(panel, { dm, viewerHost, rightHost, pinsHost, mapsCard: el("div", { class: "card me-maps" }, [el("div", { class: "dnd-row between" }, [el("h4", {}, "Your maps"), importBtn]), listHost, drop, usageHost]), onBack: shared.onBack, startOpen: maps().length ? null : "maps" });
  } else {
    panel.append(
      usageHost,
      el("div", { class: "pl-map-layout three" }, [
        el("div", { class: "pl-map-side" }, [el("div", { class: "card" }, [el("div", { class: "dnd-row between" }, [el("h4", {}, "Your maps"), importBtn]), listHost, drop]), pinsHost]),
        viewerHost,
        rightHost,
      ]),
    );
  }
  drawList();
  drawViewer().then(startLive);
  if (dndUi) syncPlacePins().then((any) => { if (any) { drawList(); viewerHost.__redraw?.(); changed(); } });
  void chip;

  // What the D&D editor's chrome reads and does (it never touches this file's variables directly)
  function chromeApi() {
    return {
      dm, viewerHost, pinsHost, usageHost, dropEl: drop, onBack: shared.onBack,
      state: () => {
        const m = current();
        return {
          map: m, maps: maps(), selected, live, mode, text: showLabels,
          areas: m?.shared && dm && live ? live.areas || [] : [],
          tokens: (m?.shared && live ? live.tokens : m?.tokens) || [],
          corners: viewerHost.__area?.corners || 0,
          places: placesState(),
        };
      },
      refresh: () => chrome?.refresh(),
      ctl: () => viewerHost.__ctl,
      setMode, selectMap, importFile, exportPack, renameMap, replaceImage, deleteMap,
      publish: publishMap, unpublish: unpublishMap, setFog, saveAreas,
      areaFinish: () => viewerHost.__area?.finish(), areaUndo: () => viewerHost.__area?.undo(),
      roster: () => rosterCached(), rosterNow: () => rosterCache?.list || [], rosterLoaded: () => !!rosterCache,
      addToken, removeToken, removePlacePin,
      placeOnMap: (nodeId, pt) => placeOnMap(nodeId, pt || viewerHost.__ctl?.middle() || { x: 0.5, y: 0.5 }),
      centreOnPin: (pin) => { viewerHost.__ctl?.centreOn({ x: pin.x, y: pin.y }); viewerHost.__openPin?.(pin.id); },
      closePinCard: () => viewerHost.__closePin?.(),
      hasOpenPin: () => !!viewerHost.__hasPin?.(),
      openWhiteboard: () => { location.hash = "planner"; },
      centreOnArea: (a) => viewerHost.__ctl?.centreOn({ x: a.x + a.w / 2, y: a.y + a.h / 2 }),
      centreOnToken: (t) => viewerHost.__ctl?.centreOn({ x: t.x, y: t.y }),
    };
  }
}

// ------------------------------------------------------------ the hub layout (the Map editor's own page)
// The map being edited fills the page, with the cosmic sky past its edges. Your maps, Labels and (for the DM) Hub map
// are buttons in a hub-style bar at the top left; each opens its section as a floating glass panel, one at a time, and
// pressing it again closes it. The map's own actions and tools float as hub pill bars too (css/planner-hub.css).
const QUICK_ICONS = {
  maps: "M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20",
  labels: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  hub: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z",
  back: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
};
const glyph = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

function mountHubLayout(panel, { dm, viewerHost, rightHost, pinsHost, mapsCard, onBack, startOpen }) {
  const sections = {
    maps: { label: "Your maps", side: "left", body: mapsCard },
    labels: { label: "Labels", side: "left", body: pinsHost },
    ...(dm ? { hub: { label: "Hub map", side: "right", body: rightHost } } : {}),
  };
  const left = el("div", { class: "me-panel left", hidden: "" });
  const right = el("div", { class: "me-panel right", hidden: "" });
  let open = null;
  const buttons = Object.entries(sections).map(([id, sec]) => {
    const b = el("button", { type: "button", class: "hub-tool", "aria-expanded": "false" });
    b.innerHTML = glyph(QUICK_ICONS[id]) + `<span>${sec.label}</span>`;
    b.addEventListener("click", () => show(open === id ? null : id));
    return [id, b];
  });
  function show(id) {
    open = id;
    for (const [bid, b] of buttons) { b.classList.toggle("on", bid === id); b.setAttribute("aria-expanded", String(bid === id)); }
    for (const host of [left, right]) { host.hidden = true; host.replaceChildren(); }
    if (!id) return;
    const sec = sections[id], host = sec.side === "left" ? left : right;
    host.append(sec.body);
    host.hidden = false;
  }
  const home = el("button", { type: "button", class: "hub-round", "aria-label": "Back to the hub", title: "Back to the hub" });
  home.innerHTML = glyph(QUICK_ICONS.back);
  home.addEventListener("click", () => (onBack ? onBack() : (location.hash = "hub")));
  const top = el("div", { class: "me-top" }, [
    home,
    el("div", { class: "hub-title" }, [el("span", { class: "hub-eyebrow" }, "Pokémon D&D"), el("strong", {}, dm ? "Map editor" : "Maps")]),
    el("div", { class: "hub-quick", role: "toolbar", "aria-label": "Map editor sections" }, buttons.map(([, b]) => b)),
  ]);
  panel.classList.add("me-hub");
  panel.append(viewerHost, top, left, right);
  if (startOpen) show(startOpen);
}
