// A character's spell lists: which spells they know / have in a spellbook /
// prepared, and which of their classes may learn a given spell.
//
// char.spells = {
//   cantrips: { classId: [spellId] }, known: { classId: [spellId] },  // leveled spells of "known" casters
//   prepared: { classId: [spellId] }, book: [spellId]                  // wizard spellbook is shared
// }

import { classSummary, casterTypeOf } from "./character.js";

export function spellKindFor(char, part, spell) {
  if (spell.level === 0) return "cantrip";
  if (part.id === "wizard") return "book";
  const known = ["bard", "ranger", "sorcerer", "warlock"].includes(part.id) && char.edition === "2014";
  return known ? "known" : "prepared";
}

// Classes of this character that have the spell on their list.
export function learnTargets(char, ctx, spell) {
  return classSummary(char, ctx)
    .filter((p) => casterTypeOf(p) !== "none" || p.cls?.spellcasting)
    .filter((p) => p.cls?.custom || (spell.classes || []).includes(p.name))
    .map((p) => ({ classId: p.id, className: p.name, kind: spellKindFor(char, p, spell), level: p.level }));
}

function listFor(char, kind, classId) {
  char.spells ||= { cantrips: {}, known: {}, prepared: {}, book: [] };
  if (kind === "book") { char.spells.book ||= []; return char.spells.book; }
  const bucket = kind === "cantrip" ? "cantrips" : kind;
  char.spells[bucket] ||= {};
  char.spells[bucket][classId] ||= [];
  return char.spells[bucket][classId];
}

export function addSpell(char, classId, spell, kind) {
  const list = listFor(char, kind, classId);
  if (!list.includes(spell.id)) list.push(spell.id);
  return list;
}

export function removeSpell(char, classId, spellId, kind) {
  const list = listFor(char, kind, classId);
  const i = list.indexOf(spellId);
  if (i >= 0) list.splice(i, 1);
  return list;
}

export function isPrepared(char, classId, spellId) {
  return (char.spells?.prepared?.[classId] || []).includes(spellId);
}

export function togglePrepared(char, classId, spellId) {
  const list = listFor(char, "prepared", classId);
  const i = list.indexOf(spellId);
  if (i >= 0) list.splice(i, 1); else list.push(spellId);
  return i < 0;
}

// Everything a class can cast right now: [{ id, kind }] for cantrips, known spells,
// spellbook (wizard) and prepared lists, de-duplicated.
export function classSpellIds(char, classId) {
  const sp = char.spells || {};
  const out = new Map();
  for (const id of sp.cantrips?.[classId] || []) out.set(id, "cantrip");
  for (const id of sp.known?.[classId] || []) out.set(id, "known");
  if (classId === "wizard") for (const id of sp.book || []) out.set(id, "book");
  for (const id of sp.prepared?.[classId] || []) if (!out.has(id)) out.set(id, "prepared");
  return out;
}

export function preparedCount(char, classId) {
  return (char.spells?.prepared?.[classId] || []).length;
}

// Highest spell level the character has slots for.
export function maxSpellLevel(derived) {
  let max = 0;
  derived.slots.forEach((s) => { if (s.max > 0) max = s.level; });
  if (derived.pact) max = Math.max(max, derived.pact.level);
  return max;
}

// Spells granted automatically by the subclass (domain/oath spells), as names.
export function alwaysPreparedNames(char, ctx) {
  const out = [];
  for (const p of classSummary(char, ctx)) {
    for (const s of p.sub?.spells || []) if ((s.level ?? 0) <= p.level) out.push(s.spell);
  }
  return out;
}
