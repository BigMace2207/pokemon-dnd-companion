// Turns the character builder's answers (a "draft") into a finished character.
// Pure functions so the same rules run in the wizard and in the tests.

import {
  newCharacter, addLevel, newItem, uid, classSummary,
} from "./character.js";
import {
  ABILITY_KEYS, STANDARD_ARRAY, POINT_BUY_COST, POINT_BUY_BUDGET, SKILLS, STARTING_GOLD, SUBCLASS_LEVEL,
} from "./rules.js";
import { rollDie } from "./dice.js";

export function newDraft(edition = "2014") {
  return {
    edition, name: "", player: "", alignment: "",
    raceId: "", subraceId: "", raceAbilityPicks: [], raceLanguagePicks: [], raceSkillPicks: [], raceToolPick: "", raceSpellPick: "", raceTraitPicks: {},
    classId: "", startLevel: 1, subclassId: "", classSkills: [],
    equipChoice: {}, equipPick: {}, takeGold: false, goldRoll: null,
    method: "standard", scores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }, assigned: {},
    backgroundId: "", bgCustom: { name: "", skills: [], tools: "", feature: "" }, bgAbility: { mode: "2/1", plus2: "", plus1: "" }, bgEquipChoice: {}, bgEquipPick: {},
    bgLanguagePicks: [],
    cantrips: [], spellsKnown: [], spellbook: [], prepared: [],
    details: { traits: "", ideals: "", bonds: "", flaws: "", backstory: "", appearance: "" },
  };
}

// ------------------------------------------------------------------ ability scores

export function pointBuyValid(scores) {
  let spent = 0;
  for (const k of ABILITY_KEYS) {
    const cost = POINT_BUY_COST[scores[k]];
    if (cost == null) return { ok: false, spent: NaN };
    spent += cost;
  }
  return { ok: spent <= POINT_BUY_BUDGET, spent, left: POINT_BUY_BUDGET - spent };
}

export function rollAbilityScores() {
  const one = () => {
    const d = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)].sort((a, b) => a - b);
    return { dice: d, total: d[1] + d[2] + d[3] };
  };
  return Array.from({ length: 6 }, one);
}

// Arrange the standard array [15,14,13,12,10,8] by priority list of ability keys.
export function standardArrayFor(priority) {
  const out = {};
  priority.forEach((k, i) => { out[k] = STANDARD_ARRAY[i]; });
  return out;
}

// A sensible default priority per class for one-click arrays.
export const CLASS_PRIORITY = {
  barbarian: ["STR", "CON", "DEX", "WIS", "CHA", "INT"], bard: ["CHA", "DEX", "CON", "WIS", "INT", "STR"],
  cleric: ["WIS", "CON", "STR", "CHA", "DEX", "INT"], druid: ["WIS", "CON", "DEX", "INT", "CHA", "STR"],
  fighter: ["STR", "CON", "DEX", "WIS", "CHA", "INT"], monk: ["DEX", "WIS", "CON", "STR", "CHA", "INT"],
  paladin: ["STR", "CHA", "CON", "WIS", "DEX", "INT"], ranger: ["DEX", "WIS", "CON", "STR", "INT", "CHA"],
  rogue: ["DEX", "CON", "CHA", "INT", "WIS", "STR"], sorcerer: ["CHA", "CON", "DEX", "WIS", "INT", "STR"],
  warlock: ["CHA", "CON", "DEX", "WIS", "INT", "STR"], wizard: ["INT", "CON", "DEX", "WIS", "CHA", "STR"],
};

// ------------------------------------------------------------------ race / background bonuses

export function raceBonuses(draft, ctx) {
  const out = [];
  const race = ctx.races.get(draft.raceId);
  if (!race) return out;
  for (const b of race.abilityBonuses) out.push({ src: race.name, ab: b.ability, n: b.bonus });
  const sub = race.subraces.find((s) => s.id === draft.subraceId);
  for (const b of sub?.abilityBonuses || []) out.push({ src: sub.name, ab: b.ability, n: b.bonus });
  for (const ab of draft.raceAbilityPicks || []) out.push({ src: `${race.name} (choice)`, ab, n: race.abilityChoices?.from?.find((f) => f.ability === ab)?.bonus ?? 1 });
  return out;
}

export function backgroundBonuses(draft, ctx) {
  if (draft.edition !== "2024") return [];
  const bg = ctx.backgrounds.get(draft.backgroundId);
  if (!bg) return [];
  const out = [];
  const a = draft.bgAbility;
  if (a.mode === "1/1/1") for (const ab of bg.abilityScores || []) out.push({ src: bg.name, ab, n: 1 });
  else {
    if (a.plus2) out.push({ src: bg.name, ab: a.plus2, n: 2 });
    if (a.plus1) out.push({ src: bg.name, ab: a.plus1, n: 1 });
  }
  return out;
}

// ------------------------------------------------------------------ equipment

function recById(ctx, id) { return ctx.equipment.get(id) || null; }

// Adds `qty` of an equipment record to the inventory (stacking plain gear, expanding packs into their contents).
function addRec(inv, ctx, rec, qty, nameFallback) {
  if (!rec) { inv.push(newItem({ name: nameFallback || "Item" }, qty)); return; }
  if (rec.kind === "pack" && rec.contents?.length) {
    for (const c of rec.contents) addRec(inv, ctx, (c.id && ctx.equipment.get(c.id)) || null, (c.qty || 1) * qty, c.name);
    return;
  }
  const stackable = rec.kind !== "weapon" && rec.kind !== "armor";
  const have = stackable ? inv.find((i) => i.id === rec.id && !i.equipped) : null;
  if (have) have.qty += qty;
  else inv.push(newItem(rec, qty));
}

// Applies one chosen alternative (a list of item specs) to the inventory/currency.
function applyAlternative(c, ctx, alt, picks, keyPrefix) {
  alt.forEach((spec, idx) => {
    if (spec.money) { c.currency[spec.money] = (c.currency[spec.money] || 0) + (spec.qty || 0); return; }
    if (spec.pick) {
      for (let n = 0; n < (spec.qty || 1); n++) {
        const id = picks[`${keyPrefix}:${idx}:${n}`];
        if (id) addRec(c.inventory, ctx, recById(ctx, id), 1);
      }
      return;
    }
    addRec(c.inventory, ctx, spec.id ? recById(ctx, spec.id) : null, spec.qty || 1, spec.name);
  });
}

export function applyEquipment(c, ctx, draft) {
  const cls = ctx.classes.get(draft.classId);
  const bg = ctx.backgrounds.get(draft.backgroundId);
  if (draft.takeGold) {
    const [n, d, mult] = STARTING_GOLD[draft.classId] || [4, 4, 10];
    let total = draft.goldRoll;
    if (total == null) { total = 0; for (let i = 0; i < n; i++) total += rollDie(d); total *= mult; }
    c.currency.gp += total;
  } else if (cls) {
    for (const f of cls.equipment.fixed) addRec(c.inventory, ctx, recById(ctx, f.id), f.qty || 1, f.name);
    cls.equipment.options.forEach((opt, oi) => {
      const alt = opt.alternatives[draft.equipChoice[oi] ?? 0];
      if (alt) applyAlternative(c, ctx, alt, draft.equipPick, `c${oi}:${draft.equipChoice[oi] ?? 0}`);
    });
  }
  if (bg) {
    if (draft.edition === "2014") {
      for (const f of bg.equipment || []) addRec(c.inventory, ctx, recById(ctx, f.id), f.qty || 1, f.name);
      if (bg.gold) c.currency.gp += bg.gold;
      (bg.equipmentOptions || []).forEach((opt, oi) => {
        const alt = opt.alternatives[draft.bgEquipChoice[oi] ?? 0];
        if (alt) applyAlternative(c, ctx, alt, draft.bgEquipPick, `b${oi}:${draft.bgEquipChoice[oi] ?? 0}`);
      });
    } else {
      (bg.equipmentOptions || []).forEach((opt, oi) => {
        const alt = opt.alternatives[draft.bgEquipChoice[oi] ?? 0];
        if (alt) applyAlternative(c, ctx, alt, draft.bgEquipPick, `b${oi}:${draft.bgEquipChoice[oi] ?? 0}`);
      });
    }
  }
  autoEquip(c, ctx);
}

// Wear the best armor you're proficient with, a shield if allowed, and wield up to two weapons.
export function autoEquip(c, ctx) {
  const parts = classSummary(c, ctx);
  const armorProf = (parts[0]?.cls?.armor || []).map((a) => a.toLowerCase());
  const profFor = (cat) => armorProf.some((a) => a.includes(String(cat).toLowerCase()));
  let bestArmor = null, shield = null;
  const weapons = [];
  for (const it of c.inventory) {
    const rec = it.id ? ctx.equipment.get(it.id) : null;
    if (!rec) continue;
    it.kind = rec.kind;
    if (rec.kind === "armor") {
      if (rec.armor.category === "Shield") { if (profFor("shield") && !shield) shield = it; }
      else if (profFor(rec.armor.category) && (!bestArmor || (rec.armor.base || 0) > (ctx.equipment.get(bestArmor.id).armor.base || 0))) bestArmor = it;
    } else if (rec.kind === "weapon") weapons.push({ it, rec });
  }
  if (bestArmor) bestArmor.equipped = true;
  if (shield) shield.equipped = true;
  const melee = weapons.filter((w) => w.rec.weapon.range === "Melee").sort((a, b) => dieSize(b.rec) - dieSize(a.rec));
  const ranged = weapons.filter((w) => w.rec.weapon.range === "Ranged");
  const twoHanded = (w) => (w.rec.weapon.properties || []).some((p) => /two-handed/i.test(p));
  const chosen = [];
  if (melee[0]) chosen.push(melee[0]);
  if (ranged[0] && chosen.length < 2) chosen.push(ranged[0]);
  if (melee[1] && chosen.length < 2 && !shield && !twoHanded(melee[0])) chosen.push(melee[1]);
  for (const w of chosen.slice(0, 2)) w.it.equipped = true;
  void uid;
}
const dieSize = (rec) => Number(String(rec.weapon?.damage?.dice || "1d1").split("d")[1]) || 0;

// ------------------------------------------------------------------ the character

const RACE_SKILL_TRAITS = { "Keen Senses": "Perception", "Menacing": "Intimidation" };

export function buildCharacter(draft, ctx) {
  const c = newCharacter(draft.edition);
  c.name = draft.name.trim();
  c.player = draft.player.trim();
  c.alignment = draft.alignment || "";
  const race = ctx.races.get(draft.raceId);
  const sub = race?.subraces.find((s) => s.id === draft.subraceId);
  c.race = { id: draft.raceId, name: race?.name || "", subraceId: draft.subraceId || "", subraceName: sub?.name || "" };
  const bg = ctx.backgrounds.get(draft.backgroundId);
  c.background = bg ? { id: bg.id, name: bg.name, custom: false } : { id: "", name: draft.bgCustom.name, custom: true };
  Object.assign(c.abilities, draft.scores);
  c.bonuses = [...raceBonuses(draft, ctx), ...backgroundBonuses(draft, ctx)];

  const cls = ctx.classes.get(draft.classId);
  if (cls) {
    for (let i = 0; i < Math.max(1, Math.min(20, draft.startLevel)); i++) addLevel(c, cls.id, null);
    c.saveProfs = [...cls.saves];
    const subLv = (SUBCLASS_LEVEL[draft.edition] || SUBCLASS_LEVEL["2014"])[cls.id] || 99;
    if (draft.subclassId && draft.startLevel >= subLv) c.subclasses[cls.id] = draft.subclassId;
    for (const s of draft.classSkills) c.skills[s] = 1;
  }
  // background skills / tools / languages
  if (bg) {
    for (const s of bg.skills || []) c.skills[s] = Math.max(c.skills[s] || 0, 1);
    c.proficiencies.tools.push(...(bg.tools || []));
    if (bg.feat) c.feats.push({ id: bg.feat.id, name: bg.feat.name, src: `${bg.name} (background)` });
  } else {
    for (const s of draft.bgCustom.skills || []) c.skills[s] = Math.max(c.skills[s] || 0, 1);
    if (draft.bgCustom.tools) c.proficiencies.tools.push(...draft.bgCustom.tools.split(",").map((x) => x.trim()).filter(Boolean));
  }
  // race: fixed skills, picks, languages
  for (const t of race?.traits || []) if (RACE_SKILL_TRAITS[t.name] && draft.edition === "2014") c.skills[RACE_SKILL_TRAITS[t.name]] = Math.max(c.skills[RACE_SKILL_TRAITS[t.name]] || 0, 1);
  for (const s of draft.raceSkillPicks || []) c.skills[s] = Math.max(c.skills[s] || 0, 1);
  if (draft.raceToolPick) c.proficiencies.tools.push(draft.raceToolPick);
  c.proficiencies.languages.push(...(draft.raceLanguagePicks || []), ...(draft.bgLanguagePicks || []));
  for (const [traitName, pick] of Object.entries(draft.raceTraitPicks || {})) {
    if (pick) c.choices[`race-trait:${traitName}`] = [pick];
  }
  // spells
  if (cls) {
    c.spells.cantrips[cls.id] = [...draft.cantrips];
    if (cls.id === "wizard") { c.spells.book = [...draft.spellbook]; c.spells.prepared[cls.id] = [...draft.prepared]; }
    else if (draft.spellsKnown.length && c.edition === "2014" && ["bard", "ranger", "sorcerer", "warlock"].includes(cls.id)) c.spells.known[cls.id] = [...draft.spellsKnown];
    else c.spells.prepared[cls.id] = [...(draft.prepared.length ? draft.prepared : draft.spellsKnown)];
  }
  if (draft.raceSpellPick) {
    const key = cls?.id || "race";
    c.spells.cantrips[key] = [...new Set([...(c.spells.cantrips[key] || []), draft.raceSpellPick])];
  }
  Object.assign(c.details, draft.details);
  applyEquipment(c, ctx, draft);
  return c;
}

// Everything still missing before a draft can become a character (shown on the review step).
export function draftProblems(draft, ctx) {
  const out = [];
  if (!draft.name.trim()) out.push("Give your character a name.");
  if (!draft.raceId) out.push("Choose a race or species.");
  const race = ctx.races.get(draft.raceId);
  if (race?.subraces?.length && !draft.subraceId && draft.edition === "2014" && race.subraces.length && race.id !== "dragonborn") out.push(`Choose a ${race.name} subrace.`);
  if (race?.abilityChoices && (draft.raceAbilityPicks || []).length < race.abilityChoices.choose) out.push(`Choose ${race.abilityChoices.choose} ability scores for ${race.name}.`);
  if (!draft.classId) out.push("Choose a class.");
  const cls = ctx.classes.get(draft.classId);
  if (cls?.skills && draft.classSkills.length < cls.skills.choose) out.push(`Choose ${cls.skills.choose} class skills.`);
  if (draft.method === "pointbuy" && !pointBuyValid(draft.scores).ok) out.push("Point buy scores cost more than 27 points.");
  const bg = ctx.backgrounds.get(draft.backgroundId);
  if (!bg && !draft.bgCustom.name.trim() && !draft.backgroundId) out.push("Choose a background.");
  if (draft.edition === "2024" && bg && draft.bgAbility.mode === "2/1" && (!draft.bgAbility.plus2 || !draft.bgAbility.plus1)) out.push("Assign the background's +2 and +1 ability bonuses.");
  return out;
}

export { SKILLS };
