import test from "node:test";
import assert from "node:assert/strict";
import { ctxFor } from "./_data.mjs";
import { newCharacter, addLevel, derive, pendingChoices } from "../../js/systems/dnd5e/engine/character.js";
import { learnTargets, addSpell, removeSpell, togglePrepared, isPrepared, classSpellIds, preparedCount, maxSpellLevel, spellKindFor } from "../../js/systems/dnd5e/engine/spellbook.js";

const ctx = ctxFor("2014");
const spell = (name) => ctx.spellsByName.get(name.toLowerCase());
function make(cls, n = 1) {
  const c = newCharacter("2014");
  for (let i = 0; i < n; i++) addLevel(c, cls, null);
  c.race = { id: "human", name: "Human", subraceId: "", subraceName: "" };
  return c;
}

test("wizards learn into the spellbook, clerics prepare, sorcerers know", () => {
  const w = make("wizard"), cl = make("cleric"), so = make("sorcerer");
  assert.equal(learnTargets(w, ctx, spell("Magic Missile"))[0].kind, "book");
  assert.equal(learnTargets(cl, ctx, spell("Bless"))[0].kind, "prepared");
  assert.equal(learnTargets(so, ctx, spell("Magic Missile"))[0].kind, "known");
  assert.equal(learnTargets(w, ctx, spell("Fire Bolt"))[0].kind, "cantrip");
});

test("a class only offers spells on its list", () => {
  assert.equal(learnTargets(make("fighter"), ctx, spell("Magic Missile")).length, 0);
  assert.equal(learnTargets(make("cleric"), ctx, spell("Magic Missile")).length, 0);
});

test("add, remove and prepare spells", () => {
  const c = make("cleric");
  const bless = spell("Bless");
  addSpell(c, "cleric", bless, "prepared");
  addSpell(c, "cleric", bless, "prepared"); // no duplicates
  assert.equal(preparedCount(c, "cleric"), 1);
  assert.ok(isPrepared(c, "cleric", bless.id));
  assert.equal(togglePrepared(c, "cleric", bless.id), false);
  assert.equal(isPrepared(c, "cleric", bless.id), false);
  assert.equal(togglePrepared(c, "cleric", bless.id), true);
  removeSpell(c, "cleric", bless.id, "prepared");
  assert.equal(classSpellIds(c, "cleric").size, 0);
});

test("wizard spellbook shows up as castable and kinds are reported per class", () => {
  const w = make("wizard");
  addSpell(w, "wizard", spell("Fire Bolt"), "cantrip");
  addSpell(w, "wizard", spell("Shield"), "book");
  const ids = classSpellIds(w, "wizard");
  assert.equal(ids.get(spell("Fire Bolt").id), "cantrip");
  assert.equal(ids.get(spell("Shield").id), "book");
  assert.equal(spellKindFor(w, { id: "wizard" }, spell("Shield")), "book");
});

test("highest castable level follows the slots", () => {
  assert.equal(maxSpellLevel(derive(make("wizard", 1), ctx)), 1);
  assert.equal(maxSpellLevel(derive(make("wizard", 5), ctx)), 3);
  assert.equal(maxSpellLevel(derive(make("warlock", 5), ctx)), 3);
  assert.equal(maxSpellLevel(derive(make("fighter", 5), ctx)), 0);
});

test("a ranger with favoured-enemy style picks shows them as pending choices", () => {
  const c = make("ranger", 1);
  const pend = pendingChoices(c, ctx).filter((p) => /favored/i.test(p.feature.name));
  assert.ok(pend.length >= 1, "favoured enemy should be a pending choice");
  c.choices[pend[0].feature.id] = pend[0].feature.pick.from.slice(0, pend[0].feature.pick.choose);
  assert.equal(pendingChoices(c, ctx).filter((p) => p.feature.id === pend[0].feature.id).length, 0);
});
