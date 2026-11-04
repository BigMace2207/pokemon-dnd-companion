// The Map editor as its own page (it used to be a drawer inside the Whiteboard), laid out like the hub: the map being
// edited fills the page over the cosmic sky. The hub's top bar has a button for it, just left of the Whiteboard's. The editor itself is js/planner/mapsTab.js: maps are part of your plan, so it uses the
// same store (and the same DM check) the Whiteboard does.

import { el, asyncView } from "../systems/dnd5e/ui.js";
import { getDmToken } from "../systems/dnd5e/dmAccess.js";
import { checkDmToken } from "../network.js";
import { activeSystem } from "../systems/registry.js";
import { setDmMode, pushShared } from "../planner/store.js";
import { renderMapsTab } from "../planner/mapsTab.js";

export function renderMapEditor(container) {
  container.replaceChildren();
  const page = el("div", { class: "me-page" });
  container.append(page);
  asyncView(page, async () => {
    const token = getDmToken();
    const dm = !!(token && await checkDmToken(token));
    setDmMode(dm);
    if (!dm) pushShared();
    const body = el("div", { class: "me-body" });
    let arg = null;   // a Whiteboard node's map link asked to open on one map and label
    try { arg = JSON.parse(sessionStorage.getItem("mapeditor-open") || "null"); sessionStorage.removeItem("mapeditor-open"); } catch { /* none */ }
    // laid out like the hub: the map fills the page, the sections are buttons at the top left (mapsTab mountHubLayout)
    renderMapsTab(body, { dm, system: activeSystem()?.id || "pokemon-dnd", hubLayout: true }, arg);
    return [body];
  });
}
