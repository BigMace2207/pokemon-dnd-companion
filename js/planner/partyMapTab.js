// The hub map, in the Whiteboard: the map the DM shows on the hub, as you see it there (the places they've made
// visible, the tokens and the fog of war you're allowed to see; the server decides all of that). Refreshes while open.
// The hub's minimap and full map (js/hubMap.js) are the main way to use it; this is the same view beside your notes.

import { el, chip } from "../systems/dnd5e/ui.js";
import { getPartyMap } from "../network.js";
import { loadSave } from "../storage.js";
import { getDmToken } from "../systems/dnd5e/dmAccess.js";
import { mapStage, panZoom } from "../mapView.js";

export function renderPartyMapTab(panel) {
  const host = el("div", { class: "pl-party-map" });
  panel.append(host);
  const meId = loadSave().networkId;
  let last = "", st = null, pz = null, opened = null;
  const note = el("div", { class: "card pl-party-note" });
  const head = el("div", { class: "dnd-row between" });

  async function load() {
    let map = null;
    try { map = await getPartyMap(getDmToken() || null, meId); } catch { map = null; }
    const sig = JSON.stringify(map);
    if (sig === last && host.childElementCount) return;
    last = sig;
    if (!map) { st = null; host.replaceChildren(el("p", { class: "view-sub" }, "Your DM hasn't put a map on the hub yet. When they do, it appears here, and places show up as they make them visible.")); return; }
    head.replaceChildren(el("strong", {}, map.name), chip(`${map.pins.length} place${map.pins.length === 1 ? "" : "s"}${map.fog?.enabled ? " · fog of war" : ""}`));
    if (st) { st.update(map); return; }
    st = mapStage(map, { labels: true, meId, see: !!getDmToken() });
    const frame = el("div", { class: "pl-map-wrap mv-frame" }, st.stage);
    host.replaceChildren(head, frame, note);
    pz = panZoom(frame, st.stage, {
      getSize: () => ({ w: st.map.w, h: st.map.h }), minK: 0.02,
      onTap: (pt, e) => {
        const pin = e.target.closest?.(".mv-pin");
        const p = pin && st.map.pins.find((x) => x.id === pin.dataset.id);
        if (p) { opened = p.id; note.replaceChildren(el("h4", {}, `${p.icon || "●"} ${p.label || "Place"}`), p.note ? el("p", {}, p.note) : el("p", { class: "dnd-small dnd-muted" }, "No notes about this place yet.")); }
      },
    });
    note.replaceChildren(el("p", { class: "dnd-small dnd-muted" }, map.pins.length ? "Tap a place on the map to read about it. Move your own token on the hub's map." : "No places visible yet."));
    requestAnimationFrame(() => pz.fit());
    void opened;
  }

  load();
  const timer = setInterval(() => { if (!document.body.contains(host)) { clearInterval(timer); return; } if (!document.hidden) load(); }, 5000);
}
