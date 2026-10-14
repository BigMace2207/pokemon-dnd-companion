// Every function here is a direct port of the formula in the matching sheet
// of pokemon_full_dex.xlsx (see README.md for the cell references).

export function statAtLevel(base, level, iv, ev, natureMult, isHP) {
  const core = Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100);
  if (isHP) return core + level + 10;
  return Math.floor((core + 5) * natureMult);
}

export function calcAllStats(pokemon, level, iv, ev, natureMult) {
  return {
    hp: statAtLevel(pokemon.hp, level, iv, ev, natureMult, true),
    atk: statAtLevel(pokemon.atk, level, iv, ev, natureMult, false),
    def: statAtLevel(pokemon.def, level, iv, ev, natureMult, false),
    spa: statAtLevel(pokemon.spa, level, iv, ev, natureMult, false),
    spd: statAtLevel(pokemon.spd, level, iv, ev, natureMult, false),
    spe: statAtLevel(pokemon.spe, level, iv, ev, natureMult, false),
  };
}

export function rollDice(count, size) {
  let total = 0;
  const rolls = [];
  for (let i = 0; i < count; i++) {
    const r = 1 + Math.floor(Math.random() * size);
    rolls.push(r);
    total += r;
  }
  return { total, rolls };
}

// One damage roll for a move: its real dice pool, summed (4d8 is four d8s
// added together, a bell curve) -- the single place live battle, the DM's
// consoles and the Damage Calculator all roll from, so they always agree.
// Status moves and moves with no dice roll 0.
export function rollMoveDice(move) {
  if (!move || !move.diceCount) return { total: 0, rolls: [] };
  return rollDice(move.diceCount, move.dieSize || 6);
}

// damageModifiers: optional array of {label, mult} — extra multipliers (from
// the curated item/ability effect subsets in js/itemEffects.js and
// js/abilityEffects.js) folded into the same final rounding step as STAB/
// type effectiveness. attacker/defender stats should already have any
// pre-formula stat boosts (Choice items, Huge Power, Fur Coat, etc.) applied
// by the caller before this runs. Pass a wrapped `typeEffectiveness` (e.g.
// forced to 0) to model a full type-immunity ability like Levitate.
export function computeDamage({ attacker, defender, move, typeEffectiveness, diceRoll, damageModifiers = [] }) {
  if (move.category === "Status") {
    return { status: true, damage: "N/A - Status move" };
  }
  const offStat = move.category === "Physical" ? attacker.atk : attacker.spa;
  const defStat = move.category === "Physical" ? defender.def : defender.spd;
  const stab = (move.type === attacker.type1 || move.type === attacker.type2) ? 1.5 : 1;
  const eff = typeEffectiveness(move.type, defender.type1) *
    (defender.type2 ? typeEffectiveness(move.type, defender.type2) : 1);
  let damage;
  if (eff === 0) {
    damage = 0;
  } else {
    let raw = (diceRoll + offStat - defStat) * stab * eff;
    for (const m of damageModifiers) raw *= m.mult;
    damage = Math.max(1, Math.floor(raw));
  }
  return { status: false, offStat, defStat, stab, eff, damage };
}

export function d20Roll() {
  return 1 + Math.floor(Math.random() * 20);
}

// Roll-high-to-succeed convention: pct is still the true % chance of success
// (100% always succeeds, 0% never does), but a bigger roll is always better,
// matching normal d20 instinct. Mirror image of the spreadsheet's original
// "roll must be <= chance" rule, which rewarded a *low* roll instead.
export function successThreshold(pct) {
  return 100 - pct; // roll5 must exceed this to succeed
}

export function checkHit(accuracy, d20) {
  const roll5 = d20 * 5;
  const threshold = successThreshold(accuracy);
  const hit = roll5 > threshold;
  return { roll5, threshold, hit };
}

const BALL_MULT = { "Poké Ball": 1, "Great Ball": 1.5, "Ultra Ball": 2, "Master Ball": "Auto" };
const STATUS_BONUS = { "None": 0, "Paralyzed / Poisoned / Burned": 10, "Asleep / Frozen": 20 };

export function hpMultiplier(hpPercent) {
  if (hpPercent > 75) return 1;
  if (hpPercent > 50) return 1.25;
  if (hpPercent > 25) return 1.5;
  return 2;
}

export function catchChance({ catchRate, ball, hpPercent, status, mod }) {
  if (ball === "Master Ball") return 100;
  const ballMult = BALL_MULT[ball];
  const hpMult = hpMultiplier(hpPercent);
  const statusBonus = STATUS_BONUS[status] ?? 0;
  const pct = (catchRate / 255 * 100) * ballMult * hpMult + mod * 5 + statusBonus;
  return Math.min(100, pct);
}

export const BALL_TYPES = Object.keys(BALL_MULT);
export const STATUS_OPTIONS = Object.keys(STATUS_BONUS);

// A saved Pokémon's status uses the 6-condition battle vocabulary (Burn,
// Poison, Paralysis, Sleep, Freeze, Confusion — see statusEffects.js), but
// this sheet's own catch formula only ever had the 3 buckets above (matching
// the original spreadsheet). Used anywhere a saved mon's status needs to
// feed into catchChance() — the Catch Chance Calculator and the DM's Full
// Turn console's Poké Ball buttons.
export function toCatchStatusBucket(status) {
  if (status === "Burn" || status === "Poison" || status === "Paralysis") return "Paralyzed / Poisoned / Burned";
  if (status === "Sleep" || status === "Freeze") return "Asleep / Frozen";
  return "None";
}
export const NATURE_OPTIONS = [
  { label: "0.9 (hindered)", value: 0.9 },
  { label: "1.0 (neutral)", value: 1.0 },
  { label: "1.1 (boosted)", value: 1.1 },
];
