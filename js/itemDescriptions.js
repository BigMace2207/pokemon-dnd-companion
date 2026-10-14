// A short hover description for any Bag item, whatever kind it is --
// spreadsheet items have real effect text; the DM-tool "always available"
// items (Poké Balls, medicine, status cures) don't, since js/battleItems.js
// only tracks the numbers a formula needs, not flavor text, so those get a
// description built from those same numbers instead.

import { isTmEntry, tmMoveName } from "./bagItems.js";
import { HEAL_ITEMS, STATUS_HEAL_ITEMS } from "./battleItems.js";

const BALL_DESCRIPTIONS = {
  "Poké Ball": "A device for catching wild Pokémon. A standard ball with an average catch rate.",
  "Great Ball": "A good, high-performance Ball with a higher catch rate than a Poké Ball.",
  "Ultra Ball": "An ultra-performance Ball with a higher catch rate than a Great Ball.",
  "Master Ball": "The best Ball with the ultimate level of performance — catches any wild Pokémon without fail.",
};

function healDescription(item) {
  if (item.reviveOnly) {
    const pct = item.isFraction ? Math.round(item.amount * 100) : item.amount;
    return `Revives a fainted Pokémon with ${pct}% of its max HP back.`;
  }
  const amount = item.amount === Infinity ? "all" : item.amount;
  return `Restores ${amount === "all" ? "" : amount + " "}HP${amount === "all" ? " fully" : ""}.` + (item.cureStatus ? " Also cures any status condition." : "");
}

export function describeItem(name, state) {
  if (isTmEntry(name)) {
    const moveName = tmMoveName(name);
    const move = state.moves[state.moveByName.get(moveName)];
    return move ? `Teaches ${moveName}. ${move.effect || ""}`.trim() : `Teaches the move ${moveName}.`;
  }
  const spreadsheetItem = state.itemByName.get(name);
  if (spreadsheetItem) return spreadsheetItem.effect || "";
  if (BALL_DESCRIPTIONS[name]) return BALL_DESCRIPTIONS[name];
  const heal = HEAL_ITEMS.find((h) => h.name === name);
  if (heal) return healDescription(heal);
  const statusHeal = STATUS_HEAL_ITEMS.find((h) => h.name === name);
  if (statusHeal) return statusHeal.cures === "Any" ? "Cures any status condition." : `Cures ${statusHeal.cures}.`;
  return "A Key Item — no further details on hand.";
}
