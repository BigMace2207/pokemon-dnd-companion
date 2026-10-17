// The D&D 5e character model and everything derived from it.
//
// A character is plain JSON (it lives in the player save's systemData.dnd5e
// and is mirrored to the server like the rest of the save). `derive()` turns it
// into the numbers a sheet shows; it never mutates the character, so the sheet
// can call it after every edit. `ctx` is the loaded rules data for the
// character's edition, as Maps: { classes, races, backgrounds, feats,
// equipment, spells? } (see dataIndex.js).

import {
  ABILITY_KEYS, SKILLS, SKILL_ABILITY, abilityMod, profBonus, averageHp, FULL_CASTER_SLOTS,
  PACT_MAGIC, CASTER_TYPES, casterLevelContribution, carryCapacity, encumbrance, coinWeight,
  asiLevels, SUBCLASS_LEVEL, levelForXp, XP_THRESHOLDS,
} from "./rules.js";
import { slug } from "./dataIndex.js";

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);

// ------------------------------------------------------------------ the model

export function newCharacter(edition = "2014") {
  const now = Date.now();
  return {
    v: 1, id: uid(), edition, name: "", player: "",
    race: { id: "", name: "", subraceId: "", subraceName: "" },
    background: { id: "", name: "", custom: false },
    alignment: "", xp: 0, milestone: false,
    levelLog: [],            // one entry per character level: { c: classId, hp: gained or null for "average" }
    subclasses: {},          // classId -> subclass id
    customClasses: {},       // classId -> { id, name, hitDie, saves, caster, casterAbility } for non-SRD classes
    abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    bonuses: [],             // { src, ab, n } permanent score bonuses: race, background, ASI, feats
    setScores: {},           // e.g. { STR: 19 } for items that set a score
    skills: {},              // skill name -> 1 proficient / 2 expertise
    saveProfs: [],
    proficiencies: { armor: [], weapons: [], tools: [], languages: [] },
    feats: [],               // { id, name, src }
    choices: {},             // class feature id -> [chosen option ids / strings]
    asiLog: [],              // { level, classId, kind: "asi"|"feat", detail }
    hp: { current: null, temp: 0, bonus: 0, override: null },
    hitDiceUsed: {},         // "d8" -> number spent
    deathSaves: { s: 0, f: 0 },
    conditions: [], exhaustion: 0, inspiration: false, concentration: "",
    effectsOn: [],           // ids of EFFECTS the player has switched on (rage, mage armor, ...)
    acBonus: 0, acOverride: null, speedBonus: 0, speedOverride: null, initBonus: 0,
    spells: { cantrips: {}, known: {}, prepared: {}, book: [] },
    slotsUsed: {}, pactUsed: 0,
    inventory: [], currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
    resourcesUsed: {}, customResources: [],
    attacks: [],             // hand-written extra attacks { id, name, bonus, damage, type, notes }
    details: { age: "", height: "", weight: "", eyes: "", skin: "", hair: "", traits: "", ideals: "", bonds: "", flaws: "", backstory: "", allies: "", appearance: "", notes: "" },
    journal: [],
    portrait: "",
    created: now, updated: now,
  };
}

export const totalLevel = (c) => c.levelLog.length;
export const classLevel = (c, id) => c.levelLog.filter((l) => l.c === id).length;

// Distinct classes in the order they were first taken.
export function classIds(c) {
  const seen = [];
  for (const l of c.levelLog) if (!seen.includes(l.c)) seen.push(l.c);
  return seen;
}

function classData(c, ctx, id) {
  const real = ctx.classes?.get(id);
  if (real) return real;
  const cc = c.customClasses?.[id];
  if (!cc) return null;
  return {
    id, name: cc.name, hitDie: cc.hitDie || 8, saves: cc.saves || [], armor: [], weapons: [], tools: [],
    levels: [], features: {}, subclasses: [], custom: true, customCaster: cc.caster || "none", customAbility: cc.casterAbility,
    spellcasting: cc.caster && cc.caster !== "none" ? { ability: cc.casterAbility || "INT", level: 1, info: [] } : null,
    multiclass: { requirements: [], proficiencies: [] },
  };
}

export function classSummary(c, ctx) {
  return classIds(c).map((id) => {
    const cls = classData(c, ctx, id);
    const level = classLevel(c, id);
    const subId = c.subclasses?.[id] || "";
    const sub = cls?.subclasses?.find((s) => s.id === subId) || null;
    return { id, name: cls?.name || id, level, hitDie: cls?.hitDie || 8, cls, subclassId: subId, subclassName: sub?.name || (subId ? c.subclassNames?.[id] || subId : ""), sub };
  });
}

export function classLabel(c, ctx) {
  const parts = classSummary(c, ctx);
  if (!parts.length) return "No class yet";
  return parts.map((p) => `${p.name} ${p.level}`).join(" / ");
}

// ------------------------------------------------------------------ ability scores

export function abilityScores(c) {
  const out = {};
  for (const k of ABILITY_KEYS) {
    const base = Number(c.abilities?.[k]) || 10;
    const bonus = (c.bonuses || []).filter((b) => b.ab === k).reduce((s, b) => s + (Number(b.n) || 0), 0);
    let score = base + bonus;
    const set = c.setScores?.[k];
    if (set != null && set > score) score = set;
    score = Math.max(1, Math.min(30, score));
    out[k] = { base, bonus, score, mod: abilityMod(score) };
  }
  return out;
}

// ------------------------------------------------------------------ flags (what the character has)

// Collects slugs of everything a character "has" (class/subclass features unlocked by level,
// race traits, feats, chosen options) so effect rules can ask `flags.has("unarmored-defense")`.
export function featureFlags(c, ctx) {
  const flags = new Set();
  const add = (s) => { if (s) flags.add(slug(s)); };
  for (const p of classSummary(c, ctx)) {
    flags.add(`class:${p.id}`);
    flags.add(`class:${p.id}:${p.level}`);
    const cls = p.cls;
    if (cls?.levels) {
      for (const lv of cls.levels) {
        if (lv.level > p.level) continue;
        for (const fid of lv.features || []) {
          flags.add(fid);
          add(cls.features?.[fid]?.name);
        }
      }
    }
    if (p.sub) {
      flags.add(`sub:${p.sub.id}`);
      for (const f of p.sub.features || []) if ((f.level || 0) <= p.level) add(f.name);
    }
  }
  const race = ctx.races?.get(c.race?.id);
  if (race) {
    flags.add(`race:${race.id}`);
    for (const t of race.traits || []) add(t.name);
    const sub = race.subraces?.find((s) => s.id === c.race.subraceId);
    if (sub) { flags.add(`subrace:${sub.id}`); for (const t of sub.traits || []) add(t.name); }
  }
  for (const f of c.feats || []) { flags.add(f.id); add(f.name); }
  for (const [fid, picks] of Object.entries(c.choices || {})) {
    for (const p of picks) {
      flags.add(String(p));
      add(String(p));
      const m = /fighting-style-(.+)$/.exec(String(p));
      if (m) flags.add(`fs:${m[1]}`);
    }
  }
  for (const id of c.effectsOn || []) flags.add(`effect:${id}`);
  // Fighting-style feats (2024) and 2014 style ids both reduce to fs:<name>
  for (const f of c.feats || []) {
    if (["archery", "defense", "dueling", "great-weapon-fighting", "protection", "two-weapon-fighting", "two-weapon-fighting"].includes(f.id)) flags.add(`fs:${f.id}`);
  }
  return flags;
}

// ------------------------------------------------------------------ toggleable effects

// Things a player can switch on that change numbers (self-buffs and rages). Each
// entry says what it does to AC; attack/damage effects are handled in attacks().
export const EFFECTS = [
  { id: "rage", label: "Rage", desc: "Bonus to melee damage with Strength; resistance to bludgeoning, piercing and slashing.", classId: "barbarian" },
  { id: "mage-armor", label: "Mage Armor", desc: "AC becomes 13 + Dexterity modifier while unarmored.", acBase: 13 },
  { id: "barkskin", label: "Barkskin", desc: "AC can't be lower than 16.", acMin: 16 },
  { id: "shield-spell", label: "Shield (spell)", desc: "+5 AC until the start of your next turn.", acBonus: 5 },
  { id: "shield-of-faith", label: "Shield of Faith", desc: "+2 AC (concentration).", acBonus: 2 },
  { id: "haste", label: "Haste", desc: "+2 AC, doubled speed, extra action.", acBonus: 2 },
  { id: "bless", label: "Bless", desc: "Add 1d4 to attack rolls and saving throws.", dice: "1d4" },
  { id: "bane", label: "Bane", desc: "Subtract 1d4 from attack rolls and saving throws." },
  { id: "hunters-mark", label: "Hunter's Mark", desc: "+1d6 damage against the marked target.", dmgDice: "1d6" },
  { id: "hex", label: "Hex", desc: "+1d6 necrotic damage against the cursed target.", dmgDice: "1d6" },
];

// ------------------------------------------------------------------ proficiency lists

export function proficiencyLists(c, ctx) {
  const parts = classSummary(c, ctx);
  const armor = new Set(c.proficiencies?.armor || []);
  const weapons = new Set(c.proficiencies?.weapons || []);
  const tools = new Set(c.proficiencies?.tools || []);
  const langs = new Set(c.proficiencies?.languages || []);
  parts.forEach((p, i) => {
    if (!p.cls) return;
    if (i === 0) {
      p.cls.armor.forEach((x) => armor.add(x));
      p.cls.weapons.forEach((x) => weapons.add(x));
      p.cls.tools.forEach((x) => tools.add(x));
    } else {
      // multiclassing grants only a subset (the class's multiclass proficiencies)
      (p.cls.multiclass?.proficiencies || []).forEach((x) => {
        if (/armor|shield/i.test(x)) armor.add(x);
        else if (/weapon|sword|bow|crossbow|dagger|club|mace|staff|dart|sling|spear|hammer|axe|rapier|scimitar/i.test(x)) weapons.add(x);
        else tools.add(x);
      });
    }
  });
  const race = ctx.races?.get(c.race?.id);
  for (const t of race?.traits || []) for (const p of t.proficiencies || []) classify(p);
  for (const p of race?.proficiencies || []) classify(p);
  const sub = race?.subraces?.find((s) => s.id === c.race?.subraceId);
  for (const p of sub?.proficiencies || []) classify(p);
  for (const l of race?.languages || []) langs.add(l);
  for (const l of sub?.languages || []) langs.add(l);
  function classify(p) {
    const name = String(p).replace(/^(Skill|Tool|Weapon|Armor):\s*/i, "");
    if (/armor|shield/i.test(name)) armor.add(name);
    else if (/weapon|axe|hammer|sword|bow/i.test(name)) weapons.add(name);
    else if (/^skill:/i.test(p)) { /* skills are stored in character.skills */ }
    else tools.add(name);
  }
  return { armor: [...armor], weapons: [...weapons], tools: [...tools], languages: [...langs] };
}

// "Crossbow, light" and "Light Crossbows" are the same weapon: compare as sets of singular words.
const wordSet = (t) => new Set(String(t).toLowerCase().replace(/[,()]/g, " ").split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, "")));
const sameWords = (a, b) => { const x = wordSet(a), y = wordSet(b); return x.size === y.size && [...x].every((w) => y.has(w)); };

function weaponProficient(lists, rec) {
  const w = rec.weapon;
  if (!w) return false;
  const category = `${w.category || ""} weapon`;
  return lists.weapons.some((p) => sameWords(p, category) || sameWords(p, rec.name));
}

// ------------------------------------------------------------------ item lookup

export function itemRecord(item, ctx) {
  const rec = item.id ? ctx.equipment?.get(item.id) : null;
  const custom = item.custom || {};
  return { ...(rec || {}), ...custom, weapon: custom.weapon || rec?.weapon, armor: custom.armor || rec?.armor, kind: custom.kind || rec?.kind || "gear" };
}

export function newItem(rec, qty = 1) {
  return {
    uid: uid(), id: rec?.id || "", name: rec?.name || "Item", qty, weight: rec?.weight ?? null,
    equipped: false, attuned: false, bonus: 0, notes: "", cost: rec?.cost || null,
    kind: rec?.kind || "gear",
  };
}

// Put an SRD equipment record (or a magic item) into a character's inventory, stacking plain gear.
export function addItemRecord(c, rec, { magic = false } = {}) {
  if (magic) {
    const it = newItem({ name: rec.name, kind: "gear" }, 1);
    Object.assign(it, { magic: true, rarity: rec.rarity, magicId: rec.id, custom: { kind: "gear", desc: rec.desc } });
    c.inventory.push(it);
    return it;
  }
  const have = rec.kind !== "weapon" && rec.kind !== "armor" ? c.inventory.find((x) => x.id === rec.id && !x.equipped) : null;
  if (have) { have.qty += 1; return have; }
  const it = newItem(rec, 1);
  c.inventory.push(it);
  return it;
}

// ------------------------------------------------------------------ armor class

function dexCapFor(armor) {
  if (!armor || armor.dexBonus === false) return 0;
  if (armor.maxBonus != null && armor.maxBonus > 0) return armor.maxBonus;
  return armor.category === "Medium" ? 2 : 99;
}

export function computeAc(c, ctx, scores, flags, parts) {
  const dex = scores.DEX.mod, con = scores.CON.mod, wis = scores.WIS.mod;
  const equipped = (c.inventory || []).filter((i) => i.equipped);
  let bodyArmor = null, shield = null;
  for (const i of equipped) {
    const rec = itemRecord(i, ctx);
    if (rec.kind !== "armor" || !rec.armor) continue;
    if (rec.armor.category === "Shield" || rec.armor.shield) shield = { i, rec };
    else if (!bodyArmor) bodyArmor = { i, rec };
  }
  if (c.acOverride != null && c.acOverride !== "") {
    return { value: Number(c.acOverride), breakdown: ["Manual override"], armor: bodyArmor, shield };
  }
  const candidates = [];
  const sBonus = shield ? (shield.rec.armor.base || 2) + (Number(shield.i.bonus) || 0) : 0;
  const shieldTxt = shield ? ` + ${sBonus} shield` : "";
  const isBarb = parts.some((p) => p.id === "barbarian");
  const isMonk = parts.some((p) => p.id === "monk");
  const mageArmor = flags.has("effect:mage-armor");
  if (bodyArmor) {
    const a = bodyArmor.rec.armor;
    const dexPart = Math.min(dex, dexCapFor(a));
    const value = (a.base || 10) + dexPart + (Number(bodyArmor.i.bonus) || 0);
    candidates.push({ value: value + sBonus, text: `${bodyArmor.i.name} ${a.base}${a.dexBonus === false ? "" : ` + Dex${dexPart !== dex ? ` (max ${dexPart})` : ""}`}${shieldTxt}` });
  } else {
    candidates.push({ value: 10 + dex + sBonus, text: `10 + Dex${shieldTxt}` });
    if (mageArmor) candidates.push({ value: 13 + dex + sBonus, text: `Mage Armor 13 + Dex${shieldTxt}` });
    if (isBarb && flags.has("unarmored-defense")) candidates.push({ value: 10 + dex + con + sBonus, text: `Unarmored Defense 10 + Dex + Con${shieldTxt}` });
    if (isMonk && flags.has("unarmored-defense") && !shield) candidates.push({ value: 10 + dex + wis, text: "Unarmored Defense 10 + Dex + Wis" });
    if (flags.has("draconic-resilience")) candidates.push({ value: 13 + dex + sBonus, text: `Draconic Resilience 13 + Dex${shieldTxt}` });
  }
  candidates.sort((a, b) => b.value - a.value);
  let best = candidates[0];
  let value = best.value;
  const breakdown = [best.text];
  if (bodyArmor && flags.has("fs:defense")) { value += 1; breakdown.push("+1 Defense fighting style"); }
  for (const e of [{ id: "shield-spell", n: 5 }, { id: "shield-of-faith", n: 2 }, { id: "haste", n: 2 }]) {
    if (flags.has(`effect:${e.id}`)) { value += e.n; breakdown.push(`+${e.n} ${e.id.replace(/-/g, " ")}`); }
  }
  if (flags.has("effect:barkskin") && value < 16) { value = 16; breakdown.push("Barkskin (minimum 16)"); }
  if (c.acBonus) { value += Number(c.acBonus); breakdown.push(`${c.acBonus > 0 ? "+" : ""}${c.acBonus} misc`); }
  return { value, breakdown, armor: bodyArmor, shield };
}

// ------------------------------------------------------------------ hit points

export function hpFor(c, ctx, conMod, flags) {
  const parts = classSummary(c, ctx);
  const hdOf = Object.fromEntries(parts.map((p) => [p.id, p.hitDie]));
  const level = totalLevel(c);
  let base = 0;
  c.levelLog.forEach((l, i) => {
    const die = hdOf[l.c] || 8;
    if (i === 0) base += l.hp != null ? l.hp : die;
    else base += l.hp != null ? l.hp : averageHp(die);
  });
  let perLevel = conMod;
  if (flags.has("dwarven-toughness")) perLevel += 1;
  if (flags.has("tough") || (c.feats || []).some((f) => f.id === "tough")) perLevel += 2;
  const sorcLevel = classLevel(c, "sorcerer");
  const draconic = flags.has("draconic-resilience") ? sorcLevel : 0;
  let max = base + perLevel * level + draconic + (Number(c.hp?.bonus) || 0);
  if (c.hp?.override != null && c.hp.override !== "") max = Number(c.hp.override);
  return Math.max(level ? 1 : 0, max);
}

// ------------------------------------------------------------------ spellcasting

export function casterTypeOf(part) {
  if (part.custom || part.cls?.custom) return part.cls.customCaster || "none";
  return CASTER_TYPES[part.id] || (part.cls?.spellcasting ? "third" : "none");
}

export function spellSlots(c, ctx, parts) {
  const casters = parts.map((p) => ({ p, type: casterTypeOf(p) })).filter((x) => x.type !== "none");
  const nonPact = casters.filter((x) => x.type !== "pact");
  const pactPart = casters.find((x) => x.type === "pact");
  let slots = Array(9).fill(0);
  let casterLevel = 0;
  if (nonPact.length === 1 && nonPact[0].type !== "third" && nonPact[0].p.cls?.levels?.length) {
    // single caster: use the class's own table (handles half casters rounding correctly)
    const info = nonPact[0].p.cls.levels.find((l) => l.level === nonPact[0].p.level)?.sc;
    if (info?.slots) slots = [...info.slots];
    casterLevel = casterLevelContribution(nonPact[0].type, nonPact[0].p.level);
  } else if (nonPact.length) {
    casterLevel = nonPact.reduce((s, x) => s + casterLevelContribution(x.type, x.p.level), 0);
    if (casterLevel > 0) slots = [...FULL_CASTER_SLOTS[Math.min(20, casterLevel) - 1]];
  }
  const out = slots.map((max, i) => ({ level: i + 1, max, used: Math.min(max, Number(c.slotsUsed?.[i + 1]) || 0) }));
  let pact = null;
  if (pactPart) {
    const lvTable = pactPart.p.cls?.levels?.find((l) => l.level === pactPart.p.level)?.sc?.slots;
    const row = PACT_MAGIC[Math.min(20, pactPart.p.level) - 1];
    let count = row.count, level = row.level;
    if (lvTable) { const idx = lvTable.findIndex((n) => n > 0); if (idx >= 0) { level = idx + 1; count = lvTable[idx]; } }
    pact = { count, level, used: Math.min(count, Number(c.pactUsed) || 0) };
  }
  return { slots: out, pact, casterLevel };
}

export function spellcastingInfo(c, ctx, scores, pb, parts) {
  const out = [];
  for (const p of parts) {
    const sc = p.cls?.spellcasting;
    const type = casterTypeOf(p);
    if (!sc && type === "none") continue;
    const abilityKey = (sc?.ability || p.cls?.customAbility || "INT");
    const mod = scores[abilityKey]?.mod ?? 0;
    const lvInfo = p.cls?.levels?.find((l) => l.level === p.level)?.sc || null;
    const startsAt = sc?.level || 1;
    if (!p.cls?.custom && p.level < startsAt && type !== "third") continue;
    const kind = ["bard", "ranger", "sorcerer", "warlock"].includes(p.id) && c.edition === "2014" ? "known" : (p.id === "wizard" ? "book" : "prepared");
    let preparedMax = null;
    if (lvInfo?.prepared != null) preparedMax = lvInfo.prepared;
    else if (kind === "prepared" || kind === "book") {
      if (p.id === "paladin") preparedMax = Math.max(1, mod + Math.floor(p.level / 2));
      else preparedMax = Math.max(1, mod + p.level);
    }
    out.push({
      classId: p.id, className: p.name, ability: abilityKey, mod, dc: 8 + pb + mod, attack: pb + mod,
      kind, cantrips: lvInfo?.cantrips ?? null, known: lvInfo?.known ?? null, preparedMax, type, classLevel: p.level,
    });
  }
  return out;
}

// ------------------------------------------------------------------ attacks

export function weaponAttack(c, ctx, d, item, rec, lists, flags) {
  const w = rec.weapon;
  const props = (w.properties || []).map((p) => p.toLowerCase());
  const ranged = w.range === "Ranged";
  const finesse = props.includes("finesse");
  const heavy = props.includes("heavy");
  const twoHandedOnly = props.includes("two-handed");
  const versatile = props.includes("versatile") && w.versatile;
  const monk = d.parts.some((p) => p.id === "monk");
  const monkWeapon = monk && ((w.category === "Simple" && !ranged && !twoHandedOnly && !heavy) || rec.name === "Shortsword");
  const strMod = d.scores.STR.mod, dexMod = d.scores.DEX.mod;
  let key = ranged ? "DEX" : (finesse || monkWeapon) ? (dexMod > strMod ? "DEX" : "STR") : "STR";
  const mod = d.scores[key].mod;
  const prof = weaponProficient(lists, rec);
  const magic = Number(item.bonus) || 0;
  let toHit = mod + (prof ? d.pb : 0) + magic;
  const notes = [];
  if (flags.has("fs:archery") && ranged) { toHit += 2; notes.push("Archery +2"); }
  let dice = w.damage?.dice || "1";
  if (monkWeapon) {
    const art = monkDie(d.parts);
    if (art && Number(art.split("d")[1]) > Number(String(dice).split("d")[1] || 0)) dice = art;
  }
  let dmgMod = mod + magic;
  const equippedWeapons = (c.inventory || []).filter((i) => i.equipped && itemRecord(i, ctx).weapon);
  const offHandFree = equippedWeapons.length === 1;
  if (flags.has("fs:dueling") && !ranged && !twoHandedOnly && !heavy && offHandFree) {
    dmgMod += 2; notes.push("Dueling +2");
  }
  if (flags.has("effect:rage") && key === "STR" && !ranged) {
    const rage = rageDamage(d.parts);
    if (rage) { dmgMod += rage; notes.push(`Rage +${rage}`); }
  }
  const gwf = flags.has("fs:great-weapon-fighting") && !ranged && (twoHandedOnly || versatile);
  const dmgType = w.damage?.type || "";
  const out = {
    id: item.uid, name: item.name, ability: key, toHit, prof, kind: "weapon",
    damage: dice, damageMod: dmgMod, damageType: dmgType, notes, properties: w.properties || [], ranged,
    range: ranged ? `${w.reach || ""}/${w.long || ""}`.replace(/^\/|\/$/g, "") : (props.includes("reach") ? "10 ft." : "5 ft."),
    gwf,
  };
  if (versatile) out.versatile = w.versatile;
  if (w.throw) out.thrown = `${w.throw.normal}/${w.throw.long}`;
  if (rec.weapon.mastery) out.mastery = rec.weapon.mastery;
  return out;
}

function monkDie(parts) {
  const m = parts.find((p) => p.id === "monk");
  if (!m?.cls) return null;
  const lv = m.cls.levels.find((l) => l.level === m.level);
  const cs = lv?.cs || {};
  if (cs.martial_arts?.dice_value) return `${cs.martial_arts.dice_count || 1}d${cs.martial_arts.dice_value}`;
  if (cs.martial_arts_die) return `1d${cs.martial_arts_die}`;
  return "1d4";
}

function rageDamage(parts) {
  const b = parts.find((p) => p.id === "barbarian");
  const lv = b?.cls?.levels.find((l) => l.level === b.level);
  return lv?.cs?.rage_damage_bonus ?? 0;
}

export function allAttacks(c, ctx, d, lists, flags) {
  const out = [];
  for (const item of c.inventory || []) {
    if (!item.equipped) continue;
    const rec = itemRecord(item, ctx);
    if (rec.kind === "weapon" && rec.weapon) out.push(weaponAttack(c, ctx, d, item, rec, lists, flags));
  }
  // Unarmed strike
  const monk = d.parts.some((p) => p.id === "monk");
  const key = monk && d.scores.DEX.mod > d.scores.STR.mod ? "DEX" : "STR";
  const m = d.scores[key].mod;
  const art = monk ? monkDie(d.parts) : null;
  let uMod = m;
  const notes = [];
  if (flags.has("effect:rage") && key === "STR") { const r = rageDamage(d.parts); if (r) { uMod += r; notes.push(`Rage +${r}`); } }
  out.push({ id: "unarmed", name: "Unarmed Strike", ability: key, toHit: m + d.pb, prof: true, kind: "unarmed", damage: art || "1", damageMod: art ? uMod : (flags.has("effect:rage") ? uMod : m), damageType: "Bludgeoning", notes, properties: [], ranged: false, range: "5 ft." });
  for (const a of c.attacks || []) {
    out.push({ id: a.id, name: a.name, kind: "custom", ability: a.ability || "", toHit: Number(a.bonus) || 0, damage: a.damage || "", damageMod: 0, damageType: a.type || "", notes: a.notes ? [a.notes] : [], properties: [], custom: true });
  }
  return out;
}

// ------------------------------------------------------------------ resources

export function classResources(c, ctx, d) {
  const out = [];
  const csFor = (p) => p.cls?.levels?.find((l) => l.level === p.level)?.cs || {};
  const ed = c.edition;
  for (const p of d.parts) {
    const cs = csFor(p);
    const lvl = p.level;
    const chaMod = d.scores.CHA.mod;
    switch (p.id) {
      case "barbarian": {
        const raw = cs.rage_count;
        out.push({ key: "rage", label: "Rage", max: raw >= 99 ? null : raw, recharge: "long", note: `+${cs.rage_damage_bonus ?? 2} damage`, src: "Barbarian" });
        break;
      }
      case "bard":
        out.push({ key: "bardic-inspiration", label: "Bardic Inspiration", max: Math.max(1, chaMod), recharge: lvl >= 5 ? "short" : "long", note: `d${cs.bardic_inspiration_die || 6}`, src: "Bard" });
        break;
      case "cleric": {
        const n = cs.channel_divinity_charges ?? (lvl >= 18 ? 3 : lvl >= 6 ? 2 : lvl >= 2 ? 1 : 0);
        if (n) out.push({ key: "channel-divinity-cleric", label: "Channel Divinity", max: n, recharge: "short", src: "Cleric" });
        break;
      }
      case "druid": {
        const n = cs.wild_shape_uses ?? (lvl >= 2 ? 2 : 0);
        if (n) out.push({ key: "wild-shape", label: "Wild Shape", max: n, recharge: ed === "2014" ? "short" : "long", src: "Druid" });
        break;
      }
      case "fighter": {
        const sw = ed === "2014" ? 1 : (cs.second_wind_uses ?? 2);
        out.push({ key: "second-wind", label: "Second Wind", max: sw, recharge: ed === "2014" ? "short" : "long", src: "Fighter" });
        if (lvl >= 2) out.push({ key: "action-surge", label: "Action Surge", max: ed === "2014" ? (cs.action_surges ?? 1) : (lvl >= 17 ? 2 : 1), recharge: "short", src: "Fighter" });
        const ind = ed === "2014" ? (cs.indomitable_uses ?? 0) : (lvl >= 17 ? 3 : lvl >= 13 ? 2 : lvl >= 9 ? 1 : 0);
        if (ind) out.push({ key: "indomitable", label: "Indomitable", max: ind, recharge: "long", src: "Fighter" });
        break;
      }
      case "monk": {
        const ki = cs.ki_points ?? cs.focus_points ?? (lvl >= 2 ? lvl : 0);
        if (ki) out.push({ key: "ki", label: ed === "2014" ? "Ki Points" : "Focus Points", max: ki, recharge: "short", src: "Monk" });
        break;
      }
      case "paladin": {
        out.push({ key: "lay-on-hands", label: "Lay on Hands (HP pool)", max: lvl * 5, recharge: "long", src: "Paladin", pool: true });
        if (ed === "2014") out.push({ key: "divine-sense", label: "Divine Sense", max: Math.max(1, 1 + chaMod), recharge: "long", src: "Paladin" });
        const n = cs.channel_divinity_charges ?? (lvl >= 3 ? 1 : 0);
        if (n) out.push({ key: "channel-divinity-paladin", label: "Channel Divinity", max: n, recharge: "short", src: "Paladin" });
        break;
      }
      case "ranger":
        if (ed === "2024" && lvl >= 1) out.push({ key: "favored-enemy", label: "Favored Enemy (free Hunter's Mark)", max: cs.favored_enemies ?? 2, recharge: "long", src: "Ranger" });
        break;
      case "sorcerer": {
        const sp = cs.sorcery_points ?? (lvl >= 2 ? lvl : 0);
        if (sp) out.push({ key: "sorcery-points", label: "Sorcery Points", max: sp, recharge: "long", src: "Sorcerer", pool: true });
        break;
      }
      case "warlock":
        for (const n of [6, 7, 8, 9]) if (cs[`mystic_arcanum_level_${n}`] > 0) out.push({ key: `mystic-arcanum-${n}`, label: `Mystic Arcanum (${n}th)`, max: 1, recharge: "long", src: "Warlock" });
        break;
      case "wizard":
        out.push({ key: "arcane-recovery", label: "Arcane Recovery", max: 1, recharge: "long", note: `slots up to ${Math.ceil(lvl / 2)} combined levels`, src: "Wizard" });
        break;
      default:
    }
  }
  // Racial and feat resources, keyed by trait name
  const race = ctx.races?.get(c.race?.id);
  const traitNames = new Set([...(race?.traits || []), ...(race?.subraces?.find((s) => s.id === c.race.subraceId)?.traits || [])].map((t) => t.name));
  const pb = d.pb;
  if (traitNames.has("Breath Weapon")) out.push({ key: "breath-weapon", label: "Breath Weapon", max: ed === "2014" ? 1 : pb, recharge: ed === "2014" ? "short" : "long", src: "Race" });
  if (traitNames.has("Relentless Endurance")) out.push({ key: "relentless-endurance", label: "Relentless Endurance", max: 1, recharge: "long", src: "Race" });
  if (traitNames.has("Infernal Legacy")) out.push({ key: "infernal-legacy", label: "Infernal Legacy spells", max: 1, recharge: "long", src: "Race" });
  if (traitNames.has("Healing Hands")) out.push({ key: "healing-hands", label: "Healing Hands", max: 1, recharge: "long", src: "Race" });
  if (traitNames.has("Adrenaline Rush")) out.push({ key: "adrenaline-rush", label: "Adrenaline Rush", max: pb, recharge: "short", src: "Race" });
  for (const r of c.customResources || []) out.push({ key: `custom:${r.id}`, label: r.name, max: Number(r.max) || 0, recharge: r.recharge || "long", src: "Custom", custom: true, id: r.id });
  return out.map((r) => ({ ...r, used: r.max == null ? 0 : Math.min(r.max, Number(c.resourcesUsed?.[r.key]) || 0) }));
}

// ------------------------------------------------------------------ features

export function featureList(c, ctx) {
  const out = [];
  for (const p of classSummary(c, ctx)) {
    if (!p.cls) continue;
    const seen = new Set();
    for (const lv of p.cls.levels || []) {
      if (lv.level > p.level) continue;
      for (const fid of lv.features || []) {
        const f = p.cls.features?.[fid];
        if (!f || seen.has(fid)) continue;
        seen.add(fid);
        out.push({ kind: "class", source: `${p.name} ${f.level ?? lv.level}`, name: f.name, level: f.level ?? lv.level, desc: f.desc || [], id: fid, options: f.options, choose: f.choose, expertise: f.expertise, pick: f.pick, classId: p.id });
      }
    }
    if (p.sub) {
      for (const f of p.sub.features || []) {
        if ((f.level || 0) > p.level) continue;
        out.push({ kind: "subclass", source: `${p.sub.name} ${f.level}`, name: f.name, level: f.level, desc: f.desc || [], options: f.options, classId: p.id, id: `sub:${p.sub.id}:${slug(f.name)}` });
      }
    }
  }
  const race = ctx.races?.get(c.race?.id);
  if (race) {
    for (const t of race.traits || []) out.push({ kind: "race", source: race.name, name: t.name, level: 0, desc: t.desc || [], id: `race:${slug(t.name)}`, options: t.options });
    const sub = race.subraces?.find((s) => s.id === c.race.subraceId);
    for (const t of sub?.traits || []) out.push({ kind: "race", source: sub.name, name: t.name, level: 0, desc: t.desc || [], id: `race:${slug(t.name)}` });
  }
  const bg = ctx.backgrounds?.get(c.background?.id);
  if (bg?.feature?.name) out.push({ kind: "background", source: bg.name, name: bg.feature.name, level: 0, desc: bg.feature.desc || [], id: `bg:${slug(bg.feature.name)}` });
  for (const f of c.feats || []) {
    const rec = ctx.feats?.get(f.id);
    out.push({ kind: "feat", source: f.src || "Feat", name: f.name, level: 0, desc: rec?.desc || [], id: `feat:${f.id}` });
  }
  return out;
}

// ------------------------------------------------------------------ the big one

export function derive(c, ctx) {
  const level = totalLevel(c);
  const pb = profBonus(Math.max(1, level));
  const scores = abilityScores(c);
  const parts = classSummary(c, ctx);
  const flags = featureFlags(c, ctx);
  const lists = proficiencyLists(c, ctx);
  const d = { level, pb, scores, parts, flags, lists };
  const dexMod = scores.DEX.mod;

  // saving throws
  d.saves = {};
  const saveProfs = new Set([...(c.saveProfs || []), ...(c.extraSaveProfs || [])]);
  const paladin = parts.find((p) => p.id === "paladin");
  const aura = paladin && paladin.level >= 6 ? Math.max(1, scores.CHA.mod) : 0;
  for (const k of ABILITY_KEYS) {
    const proficient = saveProfs.has(k);
    d.saves[k] = { mod: scores[k].mod + (proficient ? pb : 0) + aura, proficient, aura };
  }

  // skills
  const joat = flags.has("jack-of-all-trades");
  const remarkable = flags.has("remarkable-athlete");
  const reliable = flags.has("reliable-talent");
  const expMod = c.edition === "2024" && (flags.has("alert")) ? pb : 0;
  d.skills = {};
  for (const s of SKILLS) {
    const lvl = Number(c.skills?.[s.name]) || 0;
    const abMod = scores[s.ability].mod;
    let bonus = lvl === 2 ? pb * 2 : lvl === 1 ? pb : 0;
    let note = "";
    if (lvl === 0 && joat) { bonus = Math.floor(pb / 2); note = "Jack of All Trades"; }
    else if (lvl === 0 && remarkable && ["STR", "DEX", "CON"].includes(s.ability)) { bonus = Math.ceil(pb / 2); note = "Remarkable Athlete"; }
    const mod = abMod + bonus;
    d.skills[s.name] = { ability: s.ability, level: lvl, mod, passive: 10 + mod, note, reliable: reliable && lvl >= 1 };
  }

  // initiative
  d.initiative = dexMod + (Number(c.initBonus) || 0) + (joat ? Math.floor(pb / 2) : 0) + (flags.has("alert") ? (c.edition === "2024" ? pb : 5) : 0);

  // AC, HP, speed
  d.ac = computeAc(c, ctx, scores, flags, parts);
  d.hpMax = hpFor(c, ctx, scores.CON.mod, flags);
  const cur = c.hp?.current;
  d.hp = { max: d.hpMax, current: cur == null ? d.hpMax : Math.min(cur, d.hpMax), temp: Number(c.hp?.temp) || 0 };
  const race = ctx.races?.get(c.race?.id);
  let speed = race?.speed ?? 30;
  const armorRec = d.ac.armor?.rec?.armor;
  const heavyArmor = armorRec?.category === "Heavy";
  const unarmored = !d.ac.armor;
  for (const p of parts) {
    const lv = p.cls?.levels?.find((l) => l.level === p.level);
    if (p.id === "barbarian" && flags.has("fast-movement") && !heavyArmor) speed += 10;
    if (p.id === "monk" && unarmored && !d.ac.shield) speed += lv?.cs?.unarmored_movement ?? lv?.cs?.unarmored_movement_bonus ?? 0;
  }
  if (armorRec?.strMin && scores.STR.score < armorRec.strMin) speed -= 10;
  speed += Number(c.speedBonus) || 0;
  const ex = Number(c.exhaustion) || 0;
  if (c.edition === "2014") { if (ex >= 5) speed = 0; else if (ex >= 2) speed = Math.floor(speed / 2); }
  else speed = Math.max(0, speed - 5 * ex);
  if (c.speedOverride != null && c.speedOverride !== "") speed = Number(c.speedOverride);
  d.speed = Math.max(0, speed);
  d.size = race?.size || "Medium";

  // hit dice
  const pool = {};
  for (const p of parts) pool[p.hitDie] = (pool[p.hitDie] || 0) + p.level;
  d.hitDice = Object.entries(pool).map(([die, total]) => ({ die: Number(die), label: `d${die}`, total, used: Math.min(total, Number(c.hitDiceUsed?.[`d${die}`]) || 0) })).sort((a, b) => b.die - a.die);

  // spellcasting
  const sl = spellSlots(c, ctx, parts);
  d.slots = sl.slots; d.pact = sl.pact; d.casterLevel = sl.casterLevel;
  d.casting = spellcastingInfo(c, ctx, scores, pb, parts);

  // attacks, resources, features
  d.attacks = allAttacks(c, ctx, d, lists, flags);
  d.resources = classResources(c, ctx, d);
  d.features = featureList(c, ctx);

  // load
  const itemWeight = (c.inventory || []).reduce((s, i) => s + (Number(i.weight) || 0) * (Number(i.qty) || 1), 0);
  d.weight = itemWeight + coinWeight(c.currency);
  d.capacity = carryCapacity(scores.STR.score);
  d.encumbrance = encumbrance(d.weight, scores.STR.score);

  // senses
  d.senses = senses(c, ctx, race);

  // passives
  d.passive = { perception: d.skills.Perception.passive, investigation: d.skills.Investigation.passive, insight: d.skills.Insight.passive };

  // XP
  d.xpLevel = levelForXp(Number(c.xp) || 0);
  d.xpNext = level >= 20 ? null : XP_THRESHOLDS[level];
  d.canLevelByXp = !c.milestone && d.xpLevel > level;

  // concentration save DC helper + warnings
  d.warnings = warningsFor(c, ctx, d);
  d.attunedCount = (c.inventory || []).filter((i) => i.attuned).length;
  d.resistances = resistances(c, ctx, race, flags);
  return d;
}

function senses(c, ctx, race) {
  const out = [];
  const sub = race?.subraces?.find((s) => s.id === c.race?.subraceId);
  const traits = [...(race?.traits || []), ...(sub?.traits || [])];
  let best = 0;
  for (const t of traits) {
    if (!/darkvision/i.test(t.name)) continue;
    const m = /(\d+)\s*(?:feet|ft)/i.exec(`${t.name} ${(t.desc || []).join(" ")}`);
    best = Math.max(best, m ? Number(m[1]) : 60);
  }
  if (best) out.push(`Darkvision ${best} ft.`);
  return out;
}

const RESISTANCE_TRAITS = {
  "Dwarven Resilience": ["Poison"], "Hellish Resistance": ["Fire"], "Stout Resilience": ["Poison"], "Fey Ancestry": [],
};
function resistances(c, ctx, race, flags) {
  const out = new Set();
  const names = [...(race?.traits || []), ...(race?.subraces?.find((s) => s.id === c.race?.subraceId)?.traits || [])].map((t) => t.name);
  for (const n of names) for (const r of RESISTANCE_TRAITS[n] || []) out.add(r);
  if (flags.has("effect:rage")) { out.add("Bludgeoning"); out.add("Piercing"); out.add("Slashing"); }
  return [...out];
}

function warningsFor(c, ctx, d) {
  const w = [];
  if (d.ac.armor) {
    const cat = d.ac.armor.rec.armor.category;
    if (!d.lists.armor.some((a) => a.toLowerCase().includes(String(cat).toLowerCase()))) w.push(`Not proficient with ${cat.toLowerCase()} armor: disadvantage on Strength and Dexterity checks, saves and attacks, and you can't cast spells.`);
  }
  if (d.ac.shield && !d.lists.armor.some((a) => /shield/i.test(a))) w.push("Not proficient with shields.");
  if ((c.inventory || []).filter((i) => i.attuned).length > 3) w.push("More than 3 items attuned.");
  const armorRec = d.ac.armor?.rec?.armor;
  if (armorRec?.strMin && d.scores.STR.score < armorRec.strMin) w.push(`Strength ${armorRec.strMin} needed for this armor: speed reduced by 10 ft.`);
  if (armorRec?.stealthDisadvantage) w.push("This armor gives disadvantage on Dexterity (Stealth) checks.");
  if (d.encumbrance === "heavy") w.push("Heavily encumbered: speed −20 ft. and disadvantage on physical rolls.");
  else if (d.encumbrance === "encumbered") w.push("Encumbered: speed −10 ft.");
  return w;
}

// ------------------------------------------------------------------ leveling

// Adds one level in the given class. hp: a number gained (without CON), or null for "average".
export function addLevel(c, classId, hp = null) {
  if (totalLevel(c) >= 20) return false;
  c.levelLog.push({ c: classId, hp });
  c.updated = Date.now();
  return true;
}

export function removeLastLevel(c) {
  if (!c.levelLog.length) return false;
  c.levelLog.pop();
  c.updated = Date.now();
  return true;
}

// Ability score improvement opportunities earned so far minus those already used.
export function asiPending(c) {
  let earned = 0;
  for (const id of classIds(c)) {
    const lv = classLevel(c, id);
    earned += asiLevels(id).filter((l) => l <= lv).length;
  }
  return Math.max(0, earned - (c.asiLog?.length || 0));
}

export function subclassPending(c, ctx) {
  const tbl = SUBCLASS_LEVEL[c.edition] || SUBCLASS_LEVEL["2014"];
  return classSummary(c, ctx).filter((p) => !p.subclassId && p.level >= (tbl[p.id] || 99) && (p.cls?.subclasses?.length || p.cls?.custom)).map((p) => p.id);
}

// Features at the class's current level that need a decision the player hasn't made yet.
export function pendingChoices(c, ctx) {
  const out = [];
  for (const f of featureList(c, ctx)) {
    if (f.options?.length && f.kind !== "race") {
      const need = f.choose ?? chooseCountFor(c, ctx, f);
      const have = (c.choices?.[f.id] || []).length;
      if (need && have < need) out.push({ feature: f, need, have });
    }
    if (f.pick?.choose && f.kind === "class") {
      const have = (c.choices?.[f.id] || []).length;
      if (have < f.pick.choose) out.push({ feature: f, need: f.pick.choose, have });
    }
    if (f.expertise?.choose && f.kind === "class") {
      const have = (c.choices?.[`${f.id}:expertise`] || []).length;
      if (have < f.expertise.choose) out.push({ feature: f, need: f.expertise.choose, have, expertise: true });
    }
  }
  return out;
}

function chooseCountFor(c, ctx, f) {
  const p = classSummary(c, ctx).find((x) => x.id === f.classId);
  const cs = p?.cls?.levels?.find((l) => l.level === p.level)?.cs || {};
  if (/invocation/i.test(f.name)) return cs.invocations_known ?? cs.eldritch_invocations ?? 0;
  if (/metamagic/i.test(f.name)) return cs.metamagic_known ?? 0;
  return 1;
}

// ------------------------------------------------------------------ HP changes

export function applyDamage(c, d, amount, { crit = false } = {}) {
  let dmg = Math.max(0, Math.floor(amount));
  const hp = c.hp;
  const result = { absorbed: 0, taken: 0, state: "ok", log: [] };
  if (!dmg) return result;
  const startCur = hp.current == null ? d.hpMax : hp.current;
  if (startCur === 0) {
    // already at 0: damage causes a death save failure (two on a critical hit); instant death at max HP
    const fails = crit ? 2 : 1;
    if (dmg >= d.hpMax) { c.deathSaves.f = 3; result.state = "dead"; return result; }
    c.deathSaves.f = Math.min(3, c.deathSaves.f + fails);
    result.state = c.deathSaves.f >= 3 ? "dead" : "down";
    return result;
  }
  if (hp.temp > 0) {
    const used = Math.min(hp.temp, dmg);
    hp.temp -= used; dmg -= used; result.absorbed = used;
  }
  let cur = startCur - dmg;
  result.taken = dmg;
  if (cur <= 0) {
    const overflow = -cur;
    cur = 0;
    if (overflow >= d.hpMax) { c.deathSaves.f = 3; result.state = "dead"; }
    else { result.state = "down"; c.deathSaves.s = 0; c.deathSaves.f = 0; }
    if (!c.conditions.includes("Unconscious") && result.state === "down") c.conditions.push("Unconscious");
  }
  hp.current = cur;
  return result;
}

export function applyHeal(c, d, amount) {
  const heal = Math.max(0, Math.floor(amount));
  const start = c.hp.current == null ? d.hpMax : c.hp.current;
  const cur = Math.min(d.hpMax, start + heal);
  c.hp.current = cur;
  if (start === 0 && cur > 0) {
    c.deathSaves = { s: 0, f: 0 };
    c.conditions = c.conditions.filter((x) => x !== "Unconscious");
  }
  return cur - start;
}

// A death saving throw result. natural is the d20 face.
export function deathSave(c, natural) {
  const ds = c.deathSaves;
  if (natural === 20) {
    c.hp.current = 1; c.deathSaves = { s: 0, f: 0 };
    c.conditions = c.conditions.filter((x) => x !== "Unconscious");
    return "revive";
  }
  if (natural === 1) ds.f = Math.min(3, ds.f + 2);
  else if (natural >= 10) ds.s = Math.min(3, ds.s + 1);
  else ds.f = Math.min(3, ds.f + 1);
  if (ds.f >= 3) return "dead";
  if (ds.s >= 3) return "stable";
  return natural >= 10 ? "success" : "failure";
}

// Spend one hit die of the given size, healing roll + CON (min 0).
export function spendHitDie(c, d, die, rollValue) {
  const key = `d${die}`;
  const pool = d.hitDice.find((h) => h.die === die);
  if (!pool || pool.used >= pool.total) return null;
  c.hitDiceUsed[key] = (Number(c.hitDiceUsed[key]) || 0) + 1;
  const healed = Math.max(0, rollValue + d.scores.CON.mod);
  const gained = applyHeal(c, d, healed);
  return { healed, gained };
}

export function shortRest(c, d) {
  for (const r of d.resources) if (r.recharge === "short") delete c.resourcesUsed[r.key];
  c.pactUsed = 0;
  c.updated = Date.now();
}

export function longRest(c, d) {
  c.hp.current = d.hpMax; c.hp.temp = 0;
  c.deathSaves = { s: 0, f: 0 };
  c.conditions = c.conditions.filter((x) => x !== "Unconscious");
  c.slotsUsed = {}; c.pactUsed = 0; c.resourcesUsed = {};
  // regain up to half your total hit dice (at least one), largest dice first
  let regain = Math.max(1, Math.floor(d.level / 2));
  for (const h of [...d.hitDice].sort((a, b) => b.die - a.die)) {
    const used = Number(c.hitDiceUsed[h.label]) || 0;
    const give = Math.min(used, regain);
    if (give) { c.hitDiceUsed[h.label] = used - give; regain -= give; }
    if (!regain) break;
  }
  if (c.exhaustion > 0) c.exhaustion -= 1;
  c.concentration = "";
  c.updated = Date.now();
}

// ------------------------------------------------------------------ summaries

export function presenceSummary(c, ctx) {
  const d = derive(c, ctx);
  return {
    id: c.id, name: c.name, race: c.race?.name || "", classes: classLabel(c, ctx), level: d.level,
    hp: d.hp.current, maxHp: d.hp.max, tempHp: d.hp.temp, ac: d.ac.value, speed: d.speed,
    initiative: d.initiative, passivePerception: d.passive.perception,
    dc: d.casting[0]?.dc ?? null, conditions: c.conditions || [], concentration: c.concentration || "",
    deathSaves: c.hp.current === 0 ? c.deathSaves : null, inspiration: !!c.inspiration, exhaustion: c.exhaustion || 0,
    portrait: c.portrait && c.portrait.length < 30000 ? c.portrait : "",
  };
}
