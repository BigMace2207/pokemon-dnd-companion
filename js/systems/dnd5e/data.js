// Lazy loader for the D&D rules data (data/dnd5e/<edition>/<name>.json, built by
// tools/export_dnd5e.py). Each file is fetched once per page load and indexed;
// pages ask only for what they show (the Bestiary pulls the monster file,
// the Spells page the spell file, and so on).

import {
  indexClasses, indexRaces, indexBackgrounds, indexFeats, indexEquipment, indexSpells, indexMonsters, indexMagicItems,
} from "./engine/dataIndex.js";

export const EDITIONS = [
  { id: "2014", label: "2014 rules (SRD 5.1)" },
  { id: "2024", label: "2024 rules (SRD 5.2)" },
];

const BASE = "data/dnd5e";
const cache = new Map();

const INDEXERS = {
  classes: indexClasses, races: indexRaces, backgrounds: indexBackgrounds, feats: indexFeats,
  equipment: indexEquipment, spells: indexSpells, monsters: indexMonsters, magicItems: indexMagicItems,
};

export function loadSet(edition, name) {
  const key = `${edition}/${name}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const res = await fetch(`${BASE}/${edition}/${name}.json`);
      if (!res.ok) throw new Error(`Couldn't load ${name} (${res.status}). Run tools/export_dnd5e.py.`);
      const json = await res.json();
      const idx = INDEXERS[name];
      return idx ? idx(json) : json;
    })().catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}

// Everything the character engine needs, as Maps keyed by id.
const CORE = ["classes", "races", "backgrounds", "feats", "equipment"];
const ctxCache = new Map();

// The last context loaded for an edition, or null: lets synchronous code (presence pings,
// directive handling) use the rules data once some page has already fetched it.
export const peekCtx = (edition) => ctxCache.get(edition) || null;

export async function loadCtx(edition, extra = []) {
  const names = [...new Set([...CORE, ...extra])];
  const sets = await Promise.all(names.map((n) => loadSet(edition, n)));
  const by = Object.fromEntries(names.map((n, i) => [n, sets[i]]));
  const prev = ctxCache.get(edition);
  const ctx = {
    edition,
    classes: by.classes.byId, races: by.races.byId, backgrounds: by.backgrounds.byId, feats: by.feats.byId,
    equipment: by.equipment.byId, equipmentByName: by.equipment.byName,
    spells: by.spells?.byId || prev?.spells, spellsByName: by.spells?.byName || prev?.spellsByName,
    raw: { ...(prev?.raw || {}), ...by },
  };
  ctxCache.set(edition, ctx);
  return ctx;
}

// ---- tiny helpers shared by the compendium views ----

export const SCHOOL_ORDER = ["Abjuration", "Conjuration", "Divination", "Enchantment", "Evocation", "Illusion", "Necromancy", "Transmutation"];

export function spellLevelLabel(level) {
  return level === 0 ? "Cantrip" : `Level ${level}`;
}

export function monsterTypes(list) {
  return [...new Set(list.map((m) => m.type.replace(/^swarm of .*$/i, "swarm")))].sort();
}
