import test from "node:test";
import assert from "node:assert/strict";
import { buildEntries, makeMatcher } from "../../js/systems/dnd5e/glossary.js";
import { DRAGONS, dragonFor } from "../../js/systems/dnd5e/engine/dragons.js";

const items = [
  { id: "cond:blinded", name: "Blinded", group: "Conditions", kind: "desc", desc: ["- A blinded creature can't see."] },
  { id: "skill:perception", name: "Perception", group: "Skills", kind: "desc", desc: ["Spot things."] },
  { id: "dt:Fire", name: "Fire", group: "Damage types", kind: "desc", desc: ["Flames."] },
  { id: "rule:advantage-and-disadvantage", name: "Advantage and Disadvantage", group: "Using Ability Scores", kind: "md", md: "# Adv\nRoll two d20s." },
  { id: "x:draconic-ancestry", name: "Draconic Ancestry", group: "Racial traits", kind: "desc", desc: ["Pick a dragon."] },
];
const m = makeMatcher(buildEntries(items));
const ids = (t) => m.find(t).map((h) => h.entry.id);

test("keywords are found by name, with the right case rules", () => {
  assert.deepEqual(ids("The target is blinded and has disadvantage."), ["cond:blinded", "rule:advantage-and-disadvantage"]);
  assert.deepEqual(ids("Make a Perception check"), ["skill:perception"]);
  assert.deepEqual(ids("his perception is sharp"), []);       // skills match capitalised only
  assert.deepEqual(ids("Fire Bolt deals fire damage"), ["dt:Fire"]);   // a damage type only before the word damage
  assert.deepEqual(ids("Choose your Draconic Ancestry."), ["x:draconic-ancestry"]);
});
test("matches are whole words and don't overlap", () => {
  assert.deepEqual(ids("Blindedness is not a word"), []);
  const hits = m.find("advantage, advantage");
  assert.equal(hits.length, 2);
});
test("the dragon table covers all ten and finds a row from a label", () => {
  assert.equal(DRAGONS.length, 10);
  assert.equal(dragonFor("Draconic Ancestry (Silver)").damage, "Cold");
  assert.equal(dragonFor("draconic-ancestor-red").shape, "15 ft. cone");
  assert.equal(dragonFor("nothing"), null);
});
