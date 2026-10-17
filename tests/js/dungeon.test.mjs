import test from "node:test";
import assert from "node:assert/strict";
import { genDungeon } from "../../js/systems/dnd5e/engine/generators.js";

function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const OPP = { N: "S", S: "N", E: "W", W: "E" };

test("dungeons are connected, symmetric, with one entrance and one lair", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rooms = 3 + (seed % 15);
    const d = genDungeon(seeded(seed), { rooms, loops: (seed % 4) / 4 });
    assert.equal(d.rooms.length, rooms);
    const seen = new Set([1]);
    const q = [1];
    while (q.length) { const id = q.shift(); const r = d.rooms.find((x) => x.id === id); for (const e of r.exits) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); } }
    assert.equal(seen.size, rooms, `seed ${seed} is disconnected`);
    for (const r of d.rooms) for (const e of r.exits) {
      const back = d.rooms.find((x) => x.id === e.to).exits.find((b) => b.to === r.id);
      assert.ok(back, "missing return exit");
      assert.equal(back.door, e.door);
      assert.equal(back.dir, OPP[e.dir]);
    }
    assert.equal(new Set(d.rooms.map((r) => `${r.x},${r.y}`)).size, rooms, "two rooms share a cell");
    assert.equal(d.rooms.filter((r) => r.role === "entrance").length, 1);
    assert.equal(d.rooms.filter((r) => r.role === "lair").length, 1);
  }
});

test("exits only join neighbouring cells, and stairs are mirrored", () => {
  const d = genDungeon(seeded(5), { rooms: 12, loops: 0.6 });
  const dv = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  for (const r of d.rooms) for (const e of r.exits) {
    const to = d.rooms.find((x) => x.id === e.to);
    assert.deepEqual([to.x - r.x, to.y - r.y], dv[e.dir]);
    const back = to.exits.find((b) => b.to === r.id);
    assert.equal(back.vertical, e.vertical ? (e.vertical === "down" ? "up" : "down") : null);
  }
});

test("the lair is a farthest room and dead ends become vaults", () => {
  const d = genDungeon(seeded(11), { rooms: 10, loops: 0 });
  const far = Math.max(...d.rooms.map((r) => r.distance));
  assert.equal(d.rooms.find((r) => r.id === d.lair).distance, far);
  for (const r of d.rooms.filter((x) => x.deadEnd && x.id !== d.lair)) assert.equal(r.role, "vault");
  assert.equal(d.loops, 0);
});
