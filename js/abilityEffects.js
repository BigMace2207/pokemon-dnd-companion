// Curated, deterministic subset of ability effects the Damage Calculator can
// safely auto-apply — the ability equivalent of js/itemEffects.js, and the
// same philosophy: most of the ~300 abilities in the games depend on state
// this calculator doesn't track (weather, terrain, turn order, contact,
// crit chance, status conditions, whether it's the target's first turn out,
// etc.) or aren't a single damage number at all, so only well-known,
// unconditional-or-simply-conditional ones are wired in. Everything else
// still shows up in the picker with its real effect text, just not applied.
//
// The four "boosts own type at low HP" abilities (Overgrow/Blaze/Torrent/
// Swarm) need the attacker's current HP, which is why the Damage Calculator
// has an optional "Attacker Current HP" field — leave it blank and those
// simply won't trigger, same as a healthy Pokemon in the real games.

// --- Stat-boosting abilities (mutate the level-scaled stat object directly,
// same tier as a real stat multiplier / Choice item, applied before the
// damage formula rather than as a final multiplier) ---
const ATTACKER_STAT_ABILITIES = {
  "Huge Power": { stat: "atk", statLabel: "Attack", mult: 2, onlyCategory: "Physical" },
  "Pure Power": { stat: "atk", statLabel: "Attack", mult: 2, onlyCategory: "Physical" },
  "Hustle": { stat: "atk", statLabel: "Attack", mult: 1.5, onlyCategory: "Physical" },
  "Gorilla Tactics": { stat: "atk", statLabel: "Attack", mult: 1.5, onlyCategory: "Physical" },
};
const DEFENDER_STAT_ABILITIES = {
  "Fur Coat": { stat: "def", statLabel: "Defense", mult: 2, onlyCategory: "Physical" },
  "Ice Scales": { stat: "spd", statLabel: "Sp. Def", mult: 2, onlyCategory: "Special" },
};

function applyStatAbility(map, statsObj, abilityName, moveCategory) {
  const rule = map[abilityName];
  if (!rule) return null;
  if (rule.onlyCategory && rule.onlyCategory !== moveCategory) return null;
  statsObj[rule.stat] = Math.floor(statsObj[rule.stat] * rule.mult);
  return { label: `${abilityName} (${rule.statLabel} ×${rule.mult})`, mult: rule.mult };
}
export function applyAttackerStatAbility(attackerStats, abilityName, moveCategory) {
  return applyStatAbility(ATTACKER_STAT_ABILITIES, attackerStats, abilityName, moveCategory);
}
export function applyDefenderStatAbility(defenderStats, abilityName, moveCategory) {
  return applyStatAbility(DEFENDER_STAT_ABILITIES, defenderStats, abilityName, moveCategory);
}

// --- Attacker-side damage multipliers ---
const LOW_HP_TYPE_ABILITIES = { "Overgrow": "Grass", "Blaze": "Fire", "Torrent": "Water", "Swarm": "Bug" };

export function attackerDamageModifiers(abilityName, move, { isSameType, attackerHpPercent }) {
  const mods = [];
  if (!abilityName) return mods;
  if (abilityName === "Adaptability" && isSameType) {
    mods.push({ label: "Adaptability (STAB becomes 2×)", mult: 2 / 1.5 });
  }
  if (abilityName === "Technician" && move.power != null && move.power <= 60) {
    mods.push({ label: "Technician (power ≤60)", mult: 1.5 });
  }
  const lowHpType = LOW_HP_TYPE_ABILITIES[abilityName];
  if (lowHpType && lowHpType === move.type && attackerHpPercent != null && attackerHpPercent <= 100 / 3) {
    mods.push({ label: `${abilityName} (HP ≤ 1/3, ${lowHpType}-type)`, mult: 1.5 });
  }
  return mods;
}

// Needs the already-computed type effectiveness, so it's applied by the
// caller once `eff` is known (see damagecalc.js).
export function tintedLensModifier(abilityName, eff) {
  if (abilityName === "Tinted Lens" && eff > 0 && eff < 1) {
    return { label: "Tinted Lens (not very effective ×2)", mult: 2 };
  }
  return null;
}
export function solidRockModifier(abilityName, eff) {
  if ((abilityName === "Solid Rock" || abilityName === "Filter") && eff > 1) {
    return { label: `${abilityName} (super effective ×0.75)`, mult: 0.75 };
  }
  return null;
}
export function wonderGuardBlocks(abilityName, eff) {
  return abilityName === "Wonder Guard" && eff > 0 && eff <= 1;
}

// --- Defender-side: full immunity to one type (Levitate, the *-Absorb/
// -Drive/-Rod family, Flash Fire, Sap Sipper) ---
export const IMMUNITY_ABILITIES = {
  "Levitate": "Ground", "Water Absorb": "Water", "Volt Absorb": "Electric",
  "Motor Drive": "Electric", "Lightning Rod": "Electric", "Storm Drain": "Water",
  "Flash Fire": "Fire", "Sap Sipper": "Grass",
};
export function defenderIsImmuneTo(abilityName, moveType) {
  return IMMUNITY_ABILITIES[abilityName] === moveType;
}

// --- Defender-side damage multipliers ---
const RESIST_TYPE_ABILITIES = { "Thick Fat": ["Fire", "Ice"], "Heatproof": ["Fire"] };

export function defenderDamageModifiers(abilityName, move) {
  const mods = [];
  if (!abilityName) return mods;
  const resistTypes = RESIST_TYPE_ABILITIES[abilityName];
  if (resistTypes && resistTypes.includes(move.type)) {
    mods.push({ label: `${abilityName} (${move.type} ×0.5)`, mult: 0.5 });
  }
  if (abilityName === "Dry Skin" && move.type === "Fire") {
    mods.push({ label: "Dry Skin (Fire ×1.25)", mult: 1.25 });
  }
  return mods;
}

export const AUTO_APPLIED_ABILITIES = new Set([
  ...Object.keys(ATTACKER_STAT_ABILITIES), ...Object.keys(DEFENDER_STAT_ABILITIES),
  ...Object.keys(LOW_HP_TYPE_ABILITIES), ...Object.keys(IMMUNITY_ABILITIES),
  ...Object.keys(RESIST_TYPE_ABILITIES),
  "Adaptability", "Technician", "Tinted Lens", "Solid Rock", "Filter", "Wonder Guard", "Dry Skin",
]);
