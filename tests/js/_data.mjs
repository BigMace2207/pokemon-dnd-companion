// Test helper: builds the same rules context the browser uses, from the exported JSON on disk.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexClasses, indexRaces, indexBackgrounds, indexFeats, indexEquipment, indexSpells, indexMonsters } from "../../js/systems/dnd5e/engine/dataIndex.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/dnd5e");
const read = (ed, name) => JSON.parse(fs.readFileSync(path.join(root, ed, `${name}.json`), "utf8"));

const cache = {};
export function ctxFor(ed = "2014") {
  if (cache[ed]) return cache[ed];
  const classes = indexClasses(read(ed, "classes"));
  const races = indexRaces(read(ed, "races"));
  const backgrounds = indexBackgrounds(read(ed, "backgrounds"));
  const feats = indexFeats(read(ed, "feats"));
  const equipment = indexEquipment(read(ed, "equipment"));
  const spells = indexSpells(read(ed, "spells"));
  cache[ed] = {
    classes: classes.byId, races: races.byId, backgrounds: backgrounds.byId, feats: feats.byId,
    equipment: equipment.byId, equipmentByName: equipment.byName, spells: spells.byId, spellsByName: spells.byName,
    raw: { classes, races, backgrounds, feats, equipment, spells },
  };
  return cache[ed];
}
export const monsters = (ed = "2014") => indexMonsters(read(ed, "monsters"));
export const rawJson = read;
