// The actual "roll it and find out" step for a move, shared by whoever is
// resolving a turn client-side (a trainer playing their own move on the
// Battle screen, or the DM stepping an NPC/wild Pokémon through the Full
// Turn console) — one accuracy roll and (if it hits) one shared damage
// dice pool for the whole move, then js/battleMath.js's curated item/
// ability/status modifiers per target.

import { d20Roll, checkHit, rollMoveDice } from "./calc.js";
import { computeBattleDamage } from "./battleMath.js";

export function rollMove(move) {
  const d20 = d20Roll();
  const { hit } = checkHit(move.accuracy, d20);
  if (!hit || move.category === "Status") return { d20, hit, diceRoll: 0 };
  const dice = rollMoveDice(move);
  return { d20, hit, diceRoll: dice.total, diceRolls: dice.rolls };
}

export function damageAgainst({ state, move, attackerSpecies, attackerMon, defenderSpecies, defenderMon, diceRoll }) {
  const { result } = computeBattleDamage({
    state, move,
    attackerSpecies, attackerLevel: attackerMon.level, attackerAbility: attackerMon.ability,
    attackerItem: attackerMon.item, attackerStatus: attackerMon.status, attackerCurrentHp: attackerMon.currentHp,
    defenderSpecies, defenderLevel: defenderMon.level, defenderAbility: defenderMon.ability,
    defenderItem: defenderMon.item, defenderStatus: defenderMon.status,
    defenderCurrentHp: defenderMon.currentHp ?? null,
    diceRoll,
  });
  return result.damage;
}
