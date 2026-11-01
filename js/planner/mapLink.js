// Link a whiteboard node (a town, a dungeon, a shop...) to a labelled place on one of your maps, so you can jump from the node
// to its spot on the map. The link is stored on the node as { mapId, pinId }; "New place" adds a label in the middle of the map
// for you to drag into position in the Maps panel.

import { el, field, selectEl, toast, modal } from "../systems/dnd5e/ui.js";
import { kindOf, KINDS } from "./kinds.js";

const NEW = "__new__";

export function openMapLink({ node, edit, drawNodes, openMap, getPlan, mutatePlan, uid }) {
  const maps = getPlan().maps;
  if (!maps.length) { toast("Import a map first: open Maps in the top bar.", ""); return; }
  const cur = node.mapLink;
  const mapSel = selectEl(maps.map((m) => [m.id, m.name || "Map"]), cur?.mapId && maps.some((m) => m.id === cur.mapId) ? cur.mapId : maps[0].id, () => drawPins());
  const pinHost = el("div");
  let pinSel = null;
  function drawPins() {
    const m = maps.find((x) => x.id === mapSel.value);
    const opts = [[NEW, `+ New place "${node.title || (KINDS[kindOf(node)] || KINDS.note).label}"`], ...m.pins.map((p) => [p.id, p.label || "(unnamed place)"])];
    pinSel = selectEl(opts, cur?.mapId === m.id && m.pins.some((p) => p.id === cur.pinId) ? cur.pinId : (m.pins.length ? m.pins[0].id : NEW), () => {});
    pinHost.replaceChildren(field("Place on that map", pinSel));
  }
  drawPins();
  const actions = [{ label: "Cancel" }];
  if (cur) {
    actions.unshift(
      { label: "Open on the map", onClick: () => { openMap({ mapId: cur.mapId, pinId: cur.pinId }); } },
      { label: "Remove link", cls: "btn danger", onClick: () => { edit((b) => { const n = b.nodes.find((x) => x.id === node.id); if (n) delete n.mapLink; }); drawNodes(); } },
    );
  }
  actions.push({
    label: "Link", cls: "btn",
    onClick: () => {
      const mapId = mapSel.value;
      let pinId = pinSel.value;
      if (pinId === NEW) {
        pinId = uid();
        mutatePlan((p) => { p.maps.find((m) => m.id === mapId)?.pins.push({ id: pinId, x: 0.5, y: 0.5, label: (node.title || (KINDS[kindOf(node)] || KINDS.note).label).slice(0, 80), note: "", icon: "●", color: "#ff4a22", revealed: false }); });
        toast("Added a place in the middle of the map. Drag it to the right spot in Maps.", "good");
      }
      edit((b) => { const n = b.nodes.find((x) => x.id === node.id); if (n) n.mapLink = { mapId, pinId }; });
      drawNodes();
    },
  });
  modal({ title: cur ? "Linked to a map" : "Link to a place on a map", body: el("div", { class: "dnd-stack" }, [el("p", { class: "dnd-small dnd-muted" }, "Pick where this is on one of your maps."), field("Map", mapSel), pinHost]), actions });
}
