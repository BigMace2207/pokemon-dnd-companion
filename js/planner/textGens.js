// One list of generators per game system, each returning { title, lines } for the current campaign. The scenario
// editor uses it to drop generated NPCs, hooks, encounters and so on into a scene as text, and the Generators tab
// shows the same results as cards with a small options form per generator (OPTIONS).

import { loadData } from "../data.js";
import { GENERATORS as DND } from "./dndText.js";
import * as poke from "./pokeGenerators.js";
import { toText } from "./pokeGenerators.js";

let pokeState = null;
export const pokemonState = () => (pokeState ||= loadData());

const lvl = (ctx) => Number(ctx.level) || 10;
const pickEnv = (r) => { const k = Object.keys(poke.ENVIRONMENTS); return k[Math.floor(r() * k.length)]; };
const dndText = () => import("./dndText.js");

const POKEMON = [
  { id: "wild", label: "Wild encounter", run: async (c, r) => poke.wildEncounter(await pokemonState(), r, { env: c.env || pickEnv(r), level: lvl(c), count: Number(c.count) || 0, allowRare: !!c.rare }) },
  { id: "trainer", label: "Trainer", run: async (c, r) => poke.trainerNpc(await pokemonState(), r, { level: lvl(c), cls: c.cls || "" }) },
  { id: "gym", label: "Gym leader", run: async (c, r) => poke.gymLeader(await pokemonState(), r, { badge: Number(c.badge) || Math.max(1, Math.min(8, Math.round(lvl(c) / 7))), type: c.type || "" }) },
  { id: "route", label: "Route", run: async (c, r) => poke.route(await pokemonState(), r, { env: c.env || pickEnv(r), level: lvl(c) }) },
  { id: "hook", label: "Adventure hook", run: async (c, r) => poke.hook(r) },
  { id: "loot", label: "Treasure", run: async (c, r) => poke.loot(await pokemonState(), r, { tier: c.tier || (lvl(c) < 20 ? "low" : lvl(c) < 40 ? "mid" : "high") }) },
  { id: "npc", label: "NPC", run: async (c, r) => (await dndText()).npc(r) },
  { id: "name", label: "Names", run: async (c, r) => (await dndText()).name(r) },
  { id: "rumour", label: "Rumour", run: async (c, r) => (await dndText()).rumour(r) },
];

export function textGenerators(system) {
  return system === "pokemon-dnd" ? POKEMON : DND;
}

export const resultText = (res) => toText(res);

const ENV_OPTS = [["", "Any place"], ...Object.entries(poke.ENVIRONMENTS).map(([k, v]) => [k, v.label])];
const LEVEL = { key: "level", label: "Level", type: "number", min: 1, max: 100, value: 15 };

// Options shown for each generator (id -> fields). Anything missing here has no options.
export const OPTIONS = {
  "pokemon-dnd": {
    wild: [{ key: "env", label: "Place", type: "select", options: ENV_OPTS }, LEVEL, { key: "count", label: "How many (0 = random)", type: "number", min: 0, max: 6, value: 0 }, { key: "rare", label: "Allow rare Pokémon", type: "check", value: false }],
    trainer: [{ key: "cls", label: "Class", type: "select", options: [["", "Any"], ...poke.TRAINER_CLASS_NAMES.map((n) => [n, n])] }, LEVEL],
    gym: [{ key: "badge", label: "Badge number", type: "number", min: 1, max: 8, value: 1 }, { key: "type", label: "Type", type: "select", options: [["", "Random"], ...poke.GYM_TYPES.map((t) => [t, t])] }],
    route: [{ key: "env", label: "Terrain", type: "select", options: ENV_OPTS }, LEVEL],
    loot: [{ key: "tier", label: "Value", type: "select", options: [["low", "Everyday"], ["mid", "Good"], ["high", "Rare"]], value: "mid" }],
  },
  dnd5e: {
    loot: [{ key: "level", label: "Average CR of the defeated", type: "number", min: 0, max: 30, value: 3 }],
    weather: [{ key: "season", label: "Season", type: "select", options: [["spring", "Spring"], ["summer", "Summer"], ["autumn", "Autumn"], ["winter", "Winter"]], value: "spring" }],
    encounter: [{ key: "level", label: "Party level", type: "number", min: 1, max: 20, value: 3 }, { key: "size", label: "Party size", type: "number", min: 1, max: 8, value: 4 }, { key: "difficulty", label: "Difficulty", type: "select", options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["deadly", "Deadly"]], value: "medium" }],
  },
};
