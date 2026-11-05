import { test } from "node:test";
import assert from "node:assert/strict";
import { spreadLevels, encounterLevel, partyAverage } from "../../js/planner/pokeGenerators.js";

test("a team's levels sit around the trainer's level, the ace highest", () => {
  for (let k = 0; k < 200; k++) {
    for (const n of [2, 3, 4, 6]) {
      const lv = spreadLevels(15, n);
      assert.equal(lv.length, n);
      assert.ok(lv.every((x) => x >= 12 && x <= 18), `${lv}`);
      const mean = lv.reduce((t, x) => t + x, 0) / n;
      assert.ok(Math.abs(mean - 15) <= 1, `mean ${mean} for ${lv}`);
      assert.equal(lv[n - 1], Math.max(...lv));
      assert.ok(new Set(lv).size > 1, "never all the same");
    }
  }
  assert.deepEqual(spreadLevels(15, 1), [15]);
  assert.ok(spreadLevels(1, 3).every((x) => x >= 1));
});

test("the encounter level is the players' average, a little higher the more players there are", () => {
  assert.equal(encounterLevel([15]).level, 15);
  assert.equal(encounterLevel([10, 20]).level, 17);          // average 15, +2 for two players
  assert.equal(encounterLevel([12, 15, 18]).level, 18);      // average 15, +3 for three
  const four = encounterLevel([15, 15, 15, 15]);
  assert.equal(four.level, 20);                              // +5 (4.5 rounded) for four
  assert.equal(four.bonus, 5);
  assert.equal(encounterLevel([20, 20, 20, 20, 20, 20, 20, 20, 20]).level, 28);   // the bonus stops at +8
  assert.equal(encounterLevel([]).level, 10);                // nobody has Pokémon yet
  assert.equal(encounterLevel([null, 12]).level, 12);        // a player with no Pokémon doesn't count
  assert.equal(encounterLevel([99, 99, 99]).level, 100);
});

test("a party's average ignores empty slots", () => {
  assert.equal(partyAverage([{ name: "Pikachu", level: 10 }, { name: "Eevee", level: 20 }, { name: "", level: 50 }, null]), 15);
  assert.equal(partyAverage([]), null);
});
