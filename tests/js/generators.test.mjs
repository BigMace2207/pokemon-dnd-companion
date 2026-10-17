import test from "node:test";
import assert from "node:assert/strict";
import { genName, genNpc, genTavern, genShop, genRumor, genHook, genWeather, genLoot, genRoom, genWildMagic, NAME_STYLES } from "../../js/systems/dnd5e/engine/generators.js";

// a small deterministic generator so the tests don't depend on luck
function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test("every name style produces a two-part name", () => {
  for (const style of NAME_STYLES) for (let i = 0; i < 20; i++) assert.match(genName(style, seeded(i + 1)), /^\S+ \S+/);
});

test("generators are deterministic for a given rng", () => {
  assert.deepEqual(genNpc(seeded(7)), genNpc(seeded(7)));
  assert.notDeepEqual(genNpc(seeded(7)), genNpc(seeded(8)));
});

test("NPCs, taverns and shops are fully populated", () => {
  const n = genNpc(seeded(3));
  for (const k of ["name", "race", "occupation", "age", "appearance", "mannerism", "trait", "wants", "secret", "attitude"]) assert.ok(n[k], k);
  const t = genTavern(seeded(4));
  assert.ok(t.name.startsWith("The ") && t.owner.name && t.patrons.length === 3 && t.rumor);
  const s = genShop(seeded(5));
  assert.ok(s.name && s.type && s.keeper.name && s.hook);
});

test("loot scales with challenge and hoards are bigger", () => {
  const avg = (cr, hoard) => { let t = 0; for (let i = 0; i < 200; i++) { const l = genLoot(cr, { hoard, rng: seeded(i + 1) }); t += l.coins.gp + l.coins.pp * 10; } return t / 200; };
  assert.ok(avg(15, false) > avg(1, false));
  assert.ok(avg(5, true) > avg(5, false));
});

test("weather respects the season", () => {
  for (let i = 0; i < 100; i++) {
    const w = genWeather(seeded(i + 1), "winter");
    assert.ok(!/^rain|drizzle|heat/.test(w.sky) || w.sky === "sleet");
    assert.equal(w.tempF, Math.round(w.tempC * 9 / 5 + 32));
  }
  assert.ok(genWeather(seeded(2), "summer").tempC > genWeather(seeded(2), "winter").tempC);
});

test("rooms, rumours, hooks and wild magic return text", () => {
  const r = genRoom(seeded(9));
  assert.ok(r.type && r.feature && r.occupant && r.exits >= 2);
  assert.ok(genRumor(seeded(1)).length > 10 && genHook(seeded(1)).endsWith(".") && genWildMagic(seeded(1)).length > 5);
});
