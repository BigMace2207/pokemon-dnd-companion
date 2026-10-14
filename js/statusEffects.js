// Status conditions — Poison/Paralyze Heal/Antidote are called out as Bag
// items in the rulebook, but nothing in the app tracked the conditions
// themselves until now. Same philosophy as items/abilities: the one status
// with a clean, deterministic effect on the damage NUMBER (Burn halving
// Physical damage) is auto-applied; the rest change action economy (skip a
// turn, hit yourself, act at reduced Speed) rather than a single hit's
// damage, so they're modeled as roll-it-yourself helpers instead of being
// silently folded into the damage math.

export const STATUS_OPTIONS = ["None", "Burn", "Poison", "Paralysis", "Sleep", "Freeze", "Confusion"];

export const STATUS_INFO = {
  "Burn": {
    summary: "Physical damage dealt is halved. Also takes 1/16 max HP damage at the end of each turn.",
    autoApplied: true,
  },
  "Poison": {
    summary: "Takes 1/8 max HP damage at the end of each turn. Cured by an Antidote.",
    autoApplied: false,
  },
  "Paralysis": {
    summary: "Speed is halved (goes last more often, loses priority ties). Has a 25% chance to be fully paralyzed and lose the turn entirely. Cured by a Paralyze Heal.",
    autoApplied: false,
    turnCheck: { chance: 0.25, roll: () => 1 + Math.floor(Math.random() * 4), failsOn: 1, label: "Fully paralyzed check (d4, 1 = loses the turn)" },
  },
  "Sleep": {
    summary: "Can't act. Typically wakes on its own after a few turns (GM's call, e.g. roll to wake each turn).",
    autoApplied: false,
    turnCheck: { chance: 1 / 3, roll: () => 1 + Math.floor(Math.random() * 3), failsOn: 1, label: "Wake-up check (d3, 1 = wakes up)" },
  },
  "Freeze": {
    summary: "Can't act until thawed. Typically a chance to thaw each turn (GM's call), or thaws instantly if hit by a Fire-type move.",
    autoApplied: false,
    turnCheck: { chance: 0.2, roll: () => 1 + Math.floor(Math.random() * 5), failsOn: 1, label: "Thaw check (d5, 1 = thaws)" },
  },
  "Confusion": {
    summary: "Before acting, has a chance to hit itself instead: typeless damage using its own Attack and Defense, no STAB/type effectiveness.",
    autoApplied: false,
    turnCheck: { chance: 1 / 3, roll: () => 1 + Math.floor(Math.random() * 6), failsOn: (r) => r <= 2, label: "Self-hit check (d6, 1-2 = hits itself instead)" },
  },
};

// The one status effect that changes the damage NUMBER deterministically.
export function statusDamageModifier(status, moveCategory) {
  if (status === "Burn" && moveCategory === "Physical") {
    return { label: "Burn (Physical ×0.5)", mult: 0.5 };
  }
  return null;
}

export function rollTurnCheck(status) {
  const info = STATUS_INFO[status];
  if (!info || !info.turnCheck) return null;
  const { roll, failsOn, label } = info.turnCheck;
  const result = roll();
  const blocked = typeof failsOn === "function" ? failsOn(result) : result === failsOn;
  return { label, result, blocked };
}
