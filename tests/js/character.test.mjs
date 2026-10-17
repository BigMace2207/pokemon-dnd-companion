import test from "node:test";
import assert from "node:assert/strict";
import { ctxFor } from "./_data.mjs";
import {
  newCharacter, addLevel, derive, newItem, applyDamage, applyHeal, deathSave, spendHitDie, shortRest, longRest,
  asiPending, subclassPending, classLabel, presenceSummary, totalLevel, classLevel, spellSlots, classSummary,
} from "../../js/systems/dnd5e/engine/character.js";

const ctx = ctxFor("2014");

function make(classes, abilities = {}, extra = {}) {
  const c = newCharacter("2014");
  c.name = "Test";
  for (const [id, n] of classes) for (let i = 0; i < n; i++) addLevel(c, id, null);
  Object.assign(c.abilities, abilities);
  const first = ctx.classes.get(classes[0][0]);
  c.saveProfs = [...first.saves];
  c.race = { id: extra.race || "human", name: extra.race || "Human", subraceId: extra.subrace || "", subraceName: "" };
  return c;
}
function give(c, name, equip = true) {
  const rec = ctx.equipmentByName.get(name.toLowerCase());
  assert.ok(rec, `no equipment named ${name}`);
  const it = newItem(rec);
  it.equipped = equip;
  c.inventory.push(it);
  return it;
}

test("proficiency bonus scales with level", () => {
  const expected = { 1: 2, 4: 2, 5: 3, 9: 4, 13: 5, 17: 6, 20: 6 };
  for (const [lvl, pb] of Object.entries(expected)) {
    const c = make([["fighter", Number(lvl)]]);
    assert.equal(derive(c, ctx).pb, pb, `level ${lvl}`);
  }
});

test("fighter: chain mail + shield AC, fighting style defense, longsword attack", () => {
  const c = make([["fighter", 1]], { STR: 16, DEX: 14, CON: 15, INT: 10, WIS: 12, CHA: 8 });
  give(c, "Chain Mail"); give(c, "Shield"); give(c, "Longsword");
  let d = derive(c, ctx);
  assert.equal(d.ac.value, 18); // 16 (heavy, no dex) + 2 shield
  assert.equal(d.hpMax, 10 + 2); // d10 max + CON +2
  assert.equal(d.initiative, 2);
  c.choices["fighter-fighting-style"] = ["fighter-fighting-style-defense"];
  d = derive(c, ctx);
  assert.equal(d.ac.value, 19);
  const sword = d.attacks.find((a) => a.name === "Longsword");
  assert.equal(sword.toHit, 3 + 2); // STR +3, proficient (martial)
  assert.equal(sword.damage, "1d8"); assert.equal(sword.damageMod, 3);
  assert.equal(sword.versatile, "1d10");
  assert.deepEqual(d.saves.STR, { mod: 5, proficient: true, aura: 0 });
  assert.equal(d.saves.DEX.proficient, false);
});

test("medium armor caps dex at +2, light armor doesn't, heavy ignores it", () => {
  const c = make([["fighter", 1]], { DEX: 18 });
  give(c, "Scale Mail");
  assert.equal(derive(c, ctx).ac.value, 14 + 2);
  c.inventory.length = 0; give(c, "Leather Armor");
  assert.equal(derive(c, ctx).ac.value, 11 + 4);
  c.inventory.length = 0; give(c, "Plate Armor");
  assert.equal(derive(c, ctx).ac.value, 18);
});

test("no armor is 10 + Dex; manual override wins", () => {
  const c = make([["wizard", 1]], { DEX: 14 });
  assert.equal(derive(c, ctx).ac.value, 12);
  c.effectsOn = ["mage-armor"];
  assert.equal(derive(c, ctx).ac.value, 15);
  c.acOverride = 20;
  assert.equal(derive(c, ctx).ac.value, 20);
});

test("barbarian unarmored defense and rage damage", () => {
  const c = make([["barbarian", 1]], { STR: 16, DEX: 14, CON: 16 });
  give(c, "Greataxe");
  let d = derive(c, ctx);
  assert.equal(d.ac.value, 10 + 2 + 3);
  assert.equal(d.hpMax, 12 + 3);
  const axe = d.attacks.find((a) => a.name === "Greataxe");
  assert.equal(axe.damage, "1d12"); assert.equal(axe.damageMod, 3);
  c.effectsOn = ["rage"];
  d = derive(c, ctx);
  assert.equal(d.attacks.find((a) => a.name === "Greataxe").damageMod, 5); // rage +2 at level 1
  assert.ok(d.resistances.includes("Slashing"));
  const rage = d.resources.find((r) => r.key === "rage");
  assert.equal(rage.max, 2);
});

test("monk unarmored defense, martial arts die and unarmored movement", () => {
  const c = make([["monk", 2]], { DEX: 16, WIS: 14, STR: 8 });
  let d = derive(c, ctx);
  assert.equal(d.ac.value, 10 + 3 + 2);
  assert.equal(d.speed, 30 + 10);
  const unarmed = d.attacks.find((a) => a.id === "unarmed");
  assert.equal(unarmed.damage, "1d4");
  assert.equal(unarmed.ability, "DEX");
  assert.equal(d.resources.find((r) => r.key === "ki").max, 2);
  give(c, "Chain Mail");
  d = derive(c, ctx);
  assert.equal(d.speed, 20); // armored: no unarmored movement, and Str 8 < 13 costs 10 ft.
  c.abilities.STR = 13;
  assert.equal(derive(c, ctx).speed, 30);
});

test("wizard 5: HP, spell slots, DC, attack, prepared and cantrips", () => {
  const c = make([["wizard", 5]], { INT: 16, CON: 14, DEX: 12 });
  const d = derive(c, ctx);
  assert.equal(d.pb, 3);
  assert.equal(d.hpMax, 6 + 4 * 4 + 2 * 5); // 6 + 4 levels of average (4) + CON(+2) x5
  assert.deepEqual(d.slots.map((s) => s.max), [4, 3, 2, 0, 0, 0, 0, 0, 0]);
  const sc = d.casting[0];
  assert.equal(sc.dc, 8 + 3 + 3); assert.equal(sc.attack, 3 + 3);
  assert.equal(sc.preparedMax, 3 + 5);
  assert.equal(sc.cantrips, 4);
  assert.equal(sc.ability, "INT");
});

test("hit point rolls replace the average", () => {
  const c = make([["fighter", 1]], { CON: 10 });
  addLevel(c, "fighter", 9);
  c.levelLog[0].hp = 10;
  assert.equal(derive(c, ctx).hpMax, 19);
  c.hp.bonus = 3;
  assert.equal(derive(c, ctx).hpMax, 22);
  c.hp.override = 50;
  assert.equal(derive(c, ctx).hpMax, 50);
});

test("multiclass spell slots use the combined caster level", () => {
  const c = make([["fighter", 3], ["wizard", 2]]);
  const d = derive(c, ctx);
  assert.equal(d.casterLevel, 2);
  assert.deepEqual(d.slots.map((s) => s.max), [3, 0, 0, 0, 0, 0, 0, 0, 0]);
  const c2 = make([["cleric", 3], ["wizard", 4]]);
  const d2 = derive(c2, ctx);
  assert.equal(d2.casterLevel, 7);
  assert.deepEqual(d2.slots.map((s) => s.max), [4, 3, 3, 1, 0, 0, 0, 0, 0]);
  // hit dice pools combine by die size
  const c3 = make([["fighter", 3], ["wizard", 2], ["rogue", 2]]);
  const d3 = derive(c3, ctx);
  const dice = Object.fromEntries(d3.hitDice.map((h) => [h.label, h.total]));
  assert.deepEqual(dice, { d10: 3, d8: 2, d6: 2 });
});

test("single half caster uses its own table; paladin gets Aura of Protection at 6", () => {
  const c = make([["paladin", 5]], { CHA: 16 });
  assert.deepEqual(derive(c, ctx).slots.map((s) => s.max), [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  const c1 = make([["paladin", 1]], { CHA: 16 });
  assert.equal(derive(c1, ctx).casting.length, 0); // paladins cast from level 2
  const c6 = make([["paladin", 6]], { CHA: 16, WIS: 10 });
  const d = derive(c6, ctx);
  assert.equal(d.saves.WIS.mod, 0 + 3 + 3); // proficient (+3) + Aura of Protection (CHA +3)
  assert.equal(d.saves.STR.mod, 0 + 3);
  assert.equal(d.saves.STR.aura, 3);
});

test("warlock pact magic is separate from normal slots", () => {
  const c = make([["warlock", 5]], { CHA: 16 });
  const d = derive(c, ctx);
  assert.deepEqual(d.pact && { count: d.pact.count, level: d.pact.level }, { count: 2, level: 3 });
  assert.ok(d.slots.every((s) => s.max === 0));
  c.pactUsed = 1;
  assert.equal(derive(c, ctx).pact.used, 1);
  const c11 = make([["warlock", 11]]);
  assert.deepEqual(derive(c11, ctx).pact && { count: derive(c11, ctx).pact.count, level: derive(c11, ctx).pact.level }, { count: 3, level: 5 });
});

test("skills: proficiency, expertise, Jack of All Trades, passive scores", () => {
  const c = make([["bard", 2]], { CHA: 16, WIS: 12, DEX: 14 });
  c.skills = { Persuasion: 2, Stealth: 1 };
  const d = derive(c, ctx);
  assert.equal(d.skills.Persuasion.mod, 3 + 4); // expertise doubles the +2 bonus
  assert.equal(d.skills.Stealth.mod, 2 + 2);
  assert.equal(d.skills.Athletics.mod, 0 + 1); // jack of all trades: half of +2
  assert.equal(d.skills.Athletics.note, "Jack of All Trades");
  assert.equal(d.passive.perception, 10 + 1 + 1);
  assert.equal(d.initiative, 2 + 1); // dex + JoAT
});

test("rogue level 11 has Reliable Talent on proficient skills", () => {
  const c = make([["rogue", 11]]);
  c.skills = { Stealth: 2 };
  const d = derive(c, ctx);
  assert.equal(d.skills.Stealth.reliable, true);
  assert.equal(d.skills.Athletics.reliable, false);
});

test("ability score bonuses stack and set-scores override only when higher", () => {
  const c = make([["fighter", 1]], { STR: 14 });
  c.bonuses.push({ src: "Race", ab: "STR", n: 2 });
  assert.equal(derive(c, ctx).scores.STR.score, 16);
  c.setScores.STR = 19;
  assert.equal(derive(c, ctx).scores.STR.score, 19);
  c.setScores.STR = 12;
  assert.equal(derive(c, ctx).scores.STR.score, 16);
});

test("encumbrance and attunement warnings", () => {
  const c = make([["fighter", 1]], { STR: 10 });
  const it = give(c, "Chain Mail"); it.weight = 55;
  let d = derive(c, ctx);
  assert.equal(d.capacity, 150);
  assert.equal(d.encumbrance, "encumbered"); // 55 > 50
  assert.ok(d.warnings.some((w) => /Strength 13/.test(w)));
  for (let i = 0; i < 4; i++) { const x = newItem({ name: `Ring ${i}` }); x.attuned = true; c.inventory.push(x); }
  d = derive(c, ctx);
  assert.ok(d.warnings.some((w) => /attuned/.test(w)));
});

test("armor proficiency warning when untrained", () => {
  const c = make([["wizard", 1]]);
  give(c, "Plate Armor");
  assert.ok(derive(c, ctx).warnings.some((w) => /Not proficient with heavy armor/.test(w)));
});

test("damage, temporary HP, unconsciousness and instant death", () => {
  const c = make([["fighter", 1]], { CON: 14 });
  c.hp.current = null;
  let d = derive(c, ctx);
  assert.equal(d.hpMax, 12);
  c.hp.temp = 5;
  let r = applyDamage(c, d, 7);
  assert.equal(r.absorbed, 5); assert.equal(c.hp.current, 10); assert.equal(c.hp.temp, 0);
  r = applyDamage(c, d, 10);
  assert.equal(c.hp.current, 0); assert.equal(r.state, "down");
  assert.ok(c.conditions.includes("Unconscious"));
  // damage at 0 HP = death save failure (crit = 2)
  r = applyDamage(c, d, 3);
  assert.equal(c.deathSaves.f, 1);
  r = applyDamage(c, d, 3, { crit: true });
  assert.equal(c.deathSaves.f, 3); assert.equal(r.state, "dead");
  // massive damage: overflow >= max HP kills outright
  const c2 = make([["fighter", 1]], { CON: 14 });
  const d2 = derive(c2, ctx);
  r = applyDamage(c2, d2, 12 + 12);
  assert.equal(r.state, "dead");
});

test("healing from 0 HP clears death saves and unconsciousness", () => {
  const c = make([["fighter", 1]], { CON: 14 });
  const d = derive(c, ctx);
  applyDamage(c, d, 12);
  assert.equal(c.hp.current, 0);
  c.deathSaves = { s: 1, f: 2 };
  applyHeal(c, d, 4);
  assert.equal(c.hp.current, 4);
  assert.deepEqual(c.deathSaves, { s: 0, f: 0 });
  assert.ok(!c.conditions.includes("Unconscious"));
  applyHeal(c, d, 100);
  assert.equal(c.hp.current, 12);
});

test("death saving throws", () => {
  const c = make([["fighter", 1]]);
  c.hp.current = 0;
  assert.equal(deathSave(c, 12), "success");
  assert.equal(deathSave(c, 5), "failure");
  assert.equal(deathSave(c, 1), "dead"); // 1 failure + 2 = 3
  const c2 = make([["fighter", 1]]); c2.hp.current = 0;
  assert.equal(deathSave(c2, 10), "success"); assert.equal(deathSave(c2, 15), "success"); assert.equal(deathSave(c2, 11), "stable");
  const c3 = make([["fighter", 1]]); c3.hp.current = 0; c3.conditions = ["Unconscious"];
  assert.equal(deathSave(c3, 20), "revive");
  assert.equal(c3.hp.current, 1); assert.deepEqual(c3.conditions, []);
});

test("hit dice, short rest and long rest", () => {
  const c = make([["fighter", 4]], { CON: 14 });
  let d = derive(c, ctx);
  assert.equal(d.hpMax, 10 + 3 * 6 + 2 * 4);
  c.hp.current = 5;
  const res = spendHitDie(c, d, 10, 6);
  assert.deepEqual(res, { healed: 8, gained: 8 });
  assert.equal(c.hp.current, 13);
  assert.equal(c.hitDiceUsed.d10, 1);
  c.resourcesUsed["second-wind"] = 1; c.resourcesUsed["action-surge"] = 1;
  d = derive(c, ctx);
  shortRest(c, d);
  assert.equal(c.resourcesUsed["second-wind"], undefined);
  // exhaust all hit dice, then a long rest returns half (2 of 4)
  c.hitDiceUsed.d10 = 4; c.hp.current = 1; c.exhaustion = 2; c.slotsUsed = { 1: 2 };
  d = derive(c, ctx);
  longRest(c, d);
  assert.equal(c.hp.current, d.hpMax);
  assert.equal(c.hitDiceUsed.d10, 2);
  assert.equal(c.exhaustion, 1);
  assert.deepEqual(c.slotsUsed, {});
  // can't spend more dice than you have
  c.hitDiceUsed.d10 = 4;
  assert.equal(spendHitDie(c, derive(c, ctx), 10, 5), null);
});

test("leveling: ASI opportunities, subclass prompts and the 20 level cap", () => {
  const c = make([["fighter", 3]]);
  assert.equal(asiPending(c), 0);
  assert.deepEqual(subclassPending(c, ctx), ["fighter"]);
  c.subclasses.fighter = "champion";
  assert.deepEqual(subclassPending(c, ctx), []);
  addLevel(c, "fighter"); // level 4
  assert.equal(asiPending(c), 1);
  c.asiLog.push({ level: 4 });
  assert.equal(asiPending(c), 0);
  for (let i = 0; i < 2; i++) addLevel(c, "fighter"); // 6 -> fighter's bonus ASI
  assert.equal(asiPending(c), 1);
  const w = make([["wizard", 1]]);
  assert.deepEqual(subclassPending(w, ctx), []); // wizard picks at 2
  addLevel(w, "wizard");
  assert.deepEqual(subclassPending(w, ctx), ["wizard"]);
  const big = make([["wizard", 20]]);
  assert.equal(addLevel(big, "wizard"), false);
  assert.equal(totalLevel(big), 20);
});

test("subclass features show once the level is reached", () => {
  const c = make([["fighter", 3]]);
  c.subclasses.fighter = "champion";
  const d = derive(c, ctx);
  assert.ok(d.features.some((f) => f.name === "Improved Critical" && f.kind === "subclass"));
  assert.ok(d.features.some((f) => f.name === "Second Wind"));
  const names = d.features.map((f) => f.name);
  assert.ok(!names.includes("Extra Attack"));
});

test("class labels and presence summary", () => {
  const c = make([["fighter", 3], ["wizard", 2]]);
  assert.equal(classLabel(c, ctx), "Fighter 3 / Wizard 2");
  const p = presenceSummary(c, ctx);
  assert.equal(p.level, 5); assert.equal(p.classes, "Fighter 3 / Wizard 2");
  assert.equal(p.hp, p.maxHp);
});

test("racial resources and darkvision", () => {
  const c = make([["fighter", 1]], {}, { race: "half-orc" });
  const d = derive(c, ctx);
  assert.ok(d.resources.some((r) => r.key === "relentless-endurance"));
  assert.ok(d.senses.some((s) => /Darkvision 60/.test(s)));
  const dw = make([["fighter", 1]], {}, { race: "dwarf", subrace: "hill-dwarf" });
  assert.equal(derive(dw, ctx).hpMax, 10 + 1); // Dwarven Toughness
  assert.ok(derive(dw, ctx).resistances.includes("Poison"));
  assert.equal(derive(dw, ctx).speed, 25);
});

test("custom (non-SRD) classes work with a simple definition", () => {
  const c = newCharacter("2014");
  c.customClasses.artificer = { id: "artificer", name: "Artificer", hitDie: 8, saves: ["CON", "INT"], caster: "half", casterAbility: "INT" };
  addLevel(c, "artificer", null); addLevel(c, "artificer", null);
  c.abilities.INT = 16; c.abilities.CON = 14;
  const d = derive(c, ctx);
  assert.equal(d.hpMax, 8 + 5 + 2 * 2);
  assert.equal(classLabel(c, ctx), "Artificer 2");
  assert.equal(d.casting[0].ability, "INT");
});

test("unarmed strike and extra custom attacks are always listed", () => {
  const c = make([["wizard", 1]], { STR: 8 });
  c.attacks.push({ id: "a1", name: "Fire Bolt", bonus: 5, damage: "1d10", type: "Fire" });
  const d = derive(c, ctx);
  assert.ok(d.attacks.some((a) => a.id === "unarmed"));
  const fb = d.attacks.find((a) => a.name === "Fire Bolt");
  assert.equal(fb.toHit, 5);
});

test("weapon proficiency matches class lists written as plurals", () => {
  const w = make([["wizard", 1]]);
  give(w, "Quarterstaff"); give(w, "Crossbow, light"); give(w, "Longsword");
  const d = derive(w, ctx);
  assert.equal(d.attacks.find((a) => a.name === "Quarterstaff").prof, true);
  assert.equal(d.attacks.find((a) => a.name === "Crossbow, light").prof, true);
  assert.equal(d.attacks.find((a) => a.name === "Longsword").prof, false);
  const r = make([["rogue", 1]]);
  give(r, "Rapier"); give(r, "Longsword"); give(r, "Dagger");
  const dr = derive(r, ctx);
  for (const n of ["Rapier", "Longsword", "Dagger"]) assert.equal(dr.attacks.find((a) => a.name === n).prof, true, n);
});

test("finesse picks the better of Strength and Dexterity; ranged uses Dexterity", () => {
  const c = make([["rogue", 1]], { STR: 10, DEX: 16 });
  give(c, "Rapier"); give(c, "Shortbow");
  const d = derive(c, ctx);
  assert.equal(d.attacks.find((a) => a.name === "Rapier").ability, "DEX");
  assert.equal(d.attacks.find((a) => a.name === "Shortbow").ability, "DEX");
  const s = make([["fighter", 1]], { STR: 16, DEX: 12 });
  give(s, "Dagger");
  assert.equal(derive(s, ctx).attacks.find((a) => a.name === "Dagger").ability, "STR");
});

test("2024 data: fighter and wizard compute the same core numbers", () => {
  const ctx24 = ctxFor("2024");
  const c = newCharacter("2024");
  for (let i = 0; i < 5; i++) addLevel(c, "wizard");
  c.abilities.INT = 16; c.abilities.CON = 14;
  c.saveProfs = ["INT", "WIS"];
  const d = derive(c, ctx24);
  assert.equal(d.pb, 3);
  assert.deepEqual(d.slots.map((s) => s.max), [4, 3, 2, 0, 0, 0, 0, 0, 0]);
  assert.equal(d.casting[0].preparedMax, 9); // from the 2024 class table
  assert.equal(d.casting[0].dc, 14);
  const f = newCharacter("2024");
  for (let i = 0; i < 3; i++) addLevel(f, "fighter");
  const df = derive(f, ctx24);
  assert.equal(df.resources.find((r) => r.key === "second-wind").max, 2);
  assert.equal(df.resources.find((r) => r.key === "action-surge").max, 1);
});

test("slot spending is clamped to the maximum", () => {
  const c = make([["wizard", 1]]);
  c.slotsUsed = { 1: 5 };
  assert.equal(derive(c, ctx).slots[0].used, 2);
});

test("spellSlots helper is exported for views", () => {
  const c = make([["sorcerer", 3]]);
  const out = spellSlots(c, ctx, classSummary(c, ctx));
  assert.deepEqual(out.slots.map((s) => s.max).slice(0, 3), [4, 2, 0]);
  assert.equal(classLevel(c, "sorcerer"), 3);
});
