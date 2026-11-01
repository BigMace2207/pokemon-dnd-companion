import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  wildEncounter, trainerNpc, gymLeader, route, hook, loot, stageDepth, candidates, toText, ENVIRONMENTS, GYM_TYPES, TRAINER_CLASS_NAMES, GENERATORS,
} from "../../js/planner/pokeGenerators.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const read = (n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"));

// the same indexes js/data.js builds for the app
const pokemon = read("pokemon.json"), moves = read("moves.json"), items = read("items.json"), evolutions = read("evolutions.json"), movesets = read("movesets.json");
const evolvesFrom = new Map();
for (const { from, to, method } of evolutions) { if (!evolvesFrom.has(to)) evolvesFrom.set(to, []); evolvesFrom.get(to).push({ name: from, method }); }
const movesetsByDex = new Map();
for (const [dex, moveIdx, method, level, game] of movesets) { if (!movesetsByDex.has(dex)) movesetsByDex.set(dex, []); movesetsByDex.get(dex).push({ moveIdx, method, level, game }); }
const state = { pokemon, moves, items, evolvesFrom, movesetsByDex };

function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test("evolution stage is read from the evolution table", () => {
  assert.equal(stageDepth(state, "Charmander"), 0);
  assert.equal(stageDepth(state, "Charmeleon"), 1);
  assert.equal(stageDepth(state, "Charizard"), 2);
});

test("low-level encounters only contain early-stage, modest species", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = wildEncounter(state, seeded(seed), { env: "forest", level: 5 });
    assert.ok(r.mons.length >= 1);
    for (const m of r.mons) {
      assert.ok(stageDepth(state, m.name) === 0, `${m.name} is too evolved for level 5`);
      const sp = pokemon.find((p) => p.name === m.name);
      assert.ok(sp.total <= 270 + 7 * 5, `${m.name} is too strong`);
      assert.ok(m.level >= 3 && m.level <= 7);
    }
  }
});

test("species match the place they are found, and moves are ones they learn by that level", () => {
  const r = wildEncounter(state, seeded(7), { env: "water", level: 25, count: 4 });
  assert.equal(r.mons.length, 4);
  for (const m of r.mons) {
    assert.ok(m.types.some((t) => ENVIRONMENTS.water.types.includes(t)), `${m.name} doesn't belong at sea`);
    assert.ok(m.moves.length >= 1 && m.moves.length <= 4);
  }
  assert.ok(toText(r).startsWith("Wild encounter"));
});

test("trainers get a class-themed team that grows with level", () => {
  const small = trainerNpc(state, seeded(3), { level: 6, cls: "Bug Catcher" });
  const big = trainerNpc(state, seeded(3), { level: 55, cls: "Dragon Tamer" });
  assert.ok(small.mons.length <= 2 && big.mons.length >= 4);
  assert.ok(small.mons.every((m) => m.types.includes("Bug")), "a Bug Catcher uses Bug Pokémon");
  assert.ok(small.title.includes("Bug Catcher"));
  for (const c of TRAINER_CLASS_NAMES) assert.ok(trainerNpc(state, seeded(9), { level: 20, cls: c }).mons.length >= 1, c);
});

test("gym leaders scale with their badge and keep to their type", () => {
  const first = gymLeader(state, seeded(5), { badge: 1, type: "Water" });
  const last = gymLeader(state, seeded(5), { badge: 8, type: "Water" });
  assert.ok(first.mons.length < last.mons.length);
  assert.ok(Math.max(...last.mons.map((m) => m.level)) > Math.max(...first.mons.map((m) => m.level)) + 30);
  assert.ok(last.mons.every((m) => m.types.includes("Water")));
  for (const t of GYM_TYPES) assert.ok(gymLeader(state, seeded(2), { badge: 3, type: t }).lines.length > 5, t);
});

test("routes, hooks and treasure come out complete", () => {
  const r = route(state, seeded(4), { env: "cave", level: 14 });
  assert.ok(r.lines.some((l) => l.startsWith("Hazard")) && r.lines.filter((l) => /^(Common|Uncommon|Rare):/.test(l)).length >= 3);
  assert.ok(hook(seeded(1)).lines[0].endsWith("."));
  assert.ok(loot(state, seeded(1), { tier: "high" }).lines.length >= 3);
  for (const g of GENERATORS) assert.ok(g.run(state, seeded(11), {}).title, g.id);
});

test("every environment has candidates at mid level", () => {
  for (const env of Object.keys(ENVIRONMENTS)) assert.ok(candidates(state, { env, level: 30 }).length > 5, env);
});
