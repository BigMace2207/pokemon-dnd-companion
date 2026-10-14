// Pokémon D&D: the original (and currently only complete) game system.
// Its views and engine files still live in js/views/ and js/*.js; this file
// is the single manifest that plugs them into the app shell.

import { loadData } from "../../data.js";
import { renderPokedex } from "../../views/pokedex.js";
import { renderMoves } from "../../views/moves.js";
import { renderStatCalc } from "../../views/statcalc.js";
import { renderDamageCalc } from "../../views/damagecalc.js";
import { renderTypeChart } from "../../views/typechart.js";
import { renderTierGuide } from "../../views/tierguide.js";
import { renderBattleView } from "../../views/battleview.js";
import { renderTeam } from "../../views/team.js";
import { renderBag } from "../../views/bag.js";
import { renderTrainer } from "../../views/trainer.js";
import { renderTrainersOnline } from "../../views/trainers.js";
import { renderControlCentre } from "../../views/controlcentre.js";
import { pollAndApplyDirectives } from "../../directives.js";
import { mountQuickConsole } from "../../console.js";

export default {
  id: "pokemon-dnd",
  name: "Pokémon D&D",
  tagline: "Trainers, Pokémon, dice-based battles and catching.",
  status: "stable",
  brand: { title: "Pokémon D&D Companion", logo: "assets/logo.png" },
  defaultView: "pokedex",
  nav: [
    { label: null, views: [
      { id: "pokedex", label: "Pokédex", render: renderPokedex },
      { id: "moves", label: "Move Dex", render: renderMoves },
    ] },
    { label: "Calculators", views: [
      { id: "statcalc", label: "Stat Calculator", render: renderStatCalc },
      { id: "damagecalc", label: "Damage Calculator", render: renderDamageCalc },
    ] },
    { label: "Trainer", views: [
      { id: "battleview", label: "Battle", render: renderBattleView },
      { id: "team", label: "My Team", render: renderTeam },
      { id: "bag", label: "Bag", render: renderBag },
      { id: "trainer", label: "Trainer Sheet", render: renderTrainer },
      { id: "trainersOnline", label: "Trainers Online", render: renderTrainersOnline },
    ] },
    { label: "Dungeon Master", views: [
      { id: "controlcentre", label: "Control Centre", render: renderControlCentre },
    ] },
    { label: "Reference", views: [
      { id: "typechart", label: "Type Chart", render: renderTypeChart },
      { id: "tierguide", label: "Move Tier Guide", render: renderTierGuide },
    ] },
  ],
  // Views that show this player's own save data: re-rendered when a DM
  // directive (or any save change) lands while one is open.
  directiveViews: ["team", "trainer", "battleview", "bag"],
  loadData,
  mount(state) { mountQuickConsole(state); },
  applyDirectives: pollAndApplyDirectives,
  presence: (save) => ({ party: save.party, pc: save.pc }),
};
