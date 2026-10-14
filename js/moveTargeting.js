// Curated targeting data for moves that hit more than one Pokémon —
// there's no "target" field in data/moves.json (it wasn't part of the
// original spreadsheet), so this mirrors the same "curated subset, everything
// else defaults to the safe/simple case" philosophy as js/itemEffects.js and
// js/abilityEffects.js: a well-known list of real spread moves, everything
// not listed here is treated as single-target.
//
// Two spread categories, matching the mainline games:
//   "allFoes"     — hits every enemy, never allies (Rock Slide, Heat Wave, ...)
//   "allAdjacent" — hits every enemy AND every ally except the user itself
//                   (Earthquake, Surf, Discharge, ...) — but whether that
//                   actually reaches an ally depends on how the table has
//                   everyone positioned, which this app doesn't model in
//                   detail, so it's gated behind the DM's "Spread moves also
//                   hit allies" toggle (Full Turn console) rather than
//                   always-on.

export const ALL_FOES_MOVES = new Set([
  "Rock Slide", "Heat Wave", "Dazzling Gleam", "Icy Wind", "Muddy Water",
  "Sludge Wave", "Snarl", "Razor Leaf", "Bulldoze", "Struggle Bug",
  "Eruption", "Water Spout", "Blizzard", "Hyper Voice", "Boomburst",
  "Origin Pulse", "Precipice Blades", "Searing Shot", "Sparkling Aria",
  "Parting Shot", "Breaking Swipe", "Body Press",
]);

export const ALL_ADJACENT_MOVES = new Set([
  "Earthquake", "Magnitude", "Surf", "Discharge", "Explosion", "Self-Destruct",
  "Petal Blizzard", "Fissure",
]);

// "single" | "allFoes" | "allAdjacent"
export function targetKindForMove(moveName) {
  if (ALL_ADJACENT_MOVES.has(moveName)) return "allAdjacent";
  if (ALL_FOES_MOVES.has(moveName)) return "allFoes";
  return "single";
}


// combatants: full Full Turn roster; attacker: the combatant using the move.
// A combatant without a "side" assigned defaults to "A" (matches the app's
// behavior before "side" existed — legacy encounters, and NPCs/wild mons
// the DM hasn't explicitly flipped to Side B).
export function sideOf(c) { return c.side || "A"; }

export function enemiesOf(attacker, combatants) {
  return combatants.filter((c) => c !== attacker && sideOf(c) !== sideOf(attacker));
}
export function alliesOf(attacker, combatants) {
  return combatants.filter((c) => c !== attacker && sideOf(c) === sideOf(attacker));
}

// Every combatant sharing the given side, self included — used to lay out
// the Battle screen's two rows (your side along the bottom, the other side
// along the top).
export function combatantsBySide(side, combatants) {
  return combatants.filter((c) => sideOf(c) === side);
}

// True once every combatant on a side has fainted — a side with no
// combatants at all doesn't count as "defeated" (nothing to defeat yet).
// isFainted is injected by the caller since HP-at-level computation differs
// slightly between the DM's Full Turn console and the player Battle screen.
export function sideIsDefeated(side, combatants, isFainted) {
  const members = combatantsBySide(side, combatants);
  return members.length > 0 && members.every(isFainted);
}

// Resolves the actual target list for a move given the current roster and
// the DM's spreadHitsAllies toggle. Returns [] for "single" — the caller is
// expected to already have a manually-picked target for that case.
export function resolveSpreadTargets(moveName, attacker, combatants, spreadHitsAllies) {
  const kind = targetKindForMove(moveName);
  if (kind === "single") return [];
  const foes = enemiesOf(attacker, combatants);
  if (kind === "allFoes") return foes;
  return spreadHitsAllies ? [...foes, ...alliesOf(attacker, combatants)] : foes;
}
