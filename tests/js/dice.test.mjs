import test from "node:test";
import assert from "node:assert/strict";
import { roll, parseExpression, stats, rollD20, setRng, fmtMod, scaleDice, withMod } from "../../js/systems/dnd5e/engine/dice.js";

// A scripted RNG: returns the given die faces in order (for a d20 face f use (f-1)/20 + epsilon).
function script(faces, sides) {
  let i = 0;
  setRng(() => (faces[i++ % faces.length] - 1) / sides + 0.0001);
}

test.afterEach(() => setRng(null));

test("parses plain numbers and dice", () => {
  assert.equal(parseExpression("2d6+3").length, 2);
  assert.equal(parseExpression("d20").length, 1);
  assert.equal(parseExpression("1d20 + 5 - 2").length, 3);
  assert.equal(parseExpression("banana"), null);
  assert.equal(parseExpression("2d6 3d4"), null);
  assert.equal(parseExpression("0d6"), null);
  assert.equal(parseExpression("1d0"), null);
  assert.equal(parseExpression(""), null);
});

test("rolls sum dice and modifiers", () => {
  script([3, 4], 6);
  const r = roll("2d6+3");
  assert.equal(r.total, 10);
  assert.equal(r.terms[0].dice.length, 2);
});

test("negative terms subtract", () => {
  script([6], 6);
  assert.equal(roll("1d6-2").total, 4);
  assert.equal(roll("5-1d4").terms.length, 2);
});

test("keep highest (4d6kh3) drops the lowest die", () => {
  script([1, 6, 5, 4], 6);
  const r = roll("4d6kh3");
  assert.equal(r.total, 15);
  assert.equal(r.terms[0].dice.filter((d) => !d.kept).length, 1);
  assert.equal(r.terms[0].dice.find((d) => !d.kept).v, 1);
});

test("keep lowest and drop highest", () => {
  script([2, 5, 6], 6);
  assert.equal(roll("3d6kl1").total, 2);
  script([2, 5, 6], 6);
  assert.equal(roll("3d6dh1").total, 7);
  script([2, 5, 6], 6);
  assert.equal(roll("3d6dl1").total, 11);
});

test("advantage and disadvantage words become kh/kl on the d20", () => {
  script([4, 17], 20);
  assert.equal(roll("1d20+5 adv").total, 22);
  script([4, 17], 20);
  assert.equal(roll("1d20+5 disadvantage").total, 9);
});

test("reroll once and minimum die (Great Weapon Fighting / Elemental Adept)", () => {
  script([1, 5], 6); // first roll 1 (<=2 -> rerolled), gives 5
  const r = roll("1d6r2");
  assert.equal(r.total, 5);
  script([1], 6);
  assert.equal(roll("1d6mi2").total, 2);
});

test("exploding dice add extra rolls on the maximum", () => {
  script([6, 6, 3], 6);
  assert.equal(roll("1d6!").total, 15);
});

test("critical hits double dice but not modifiers", () => {
  script([2, 3, 4, 5], 6);
  const r = roll("2d6+4", { crit: true });
  assert.equal(r.terms[0].dice.length, 4);
  assert.equal(r.total, 2 + 3 + 4 + 5 + 4);
  assert.match(r.terms[0].label, /^4d6/);
});

test("d% is a d100", () => {
  script([42], 100);
  assert.equal(roll("d%").total, 42);
});

test("stats() gives min/max/avg", () => {
  const s = stats("2d6+3");
  assert.equal(s.min, 5); assert.equal(s.max, 15); assert.equal(s.avg, 10);
  const a = stats("1d20+5 adv");
  assert.equal(a.min, 6); assert.equal(a.max, 25);
  assert.ok(Math.abs(a.avg - 18.825) < 0.001); // E[max of 2d20] = 13.825
  const d = stats("1d20 dis");
  assert.ok(Math.abs(d.avg - 7.175) < 0.001); // E[min of 2d20] = 7.175
});

test("rollD20 honours advantage, disadvantage, crit/fumble and Reliable Talent", () => {
  script([7, 15], 20);
  let r = rollD20({ mod: 3, mode: "adv" });
  assert.equal(r.chosen, 15); assert.equal(r.total, 18); assert.equal(r.rolls.length, 2);
  script([7, 15], 20);
  r = rollD20({ mod: 3, mode: "dis" });
  assert.equal(r.chosen, 7);
  script([20], 20);
  assert.equal(rollD20().crit, true);
  script([1], 20);
  assert.equal(rollD20().fumble, true);
  script([4], 20);
  r = rollD20({ mod: 6, reliable10: true });
  assert.equal(r.chosen, 10); assert.equal(r.natural, 4); assert.equal(r.total, 16);
});

test("small helpers", () => {
  assert.equal(fmtMod(3), "+3");
  assert.equal(fmtMod(-2), "−2");
  assert.equal(fmtMod(0), "+0");
  assert.equal(withMod("1d8", 3), "1d8+3");
  assert.equal(withMod("1d8", -1), "1d8-1");
  assert.equal(withMod("1d8", 0), "1d8");
  assert.equal(scaleDice("1d10", 2), "2d10");
  assert.equal(scaleDice("8d6+2d4", 2), "16d6+4d4");
});
