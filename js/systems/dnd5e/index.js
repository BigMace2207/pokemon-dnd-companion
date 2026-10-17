// Dungeons & Dragons (5th edition): a full companion built on the SRD rules.
// Characters, spells, monsters, items, rules, dice, party and live combat for
// players; encounter building, generators and campaign notes for the DM.
//
// Rules data lives in data/dnd5e/<2014|2024>/ (built by tools/export_dnd5e.py);
// the engine (engine/*.js) is plain functions so it can be unit-tested in Node.
// Everything player-facing is stored in the player save's systemData.dnd5e and
// shared with the table through the same presence / directive / log transport
// the Pokémon system uses, so the server needs nothing D&D-specific.

import { pollAndApplyDirectives } from "./directives.js";
import { loadCtx, peekCtx } from "./data.js";
import { activeCharacter, getDnd } from "./store.js";
import { presenceSummary } from "./engine/character.js";

// Pages load on demand: the shell only pays for the ones you open.
const lazy = (path, fn) => async (container, state) => {
  const mod = await import(path);
  return mod[fn](container, state);
};

export default {
  id: "dnd5e",
  name: "Dungeons & Dragons",
  tagline: "Characters, spells, monsters, dice and combat using 5th edition rules.",
  status: "stable",
  brand: { title: "D&D Companion", logo: "assets/dnd-logo.svg", favicon: "assets/dnd-logo.svg" },
  defaultView: "dndHome",
  nav: [
    { label: null, views: [
      { id: "dndHome", label: "Overview", render: lazy("./views/home.js", "renderHome") },
    ] },
    { label: "Character", views: [
      { id: "dndCharacters", label: "Characters", render: lazy("./views/characters.js", "renderCharacters") },
      { id: "dndSheet", label: "Character Sheet", render: lazy("./views/sheet.js", "renderSheet") },
    ] },
    { label: "Play", views: [
      { id: "dndDice", label: "Dice Roller", render: lazy("./views/dice.js", "renderDice") },
      { id: "dndParty", label: "Party", render: lazy("./views/party.js", "renderParty") },
      { id: "dndCombat", label: "Combat", render: lazy("./views/combat.js", "renderCombat") },
    ] },
    { label: "Compendium", views: [
      { id: "dndSpells", label: "Spells", render: lazy("./views/spells.js", "renderSpells") },
      { id: "dndBestiary", label: "Bestiary", render: lazy("./views/bestiary.js", "renderBestiary") },
      { id: "dndItems", label: "Equipment & Items", render: lazy("./views/items.js", "renderItems") },
      { id: "dndClasses", label: "Classes", render: lazy("./views/classes.js", "renderClasses") },
      { id: "dndRaces", label: "Races & Species", render: lazy("./views/races.js", "renderRaces") },
      { id: "dndBackgrounds", label: "Backgrounds & Feats", render: lazy("./views/backgrounds.js", "renderBackgrounds") },
      { id: "dndRules", label: "Rules", render: lazy("./views/rules.js", "renderRules") },
      { id: "dndTables", label: "Reference Tables", render: lazy("./views/tables.js", "renderTables") },
    ] },
    { label: "Dungeon Master", views: [
      { id: "dndDmScreen", label: "DM Screen", render: lazy("./views/dmScreen.js", "renderDmScreen") },
      { id: "dndEncounter", label: "Encounter Builder", render: lazy("./views/encounter.js", "renderEncounter") },
      { id: "dndGenerators", label: "Generators", render: lazy("./views/generators.js", "renderGenerators") },
      { id: "dndNotes", label: "Campaign Notes", render: lazy("./views/notes.js", "renderNotes") },
    ] },
  ],
  // Pages that show this player's own character: refreshed when a DM change lands.
  directiveViews: ["dndHome", "dndSheet", "dndCharacters"],
  async loadData() { return { system: "dnd5e" }; },
  mount() {
    // Warm the rules cache for the active character so presence pings and DM
    // directives can use it before any page has been opened.
    const c = activeCharacter();
    loadCtx(c?.edition || getDnd().settings.edition).catch(() => {});
  },
  applyDirectives: pollAndApplyDirectives,
  presence(save) {
    const d = getDnd(save);
    const c = d.characters.find((x) => x.id === d.activeId) || d.characters[0];
    if (!c) return { party: [], pc: [] };
    const ctx = peekCtx(c.edition);
    const summary = ctx ? presenceSummary(c, ctx) : { id: c.id, name: c.name, classes: "", level: c.levelLog.length, hp: c.hp?.current, maxHp: null, ac: null, conditions: c.conditions || [] };
    return { party: [], pc: [], dnd: summary };
  },
};
