// Keeps map labels that are linked to Whiteboard places up to date (see places.js). Called when a place card is edited
// and when the Map editor opens. A label whose card was removed stays on the map as a plain label.

import { getPlan, mutatePlan } from "./store.js";
import { getDmToken } from "../systems/dnd5e/dmAccess.js";
import { updatePartyMapLive } from "../network.js";
import { placeNodes, pinFields, pinDiffers } from "./places.js";

/** Brings every linked label in line with its place card, and the hub's copy of the map with it. True if any changed. */
export async function syncPlacePins() {
  const plan = getPlan();
  const places = new Map(placeNodes(plan).map(({ node }) => [node.id, node]));
  const changes = [];   // [mapId, pinId, fields, or null to unlink]
  for (const m of plan.maps) {
    for (const p of m.pins) {
      if (!p.placeId) continue;
      const node = places.get(p.placeId);
      if (!node) { changes.push([m.id, p.id, null]); continue; }
      const fields = pinFields(node);
      if (pinDiffers(p, fields)) changes.push([m.id, p.id, fields]);
    }
  }
  if (!changes.length) return false;
  mutatePlan((pl) => {
    for (const [mapId, pinId, fields] of changes) {
      const pin = pl.maps.find((x) => x.id === mapId)?.pins.find((x) => x.id === pinId);
      if (!pin) continue;
      if (fields) Object.assign(pin, fields); else delete pin.placeId;
    }
  });
  const shared = getPlan().maps.find((m) => m.shared), token = getDmToken();
  if (shared && token && changes.some(([mapId]) => mapId === shared.id)) {
    try { await updatePartyMapLive(token, shared.pins); } catch { /* offline: it goes with the next change */ }
  }
  return true;
}
