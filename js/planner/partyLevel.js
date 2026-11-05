// How strong a Whiteboard encounter should be, from the players' own Pokémon. Each player's level is the average of
// their party; the party level is the average of those (so one big team doesn't drag it up on its own), and the
// encounter goes a little above it the more players there are, since more Pokémon are on their side. Trainers, gym
// leaders and wild encounters spawn at that level, and each card's Level box re-levels its team around a new one,
// e.g. a level 15 trainer gets 14 and 16, or 13, 15 and 16.
//
// The pure parts (encounterLevel, partyAverage, spreadLevels) live in pokeGenerators.js and are tested in
// tests/js/partyLevel.test.mjs.

import { getRoster } from "../network.js";
import { getDmToken } from "../systems/dnd5e/dmAccess.js";
import { loadSave } from "../storage.js";
import { learnedMoves, spreadLevels, encounterLevel, partyAverage } from "./pokeGenerators.js";

export { spreadLevels, encounterLevel, partyAverage };

/**
 * A team re-levelled around `level`. Generated Pokémon (auto) also get the moves they'd know at the new level; ones
 * the DM built by hand keep theirs. Species, ability, item and nickname stay.
 */
export function relevelTeam(state, mons, level, rng = Math.random) {
  const levels = spreadLevels(level, mons.length, rng);
  return mons.map((m, i) => {
    const out = { ...m, level: levels[i] };
    const p = m.auto ? state?.pokemonByName?.get(m.name) : null;
    if (p) { const moves = learnedMoves(state, p, levels[i], rng); if (moves.length) out.moves = moves; }
    return out;
  });
}

// ---- the players' levels, fetched (kept for a minute so spawning several things doesn't ask each time)
let cached = null, cachedAt = 0;
/** The encounter level for this campaign right now (see encounterLevel). The DM sees every player's party; anyone
 *  else only knows their own, so it falls back to that. */
export async function currentEncounterLevel() {
  if (cached && Date.now() - cachedAt < 60000) return cached;
  let per = [], fromRoster = false;
  try {
    const token = getDmToken() || "";
    const roster = token ? await getRoster(token) : null;
    if (Array.isArray(roster)) {
      fromRoster = true;
      const me = loadSave()?.networkId;
      // players only: not DMs (the server marks them) and not you (a DM's own test team)
      per = roster.filter((r) => !r.dm && r.id !== me && Array.isArray(r.party)).map((r) => partyAverage(r.party));
    }
  } catch { per = []; }
  if (!per.some((n) => n)) per = [partyAverage(loadSave()?.party)];
  const out = encounterLevel(per);
  if (fromRoster) { cached = out; cachedAt = Date.now(); }   // a failed lookup is tried again next time
  return out;
}
