// Turns the exported rules JSON (data/dnd5e/<edition>/*.json) into lookup
// structures the engine and views use. The exporter drops empty values to keep
// the files small, so every collection is given its empty defaults back here.
// Pure functions (no fetch/DOM) so Node tests can build the same indexes.

export const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function byId(list, key = "id") {
  const map = new Map();
  for (const x of list) map.set(x[key], x);
  return map;
}

export function indexClasses(list) {
  for (const c of list) {
    c.armor ||= []; c.weapons ||= []; c.tools ||= []; c.saves ||= [];
    c.subclasses ||= []; c.levels ||= []; c.features ||= {};
    c.equipment ||= { fixed: [], options: [] };
    c.equipment.fixed ||= []; c.equipment.options ||= [];
    c.multiclass ||= { requirements: [], proficiencies: [] };
    c.multiclass.requirements ||= []; c.multiclass.proficiencies ||= [];
    for (const lv of c.levels) { lv.features ||= []; lv.cs ||= {}; lv.sc ||= null; }
    for (const f of Object.values(c.features)) { f.desc ||= []; }
    for (const s of c.subclasses) {
      s.features ||= []; s.desc ||= []; s.spells ||= [];
      for (const f of s.features) f.desc ||= [];
    }
  }
  return { list, byId: byId(list) };
}

export function indexRaces(list) {
  for (const r of list) {
    r.abilityBonuses ||= []; r.traits ||= []; r.subraces ||= []; r.languages ||= []; r.proficiencies ||= [];
    for (const t of r.traits) t.desc ||= [];
    for (const s of r.subraces) { s.abilityBonuses ||= []; s.traits ||= []; s.proficiencies ||= []; s.languages ||= []; for (const t of s.traits) t.desc ||= []; }
  }
  return { list, byId: byId(list) };
}

export function indexBackgrounds(list) {
  for (const b of list) {
    b.skills ||= []; b.tools ||= []; b.equipment ||= []; b.equipmentOptions ||= [];
    b.personalityTraits ||= []; b.ideals ||= []; b.bonds ||= []; b.flaws ||= [];
    if (b.feature) b.feature.desc ||= [];
  }
  return { list, byId: byId(list) };
}

export function indexFeats(list) {
  for (const f of list) f.desc ||= [];
  return { list, byId: byId(list) };
}

export function indexEquipment(list) {
  for (const e of list) { e.categories ||= []; e.desc ||= []; }
  const byName = new Map(list.map((e) => [e.name.toLowerCase(), e]));
  return { list, byId: byId(list), byName };
}

export function indexSpells(list) {
  for (const s of list) { s.desc ||= []; s.higherLevel ||= []; s.classes ||= []; s.components ||= []; }
  return { list, byId: byId(list), byName: new Map(list.map((s) => [s.name.toLowerCase(), s])) };
}

export function indexMonsters(list) {
  for (const m of list) {
    m.ac ||= []; m.speed ||= {}; m.abilities ||= {}; m.saves ||= {}; m.skills ||= {};
    m.vulnerabilities ||= []; m.resistances ||= []; m.immunities ||= []; m.conditionImmunities ||= [];
    m.senses ||= {}; m.traits ||= []; m.actions ||= []; m.bonusActions ||= []; m.reactions ||= []; m.legendary ||= [];
  }
  return { list, byId: byId(list), byName: new Map(list.map((m) => [m.name.toLowerCase(), m])) };
}

export function indexMagicItems(list) {
  for (const m of list) m.desc ||= [];
  return { list, byId: byId(list) };
}

// Looks a class feature up by id across a class's own features.
export function classFeature(cls, id) {
  return cls?.features?.[id] || null;
}
