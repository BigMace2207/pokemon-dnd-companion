// Tiny cross-view bridge for "clicked something here, jump to its page and
// have it already selected there" — a plain location.hash change (see
// app.js) can pick the right VIEW, but can't carry which item within that
// view to open, so this carries just that one extra bit of context.

let pendingMove = null;
let pendingPokemon = null;
let pendingStatCalc = null;

export function goToMove(name) {
  pendingMove = name;
  location.hash = "moves";
}

export function consumePendingMove() {
  const v = pendingMove;
  pendingMove = null;
  return v;
}

export function goToPokemon(name) {
  pendingPokemon = name;
  location.hash = "pokedex";
}

export function consumePendingPokemon() {
  const v = pendingPokemon;
  pendingPokemon = null;
  return v;
}

// Carries both species name and level — "View in Stat Calculator" from a
// saved Pokémon (My Team, NPC/Wild Library) should land on that Pokémon's
// own level, not the calculator's default of 5.
export function goToStatCalc(name, level) {
  pendingStatCalc = { name, level };
  location.hash = "statcalc";
}

export function consumePendingStatCalc() {
  const v = pendingStatCalc;
  pendingStatCalc = null;
  return v;
}
