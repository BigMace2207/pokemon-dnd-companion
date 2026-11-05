import { test } from "node:test";
import assert from "node:assert/strict";
import { catchChance, levelCatchMultiplier } from "../../js/calc.js";

test("level makes a Pokémon easier or harder to catch", () => {
  assert.ok(levelCatchMultiplier(5) > levelCatchMultiplier(30));
  assert.ok(levelCatchMultiplier(30) > levelCatchMultiplier(80));
  assert.equal(levelCatchMultiplier(100), 0.5);
  assert.equal(levelCatchMultiplier(null), 1, "no level: the original formula");
  const at = (level) => catchChance({ catchRate: 120, ball: "Poké Ball", hpPercent: 100, status: "None", level });
  assert.ok(at(5) > at(50) && at(50) > at(90));
});

test("HP, the ball and status still count, and the chance stays between 0 and 100", () => {
  const base = { catchRate: 45, hpPercent: 100, status: "None", level: 20 };
  assert.ok(catchChance({ ...base, ball: "Ultra Ball" }) > catchChance({ ...base, ball: "Poké Ball" }));
  assert.ok(catchChance({ ...base, ball: "Poké Ball", hpPercent: 10 }) > catchChance({ ...base, ball: "Poké Ball" }));
  assert.ok(catchChance({ ...base, ball: "Poké Ball", status: "Asleep / Frozen" }) > catchChance({ ...base, ball: "Poké Ball" }));
  assert.equal(catchChance({ ...base, ball: "Master Ball" }), 100);
  assert.equal(catchChance({ ...base, catchRate: 255, ball: "Ultra Ball", hpPercent: 5, level: 2 }), 100);
});
