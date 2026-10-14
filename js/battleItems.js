// Bag contents for the DM's Full Turn console: Poké Balls (trigger the
// same catch-chance math as the Catch Chance Calculator — see BALL_TYPES
// in calc.js, reused rather than duplicated here) and healing items
// (restore HP / revive). These are simple, well-known, fixed game values —
// there's no per-trainer inventory/count tracking in this app (that would
// be a whole separate feature), so every combatant always "has" the full
// bag available; treat it as a GM tool rather than a strict inventory sim.

// amount: flat HP restored, or a fraction (0 < amount <= 1) when isFraction
// is set (used for Revives, which heal relative to max HP). reviveOnly
// means it only works on a fainted (0 HP) Pokémon; otherwise it can't be
// used on one.
export const HEAL_ITEMS = [
  { name: "Potion", amount: 20, reviveOnly: false },
  { name: "Super Potion", amount: 50, reviveOnly: false },
  { name: "Hyper Potion", amount: 200, reviveOnly: false },
  { name: "Max Potion", amount: Infinity, reviveOnly: false },
  { name: "Full Restore", amount: Infinity, reviveOnly: false, cureStatus: true },
  { name: "Revive", amount: 0.5, isFraction: true, reviveOnly: true },
  { name: "Max Revive", amount: 1, isFraction: true, reviveOnly: true },
];

// Status-curing medicine — same "well-known, fixed game item" treatment as
// HEAL_ITEMS above, filling in the one thing this app tracked (the 6-
// condition battle statuses, see statusEffects.js) but had no bag item for
// until the Bag page. cures: "Any" clears whatever status is currently set.
export const STATUS_HEAL_ITEMS = [
  { name: "Antidote", cures: "Poison" },
  { name: "Burn Heal", cures: "Burn" },
  { name: "Ice Heal", cures: "Freeze" },
  { name: "Awakening", cures: "Sleep" },
  { name: "Paralyze Heal", cures: "Paralysis" },
  { name: "Full Heal", cures: "Any" },
];
