// Sorts a Bag entry's item name into one of the Bag page's sections. TMs
// aren't a real entity anywhere else in the app's data — data/moves.json
// has no notion of "TM items" — so a TM is represented as the literal
// string "TM: <move name>", built from whichever moves data/movesets.json
// actually lists under the "T" (TM) method for at least one Pokémon.

import { BALL_TYPES } from "./calc.js";
import { HEAL_ITEMS, STATUS_HEAL_ITEMS } from "./battleItems.js";

export const TM_PREFIX = "TM: ";

export function tmName(moveName) { return `${TM_PREFIX}${moveName}`; }
export function isTmEntry(name) { return name.startsWith(TM_PREFIX); }
export function tmMoveName(name) { return name.slice(TM_PREFIX.length); }

// Every move actually teachable by TM in this app's own movesets data,
// deduped and sorted — the source list for the Bag/Quick Console's TM
// picker, so it only ever offers real, teachable TMs.
export function tmMoveNames(state) {
  const names = new Set();
  for (const rows of state.movesetsByDex.values()) {
    for (const r of rows) {
      if (r.method !== "T") continue;
      const move = state.moves[r.moveIdx];
      if (move && !move.stub) names.add(move.name);
    }
  }
  return [...names].sort();
}

// "ball" | "medicine" | "tm" | "held" | "key"
export function categorizeItem(name, state) {
  if (BALL_TYPES.includes(name)) return "ball";
  if (HEAL_ITEMS.some((h) => h.name === name) || STATUS_HEAL_ITEMS.some((h) => h.name === name)) return "medicine";
  if (isTmEntry(name)) return "tm";
  if (state.itemByName.has(name)) return "held";
  return "key";
}

export const SECTION_LABELS = { ball: "Poké Balls", medicine: "Medicine", tm: "TMs", held: "Held Items", key: "Key Items" };
export const SECTION_ORDER = ["ball", "medicine", "tm", "held", "key"];
