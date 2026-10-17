// Encounter maths and the combat tracker's data model (pure; no DOM).

import {
  ENCOUNTER_THRESHOLDS_2014, XP_BUDGET_2024, MULTIPLIER_STEPS, multiplierIndexFor, CR_XP, abilityMod,
} from "./rules.js";
import { rollDie, roll } from "./dice.js";

// ------------------------------------------------------------------ difficulty

// levels: array of character levels, e.g. [3,3,4,5]
export function partyBudget(levels, edition = "2014") {
  const sums = edition === "2024" ? [0, 0, 0] : [0, 0, 0, 0];
  for (const l of levels) {
    const row = (edition === "2024" ? XP_BUDGET_2024 : ENCOUNTER_THRESHOLDS_2014)[Math.max(1, Math.min(20, l)) - 1];
    row.forEach((v, i) => { sums[i] += v; });
  }
  return edition === "2024"
    ? { low: sums[0], moderate: sums[1], high: sums[2] }
    : { easy: sums[0], medium: sums[1], hard: sums[2], deadly: sums[3] };
}

// 2014: more monsters multiply the XP; small parties step the multiplier up, big ones down.
export function groupMultiplier(monsterCount, partySize) {
  let idx = multiplierIndexFor(monsterCount);
  if (monsterCount <= 0) return 1;
  if (partySize < 3) idx = Math.min(MULTIPLIER_STEPS.length - 1, idx + 1);
  else if (partySize >= 6) idx = Math.max(0, idx - 1);
  return MULTIPLIER_STEPS[idx];
}

// monsters: [{ xp, count }] (xp per creature). Returns raw/adjusted XP and the difficulty label.
export function evaluateEncounter(monsters, levels, edition = "2014") {
  const total = monsters.reduce((s, m) => s + (Number(m.count) || 0), 0);
  const baseXp = monsters.reduce((s, m) => s + (Number(m.xp) || 0) * (Number(m.count) || 0), 0);
  const budget = partyBudget(levels, edition);
  if (edition === "2024") {
    // 2024 has no multiplier: the XP total is compared straight to the budget.
    let label = "Trivial";
    if (baseXp >= budget.high) label = baseXp > budget.high * 1.25 ? "Beyond High" : "High";
    else if (baseXp >= budget.moderate) label = "Moderate";
    else if (baseXp >= budget.low) label = "Low";
    return { total, baseXp, multiplier: 1, adjustedXp: baseXp, budget, label, perPlayer: levels.length ? Math.floor(baseXp / levels.length) : 0 };
  }
  const multiplier = groupMultiplier(total, levels.length);
  const adjustedXp = Math.floor(baseXp * multiplier);
  let label = "Trivial";
  if (adjustedXp >= budget.deadly) label = "Deadly";
  else if (adjustedXp >= budget.hard) label = "Hard";
  else if (adjustedXp >= budget.medium) label = "Medium";
  else if (adjustedXp >= budget.easy) label = "Easy";
  return { total, baseXp, multiplier, adjustedXp, budget, label, perPlayer: levels.length ? Math.floor(baseXp / levels.length) : 0 };
}

export const xpForCr = (cr) => CR_XP[cr] ?? 0;

// ------------------------------------------------------------------ combat model

let seq = 0;
export const cid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function newCombat() {
  return { round: 1, turn: 0, started: false, combatants: [], log: [] };
}

export function monsterCombatant(m, { name, hpMode = "average", index = 0 } = {}) {
  let hp = m.hp || 1;
  if (hpMode === "roll" && m.hpRoll) hp = Math.max(1, roll(m.hpRoll.replace(/\s+/g, ""))?.total || hp);
  const dexMod = abilityMod(m.abilities?.DEX ?? 10);
  const legendary = (m.legendary || []).length ? 3 : 0;
  return {
    id: cid(), kind: "monster", name: name || m.name, monsterId: m.id,
    init: null, dexMod, hp, maxHp: hp, tempHp: 0,
    ac: m.ac?.[0]?.value ?? 10, speed: m.speed?.walk || "", cr: m.cr ?? null, xp: m.xp ?? CR_XP[m.cr] ?? 0,
    conditions: [], notes: "", hidden: false, dead: false, concentration: "",
    resistances: [...(m.resistances || [])], immunities: [...(m.immunities || [])], vulnerabilities: [...(m.vulnerabilities || [])],
    legendary: legendary ? { max: legendary, used: 0 } : null, index,
  };
}

export function pcCombatant(summary) {
  return {
    id: cid(), kind: "pc", name: summary.name || "Character", pcId: summary.id, owner: summary.owner || null,
    init: null, dexMod: 0, hp: summary.hp ?? 1, maxHp: summary.maxHp ?? 1, tempHp: summary.tempHp ?? 0,
    ac: summary.ac ?? 10, conditions: [...(summary.conditions || [])], notes: "", hidden: false, dead: false,
    concentration: summary.concentration || "", deathSaves: { s: 0, f: 0 }, initBonus: summary.initiative ?? 0,
    portrait: summary.portrait || "",
  };
}

export function customCombatant({ name, hp = 10, ac = 10, initBonus = 0, kind = "npc" }) {
  return {
    id: cid(), kind, name: name || "Creature", init: null, dexMod: initBonus, hp, maxHp: hp, tempHp: 0, ac,
    conditions: [], notes: "", hidden: false, dead: false, concentration: "", resistances: [], immunities: [], vulnerabilities: [],
  };
}

// Rolls initiative for one combatant (monsters use Dex mod; PCs their sheet bonus).
export function rollInitiative(c, mode = "normal") {
  const bonus = c.kind === "pc" ? (c.initBonus ?? 0) : (c.dexMod ?? 0);
  const a = rollDie(20), b = mode === "normal" ? null : rollDie(20);
  const n = mode === "adv" ? Math.max(a, b ?? a) : mode === "dis" ? Math.min(a, b ?? a) : a;
  c.init = n + bonus;
  c.initRoll = n;
  return c.init;
}

export function sortInitiative(list) {
  return [...list].sort((a, b) =>
    (b.init ?? -999) - (a.init ?? -999) ||
    (b.dexMod ?? 0) - (a.dexMod ?? 0) ||
    String(a.name).localeCompare(String(b.name)));
}

export function orderedCombatants(combat) {
  return sortInitiative(combat.combatants);
}

export function currentCombatant(combat) {
  const order = orderedCombatants(combat);
  return order.length ? order[Math.min(combat.turn, order.length - 1)] : null;
}

// Moves to the next living combatant; bumps the round when the order wraps.
export function nextTurn(combat) {
  const order = orderedCombatants(combat);
  if (!order.length) return combat;
  let guard = 0;
  do {
    combat.turn += 1;
    if (combat.turn >= order.length) { combat.turn = 0; combat.round += 1; }
    guard++;
  } while (order[combat.turn].dead && guard <= order.length);
  return combat;
}

export function prevTurn(combat) {
  const order = orderedCombatants(combat);
  if (!order.length) return combat;
  combat.turn -= 1;
  if (combat.turn < 0) { combat.turn = order.length - 1; combat.round = Math.max(1, combat.round - 1); }
  return combat;
}

// After adding/removing combatants keep the pointer on the same creature.
export function withStableTurn(combat, fn) {
  const cur = currentCombatant(combat);
  fn();
  if (cur) {
    const idx = orderedCombatants(combat).findIndex((c) => c.id === cur.id);
    combat.turn = idx >= 0 ? idx : Math.min(combat.turn, Math.max(0, combat.combatants.length - 1));
  }
}

// Damage with temp HP, resistance (half), vulnerability (double) and immunity (none).
export function damageCombatant(c, amount, { type = "", crit = false } = {}) {
  let dmg = Math.max(0, Math.floor(amount));
  const t = String(type).toLowerCase();
  const has = (list) => (list || []).some((x) => String(x).toLowerCase().includes(t) && t);
  let note = "";
  if (has(c.immunities)) { dmg = 0; note = "immune"; }
  else if (has(c.resistances)) { dmg = Math.floor(dmg / 2); note = "resisted"; }
  else if (has(c.vulnerabilities)) { dmg *= 2; note = "vulnerable"; }
  if (!dmg) return { dealt: 0, note, down: false };
  if (c.kind === "pc" && c.hp === 0) {
    c.deathSaves = c.deathSaves || { s: 0, f: 0 };
    c.deathSaves.f = Math.min(3, c.deathSaves.f + (crit ? 2 : 1));
    return { dealt: dmg, note, down: true, dead: c.deathSaves.f >= 3 };
  }
  const total = dmg;
  let absorbed = 0;
  if (c.tempHp > 0) { absorbed = Math.min(c.tempHp, dmg); c.tempHp -= absorbed; dmg -= absorbed; }
  c.hp = Math.max(0, c.hp - dmg);
  const down = c.hp === 0;
  if (down) {
    if (c.kind === "pc") { c.deathSaves = { s: 0, f: 0 }; if (!c.conditions.includes("Unconscious")) c.conditions.push("Unconscious"); }
    else c.dead = true;
  }
  return { dealt: total, absorbed, note, down };
}

export function healCombatant(c, amount) {
  const before = c.hp;
  c.hp = Math.min(c.maxHp, c.hp + Math.max(0, Math.floor(amount)));
  if (before === 0 && c.hp > 0) {
    c.dead = false;
    if (c.kind === "pc") { c.deathSaves = { s: 0, f: 0 }; c.conditions = c.conditions.filter((x) => x !== "Unconscious"); }
  }
  return c.hp - before;
}

// What players are told about a creature they don't own.
export function healthStatus(c) {
  if (c.dead || c.hp <= 0) return c.kind === "pc" ? "Down" : "Defeated";
  const r = c.hp / c.maxHp;
  if (r > 0.99) return "Unhurt";
  if (r > 0.5) return "Wounded";
  if (r > 0.25) return "Bloodied";
  return "Near death";
}

// A concentration save after damage: DC 10 or half the damage, whichever is higher.
export const concentrationDc = (damage) => Math.max(10, Math.floor(damage / 2));

// Random encounter suggestion: fills a budget with creatures within a CR range.
export function suggestEncounter(pool, targetXp, { maxCount = 8, minCr = 0, maxCr = 30, edition = "2014", partySize = 4, rng = Math.random } = {}) {
  const eligible = pool.filter((m) => m.cr >= minCr && m.cr <= maxCr && m.xp);
  if (!eligible.length) return [];
  const picks = [];
  let best = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const chosen = new Map();
    let count = 0;
    let adjusted = 0;
    let guard = 0;
    while (count < maxCount && guard++ < 40) {
      const m = eligible[Math.floor(rng() * eligible.length)];
      const next = [...chosen.entries()].map(([id, e]) => ({ xp: e.m.xp, count: e.n }));
      const trial = next.concat([{ xp: m.xp, count: 1 }]);
      const ev = evaluateXp(trial, partySize, edition);
      if (ev > targetXp * 1.1) { if (count >= 1) break; else continue; }
      chosen.set(m.id, { m, n: (chosen.get(m.id)?.n || 0) + 1 });
      count++; adjusted = ev;
      if (adjusted >= targetXp * 0.9) break;
    }
    const diff = Math.abs(targetXp - adjusted);
    if (count && (!best || diff < best.diff)) best = { diff, chosen: [...chosen.values()] };
  }
  return best ? best.chosen.map((e) => ({ monster: e.m, count: e.n })) : picks;
}

function evaluateXp(monsters, partySize, edition) {
  const total = monsters.reduce((s, m) => s + m.count, 0);
  const base = monsters.reduce((s, m) => s + m.xp * m.count, 0);
  return edition === "2024" ? base : Math.floor(base * groupMultiplier(total, partySize));
}
