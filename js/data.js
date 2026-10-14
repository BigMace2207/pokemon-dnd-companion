// Loads the exported JSON and builds fast lookup indices used by every view.

import { applySpecialMoveRules } from "./specialMoves.js";

export const TYPE_COLORS = {
  Normal: "#9199a1", Fire: "#ff9c54", Water: "#4d90d5", Electric: "#f4d23c",
  Grass: "#63bc5a", Ice: "#74cec0", Fighting: "#ce4069", Poison: "#ab6ac8",
  Ground: "#d97845", Flying: "#8fa8dd", Psychic: "#f97176", Bug: "#90c12c",
  Rock: "#c7b78b", Ghost: "#5269ad", Dragon: "#0a6dc4", Dark: "#5a5366",
  Steel: "#5a8ea1", Fairy: "#ec8fe6",
};

export const METHOD_LABELS = { L: "Level-Up", T: "TM", E: "Egg", U: "Tutor" };
export const GAME_LABELS = {
  1: "Scarlet / Violet", 2: "Sword / Shield", 3: "Ultra Sun / Ultra Moon",
  4: "Brilliant Diamond / Shining Pearl", 5: "Let's Go Pikachu / Eevee",
  6: "Legends: Arceus", 7: "Omega Ruby / Alpha Sapphire",
};
export const DEFAULT_GAME = 1; // Scarlet/Violet has the most complete movesets

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export async function loadData() {
  const [pokemon, moves, typeChart, tierGuide, movesets, items, megaForms, evolutions, specialMoves] = await Promise.all([
    getJSON("data/pokemon.json"),
    getJSON("data/moves.json"),
    getJSON("data/type_chart.json"),
    getJSON("data/tier_guide.json"),
    getJSON("data/movesets.json"),
    getJSON("data/items.json").catch(() => []),
    getJSON("data/mega_forms.json").catch(() => []),
    getJSON("data/evolutions.json").catch(() => []),
    getJSON("data/special_moves.json").catch(() => ({ moves: {} })),
  ]);

  // Fixed-damage / variable-power / Z-moves have no dice in the spreadsheet;
  // give them dice or a direct-damage rule (see js/specialMoves.js).
  applySpecialMoveRules(moves, specialMoves);

  const itemByName = new Map(items.map((it) => [it.name, it]));
  // stone item name -> { speciesName, megaFormName }
  const megaFormByStone = new Map(megaForms.map((m) => [m.stoneName, m]));

  const pokemonByDex = new Map();
  const pokemonByName = new Map();
  pokemon.forEach((p) => {
    pokemonByDex.set(p.dex, p);
    pokemonByName.set(p.name, p);
  });

  const moveByName = new Map();
  moves.forEach((m, i) => moveByName.set(m.name, i));

  const movesetsByDex = new Map();
  const movesetsByMoveIdx = new Map();
  for (const row of movesets) {
    const [dex, moveIdx, method, level, game] = row;
    if (!movesetsByDex.has(dex)) movesetsByDex.set(dex, []);
    movesetsByDex.get(dex).push({ moveIdx, method, level, game });
    if (!movesetsByMoveIdx.has(moveIdx)) movesetsByMoveIdx.set(moveIdx, []);
    movesetsByMoveIdx.get(moveIdx).push({ dex, method, level, game });
  }

  // type chart: rows[attackType][i] where i indexes defTypes, both = effectiveness multiplier
  const defTypeIndex = new Map(typeChart.defTypes.map((t, i) => [t, i]));
  function typeEffectiveness(attackType, defType) {
    if (!defType) return 1;
    const row = typeChart.rows[attackType];
    if (!row) return 1;
    const i = defTypeIndex.get(defType);
    if (i === undefined) return 1;
    const v = row[i];
    return v === null || v === undefined ? 1 : v;
  }

  // evolutions.json is a flat list of {from, to, method} edges (by species
  // name) -- hand-authored (see that file's own scope note), not exported
  // from the spreadsheet, since it has no evolution columns. Indexed both
  // directions since a Pokédex entry needs to show what it evolves FROM
  // just as often as what it evolves INTO, and a branching case (Eevee,
  // Tyrogue, Wurmple, ...) needs "to" to return more than one entry.
  const evolvesFrom = new Map(); // name -> [{name, method}]  (this species evolves from...)
  const evolvesTo = new Map();   // name -> [{name, method}]  (this species evolves into...)
  for (const { from, to, method } of evolutions) {
    if (!evolvesTo.has(from)) evolvesTo.set(from, []);
    evolvesTo.get(from).push({ name: to, method });
    if (!evolvesFrom.has(to)) evolvesFrom.set(to, []);
    evolvesFrom.get(to).push({ name: from, method });
  }

  return {
    pokemon, pokemonByDex, pokemonByName,
    moves, moveByName,
    typeChart, defTypeIndex, typeEffectiveness,
    tierGuide,
    movesetsByDex, movesetsByMoveIdx,
    items, itemByName,
    megaForms, megaFormByStone,
    evolvesFrom, evolvesTo,
  };
}

// Returns the Mega Evolution species record (from state.pokemon) a mon is
// eligible to Mega Evolve into, or null — needs the right species AND the
// matching stone held, and that resulting "Mega X" to actually exist in
// the dex (it always will for the curated 47, this is just a safety check).
export function megaFormFor(state, speciesName, heldItemName) {
  if (!heldItemName) return null;
  const rule = state.megaFormByStone.get(heldItemName);
  if (!rule || rule.speciesName !== speciesName) return null;
  return state.pokemonByName.get(rule.megaFormName) || null;
}

export function battleMoves(state) {
  return state.moves.filter((m) => !m.stub);
}
