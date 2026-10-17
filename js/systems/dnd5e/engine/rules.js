// Fixed 5e tables and small rule helpers shared by the sheet, the DM tools and
// the tests. Everything here is a plain mechanic (a number, a formula, a list
// of names); the descriptive rules text lives in data/dnd5e/<edition>/ (SRD).

export const ABILITIES = [
  { key: "STR", name: "Strength" },
  { key: "DEX", name: "Dexterity" },
  { key: "CON", name: "Constitution" },
  { key: "INT", name: "Intelligence" },
  { key: "WIS", name: "Wisdom" },
  { key: "CHA", name: "Charisma" },
];
export const ABILITY_KEYS = ABILITIES.map((a) => a.key);
export const ABILITY_NAME = Object.fromEntries(ABILITIES.map((a) => [a.key, a.name]));

export const SKILLS = [
  { name: "Acrobatics", ability: "DEX" }, { name: "Animal Handling", ability: "WIS" },
  { name: "Arcana", ability: "INT" }, { name: "Athletics", ability: "STR" },
  { name: "Deception", ability: "CHA" }, { name: "History", ability: "INT" },
  { name: "Insight", ability: "WIS" }, { name: "Intimidation", ability: "CHA" },
  { name: "Investigation", ability: "INT" }, { name: "Medicine", ability: "WIS" },
  { name: "Nature", ability: "INT" }, { name: "Perception", ability: "WIS" },
  { name: "Performance", ability: "CHA" }, { name: "Persuasion", ability: "CHA" },
  { name: "Religion", ability: "INT" }, { name: "Sleight of Hand", ability: "DEX" },
  { name: "Stealth", ability: "DEX" }, { name: "Survival", ability: "WIS" },
];
export const SKILL_ABILITY = Object.fromEntries(SKILLS.map((s) => [s.name, s.ability]));

export const ALIGNMENTS = [
  "Lawful Good", "Neutral Good", "Chaotic Good", "Lawful Neutral", "True Neutral",
  "Chaotic Neutral", "Lawful Evil", "Neutral Evil", "Chaotic Evil", "Unaligned",
];

export const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];

export const CONDITION_NAMES_2014 = [
  "Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible",
  "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious",
];
export const CONDITION_NAMES_2024 = [
  "Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible",
  "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious",
];

export const DAMAGE_TYPES = [
  "Acid", "Bludgeoning", "Cold", "Fire", "Force", "Lightning", "Necrotic", "Piercing",
  "Poison", "Psychic", "Radiant", "Slashing", "Thunder",
];

// ------------------------------------------------------------------ numbers

export const abilityMod = (score) => Math.floor((Number(score) - 10) / 2);
export const profBonus = (level) => 2 + Math.floor((Math.max(1, Math.min(20, Number(level) || 1)) - 1) / 4);

// Average hit points for a die when you take "average" instead of rolling.
export const averageHp = (hitDie) => Math.floor(hitDie / 2) + 1;

// Minimum total XP for each character level (index 0 = level 1).
export const XP_THRESHOLDS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];
export function levelForXp(xp) {
  let lvl = 1;
  for (let i = 0; i < XP_THRESHOLDS.length; i++) if (xp >= XP_THRESHOLDS[i]) lvl = i + 1;
  return lvl;
}
export function xpToNextLevel(xp, level) {
  return level >= 20 ? null : XP_THRESHOLDS[level] - xp;
}

// XP value of a monster by challenge rating.
export const CR_XP = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300,
  7: 2900, 8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
  16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000,
  24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000,
};
export const CR_LIST = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)];
export function crLabel(cr) {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}
export function parseCr(text) {
  const t = String(text).trim();
  if (t === "1/8") return 0.125;
  if (t === "1/4") return 0.25;
  if (t === "1/2") return 0.5;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// 2014 Dungeon Master's Guide encounter thresholds per character: [easy, medium, hard, deadly].
export const ENCOUNTER_THRESHOLDS_2014 = [
  [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500],
  [250, 500, 750, 1100], [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100],
  [550, 1100, 1600, 2400], [600, 1200, 1900, 2800], [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500],
  [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400], [1600, 3200, 4800, 7200],
  [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700],
];
// 2024 XP budget per character: [low, moderate, high].
export const XP_BUDGET_2024 = [
  [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100],
  [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100],
  [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800],
  [3800, 6100, 9800], [4300, 7200, 11700], [4900, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000],
];
// 2014 group multipliers by number of monsters (index into MULTIPLIER_STEPS).
export const MULTIPLIER_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
export function multiplierIndexFor(count) {
  if (count <= 0) return 1;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 6) return 3;
  if (count <= 10) return 4;
  if (count <= 14) return 5;
  return 6;
}

// ------------------------------------------------------------------ spell slots

// Slots for a single FULL caster (wizard table) by caster level 1-20: slots[spellLevel - 1].
export const FULL_CASTER_SLOTS = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0], [3, 0, 0, 0, 0, 0, 0, 0, 0], [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0], [4, 3, 2, 0, 0, 0, 0, 0, 0], [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0], [4, 3, 3, 2, 0, 0, 0, 0, 0], [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0], [4, 3, 3, 3, 2, 1, 0, 0, 0], [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0], [4, 3, 3, 3, 2, 1, 1, 0, 0], [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
// Warlock Pact Magic by warlock level: { count, level }.
export const PACT_MAGIC = [
  { count: 1, level: 1 }, { count: 2, level: 1 }, { count: 2, level: 2 }, { count: 2, level: 2 },
  { count: 2, level: 3 }, { count: 2, level: 3 }, { count: 2, level: 4 }, { count: 2, level: 4 },
  { count: 2, level: 5 }, { count: 2, level: 5 }, { count: 3, level: 5 }, { count: 3, level: 5 },
  { count: 3, level: 5 }, { count: 3, level: 5 }, { count: 3, level: 5 }, { count: 3, level: 5 },
  { count: 4, level: 5 }, { count: 4, level: 5 }, { count: 4, level: 5 }, { count: 4, level: 5 },
];

// How a class contributes to the multiclass spellcaster level.
export const CASTER_TYPES = {
  bard: "full", cleric: "full", druid: "full", sorcerer: "full", wizard: "full",
  paladin: "half", ranger: "half", warlock: "pact",
};
export function casterLevelContribution(type, level) {
  if (type === "full") return level;
  if (type === "half") return Math.floor(level / 2);
  if (type === "third") return Math.floor(level / 3);
  return 0;
}

export const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// ------------------------------------------------------------------ point buy, arrays

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;
export function pointBuySpent(scores) {
  return ABILITY_KEYS.reduce((s, k) => s + (POINT_BUY_COST[scores[k]] ?? 99), 0);
}

// ------------------------------------------------------------------ currency & weight

export const CURRENCY = [
  { key: "pp", name: "Platinum", cp: 1000 },
  { key: "gp", name: "Gold", cp: 100 },
  { key: "ep", name: "Electrum", cp: 50 },
  { key: "sp", name: "Silver", cp: 10 },
  { key: "cp", name: "Copper", cp: 1 },
];
export const CP_VALUE = Object.fromEntries(CURRENCY.map((c) => [c.key, c.cp]));
export function totalCopper(wallet) {
  return CURRENCY.reduce((s, c) => s + (Number(wallet?.[c.key]) || 0) * c.cp, 0);
}
export function walletFromCopper(cp, { useElectrum = false } = {}) {
  let rest = Math.max(0, Math.floor(cp));
  const out = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
  for (const c of CURRENCY) {
    if (c.key === "ep" && !useElectrum) continue;
    out[c.key] = Math.floor(rest / c.cp);
    rest -= out[c.key] * c.cp;
  }
  return out;
}
export function costToCopper(cost) {
  if (!cost || cost.q == null) return 0;
  return cost.q * (CP_VALUE[cost.u] || 0);
}
// Coins weigh 50 to the pound.
export const coinWeight = (wallet) => CURRENCY.reduce((s, c) => s + (Number(wallet?.[c.key]) || 0), 0) / 50;

export const carryCapacity = (str) => (Number(str) || 0) * 15;
export function encumbrance(weight, str) {
  const s = Number(str) || 0;
  if (weight > s * 10) return "heavy";
  if (weight > s * 5) return "encumbered";
  return "none";
}

// ------------------------------------------------------------------ exhaustion

export const EXHAUSTION_2014 = [
  "No effect",
  "Disadvantage on ability checks",
  "Speed halved",
  "Disadvantage on attack rolls and saving throws",
  "Hit point maximum halved",
  "Speed reduced to 0",
  "Death",
];
export const EXHAUSTION_2024 = [
  "No effect",
  "D20 Tests −2, speed −5 ft.",
  "D20 Tests −4, speed −10 ft.",
  "D20 Tests −6, speed −15 ft.",
  "D20 Tests −8, speed −20 ft.",
  "D20 Tests −10, speed −25 ft.",
  "Death",
];

// ------------------------------------------------------------------ misc reference tables

export const DC_TABLE = [
  ["Very easy", 5], ["Easy", 10], ["Medium", 15], ["Hard", 20], ["Very hard", 25], ["Nearly impossible", 30],
];
export const COVER = [
  ["Half cover", "+2 bonus to AC and Dexterity saving throws"],
  ["Three-quarters cover", "+5 bonus to AC and Dexterity saving throws"],
  ["Total cover", "Can't be targeted directly by an attack or spell"],
];
export const TRAVEL_PACE = [
  { name: "Fast", perHour: "4 miles", perDay: "30 miles", effect: "−5 penalty to passive Wisdom (Perception) scores" },
  { name: "Normal", perHour: "3 miles", perDay: "24 miles", effect: "—" },
  { name: "Slow", perHour: "2 miles", perDay: "18 miles", effect: "Able to use stealth" },
];
export const LIFESTYLE = [
  ["Wretched", "—"], ["Squalid", "1 sp/day"], ["Poor", "2 sp/day"], ["Modest", "1 gp/day"],
  ["Comfortable", "2 gp/day"], ["Wealthy", "4 gp/day"], ["Aristocratic", "10 gp/day minimum"],
];
export const SIZE_SPACE = [
  ["Tiny", "2½ × 2½ ft."], ["Small", "5 × 5 ft."], ["Medium", "5 × 5 ft."],
  ["Large", "10 × 10 ft."], ["Huge", "15 × 15 ft."], ["Gargantuan", "20 × 20 ft. or larger"],
];
export const ACTIONS_IN_COMBAT = [
  ["Attack", "Make one melee or ranged attack (more with Extra Attack)."],
  ["Cast a Spell", "Cast a spell with a casting time of 1 action."],
  ["Dash", "Gain extra movement equal to your speed for the turn."],
  ["Disengage", "Your movement doesn't provoke opportunity attacks for the rest of the turn."],
  ["Dodge", "Attacks against you have disadvantage and you have advantage on Dexterity saves until your next turn."],
  ["Help", "Give an ally advantage on their next ability check or attack roll against a creature near you."],
  ["Hide", "Make a Dexterity (Stealth) check to become hidden."],
  ["Ready", "Choose a trigger and an action to take in response, using your reaction."],
  ["Search", "Make a Wisdom (Perception) or Intelligence (Investigation) check to find something."],
  ["Use an Object", "Interact with a second object or use an object's special feature."],
];

// Starting gold if you take money instead of the class's equipment (dice, multiplier).
export const STARTING_GOLD = {
  barbarian: [2, 4, 10], bard: [5, 4, 10], cleric: [5, 4, 10], druid: [2, 4, 10], fighter: [5, 4, 10],
  monk: [5, 4, 1], paladin: [5, 4, 10], ranger: [5, 4, 10], rogue: [4, 4, 10], sorcerer: [3, 4, 10],
  warlock: [4, 4, 10], wizard: [4, 4, 10],
};

// The character level at which each class picks its subclass.
export const SUBCLASS_LEVEL = {
  "2014": { barbarian: 3, bard: 3, cleric: 1, druid: 2, fighter: 3, monk: 3, paladin: 3, ranger: 3, rogue: 3, sorcerer: 1, warlock: 1, wizard: 2 },
  "2024": { barbarian: 3, bard: 3, cleric: 3, druid: 3, fighter: 3, monk: 3, paladin: 3, ranger: 3, rogue: 3, sorcerer: 3, warlock: 3, wizard: 3 },
};
// Levels at which a class gets an Ability Score Improvement (fighter and rogue get extras).
export function asiLevels(classId) {
  const base = [4, 8, 12, 16, 19];
  if (classId === "fighter") return [4, 6, 8, 12, 14, 16, 19];
  if (classId === "rogue") return [4, 8, 10, 12, 16, 19];
  return base;
}
