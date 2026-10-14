// Regular D&D (5e-style): a PREVIEW scaffold that proves the extension
// point. It ships a working dice roller and an ability-score/modifier
// helper; characters, spells, monsters and combat come next. Put this
// system's rules data under data/dnd5e/ and its engine files next to this
// one (js/systems/dnd5e/...), keeping it independent of the Pokémon code.

import { renderDiceRoller } from "./views/diceRoller.js";
import { renderAbilityScores } from "./views/abilityScores.js";
import { renderOverview } from "./views/overview.js";

export default {
  id: "dnd5e",
  name: "Dungeons & Dragons",
  tagline: "Coming soon: dice roller and ability scores while the full rules are built.",
  status: "preview",
  brand: { title: "D&D Companion", logo: "assets/logo.png" },
  defaultView: "dndOverview",
  nav: [
    { label: null, views: [
      { id: "dndOverview", label: "Overview", render: renderOverview },
    ] },
    { label: "Tools", views: [
      { id: "dndDice", label: "Dice Roller", render: renderDiceRoller },
      { id: "dndAbilities", label: "Ability Scores", render: renderAbilityScores },
    ] },
  ],
  directiveViews: [],
  // This system has no exported rules data yet; return an empty state.
  async loadData() { return { system: "dnd5e" }; },
  mount() {},
  async applyDirectives() { return false; },
  presence: () => ({}),
};
