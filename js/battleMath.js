// The actual "resolve one hit" engine shared by the Damage Calculator page
// AND the DM's live battle tools (Full Turn console, Control Centre's Force
// a Move) — extracted from the calculator so a real encounter gets the exact
// same item/ability/status modifier handling as the standalone calculator,
// instead of Full Turn's previous bare computeDamage() call (no modifiers
// at all). See js/itemEffects.js and js/abilityEffects.js for what's
// actually curated in here.

import { calcAllStats, computeDamage } from "./calc.js";
import { statusDamageModifier } from "./statusEffects.js";
import { isDirectSpecial, specialDamage } from "./specialMoves.js";
import {
  applyChoiceStatBoost, attackerDamageModifiers as itemAttackerDamageModifiers,
  expertBeltModifier, defenderDamageModifiers as itemDefenderDamageModifiers,
} from "./itemEffects.js";
import {
  applyAttackerStatAbility, applyDefenderStatAbility,
  attackerDamageModifiers as abilityAttackerDamageModifiers, tintedLensModifier, solidRockModifier, wonderGuardBlocks,
  defenderIsImmuneTo, defenderDamageModifiers as abilityDefenderDamageModifiers,
} from "./abilityEffects.js";

export function statsAtLevel(species, level) {
  const lvl = Math.min(100, Math.max(1, Number(level) || 1));
  return { ...species, ...calcAllStats(species, lvl, 15, 0, 1) };
}

// A quick "would this be super/not-very effective" preview for move-picking
// UI (Control Centre's Battle Control, the player Battle tab) — raw type
// chart only, no item/ability immunity overrides (those aren't knowable
// before the move actually resolves), same simplification the in-game
// target-selection hint uses. defenderSpeciesList lets a spread move be
// checked against every target at once; a mixed result (some resisted, some
// weak) is called out rather than picking one arbitrarily.
export function moveEffectivenessSummary(state, move, defenderSpeciesList) {
  if (!move?.type || move.category === "Status") return "";
  const effs = defenderSpeciesList
    .filter(Boolean)
    .map((sp) => state.typeEffectiveness(move.type, sp.type1) * (sp.type2 ? state.typeEffectiveness(move.type, sp.type2) : 1));
  if (!effs.length) return "";
  const uniq = [...new Set(effs)];
  if (uniq.length > 1) return "mixed effectiveness";
  const eff = uniq[0];
  if (eff === 1) return "";
  if (eff === 0) return "no effect";
  return eff > 1 ? `${eff}× super effective` : `${eff}× not very effective`;
}

// Everything needed to resolve one attacker-vs-defender hit, item/ability/
// status modifiers included. attackerCurrentHp is optional (only feeds the
// Overgrow/Blaze/Torrent/Swarm-style HP-gated abilities).
export function computeBattleDamage({
  state, move,
  attackerSpecies, attackerLevel, attackerAbility, attackerItem, attackerStatus, attackerCurrentHp = null,
  defenderSpecies, defenderLevel, defenderAbility, defenderItem, defenderStatus, defenderCurrentHp = null,
  diceRoll,
}) {
  const attackerAtLevel = statsAtLevel(attackerSpecies, attackerLevel);
  const defenderAtLevel = statsAtLevel(defenderSpecies, defenderLevel);

  const appliedMods = [];
  const postFormulaMods = [];
  let forcedImmune = false;
  let wonderGuardTriggered = false;
  let effectiveTypeEff = state.typeEffectiveness;

  if (move.category !== "Status") {
    const choiceMod = applyChoiceStatBoost(attackerAtLevel, attackerItem, move.category);
    if (choiceMod) appliedMods.push(choiceMod);
    const atkAbilityStatMod = applyAttackerStatAbility(attackerAtLevel, attackerAbility, move.category);
    if (atkAbilityStatMod) appliedMods.push(atkAbilityStatMod);
    const defAbilityStatMod = applyDefenderStatAbility(defenderAtLevel, defenderAbility, move.category);
    if (defAbilityStatMod) appliedMods.push(defAbilityStatMod);

    if (defenderIsImmuneTo(defenderAbility, move.type)) {
      forcedImmune = true;
      effectiveTypeEff = () => 0;
    }

    const preEff = effectiveTypeEff(move.type, defenderAtLevel.type1) *
      (defenderAtLevel.type2 ? effectiveTypeEff(move.type, defenderAtLevel.type2) : 1);
    const isSameType = move.type === attackerAtLevel.type1 || move.type === attackerAtLevel.type2;
    const attackerHpPercent = attackerCurrentHp === null ? null : (attackerCurrentHp / attackerAtLevel.hp) * 100;

    const mods = [
      ...itemAttackerDamageModifiers(attackerItem, move),
      ...abilityAttackerDamageModifiers(attackerAbility, move, { isSameType, attackerHpPercent }),
      ...itemDefenderDamageModifiers(defenderItem, move),
      ...abilityDefenderDamageModifiers(defenderAbility, move),
    ];
    const burnMod = statusDamageModifier(attackerStatus, move.category);
    if (burnMod) mods.push(burnMod);
    const beltMod = expertBeltModifier(attackerItem, preEff);
    if (beltMod) mods.push(beltMod);
    const tintedMod = tintedLensModifier(attackerAbility, preEff);
    if (tintedMod) mods.push(tintedMod);
    const rockMod = solidRockModifier(defenderAbility, preEff);
    if (rockMod) mods.push(rockMod);

    wonderGuardTriggered = !forcedImmune && wonderGuardBlocks(defenderAbility, preEff);

    postFormulaMods.push(...mods);
    appliedMods.push(...mods);
  }

  const result = computeDamage({
    attacker: attackerAtLevel, defender: defenderAtLevel, move,
    typeEffectiveness: effectiveTypeEff, diceRoll, damageModifiers: postFormulaMods,
  });

  // Fixed-damage / OHKO / HP-based moves (data/special_moves.json): the
  // damage comes from the move's own rule, not the stat formula -- but type
  // immunity (including immunity abilities) still blocks it.
  if (!result.status && isDirectSpecial(move)) {
    const sp = specialDamage(move, {
      attackerLevel, defenderLevel,
      attackerCurrentHp, attackerMaxHp: attackerAtLevel.hp,
      defenderCurrentHp, defenderMaxHp: defenderAtLevel.hp,
    });
    result.special = sp;
    result.damage = result.eff === 0 ? 0 : sp.damage;
  }
  if (wonderGuardTriggered && !result.status) result.damage = 0;

  return { result, appliedMods, forcedImmune, wonderGuardTriggered, attackerAtLevel, defenderAtLevel };
}
