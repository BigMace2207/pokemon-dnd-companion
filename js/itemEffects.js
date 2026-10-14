// Curated, deterministic subset of held-item effects the Damage Calculator
// can safely auto-apply to the damage number itself.
//
// Most of the 141 items in data/items.json do something in-game that ISN'T
// a simple, single-number damage modifier — crit chance, priority, weather,
// stat boosts that only trigger at low HP, status cures, held-in-reserve
// effects, etc. Guessing at those would be worse than leaving them alone,
// so only the handful below (well-documented, unconditional-or-simply-
// conditional damage math from the mainline games) are wired in. Everything
// else still shows up in the item picker and is displayed for reference —
// it's just not folded into the damage number.
//
// Multipliers used (standard modern-gen values):
//   Type-boosting items (classic single-type items, Incenses, Plates): x1.2
//   Choice Band / Choice Specs: x1.5 to the Attack/Sp. Atk STAT (applied
//     before the damage formula, same as a real stat boost — not a flat
//     x1.5 on the final number)
//   Life Orb: x1.3 to all damage
//   Expert Belt: x1.2, only when the hit is super effective
//   Muscle Band / Wise Glasses: x1.1 to Physical / Special damage
//   Type-resist Berries: x0.5 when hit by a move of the matching type
//     (simplified: real games gate this on the hit being super effective in
//     Gen 6+; here it applies whenever the type matches, which is easier to
//     reason about at the table and errs toward the berry actually helping)

export const TYPE_BOOST_ITEMS = {
  // Classic Gen 2+ single-type items
  "Black Belt": "Fighting", "Black Glasses": "Dark", "Charcoal": "Fire",
  "Dragon Fang": "Dragon", "Hard Stone": "Rock", "Magnet": "Electric",
  "Metal Coat": "Steel", "Miracle Seed": "Grass", "Mystic Water": "Water",
  "Never-Melt Ice": "Ice", "Poison Barb": "Poison", "Sharp Beak": "Flying",
  "Silk Scarf": "Normal", "Silver Powder": "Bug", "Soft Sand": "Ground",
  "Spell Tag": "Ghost", "Twisted Spoon": "Psychic",
  // Gen 4 Incenses
  "Odd Incense": "Psychic", "Rock Incense": "Rock", "Sea Incense": "Water",
  "Wave Incense": "Water", "Rose Incense": "Grass",
  // Arceus Plates
  "Draco Plate": "Dragon", "Dread Plate": "Dark", "Earth Plate": "Ground",
  "Fist Plate": "Fighting", "Flame Plate": "Fire", "Icicle Plate": "Ice",
  "Insect Plate": "Bug", "Iron Plate": "Steel", "Meadow Plate": "Grass",
  "Mind Plate": "Psychic", "Sky Plate": "Flying", "Splash Plate": "Water",
  "Spooky Plate": "Ghost", "Stone Plate": "Rock", "Toxic Plate": "Poison",
  "Zap Plate": "Electric",
};
const TYPE_ITEM_MULT = 1.2;

export const RESIST_BERRIES = {
  "Babiri Berry": "Steel", "Charti Berry": "Rock", "Chilan Berry": "Normal",
  "Chople Berry": "Fighting", "Coba Berry": "Flying", "Colbur Berry": "Dark",
  "Haban Berry": "Dragon", "Kasib Berry": "Ghost", "Kebia Berry": "Poison",
  "Occa Berry": "Fire", "Passho Berry": "Water", "Payapa Berry": "Psychic",
  "Rindo Berry": "Grass", "Shuca Berry": "Ground", "Tanga Berry": "Bug",
  "Wacan Berry": "Electric", "Yache Berry": "Ice",
};

export const AUTO_APPLIED_ITEMS = new Set([
  ...Object.keys(TYPE_BOOST_ITEMS),
  ...Object.keys(RESIST_BERRIES),
  "Choice Band", "Choice Specs", "Life Orb", "Expert Belt", "Muscle Band", "Wise Glasses",
]);

// Stat boost applied to the attacker's Attack/Sp.Atk *before* the damage
// formula runs (mutates the level-scaled stat object in place).
export function applyChoiceStatBoost(attackerStats, itemName, moveCategory) {
  if (itemName === "Choice Band" && moveCategory === "Physical") {
    attackerStats.atk = Math.floor(attackerStats.atk * 1.5);
    return { label: "Choice Band (Attack x1.5)", mult: 1.5 };
  }
  if (itemName === "Choice Specs" && moveCategory === "Special") {
    attackerStats.spa = Math.floor(attackerStats.spa * 1.5);
    return { label: "Choice Specs (Sp. Atk x1.5)", mult: 1.5 };
  }
  return null;
}

// Post-formula damage multipliers, gathered separately for attacker/defender
// items so the caller can show which side each came from.
export function attackerDamageModifiers(itemName, move) {
  const mods = [];
  if (!itemName) return mods;
  if (itemName === "Life Orb") mods.push({ label: "Life Orb (all damage)", mult: 1.3 });
  if (itemName === "Muscle Band" && move.category === "Physical") mods.push({ label: "Muscle Band (Physical)", mult: 1.1 });
  if (itemName === "Wise Glasses" && move.category === "Special") mods.push({ label: "Wise Glasses (Special)", mult: 1.1 });
  const boostType = TYPE_BOOST_ITEMS[itemName];
  if (boostType && boostType === move.type) mods.push({ label: `${itemName} (${boostType}-type moves)`, mult: TYPE_ITEM_MULT });
  return mods;
}

export function expertBeltModifier(itemName, typeEff) {
  if (itemName === "Expert Belt" && typeEff > 1) return { label: "Expert Belt (super effective)", mult: 1.2 };
  return null;
}

export function defenderDamageModifiers(itemName, move) {
  const mods = [];
  if (!itemName) return mods;
  const resistType = RESIST_BERRIES[itemName];
  if (resistType && resistType === move.type) mods.push({ label: `${itemName} (resists ${resistType})`, mult: 0.5 });
  return mods;
}
