import test from "node:test";
import assert from "node:assert/strict";
import { monsters } from "./_data.mjs";
import { setRng } from "../../js/systems/dnd5e/engine/dice.js";
import {
  partyBudget, groupMultiplier, evaluateEncounter, newCombat, monsterCombatant, pcCombatant, customCombatant,
  sortInitiative, nextTurn, prevTurn, currentCombatant, damageCombatant, healCombatant, healthStatus,
  concentrationDc, rollInitiative, suggestEncounter, orderedCombatants, withStableTurn,
} from "../../js/systems/dnd5e/engine/encounter.js";
import { CR_XP, levelForXp, xpToNextLevel, totalCopper, walletFromCopper, costToCopper, pointBuySpent, crLabel, parseCr } from "../../js/systems/dnd5e/engine/rules.js";

test.afterEach(() => setRng(null));

test("party thresholds sum per character", () => {
  assert.deepEqual(partyBudget([1, 1, 1, 1]), { easy: 100, medium: 200, hard: 300, deadly: 400 });
  assert.deepEqual(partyBudget([5, 5, 5, 5]), { easy: 1000, medium: 2000, hard: 3000, deadly: 4400 });
  assert.deepEqual(partyBudget([1, 2], "2024"), { low: 150, moderate: 225, high: 300 });
});

test("group multipliers and party size adjustment", () => {
  assert.equal(groupMultiplier(1, 4), 1);
  assert.equal(groupMultiplier(2, 4), 1.5);
  assert.equal(groupMultiplier(4, 4), 2);
  assert.equal(groupMultiplier(8, 4), 2.5);
  assert.equal(groupMultiplier(12, 4), 3);
  assert.equal(groupMultiplier(15, 4), 4);
  assert.equal(groupMultiplier(2, 2), 2);      // small party: one step up
  assert.equal(groupMultiplier(2, 6), 1);      // big party: one step down
});

test("2014 encounter difficulty uses the adjusted XP", () => {
  // four 5th-level characters vs. 3 ogres (CR 2, 450 xp each) = 1350 * 2 = 2700 -> Hard
  const r = evaluateEncounter([{ xp: 450, count: 3 }], [5, 5, 5, 5]);
  assert.equal(r.baseXp, 1350); assert.equal(r.multiplier, 2); assert.equal(r.adjustedXp, 2700);
  assert.equal(r.label, "Medium"); // 2000 <= 2700 < 3000
  const deadly = evaluateEncounter([{ xp: 5900, count: 1 }], [5, 5, 5, 5]);
  assert.equal(deadly.label, "Deadly");
  assert.equal(evaluateEncounter([{ xp: 10, count: 1 }], [5, 5, 5, 5]).label, "Trivial");
  assert.equal(evaluateEncounter([], [3, 3]).adjustedXp, 0);
});

test("2024 encounters compare raw XP to the budget", () => {
  const r = evaluateEncounter([{ xp: 450, count: 2 }], [4, 4, 4, 4], "2024");
  assert.equal(r.multiplier, 1); assert.equal(r.baseXp, 900);
  assert.equal(r.label, "Trivial"); // 900 is under the 1000 XP "low" budget for four 4th-level characters
  assert.equal(evaluateEncounter([{ xp: 500, count: 2 }], [4, 4, 4, 4], "2024").label, "Low");
  assert.equal(evaluateEncounter([{ xp: 1500, count: 1 }], [4, 4, 4, 4], "2024").label, "Moderate");
  assert.equal(evaluateEncounter([{ xp: 2100, count: 1 }], [4, 4, 4, 4], "2024").label, "High");
});

test("monster combatants average or roll hit points", () => {
  const list = monsters("2014").list;
  const goblin = list.find((m) => m.name === "Goblin");
  const c = monsterCombatant(goblin);
  assert.equal(c.maxHp, goblin.hp); assert.equal(c.ac, 15);
  assert.equal(c.dexMod, 2);
  setRng(() => 0.9999); // every die maxes out
  const r = monsterCombatant(goblin, { hpMode: "roll" });
  assert.ok(r.maxHp >= goblin.hp);
  const dragon = list.find((m) => m.name === "Adult Red Dragon");
  assert.deepEqual(monsterCombatant(dragon).legendary, { max: 3, used: 0 });
});

test("initiative ordering: high first, ties by Dex then name", () => {
  const a = customCombatant({ name: "Zed", initBonus: 1 }); a.init = 15;
  const b = customCombatant({ name: "Amy", initBonus: 3 }); b.init = 15;
  const c = customCombatant({ name: "Bob", initBonus: 3 }); c.init = 15;
  const d = customCombatant({ name: "Low", initBonus: 0 }); d.init = 3;
  const e = customCombatant({ name: "NoRoll" });
  assert.deepEqual(sortInitiative([a, b, c, d, e]).map((x) => x.name), ["Amy", "Bob", "Zed", "Low", "NoRoll"]);
});

test("rolling initiative uses the right bonus", () => {
  setRng(() => 9.5 / 20); // d20 -> 10
  const pc = pcCombatant({ name: "Hero", id: "h1", initiative: 3 });
  assert.equal(rollInitiative(pc), 13);
  const goblin = monsterCombatant(monsters("2014").list.find((m) => m.name === "Goblin"));
  assert.equal(rollInitiative(goblin), 12);
});

test("turn order advances, skips the defeated, and counts rounds", () => {
  const combat = newCombat();
  const names = ["A", "B", "C"];
  names.forEach((n, i) => { const c = customCombatant({ name: n }); c.init = 20 - i; combat.combatants.push(c); });
  assert.equal(currentCombatant(combat).name, "A");
  nextTurn(combat); assert.equal(currentCombatant(combat).name, "B");
  combat.combatants.find((c) => c.name === "C").dead = true;
  nextTurn(combat); // C is dead -> skip to A and start round 2
  assert.equal(currentCombatant(combat).name, "A"); assert.equal(combat.round, 2);
  prevTurn(combat);
  assert.equal(combat.round, 1);
});

test("the pointer stays on the same creature when the roster changes", () => {
  const combat = newCombat();
  ["A", "B", "C"].forEach((n, i) => { const c = customCombatant({ name: n }); c.init = 10 - i; combat.combatants.push(c); });
  nextTurn(combat); // B
  withStableTurn(combat, () => { const f = customCombatant({ name: "Fast" }); f.init = 30; combat.combatants.push(f); });
  assert.equal(currentCombatant(combat).name, "B");
  assert.equal(orderedCombatants(combat)[0].name, "Fast");
});

test("damage honours temp HP, resistances, immunities and vulnerabilities", () => {
  const c = customCombatant({ name: "Golem", hp: 30 });
  c.tempHp = 5; c.resistances = ["fire"]; c.immunities = ["poison"]; c.vulnerabilities = ["cold"];
  let r = damageCombatant(c, 8, { type: "fire" });
  assert.equal(r.dealt, 4); assert.equal(r.note, "resisted");
  assert.equal(c.tempHp, 1); assert.equal(c.hp, 30); // 4 dmg: 4 -> temp 5 absorbs all but... 5-4 = 1 left
  r = damageCombatant(c, 10, { type: "poison" });
  assert.equal(r.dealt, 0);
  r = damageCombatant(c, 5, { type: "cold" });
  assert.equal(r.dealt, 10);
  assert.equal(c.hp, 21); // temp 1 + 9 hp
  r = damageCombatant(c, 100, { type: "slashing" });
  assert.equal(c.hp, 0); assert.equal(c.dead, true); assert.equal(r.down, true);
  healCombatant(c, 5);
  assert.equal(c.hp, 5); assert.equal(c.dead, false);
});

test("a downed PC makes death saves instead of dying outright", () => {
  const pc = pcCombatant({ name: "Hero", id: "x", hp: 10, maxHp: 10 });
  damageCombatant(pc, 10);
  assert.equal(pc.hp, 0); assert.ok(pc.conditions.includes("Unconscious")); assert.equal(pc.dead, false);
  const r = damageCombatant(pc, 3, { crit: true });
  assert.equal(pc.deathSaves.f, 2);
  damageCombatant(pc, 1);
  assert.equal(pc.deathSaves.f, 3);
  healCombatant(pc, 4);
  assert.deepEqual(pc.deathSaves, { s: 0, f: 0 });
  assert.ok(!pc.conditions.includes("Unconscious"));
});

test("what players are told about a creature's health", () => {
  const c = customCombatant({ name: "Orc", hp: 20 });
  assert.equal(healthStatus(c), "Unhurt");
  c.hp = 15; assert.equal(healthStatus(c), "Wounded");
  c.hp = 10; assert.equal(healthStatus(c), "Bloodied"); // at or below half
  c.hp = 9; assert.equal(healthStatus(c), "Bloodied");
  c.hp = 4; assert.equal(healthStatus(c), "Near death");
  c.hp = 0; assert.equal(healthStatus(c), "Defeated");
});

test("concentration DC", () => {
  assert.equal(concentrationDc(4), 10);
  assert.equal(concentrationDc(20), 10);
  assert.equal(concentrationDc(30), 15);
  assert.equal(concentrationDc(45), 22);
});

test("encounter suggestion stays near the budget", () => {
  const pool = monsters("2014").list;
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const picks = suggestEncounter(pool, 1000, { minCr: 0, maxCr: 5, partySize: 4, rng });
  assert.ok(picks.length > 0);
  const base = picks.reduce((s, p) => s + p.monster.xp * p.count, 0);
  const count = picks.reduce((s, p) => s + p.count, 0);
  const adj = base * groupMultiplier(count, 4);
  assert.ok(adj <= 1100 && adj >= 400, `adjusted ${adj}`);
});

test("rules helpers: xp, money, point buy, CR labels", () => {
  assert.equal(levelForXp(0), 1); assert.equal(levelForXp(299), 1); assert.equal(levelForXp(300), 2);
  assert.equal(levelForXp(355000), 20);
  assert.equal(xpToNextLevel(250, 1), 50); assert.equal(xpToNextLevel(0, 20), null);
  assert.equal(totalCopper({ pp: 1, gp: 2, sp: 3, cp: 4 }), 1000 + 200 + 30 + 4);
  assert.deepEqual(walletFromCopper(1234), { pp: 1, gp: 2, ep: 0, sp: 3, cp: 4 });
  assert.equal(costToCopper({ q: 15, u: "gp" }), 1500);
  assert.equal(pointBuySpent({ STR: 15, DEX: 15, CON: 15, INT: 8, WIS: 8, CHA: 8 }), 27);
  assert.equal(crLabel(0.125), "1/8"); assert.equal(crLabel(5), "5");
  assert.equal(parseCr("1/2"), 0.5); assert.equal(parseCr("x"), null);
  assert.equal(CR_XP[1], 200);
});
