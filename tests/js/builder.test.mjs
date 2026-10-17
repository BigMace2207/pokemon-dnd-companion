import test from "node:test";
import assert from "node:assert/strict";
import { ctxFor } from "./_data.mjs";
import { newDraft, buildCharacter, draftProblems, pointBuyValid, standardArrayFor, CLASS_PRIORITY, raceBonuses, backgroundBonuses } from "../../js/systems/dnd5e/engine/builder.js";
import { derive, classLabel } from "../../js/systems/dnd5e/engine/character.js";

const ctx = ctxFor("2014");

function draftFor(classId, raceId, extra = {}) {
  const d = newDraft("2014");
  d.name = "Hero"; d.raceId = raceId; d.classId = classId;
  d.scores = standardArrayFor(CLASS_PRIORITY[classId]);
  d.backgroundId = "acolyte";
  const cls = ctx.classes.get(classId);
  d.classSkills = cls.skills.from.filter((s) => !["Insight", "Religion"].includes(s)).slice(0, cls.skills.choose);
  return Object.assign(d, extra);
}

test("a level 1 human fighter is built end to end", () => {
  const c = buildCharacter(draftFor("fighter", "human"), ctx);
  const d = derive(c, ctx);
  assert.equal(c.name, "Hero");
  assert.equal(classLabel(c, ctx), "Fighter 1");
  // human gets +1 everywhere: STR 15+1, DEX 13+1(?), CON 14+1 ...
  assert.equal(d.scores.STR.score, 16); assert.equal(d.scores.CON.score, 15);
  assert.deepEqual(c.saveProfs, ["STR", "CON"]);
  assert.equal(Object.keys(c.skills).length, 4); // 2 class + 2 acolyte (Insight, Religion)
  assert.equal(c.skills.Insight, 1); assert.equal(c.skills.Religion, 1);
  assert.equal(d.hpMax, 10 + d.scores.CON.mod);
  assert.ok(c.inventory.length > 3);
  assert.ok(c.inventory.some((i) => i.equipped && i.kind === "armor"), "wears armor");
  assert.ok(c.inventory.some((i) => i.equipped && i.kind === "weapon"), "wields a weapon");
  assert.ok(d.ac.value >= 11);
  assert.ok(c.currency.gp >= 15); // Acolyte's 15 gp
});

test("explorer's pack is unpacked into its contents", () => {
  const c = buildCharacter(draftFor("barbarian", "human"), ctx);
  const names = c.inventory.map((i) => i.name);
  assert.ok(names.includes("Torch"), names.join(","));
  assert.ok(names.includes("Waterskin"));
  assert.ok(!names.includes("Explorer's Pack"));
  const torch = c.inventory.find((i) => i.name === "Torch");
  assert.equal(torch.qty, 10);
  assert.ok(torch.weight != null);
});

test("racial bonuses and subraces stack", () => {
  const d = draftFor("wizard", "elf", { subraceId: "high-elf" });
  const bonuses = raceBonuses(d, ctx);
  assert.deepEqual(bonuses.map((b) => `${b.ab}+${b.n}`), ["DEX+2", "INT+1"]);
  const c = buildCharacter(d, ctx);
  const dv = derive(c, ctx);
  assert.equal(dv.scores.DEX.score, 13 + 2);
  assert.equal(dv.scores.INT.score, 15 + 1);
  assert.equal(c.skills.Perception, 1); // Elf: Keen Senses
  assert.equal(c.race.subraceName, "High Elf");
  assert.equal(dv.speed, 30);
  assert.ok(dv.senses[0].startsWith("Darkvision"));
});

test("half-elf picks two extra +1 bonuses", () => {
  const d = draftFor("bard", "half-elf", { raceAbilityPicks: ["DEX", "CON"] });
  const b = raceBonuses(d, ctx);
  assert.equal(b.length, 3);
  assert.equal(derive(buildCharacter(d, ctx), ctx).scores.CHA.score, 15 + 2);
});

test("class equipment alternatives and category picks", () => {
  const d = draftFor("fighter", "human");
  // fighter option 0: (a) chain mail or (b) leather armor, longbow, 20 arrows
  d.equipChoice[0] = 1;
  const c = buildCharacter(d, ctx);
  const names = c.inventory.map((i) => i.name);
  assert.ok(names.includes("Leather Armor") && names.includes("Longbow") && names.includes("Arrow"));
  assert.ok(!names.includes("Chain Mail"));
  assert.equal(c.inventory.find((i) => i.name === "Arrow").qty, 20);
});

test("starting gold replaces equipment when chosen", () => {
  const d = draftFor("wizard", "human", { takeGold: true, goldRoll: 150 });
  const c = buildCharacter(d, ctx);
  assert.equal(c.currency.gp, 150 + 15); // + acolyte gold
  assert.ok(!c.inventory.some((i) => i.name === "Spellbook"));
});

test("starting above level 1 grants average hit points per level", () => {
  const d = draftFor("fighter", "human", { startLevel: 5 });
  const c = buildCharacter(d, ctx);
  const dv = derive(c, ctx);
  assert.equal(dv.level, 5);
  assert.equal(dv.hpMax, 10 + 4 * 6 + 5 * dv.scores.CON.mod);
  assert.equal(dv.pb, 3);
});

test("point buy cost checks", () => {
  assert.equal(pointBuyValid({ STR: 8, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 }).spent, 0);
  assert.equal(pointBuyValid({ STR: 15, DEX: 15, CON: 15, INT: 8, WIS: 8, CHA: 8 }).ok, true);
  assert.equal(pointBuyValid({ STR: 15, DEX: 15, CON: 15, INT: 15, WIS: 8, CHA: 8 }).ok, false);
  assert.equal(pointBuyValid({ STR: 16, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 }).ok, false); // 16 isn't buyable
});

test("problems list is empty only when the draft is complete", () => {
  const d = newDraft("2014");
  assert.ok(draftProblems(d, ctx).length >= 3);
  const ok = draftFor("rogue", "human");
  assert.deepEqual(draftProblems(ok, ctx), []);
  ok.name = "";
  assert.deepEqual(draftProblems(ok, ctx), ["Give your character a name."]);
});

test("2024: background ability bonuses and origin feat", () => {
  const c24 = ctxFor("2024");
  const d = newDraft("2024");
  d.name = "Nova"; d.raceId = "human"; d.classId = "wizard";
  d.scores = standardArrayFor(CLASS_PRIORITY.wizard);
  d.backgroundId = "acolyte";
  d.bgAbility = { mode: "2/1", plus2: "INT", plus1: "WIS" };
  const cls = c24.classes.get("wizard");
  d.classSkills = cls.skills.from.slice(0, cls.skills.choose);
  assert.deepEqual(backgroundBonuses(d, c24).map((b) => `${b.ab}+${b.n}`), ["INT+2", "WIS+1"]);
  assert.deepEqual(draftProblems(d, c24), []);
  const c = buildCharacter(d, c24);
  const dv = derive(c, c24);
  assert.equal(dv.scores.INT.score, 15 + 2);
  assert.ok(c.feats.some((f) => f.id === "magic-initiate"));
  assert.equal(c.edition, "2024");
});
