// A loot-tier rarity for Bag items, colour-coding each icon. There's no
// price field anywhere in this app's data (data/items.json never had one —
// it's effect text only), so this uses real, well-known Pokémon Mart prices
// for Balls/Medicine (curated below), each TM's rarity from the move's own
// tier (data/moves.json already has one — Basic/Light/.../Signature), and a
// small curated heuristic for held items (mega stones and the "auto-applied"
// competitive staples from js/itemEffects.js read as rarer than a plain
// berry). Key items aren't normally sellable in the games at all, so they
// get their own neutral tier rather than a price-based one.

import { AUTO_APPLIED_ITEMS } from "./itemEffects.js";

const BALL_PRICES = { "Poké Ball": 200, "Great Ball": 600, "Ultra Ball": 1200, "Master Ball": null };
const MEDICINE_PRICES = {
  "Potion": 300, "Super Potion": 700, "Hyper Potion": 1200, "Max Potion": 2500,
  "Full Restore": 3000, "Revive": 1500, "Max Revive": 4000,
  "Antidote": 100, "Burn Heal": 250, "Ice Heal": 250, "Awakening": 250, "Paralyze Heal": 200, "Full Heal": 400,
};

const TIER_RARITY = {
  "Status": "common", "Basic": "common", "Light": "uncommon", "Moderate": "uncommon",
  "Strong": "rare", "Heavy": "epic", "Signature/Ultimate": "legendary",
};

export const RARITY_COLORS = {
  common: "#9199a1", uncommon: "#2f9e44", rare: "#2f6fed", epic: "#ab6ac8", legendary: "#e8b800", keyitem: "#5a5366",
};
export const RARITY_LABELS = {
  common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", keyitem: "Key Item",
};

function fromPrice(price) {
  if (price === null || price === undefined) return "legendary"; // not normally sold — Master Ball, etc.
  if (price <= 300) return "common";
  if (price <= 1000) return "uncommon";
  if (price <= 3000) return "rare";
  if (price <= 10000) return "epic";
  return "legendary";
}

// section: "ball" | "medicine" | "tm" | "held" | "key" (see js/bagItems.js).
// name: the item name for ball/medicine/held/key, or the bare move name
// (without the "TM: " prefix) for a TM entry.
export function rarityOf({ section, name, state }) {
  if (section === "ball") return fromPrice(name in BALL_PRICES ? BALL_PRICES[name] : 600);
  if (section === "medicine") return fromPrice(name in MEDICINE_PRICES ? MEDICINE_PRICES[name] : 300);
  if (section === "key") return "keyitem";
  if (section === "tm") {
    const move = state.moves[state.moveByName.get(name)];
    return TIER_RARITY[move?.tier] || "common";
  }
  // held item
  if (state.megaFormByStone?.has(name)) return "legendary";
  if (AUTO_APPLIED_ITEMS.has(name)) return "rare";
  if (/ Berry$/.test(name)) return "common";
  return "uncommon";
}

export function rarityColor(rarity) { return RARITY_COLORS[rarity] || RARITY_COLORS.common; }
export function rarityLabel(rarity) { return RARITY_LABELS[rarity] || "Common"; }
