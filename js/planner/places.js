// Places: a Whiteboard card for somewhere in the world (a town, a tavern, a dungeon) with a name, a type, a line it is
// known for, a description players can read and DM notes only the DM can. The Map editor's Places drawer drags one onto
// a map as a label that stays linked to the card: edit the card and the label follows (placeSync.js).
//
// A place card is { type: "place", title, placeKind, known, body, dmNotes, mapLink }. Only name, type, known-for and
// description ever reach a map label, and from there the hub; the DM's notes never leave the card.
// This file is plain functions so it can be tested in Node (tests/js/places.test.mjs).

// [key, label, the label's icon on a map, its colour]
export const PLACE_TYPES = [
  ["town", "Town", "🏘️", "#d9a032"],
  ["city", "City", "🏙️", "#c8402f"],
  ["village", "Village", "🛖", "#7a9a3a"],
  ["castle", "Castle", "🏰", "#8b5cc4"],
  ["tavern", "Tavern", "🍺", "#e07a22"],
  ["inn", "Inn", "🛏️", "#c27b4a"],
  ["shop", "Shop", "🛒", "#3d86d6"],
  ["temple", "Temple", "⛪", "#b6a05a"],
  ["dungeon", "Dungeon", "🗝️", "#6b5b73"],
  ["cave", "Cave", "🕳️", "#8a6b4a"],
  ["ruins", "Ruins", "🏚️", "#7d7468"],
  ["forest", "Forest", "🌲", "#4f8f4a"],
  ["mountain", "Mountain", "⛰️", "#7a8a99"],
  ["road", "Road", "🛤️", "#9a5b32"],
  ["landmark", "Landmark", "🗿", "#1d9a99"],
  ["camp", "Camp", "⛺", "#d1503a"],
  ["other", "Other", "📍", "#c8402f"],
];
/** What a Pokemon campaign adds (the D&D side never shows these). */
export const POKEMON_PLACE_TYPES = [
  ["pokecenter", "Pokémon Center", "🏥", "#e24a6a"],
  ["gym", "Gym", "🏟️", "#3a6fd8"],
  ["mart", "Poké Mart", "🏪", "#2f7fd0"],
  ["route", "Route", "🌿", "#5aa84a"],
  ["lab", "Lab", "🔬", "#7a62d0"],
];
/** The types a campaign can pick from: the shared ones, then (for Pokemon) its own before "Other". */
export const placeTypesFor = (system) => (system === "dnd5e" ? PLACE_TYPES : [...PLACE_TYPES.slice(0, -1), ...POKEMON_PLACE_TYPES, PLACE_TYPES[PLACE_TYPES.length - 1]]);
export const placeType = (key) => PLACE_TYPES.concat(POKEMON_PLACE_TYPES).find(([k]) => k === key) || PLACE_TYPES[PLACE_TYPES.length - 1];

/** What a place tells its map label: everything a player may read, and nothing of the DM's notes. */
export function pinFields(node) {
  const [, label, icon, color] = placeType(node.placeKind);
  return {
    label: String(node.title || "").trim().slice(0, 80) || "Unnamed place",
    note: String(node.body || "").slice(0, 2000),
    kind: node.placeKind ? label : "",
    known: String(node.known || "").trim().slice(0, 160),
    icon, color,
  };
}

/** Does this label need updating to match its place? */
export const pinDiffers = (pin, fields) => Object.keys(fields).some((k) => (pin[k] ?? "") !== fields[k]);

/** Every place card across the plan's whiteboards: [{ node, board }]. */
export const placeNodes = (plan) => (plan?.boards || []).flatMap((board) => (board.nodes || []).filter((n) => n.type === "place").map((node) => ({ node, board })));

/** Where a place is on the maps: { map, pin } for the map it is on (the first one if several), or null. */
export function placeOnMaps(plan, nodeId, preferMapId = null) {
  const hits = (plan?.maps || []).flatMap((map) => (map.pins || []).filter((p) => p.placeId === nodeId).map((pin) => ({ map, pin })));
  return hits.find((h) => h.map.id === preferMapId) || hits[0] || null;
}

/** The place card for a label, or null (a plain label, or its card was removed). */
export const nodeForPin = (plan, pin) => placeNodes(plan).find(({ node }) => node.id === pin?.placeId)?.node || null;
