// Damaging moves that the spreadsheet has no dice for (fixed-damage moves,
// OHKO moves, variable-power moves, Z-moves...). Their rules live in
// data/special_moves.json so they can be tuned without touching code.
//
//  - kind "tier":  borrows that tier's dice and then uses the normal formula.
//  - direct kinds: fixed / level / levelRange / fractionCurrentHp / ohko /
//                  endeavor / finalGambit set the damage themselves, ignoring
//                  stats, STAB and items (as in the games) but still respecting
//                  type immunity.
//  - kind "dm":    can't be automated (needs damage the user took) -> 0 damage
//                  and a note telling the DM to rule on it.

export const TIER_DICE = {
  Basic: [1, 6], Light: [2, 6], Moderate: [3, 6],
  Strong: [4, 8], Heavy: [5, 10], "Signature/Ultimate": [6, 12],
};

// Mutates the loaded moves: gives "tier" moves their dice and tags every
// special move with `special` (the rule) so engines and UIs can see it.
export function applySpecialMoveRules(moves, rules) {
  const table = rules?.moves || {};
  for (const m of moves) {
    const rule = table[m.name];
    if (!rule || m.diceCount) continue;
    m.special = rule;
    if (rule.kind === "tier" && TIER_DICE[rule.tier]) {
      [m.diceCount, m.dieSize] = TIER_DICE[rule.tier];
      m.tier = rule.tier;
    }
  }
  return moves;
}

export function isDirectSpecial(move) {
  const k = move?.special?.kind;
  return !!k && k !== "tier";
}

// Returns { damage, note, selfFaints? } for a direct special move that
// already passed the type-immunity check.
export function specialDamage(move, { attackerLevel, defenderLevel, attackerCurrentHp, attackerMaxHp, defenderCurrentHp, defenderMaxHp }) {
  const rule = move.special;
  const defHp = defenderCurrentHp ?? defenderMaxHp;
  const atkHp = attackerCurrentHp ?? attackerMaxHp;
  switch (rule.kind) {
    case "fixed": return { damage: rule.amount, note: `${move.name} always deals ${rule.amount}.` };
    case "level": {
      const d = Math.max(1, Math.floor(attackerLevel * (rule.mult ?? 1)));
      return { damage: d, note: `${move.name} deals damage equal to the user's level.` };
    }
    case "levelRange": {
      const lo = Math.max(1, Math.floor(attackerLevel * rule.min)), hi = Math.max(lo, Math.floor(attackerLevel * rule.max));
      return { damage: lo + Math.floor(Math.random() * (hi - lo + 1)), note: `${move.name} deals ${lo}–${hi}.` };
    }
    case "fractionCurrentHp":
      return { damage: Math.max(1, Math.floor(defHp * rule.fraction)), note: `${move.name} takes ${Math.round(rule.fraction * 100)}% of the target's current HP.` };
    case "ohko":
      if (attackerLevel < (defenderLevel ?? 0)) return { damage: 0, note: `${move.name} fails — the target's level is higher.` };
      return { damage: defHp, note: `${move.name} is a one-hit KO.` };
    case "endeavor":
      return { damage: Math.max(0, defHp - atkHp), note: "Endeavor drops the target to the user's HP." };
    case "finalGambit":
      return { damage: atkHp, selfFaints: true, note: "Final Gambit deals the user's HP in damage, and the user faints." };
    case "dm":
    default:
      return { damage: 0, note: `${move.name}: ${rule.why || "the DM decides the damage."}` };
  }
}
