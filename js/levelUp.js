// Checks a species' level-up learnset (data/movesets.json, same table the
// Pokédex's "Moves Known" tab already reads) for anything newly learnable
// between two levels, and walks the trainer through swapping it into one of
// the mon's 4 move slots — used by My Team's level field and the floating
// Quick Console's "Level Up" tab, so leveling up anywhere in the app offers
// the same move-swap prompt a real level-up would.

import { el } from "./components.js";
import { DEFAULT_GAME, battleMoves } from "./data.js";

// Moves learned strictly above fromLevel, up to and including toLevel,
// de-duplicated (a move can appear at the same level across regional
// variants) and sorted by level. Falls back to "any game" if the default
// game's learnset has nothing in range, same convention as moves.js/
// pokedex.js.
export function movesLearnedBetween(state, dex, fromLevel, toLevel) {
  if (toLevel <= fromLevel) return [];
  const raw = (state.movesetsByDex.get(dex) || []).filter((r) => r.method === "L" && r.level > fromLevel && r.level <= toLevel);
  const rows = raw.filter((r) => r.game === DEFAULT_GAME);
  const useRows = rows.length ? rows : raw;
  const seen = new Map();
  for (const r of useRows) {
    if (!seen.has(r.moveIdx) || seen.get(r.moveIdx).level > r.level) seen.set(r.moveIdx, r);
  }
  return [...seen.values()]
    .map((r) => ({ level: r.level, move: state.moves[r.moveIdx] }))
    .filter((r) => r.move && !r.move.stub)
    .sort((a, b) => a.level - b.level);
}

// Move names selectable for a mon's move slots — its level-up learnset up
// to its current level, plus TM/Egg/Tutor moves (those aren't level-gated,
// so they're always fair game once the species can learn them at all).
// Used by My Team and the NPC/Wild Library editors so the move picker
// doesn't offer, say, a level-40 move on a level-5 Pokémon. Falls back to
// the full curated move list for an unrecognized species or a species with
// no moveset data at all, rather than leaving the picker empty.
export function learnableMoveNames(state, mon) {
  const species = state.pokemonByName.get(mon.name);
  const fallback = () => battleMoves(state).map((m) => m.name);
  if (!species) return fallback();
  const level = Math.min(100, Math.max(1, Number(mon.level) || 1));
  const rows = state.movesetsByDex.get(species.dex) || [];
  const eligible = rows.filter((r) => r.method !== "L" || r.level <= level);
  const seen = new Set();
  const names = [];
  for (const r of eligible) {
    const move = state.moves[r.moveIdx];
    if (!move || move.stub || seen.has(move.name)) continue;
    seen.add(move.name);
    names.push(move.name);
  }
  return names.length ? names.sort() : fallback();
}

// Shows a small modal asking whether to swap the newly-learned move into
// one of the mon's 4 slots (or skip it). Resolves once the trainer picks.
function promptOneMove(monLabel, moveName, currentMoves) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const slotBtns = [0, 1, 2, 3].map((i) => {
      const label = currentMoves[i] ? currentMoves[i] : "(empty slot)";
      const btn = el("button", { class: "btn secondary modal-slot-btn" }, `${i + 1}. ${label}`);
      btn.addEventListener("click", () => { document.body.removeChild(overlay); resolve(i); });
      return btn;
    });
    const skipBtn = el("button", { class: "btn secondary" }, "Don't learn it");
    skipBtn.addEventListener("click", () => { document.body.removeChild(overlay); resolve(null); });
    overlay.appendChild(el("div", { class: "modal-box" }, [
      el("h4", {}, `${monLabel} can learn ${moveName}!`),
      currentMoves.every(Boolean)
        ? el("p", { class: "view-sub" }, "It already knows 4 moves — pick one to replace, or skip it.")
        : el("p", { class: "view-sub" }, "Pick a slot to learn it in, or skip it."),
      el("div", { class: "modal-slot-list" }, slotBtns),
      skipBtn,
    ]));
    document.body.appendChild(overlay);
  });
}

// Walks through every move learned between fromLevel and toLevel (in level
// order), prompting for each in turn, mutating mon.moves in place. Caller
// is responsible for persisting afterward. Safe to call with no moves
// learned (resolves immediately, no modal shown).
export async function handleLevelUp(state, mon, fromLevel, toLevel) {
  if (!mon.moves) mon.moves = ["", "", "", ""];
  const species = state.pokemonByName.get(mon.name);
  if (!species) return;
  const learned = movesLearnedBetween(state, species.dex, fromLevel, toLevel);
  const label = mon.nickname || mon.name;
  for (const { move } of learned) {
    if (mon.moves.includes(move.name)) continue; // already knows it (e.g. re-taught by TM)
    const slot = await promptOneMove(label, move.name, mon.moves);
    if (slot !== null) mon.moves[slot] = move.name;
  }
}
