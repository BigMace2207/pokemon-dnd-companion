// Where D&D characters live: the player save's systemData.dnd5e slice. It is
// written through storage.js's writeSave(), so it is kept in localStorage AND
// mirrored to the server like the Pokémon fields -- characters survive a wiped
// browser and follow the account to a new device.

import { loadSave, writeSave, getSystemData } from "../../storage.js";
import { newCharacter, uid } from "./engine/character.js";

const SYSTEM_ID = "dnd5e";
export const CHANGED = "dnd5e-changed";

const defaults = () => ({
  characters: [], activeId: null,
  settings: { edition: "2014", shareRolls: true, rollMode: "normal", diceSounds: false },
  dm: {
    notes: [], npcs: [], quests: [], locations: [], sessions: [], encounters: [], combat: null,
    customMonsters: [], customSpells: [], customItems: [],
  },
});

// Always returns a fully-populated slice (older saves lacking newer keys are topped up).
export function getDnd(save = loadSave()) {
  const d = getSystemData(save, SYSTEM_ID, defaults());
  const base = defaults();
  d.characters ||= [];
  d.settings = { ...base.settings, ...(d.settings || {}) };
  d.dm = { ...base.dm, ...(d.dm || {}) };
  for (const k of Object.keys(base.dm)) if (d.dm[k] == null) d.dm[k] = base.dm[k];
  return d;
}

function commit(save, detail) {
  writeSave(save);
  window.dispatchEvent(new CustomEvent(CHANGED, { detail }));
}

export function listCharacters() {
  return getDnd().characters;
}

export function getCharacter(id) {
  return getDnd().characters.find((c) => c.id === id) || null;
}

export function activeCharacter() {
  const d = getDnd();
  return d.characters.find((c) => c.id === d.activeId) || d.characters[0] || null;
}

export function setActive(id) {
  const save = loadSave();
  getDnd(save).activeId = id;
  commit(save, { id });
}

// Persist a character (insert or replace). The same object can be saved repeatedly as it's edited.
export function saveCharacter(char) {
  char.updated = Date.now();
  const save = loadSave();
  const d = getDnd(save);
  const i = d.characters.findIndex((c) => c.id === char.id);
  if (i >= 0) d.characters[i] = char;
  else d.characters.push(char);
  if (!d.activeId) d.activeId = char.id;
  commit(save, { id: char.id });
  return char;
}

export function createCharacter(edition) {
  const c = newCharacter(edition || getDnd().settings.edition);
  const save = loadSave();
  const d = getDnd(save);
  d.characters.push(c);
  d.activeId = c.id;
  commit(save, { id: c.id });
  return c;
}

export function deleteCharacter(id) {
  const save = loadSave();
  const d = getDnd(save);
  d.characters = d.characters.filter((c) => c.id !== id);
  if (d.activeId === id) d.activeId = d.characters[0]?.id || null;
  commit(save, { id });
}

export function duplicateCharacter(id) {
  const src = getCharacter(id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  copy.name = `${src.name || "Character"} (copy)`;
  copy.inventory.forEach((i) => { i.uid = uid(); });
  copy.created = copy.updated = Date.now();
  const save = loadSave();
  const d = getDnd(save);
  d.characters.push(copy);
  commit(save, { id: copy.id });
  return copy;
}

// ---- settings and the DM slice ----

export function getSettings() { return getDnd().settings; }

export function setSettings(patch) {
  const save = loadSave();
  const d = getDnd(save);
  d.settings = { ...d.settings, ...patch };
  commit(save, { settings: true });
  return d.settings;
}

export function getDm() { return getDnd().dm; }

// Mutate the DM slice inside fn(dm); it is saved afterwards.
export function updateDm(fn) {
  const save = loadSave();
  const d = getDnd(save);
  fn(d.dm);
  commit(save, { dm: true });
  return d.dm;
}

// ---- files ----

const FILE_KIND = "dnd5e-character-v1";

export function exportCharacterJson(char) {
  return JSON.stringify({ kind: FILE_KIND, character: char }, null, 2);
}

export function importCharacterJson(text) {
  const parsed = JSON.parse(text);
  const list = parsed.kind === FILE_KIND ? [parsed.character]
    : Array.isArray(parsed.characters) ? parsed.characters
    : parsed.levelLog ? [parsed] : null;
  if (!list || !list.length) throw new Error("That file doesn't look like a D&D character.");
  const save = loadSave();
  const d = getDnd(save);
  const added = [];
  for (const raw of list) {
    if (!raw || !Array.isArray(raw.levelLog)) continue;
    const c = { ...newCharacter(raw.edition || "2014"), ...raw };
    if (d.characters.some((x) => x.id === c.id)) c.id = uid();
    c.inventory = (c.inventory || []).map((i) => ({ ...i, uid: uid() }));
    d.characters.push(c);
    added.push(c);
  }
  if (!added.length) throw new Error("No characters found in that file.");
  d.activeId = added[0].id;
  commit(save, { id: added[0].id });
  return added;
}
