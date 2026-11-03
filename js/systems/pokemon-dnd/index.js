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
import { renderRulebook } from "../../views/rulebook.js";
import { renderBattleView } from "../../views/battleview.js";
import { renderHub } from "../../views/hub.js";
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
  brand: {
    title: "Pokémon D&D Companion", logo: "assets/logo.png",
    favicon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2245%22 fill=%22%23e3350d%22/><rect y=%2245%22 width=%22100%22 height=%2210%22 fill=%22%23222%22/><circle cx=%2250%22 cy=%2250%22 r=%2216%22 fill=%22white%22 stroke=%22%23222%22 stroke-width=%228%22/></svg>",
  },
  credit: "All Pokémon art is provided by PokeAPI and originates from Nintendo, Game Freak and The Pokémon Company. This is an unofficial fan project and is not affiliated with or endorsed by them.",
  defaultView: "hub",
  nav: [
    { label: null, views: [
      { id: "hub", label: "Hub", render: renderHub },
    ] },
    { label: "Calculators", views: [
      { id: "statcalc", label: "Stat Calculator", render: renderStatCalc },
      { id: "damagecalc", label: "Damage Calculator", render: renderDamageCalc },
    ] },
    { label: "Trainer", views: [
      { id: "team", label: "My Team", render: renderTeam },
      { id: "bag", label: "Bag", render: renderBag },
      { id: "trainer", label: "Trainer Sheet", render: renderTrainer },
      { id: "trainersOnline", label: "Trainers Online", render: renderTrainersOnline },
    ] },
    { label: "Dungeon Master", views: [
      { id: "controlcentre", label: "Control Centre", render: renderControlCentre },
    ] },
    { label: "Reference", views: [
      { id: "rulebook", label: "Rulebook", render: renderRulebook },
      { id: "typechart", label: "Type Chart", render: renderTypeChart },
      { id: "tierguide", label: "Move Tier Guide", render: renderTierGuide },
    ] },
  ],
  // Views that show this player's own save data: re-rendered when a DM
  // directive (or any save change) lands while one is open.
  // Not in the sidebar: the Battle screen opens only from an encounter button on the hub.
  gatedViews: [{ id: "battleview", label: "Battle", render: renderBattleView }],
  onHub: ["settings", "planner", "library"],   // buttons on the hub (top right) instead of sidebar pages
  // No sidebar at all: every page is a button on the hub (js/views/hub.js) or a pull tab, and the top bar's menu
  // button takes you back to the hub. `nav` below still lists the pages so the router knows them.
  noSidebar: true,
  theme: "cosmic",   // every page in the hub's look (css/cosmic.css), whatever theme the device is set to
  // pull tabs on the right edge, beside LOG: the rulebook and the type chart, open over any page
  pullTabs: [
    { id: "rules", label: "RULES", title: "Rulebook", render: (host) => renderRulebook(host), wide: true },
    { id: "types", label: "TYPES", title: "Type Chart", render: (host, state) => renderTypeChart(host, state), wide: true },
    { id: "tiers", label: "TIERS", title: "Move Tier Guide", render: (host, state) => renderTierGuide(host, state), wide: true },
  ],
  // pages that aren't in the sidebar but can still be opened (the hub's Pokédex and Move Dex pull-outs link to them)
  hiddenViews: [{ id: "pokedex", label: "Pokédex", render: renderPokedex }, { id: "moves", label: "Move Dex", render: renderMoves }],
  directiveViews: ["team", "trainer", "battleview", "bag"],
  loadData,
  mount(state) { mountQuickConsole(state); },
  applyDirectives: pollAndApplyDirectives,
  presence: (save) => ({ party: save.party, pc: save.pc }),
};
