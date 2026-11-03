// What kind of thing a whiteboard node is, for its look (css/whiteboard.css [data-kind]) and for suggesting how two nodes
// relate (board.js suggestRelation). Generated nodes use the generator's id as their kind; a Pokémon "wild encounter"
// is "wildmon" so it doesn't clash with D&D's "wild magic".

export const KINDS = {
  note: { label: "Note", icon: "note" },
  list: { label: "Checklist", icon: "list" },
  text: { label: "Sticky", icon: "sticky" },
  dungeon: { label: "Dungeon", icon: "dungeon" },
  npc: { label: "NPC", icon: "person" },
  name: { label: "Names", icon: "tag" },
  hook: { label: "Hook", icon: "quill" },
  rumour: { label: "Rumour", icon: "quill" },
  tavern: { label: "Tavern", icon: "tavern" },
  shop: { label: "Shop", icon: "shop" },
  room: { label: "Room", icon: "room" },
  loot: { label: "Loot", icon: "chest" },
  weather: { label: "Weather", icon: "cloud" },
  wild: { label: "Wild magic", icon: "spark" },
  encounter: { label: "Encounter", icon: "swords" },
  wildmon: { label: "Wild Pokémon", icon: "paw" },
  trainer: { label: "Trainer", icon: "person" },
  gym: { label: "Gym", icon: "badge" },
  route: { label: "Route", icon: "route" },
  libmon: { label: "Pokémon", icon: "paw" },
  libtrainer: { label: "Trainer", icon: "person" },
};

export const kindOf = (n) => (n.type === "gen" ? (n.kind || n.gen || "note") : n.type);
