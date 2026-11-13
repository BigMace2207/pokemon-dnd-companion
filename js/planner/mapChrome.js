// The D&D Map editor's chrome (js/planner/mapsTab.js builds the map itself and hands this its state and actions).
//
//   top left   home, the title, and the map's name: press it for your maps
//   top right  (DM) whether the map is on the hub, with the buttons to put it there, update it or take it off
//   bottom     one toolbar like the hub's and the Whiteboard's: Move, Label, Area and Mist tools on a sliding pill,
//              zoom, label text on or off, and the Labels / Players / Fog drawers
//   above it   a short bar that appears only while the tool in use has something to say or do (Finish, Undo, Cancel)
//   drawers    maps on the left; labels (and the hub map's areas), players and fog on the right
//
// Everything redraws from api.state() through refresh(), and each part remembers what it last drew, so a refresh that
// changes nothing (the hub's copy is polled every few seconds) costs nothing and never resets a scroll or a field.

import { el, toast, confirmDialog, promptDialog, pickFile, checkbox } from "../systems/dnd5e/ui.js";
import { gridRef, areaAt } from "../mapView.js";
import { placeType } from "./places.js";

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
  home: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
  map: "M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20",
  chevron: "M6 9l6 6 6-6",
  close: "M6 6l12 12M18 6L6 18",
  move: "M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20",
  label: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  area: "M4 6l9-2 7 5-4 3 3 7-9 1-6-5z",
  mist: "M7 18h10a4 4 0 0 0 .6-7.9A5.5 5.5 0 0 0 7 9.5 4.3 4.3 0 0 0 7 18z",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  labels: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  places: "M5 21V4M5 4h11l-2 4 2 4H5",
  players: "M9 11a3 3 0 1 0 0-.01M3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-.01M15.5 15.5A5 5 0 0 1 21 20",
  fog: "M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7",
  edit: "M4 20l4-1L19 8l-3-3L5 16z",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13",
};
const icon = (d, cls = "me-ico") => { const s = el("span", { class: cls, "aria-hidden": "true" }); s.innerHTML = svg(d); return s; };
const pill = (label, onClick, { solid = false, danger = false, disabled = false, title = "" } = {}) => {
  const b = el("button", { type: "button", class: `hub-pill${solid ? " solid" : ""}${danger ? " danger" : ""}`, ...(title ? { title } : {}) }, label);
  if (disabled) b.disabled = true;
  b.addEventListener("click", onClick);
  return b;
};
const note = (text) => el("span", { class: "me-note" }, text);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function mountMapChrome(panel, api) {
  const { dm, viewerHost } = api;
  panel.classList.add("me-hub", "me-dnd");
  let open = null;            // the drawer that's out: "maps" | "labels" | "players" | "fog"
  let labelsTab = "labels";   // inside the Labels drawer: "labels" | "areas"
  let drawn = {};             // what each part last drew (a signature), so refresh() only redraws what changed
  const changedSince = (key, sig) => { if (drawn[key] === sig) return false; drawn[key] = sig; return true; };

  // ---------------------------------------------------------------- top left
  const home = el("button", { type: "button", class: "hub-round", "aria-label": "Back to the hub", title: "Back to the hub" });
  home.innerHTML = svg(ICON.home);
  home.addEventListener("click", () => (api.onBack ? api.onBack() : (location.hash = "hub")));
  const mapName = el("span", { class: "me-mapbtn-name" });
  const mapBtn = el("button", { type: "button", class: "me-mapbtn", title: "Your maps", "aria-haspopup": "dialog", "aria-expanded": "false" }, [icon(ICON.map), mapName, icon(ICON.chevron, "me-ico me-chev")]);
  mapBtn.addEventListener("click", () => toggleDrawer("maps"));
  const top = el("div", { class: "me-top" }, [
    home,
    el("div", { class: "hub-title" }, [el("span", { class: "hub-eyebrow" }, "Dungeons & Dragons"), el("strong", {}, dm ? "Map editor" : "Maps")]),
    mapBtn,
  ]);

  // ---------------------------------------------------------------- top right: the hub's copy (DM)
  const share = el("div", { class: "me-share", hidden: "" });
  function drawShare(st) {
    const m = st.map;
    share.hidden = !dm || !m;
    if (share.hidden) return;
    const shown = m.pins.filter((p) => p.revealed).length;
    if (!changedSince("share", JSON.stringify([m.id, m.shared, shown, m.pins.length]))) return;
    share.replaceChildren(
      el("span", { class: `me-dot${m.shared ? " on" : ""}`, "aria-hidden": "true" }),
      el("span", { class: "me-share-text" }, m.shared ? `On the hub · ${shown} of ${plural(m.pins.length, "label")} visible` : "Not on the hub"),
      ...(m.shared
        ? [pill("Update", () => api.publish(), { title: "Send the map's name, image and labels to the hub again" }), pill("Take off", () => api.unpublish())]
        : [pill("Show on the hub", () => api.publish(), { solid: true })]),
    );
  }

  // ---------------------------------------------------------------- the toolbar
  const toolbar = el("div", { class: "hub-toolbar me-toolbar", role: "toolbar", "aria-label": "Map tools" });
  const thumb = el("span", { class: "hub-thumb", "aria-hidden": "true" });
  const TOOLS = [["pan", "Move", ICON.move, "V"], ["add", "Label", ICON.label, "L"], ...(dm ? [["area", "Area", ICON.area, "A"], ["reveal", "Mist", ICON.mist, "M"]] : [])];
  const toolBtns = new Map(TOOLS.map(([id, label, d, key]) => {
    const b = el("button", { type: "button", class: "hub-tool", "data-tool": id, title: `${label} (${key})`, "aria-label": label, "aria-pressed": "false" });
    b.innerHTML = `${svg(d)}<span>${label}</span>`;
    b.addEventListener("click", () => pickTool(id));
    return [id, b];
  }));
  function pickTool(id) {
    const st = api.state();
    if (!st.map) { toast("Import a map first."); return; }
    if (id === "area" && !st.map.shared) { toast("Show the map on the hub first, then draw its areas."); return; }
    if (id === "reveal") {
      if (!st.map.shared) { toast("Show the map on the hub first, then clear its mist."); return; }
      if (!st.live?.fog?.enabled) { toast("Turn on fog of war first."); openDrawer("fog"); return; }
    }
    api.setMode(id);
  }
  const iconBtn = (d, label, onClick) => {
    const b = el("button", { type: "button", class: "hub-tool me-icon", title: label, "aria-label": label });
    b.innerHTML = svg(d);
    b.addEventListener("click", onClick);
    return b;
  };
  const readout = el("span", { class: "me-zoom", "aria-live": "off" }, "100%");
  const textBtn = iconBtn(ICON.text, "Hide label text", () => { api.ctl()?.toggleText(); api.refresh(); });
  const toggles = new Map();
  const toggleBtn = (id, label, d) => {
    const b = el("button", { type: "button", class: "hub-tool me-toggle", "data-drawer": id, title: label, "aria-label": label, "aria-expanded": "false" });
    b.innerHTML = `${svg(d)}<span>${label}</span>`;
    b.addEventListener("click", () => toggleDrawer(id));
    toggles.set(id, b);
    return b;
  };
  toolbar.append(
    thumb, ...toolBtns.values(), el("span", { class: "hub-sep" }),
    iconBtn(ICON.minus, "Zoom out", () => api.ctl()?.zoomBy(1 / 1.3)), readout, iconBtn(ICON.plus, "Zoom in", () => api.ctl()?.zoomBy(1.3)), iconBtn(ICON.fit, "Fit the map", () => api.ctl()?.fit()), textBtn,
    el("span", { class: "hub-sep" }),
    toggleBtn("labels", "Labels", ICON.labels), ...(dm ? [toggleBtn("places", "Places", ICON.places), toggleBtn("players", "Players", ICON.players), toggleBtn("fog", "Fog", ICON.fog)] : []),
  );
  viewerHost.__onView = (z) => { readout.textContent = `${Math.round(z * 100)}%`; };
  // the grid square under the pointer (and the area it's in), bottom left on the toolbar's line
  const coord = el("div", { class: "me-coord", hidden: "", "aria-hidden": "true" });
  viewerHost.__onCursor = (at) => {
    if (!at) { coord.hidden = true; return; }
    const area = areaAt({ areas: api.state().areas }, at.x, at.y);
    coord.textContent = `${gridRef(at.map, at.x, at.y)}${area ? ` · ${area.name}` : ""}`;
    coord.hidden = false;
  };
  function moveThumb(instant = false) {
    const on = toolbar.querySelector(".hub-tool[data-tool][aria-pressed='true']");
    if (!on) return;
    thumb.classList.toggle("instant", instant);
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  function drawTools(st) {
    const sig = JSON.stringify([st.mode, !!st.map, st.map?.shared, st.text, open]);
    if (!changedSince("tools", sig)) return;
    for (const [id, b] of toolBtns) {
      const on = !!st.map && st.mode === id;
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("me-soft-off", (id === "area" || id === "reveal") && !!st.map && !st.map.shared);
      b.disabled = !st.map && id !== "pan";
    }
    textBtn.classList.toggle("me-off", !st.text);
    textBtn.title = textBtn.ariaLabel = st.text ? "Hide label text" : "Show label text";
    textBtn.setAttribute("aria-label", textBtn.title);
    for (const [id, b] of toggles) { b.classList.toggle("on", open === id); b.setAttribute("aria-expanded", String(open === id)); }
    mapBtn.setAttribute("aria-expanded", String(open === "maps"));
    moveThumb();
  }

  // ---------------------------------------------------------------- the bar above the toolbar
  const subbar = el("div", { class: "hub-subbar me-subbar", role: "group", "aria-label": "Tool options" });
  function drawSubbar(st) {
    if (!changedSince("sub", JSON.stringify([st.mode, st.corners, st.areas.length, st.live?.fog?.enabled]))) return;
    subbar.replaceChildren();
    if (st.mode === "add") subbar.append(note("Click the map to place a label."), pill("Cancel", () => api.setMode("pan")));
    else if (st.mode === "area") {
      subbar.append(
        note(st.corners ? `${plural(st.corners, "corner")}. Click the first one, or press Enter, to close the shape.` : "Click the map to place each corner."),
        pill("Finish", () => api.areaFinish(), { solid: true, disabled: st.corners < 3 }),
        pill("Undo", () => api.areaUndo(), { disabled: !st.corners }),
        pill("Cancel", () => api.setMode("pan")),
      );
    } else if (st.mode === "reveal") {
      subbar.append(note("Drag across the map to clear mist."), pill("Cover it all again", () => coverAgain()), pill("Done", () => api.setMode("pan")));
    }
    subbar.classList.toggle("show", st.mode !== "pan");
    panel.classList.toggle("sub-on", st.mode !== "pan");   // the drawers stop short of it
  }
  async function coverAgain() {
    if (await confirmDialog("Cover the whole map in mist again? Players keep only the patch where they're standing.", { ok: "Cover it" })) api.setFog({}, "reset");
  }

  // ---------------------------------------------------------------- drawers
  const drawers = { left: el("aside", { class: "me-drawer left", hidden: "" }), right: el("aside", { class: "me-drawer right", hidden: "" }) };
  const TITLES = { maps: "Maps", labels: "Labels", places: "Places", players: "Players", fog: "Fog of war" };
  const sideOf = (id) => (id === "maps" ? "left" : "right");
  function toggleDrawer(id) { open = open === id ? null : id; afterDrawerChange(); }
  function openDrawer(id, tab) { if (tab) labelsTab = tab; open = id; afterDrawerChange(true); }
  function afterDrawerChange(force = false) {
    if (open === "players") api.roster().then(() => { drawn.players = null; refreshDrawer(); });
    drawn.tools = null;   // the toggles' pressed state
    refreshDrawer(force);
    api.refresh();
  }
  function refreshDrawer(force = false, st = api.state()) {
    for (const [side, host] of Object.entries(drawers)) {
      if (!open || sideOf(open) !== side) { if (!host.hidden) { host.hidden = true; host.replaceChildren(); drawn[`drawer-${side}`] = null; } continue; }
      const sig = `${open}|${labelsTab}|${drawerSig(st)}`;
      if (!force && !host.hidden && drawn[`drawer-${side}`] === sig) continue;
      const wasHidden = host.hidden;
      const keepScroll = !wasHidden && drawn[`drawer-${side}`]?.startsWith(`${open}|`) ? host.querySelector(".me-drawer-body")?.scrollTop || 0 : 0;
      drawn[`drawer-${side}`] = sig;
      const close = el("button", { type: "button", class: "hub-round small", "aria-label": `Close ${TITLES[open]}`, title: "Close" });
      close.innerHTML = svg(ICON.close);
      close.addEventListener("click", () => { open = null; afterDrawerChange(); });
      const body = el("div", { class: "me-drawer-body" }, drawerBody(open, st));
      host.replaceChildren(el("header", { class: "me-drawer-head" }, [el("h2", {}, TITLES[open]), close]), body);
      host.hidden = false;
      body.scrollTop = keepScroll;
    }
  }
  // what a drawer shows, boiled down: it redraws only when this changes
  function drawerSig(st) {
    const m = st.map;
    if (open === "maps") return JSON.stringify([st.selected, st.maps.map((x) => [x.id, x.name, x.pins.length])]);
    if (open === "labels") return labelsTab === "areas" ? JSON.stringify([m?.shared, st.areas.map((a) => [a.id, a.name, a.color])]) : "labels";
    if (open === "places") return JSON.stringify([m?.id, st.places.map(({ node, onThis, elsewhere }) => [node.id, node.title, node.placeKind, onThis && [onThis.id, onThis.x, onThis.y, onThis.area || "", !!onThis.revealed], elsewhere?.map.name])]);
    if (open === "players") return JSON.stringify([m?.id, st.tokens.map((t) => [t.id, t.name, t.color]), api.rosterNow().map((p) => [p.id, p.name, p.online])]);
    if (open === "fog") return JSON.stringify([m?.shared, !!st.live, st.live?.fog]);
    return "";
  }
  function drawerBody(id, st) {
    if (id === "maps") return mapsBody(st);
    if (id === "labels") return labelsBody(st);
    if (id === "places") return placesBody(st);
    if (id === "players") return playersBody(st);
    return fogBody(st);
  }

  function mapsBody(st) {
    const rows = st.maps.map((m) => {
      const b = el("button", { type: "button", class: `me-row${m.id === st.selected ? " on" : ""}`, "aria-current": m.id === st.selected ? "true" : "false" }, [
        el("span", { class: "me-row-name" }, m.name || "Map"), el("small", {}, plural(m.pins.length, "label")),
      ]);
      b.addEventListener("click", () => api.selectMap(m.id));
      return b;
    });
    const m = st.map;
    return [
      el("div", { class: "me-actions" }, [pill("Import a map", async () => api.importFile(await pickFile("image/*,.json")), { solid: true })]),
      el("div", { class: "me-rows" }, rows.length ? rows : [el("p", { class: "me-empty" }, "No maps yet. Import an image, or drop one here.")]),
      m ? el("div", { class: "me-actions wrap" }, [
        pill("Rename", () => api.renameMap(m)), pill("Replace image", () => api.replaceImage(m)), pill("Export", () => api.exportPack(m)), pill("Delete", () => api.deleteMap(m), { danger: true }),
      ]) : null,
      api.dropEl, api.usageHost,
    ].filter(Boolean);
  }

  function labelsBody(st) {
    const tabs = el("div", { class: "me-seg", role: "tablist" }, [["labels", `Labels (${st.map?.pins.length || 0})`], ...(dm ? [["areas", `Areas (${st.areas.length})`]] : [])].map(([id, label]) => {
      const b = el("button", { type: "button", role: "tab", class: labelsTab === id ? "on" : "", "aria-selected": String(labelsTab === id) }, label);
      b.addEventListener("click", () => { labelsTab = id; refreshDrawer(true); });
      return b;
    }));
    return [dm ? tabs : null, labelsTab === "areas" && dm ? areasList(st) : api.pinsHost].filter(Boolean);
  }
  function areasList(st) {
    const m = st.map;
    if (!m?.shared) return el("div", { class: "me-empty-block" }, [el("p", { class: "me-empty" }, "Areas belong to the map on the hub."), pill("Show on the hub", () => api.publish(), { solid: true })]);
    if (!st.areas.length) return el("div", { class: "me-empty-block" }, [el("p", { class: "me-empty" }, "No areas yet. Pick Area on the toolbar and click round the place."), pill("Draw an area", () => pickTool("area"), { solid: true })]);
    return el("div", { class: "me-rows" }, st.areas.map((a) => {
      const go = el("button", { type: "button", class: "me-row" }, [el("span", { class: "me-swatch", style: `--c:${a.color || "#e9c27a"}` }), el("span", { class: "me-row-name" }, a.name), el("small", {}, gridRef(m, a.x, a.y))]);
      go.addEventListener("click", () => api.centreOnArea(a));
      const rename = el("button", { type: "button", class: "me-mini", title: "Rename", "aria-label": `Rename ${a.name}` });
      rename.innerHTML = svg(ICON.edit);
      rename.addEventListener("click", async () => { const n = await promptDialog("Rename area", "Name", a.name); if (n?.trim()) api.saveAreas(st.areas.map((x) => (x.id === a.id ? { ...x, name: n.trim().slice(0, 60) } : x))); });
      const del = el("button", { type: "button", class: "me-mini danger", title: "Delete", "aria-label": `Delete ${a.name}` });
      del.innerHTML = svg(ICON.trash);
      del.addEventListener("click", async () => { if (await confirmDialog(`Delete the area "${a.name}"?`, { ok: "Delete", danger: true })) api.saveAreas(st.areas.filter((x) => x.id !== a.id)); });
      return el("div", { class: "me-line" }, [go, rename, del]);
    }));
  }

  // the Whiteboard's place cards: drag one onto the map (or press Place) to make a label that stays linked to it
  function placesBody(st) {
    const m = st.map;
    if (!m) return [el("p", { class: "me-empty" }, "Pick a map first.")];
    if (!st.places.length) {
      return [el("div", { class: "me-empty-block" }, [
        el("p", { class: "me-empty" }, "No places yet. Add a Place from the Whiteboard's add bar, give it a name and details, then drag it onto the map from here."),
        pill("Open the Whiteboard", () => api.openWhiteboard(), { solid: true }),
      ])];
    }
    const rows = st.places.map(({ node, onThis, elsewhere }) => {
      const type = placeType(node.placeKind);
      const status = onThis
        ? ["On the map", gridRef(m, onThis.x, onThis.y), onThis.area ? `in ${onThis.area}` : null, onThis.revealed ? "visible" : "hidden"].filter(Boolean).join(" · ")
        : elsewhere ? `On ${elsewhere.map.name || "another map"}` : "Not placed";
      let action;
      if (onThis) {
        action = el("button", { type: "button", class: "me-mini danger", title: "Take off the map", "aria-label": `Take ${node.title || "the place"} off the map` });
        action.innerHTML = svg(ICON.close);
        action.addEventListener("click", () => api.removePlacePin(onThis.id));
      } else action = pill("Place", () => api.placeOnMap(node.id));
      const row = el("div", { class: `me-place${onThis ? " on" : ""}`, draggable: "true", title: "Drag onto the map" }, [
        el("span", { class: "me-place-icon", style: `--c:${type[3]}`, "aria-hidden": "true" }, type[2]),
        el("span", { class: "me-place-text" }, [el("strong", {}, node.title || "Unnamed place"), el("small", {}, `${type[1]} · ${status}`)]),
        action,
      ]);
      row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("application/x-map-place", node.id); e.dataTransfer.effectAllowed = "copy"; row.classList.add("lifted"); });
      row.addEventListener("dragend", () => row.classList.remove("lifted"));
      if (onThis) row.addEventListener("click", (e) => { if (!e.target.closest("button")) api.centreOnPin(onThis); });
      return row;
    });
    return [el("p", { class: "me-fine" }, "Drag a place onto the map, or press Place. It stays hidden from players until you show it."), el("div", { class: "me-rows" }, rows)];
  }

  function playersBody(st) {
    const people = api.rosterNow();
    const placed = new Set(st.tokens.map((t) => t.id));
    const onMap = st.tokens.map((t) => {
      const rm = el("button", { type: "button", class: "me-mini danger", title: "Take off the map", "aria-label": `Take ${t.name} off the map` });
      rm.innerHTML = svg(ICON.close);
      rm.addEventListener("click", () => api.removeToken(t.id));
      const go = el("button", { type: "button", class: "me-row" }, [el("span", { class: "me-avatar", style: `--c:${t.color || "#5aa8f0"}` }, (t.name || "?").trim()[0]?.toUpperCase() || "?"), el("span", { class: "me-row-name" }, t.name)]);
      go.addEventListener("click", () => api.centreOnToken(t));
      return el("div", { class: "me-line" }, [go, rm]);
    });
    const waiting = people.filter((p) => !placed.has(p.id)).map((p) => el("div", { class: "me-line" }, [
      el("span", { class: "me-row static" }, [el("span", { class: `me-avatar off${p.online ? " online" : ""}` }, (p.name || "?").trim()[0]?.toUpperCase() || "?"), el("span", { class: "me-row-name" }, p.name || "Player"), p.online ? el("small", {}, "online") : null].filter(Boolean)),
      pill("Place", () => api.addToken(p.id, p.name || "Player", api.ctl()?.middle()), { solid: false }),
    ]));
    return [
      el("h3", { class: "me-sub" }, `On the map (${onMap.length})`),
      el("div", { class: "me-rows" }, onMap.length ? onMap : [el("p", { class: "me-empty" }, "Nobody is on the map yet.")]),
      el("h3", { class: "me-sub" }, "Not placed"),
      el("div", { class: "me-rows" }, api.rosterLoaded() ? (waiting.length ? waiting : [el("p", { class: "me-empty" }, "Everyone is on the map.")]) : [el("p", { class: "me-empty" }, "Loading players…")]),
      el("div", { class: "me-actions" }, [pill("Add a marker", async () => { const n = await promptDialog("Add a marker", "Name (a party, a monster, a ship)", ""); if (n?.trim()) api.addToken(`custom-${Math.random().toString(36).slice(2, 10)}`, n.trim(), api.ctl()?.middle()); })]),
    ];
  }

  function fogBody(st) {
    if (!st.map?.shared || !st.live) {
      return [el("div", { class: "me-empty-block" }, [el("p", { class: "me-empty" }, "Fog of war works on the map the hub is showing."), pill("Show on the hub", () => api.publish(), { solid: true })])];
    }
    const fog = st.live.fog || {};
    const out = [checkbox("Cover the map in mist", !!fog.enabled, (v) => api.setFog({ enabled: v })), el("p", { class: "me-fine" }, "Mist clears where players go.")];
    if (!fog.enabled) return out;
    const seg = el("div", { class: "me-seg" }, [["shared", "Shared"], ["private", "Private"]].map(([id, label]) => {
      const on = (fog.shared === false ? "private" : "shared") === id;
      const b = el("button", { type: "button", class: on ? "on" : "", "aria-pressed": String(on) }, label);
      b.addEventListener("click", () => { if (!on) api.setFog({ shared: id === "shared" }); });
      return b;
    }));
    const radius = el("input", { type: "range", min: "2", max: "30", value: String(Math.round((fog.radius || 0.08) * 100)), "aria-label": "How far players see" });
    radius.addEventListener("change", () => api.setFog({ radius: Number(radius.value) / 100 }));
    return [
      ...out,
      el("h3", { class: "me-sub" }, "Who sees what"), seg,
      el("p", { class: "me-fine" }, fog.shared === false ? "Each player sees only what they've explored, and only their own token." : "Everyone sees what anyone has explored, and every token."),
      el("h3", { class: "me-sub" }, "How far players see"), radius,
      el("div", { class: "me-actions" }, [pill("Clear mist by hand", () => pickTool("reveal")), pill("Cover it all again", () => coverAgain())]),
    ];
  }

  // ---------------------------------------------------------------- the map's name, and everything together
  function drawHeader(st) {
    if (!changedSince("head", JSON.stringify([st.map?.id, st.map?.name, st.maps.length]))) return;
    mapName.textContent = st.map ? st.map.name || "Map" : st.maps.length ? "Pick a map" : "No maps yet";
  }
  function refresh() {
    const st = api.state();
    drawHeader(st); drawShare(st); drawTools(st); drawSubbar(st); refreshDrawer(false, st);
  }

  // keys: Esc leaves the tool (then closes the drawer); Enter and Backspace work the area being drawn; V L A M pick a tool
  const onKey = (e) => {
    if (!document.body.contains(panel)) { document.removeEventListener("keydown", onKey); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, textarea, select, [contenteditable='true']") || document.querySelector(".modal-overlay")) return;
    const st = api.state();
    if (st.mode === "area" && e.key === "Enter") { e.preventDefault(); api.areaFinish(); return; }
    if (st.mode === "area" && e.key === "Backspace" && st.corners) { e.preventDefault(); api.areaUndo(); return; }
    if (e.key === "Escape") { if (api.hasOpenPin()) api.closePinCard(); else if (st.mode !== "pan") api.setMode("pan"); else if (open) { open = null; afterDrawerChange(); } return; }
    const hot = { v: "pan", l: "add", a: "area", m: "reveal" }[e.key.toLowerCase()];
    if (hot && toolBtns.has(hot)) pickTool(hot);
  };
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", function again() { if (!document.body.contains(panel)) { window.removeEventListener("resize", again); return; } moveThumb(true); });

  panel.append(viewerHost, top, share, subbar, toolbar, coord, drawers.left, drawers.right);
  if (!api.state().maps.length) open = "maps";
  refresh();
  refreshDrawer(true);
  requestAnimationFrame(() => moveThumb(true));
  return { refresh };
}
