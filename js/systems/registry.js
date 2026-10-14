// Game-system registry. The app shell (js/app.js: campaigns, sync, themes,
// settings, battle log, dice tray, presence) is system-agnostic; everything
// that is specific to a tabletop game lives in a "system" module registered
// here. A campaign stores its system id (server.py: meta.system), and the
// shell loads that system's navigation, data and hooks when you enter it.
//
// A system definition looks like:
//
//   {
//     id: "pokemon-dnd",              // stable id, stored on campaigns
//     name: "Pokémon D&D",
//     tagline: "…",                    // shown in the campaign picker
//     status: "stable" | "preview",    // "preview" systems are labelled as such
//     brand: { title, logo },          // top-bar text/logo
//     nav: [ { label: null | "Group", views: [ { id, label, render, icon? } ] } ],
//     defaultView: "pokedex",
//     directiveViews: ["team", ...],  // views to re-render when a DM directive/save changes
//     loadData(): Promise<state>,      // load this system's rules data
//     mount(state): void,              // one-time hooks after data loads (floating tools, ...)
//     applyDirectives(state): Promise<boolean>,  // poll/apply DM directives; true if anything changed
//     presence(save): object,          // what other players see about you (Trainers Online, DM)
//     // `render(container, state)` of each view draws into the main area.
//   }
//
// To add a system: create js/systems/<id>/index.js exporting a definition,
// then add one `registerSystem(...)` line in js/systems/index.js and the id
// to KNOWN_SYSTEMS in server.py. See ARCHITECTURE.md.

const systems = new Map();
let active = null;

export function registerSystem(def) {
  if (!def?.id || !Array.isArray(def.nav)) throw new Error("registerSystem: a system needs an id and a nav");
  systems.set(def.id, def);
}

export function getSystem(id) {
  return systems.get(id) || null;
}

export function listSystems() {
  return [...systems.values()];
}

export function setActiveSystem(id) {
  active = systems.get(id) || systems.get("pokemon-dnd") || null;
  return active;
}

export function activeSystem() {
  return active;
}

// Flat id -> view map for the active system (the router's lookup table).
export function viewsOf(system) {
  const out = {};
  for (const group of system.nav) for (const v of group.views) out[v.id] = v;
  return out;
}
