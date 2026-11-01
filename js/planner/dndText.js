// The D&D generators as { title, lines } results, so the planner can show them as cards and insert them into a
// scenario as plain text. (The Generators tab for D&D also embeds the richer UI from the D&D system's own page.)

import {
  genNpc, genName, genTavern, genShop, genRumor, genHook, genWeather, genLoot, genRoom, genWildMagic, NAME_STYLES,
} from "../systems/dnd5e/engine/generators.js";
import { partyBudget, suggestEncounter } from "../systems/dnd5e/engine/encounter.js";
import { crLabel } from "../systems/dnd5e/engine/rules.js";

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const pick = (a, r) => a[Math.floor(r() * a.length)];

export function npc(rng = Math.random) {
  const n = genNpc(rng);
  return { title: `${n.name} — ${n.age} ${n.race.toLowerCase()} ${n.occupation}`, lines: [`Looks: ${n.appearance}`, `Mannerism: ${n.mannerism}`, `Personality: ${n.trait}`, `Wants: ${n.wants}`, `Secret: ${n.secret}`, `Attitude: ${n.attitude}`] };
}
export function tavern(rng = Math.random) {
  const t = genTavern(rng);
  return { title: t.name, lines: [`${cap(t.quality)} establishment run by ${t.owner.name} (${t.owner.trait})`, `Known for: ${t.feature}`, `On tap: ${t.drink}; kitchen: ${t.food}`, `Prices: ${t.price}`, `Rumour: ${t.rumor}`, "# Patrons", ...t.patrons] };
}
export function shop(rng = Math.random) {
  const s = genShop(rng);
  return { title: s.name, lines: [`Type: ${s.type}`, `Keeper: ${s.keeper.name} (${s.keeper.trait})`, `Prices: ${s.prices}`, `Hook: the shop ${s.hook}`] };
}
export const rumour = (rng = Math.random) => ({ title: "Rumour", lines: [genRumor(rng)] });
export const hook = (rng = Math.random) => ({ title: "Adventure hook", lines: [genHook(rng)] });
export function room(rng = Math.random) {
  const r = genRoom(rng);
  return { title: `Room: ${r.type}`, lines: [`Notable: ${r.feature}`, `Inside: ${r.occupant}`, ...(r.trap ? [`Trap: ${r.trap}`] : []), `Exits: ${r.exits}`] };
}
export function loot(rng = Math.random, { cr = 3, hoard = false } = {}) {
  const l = genLoot(cr, { hoard, rng });
  const coins = Object.entries(l.coins).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "no coins";
  return { title: hoard ? "Treasure hoard" : "Loot", lines: [coins, ...l.items, ...l.magic] };
}
export function weather(rng = Math.random, { season = "spring" } = {}) {
  const w = genWeather(rng, season);
  return { title: "Weather", lines: [`${cap(w.sky)}, ${w.tempC}°C with ${w.wind}`, ...w.effects] };
}
export const name = (rng = Math.random) => ({ title: "Names", lines: Array.from({ length: 6 }, () => genName(pick(NAME_STYLES, rng), rng)) });
export const wildMagic = (rng = Math.random) => ({ title: "Wild magic surge", lines: [genWildMagic(rng)] });

// A random encounter from the SRD monsters, sized for a party and a difficulty.
export function encounter(monsters, rng = Math.random, { level = 3, size = 4, difficulty = "medium", edition = "2014" } = {}) {
  const budget = partyBudget(Array(size).fill(level), edition);
  const key = edition === "2024" ? ({ easy: "low", medium: "moderate", hard: "high", deadly: "high" }[difficulty] || "moderate") : difficulty;
  const target = budget[key] || Object.values(budget)[1];
  const crCap = Math.max(1, Math.round(level * 1.1 + 1));
  const picks = suggestEncounter(monsters, target, { edition, partySize: size, maxCr: crCap, rng });
  if (!picks.length) return { title: "Encounter", lines: ["No monsters fit that budget."] };
  return {
    title: `Encounter (${difficulty}) for ${size} level-${level} characters`,
    lines: [...picks.map((p) => `${p.count}× ${p.monster.name} (CR ${crLabel(p.monster.cr)}, ${p.monster.xp} XP each)`), `XP budget: about ${target}`],
    picks,
  };
}

export const GENERATORS = [
  { id: "npc", label: "NPC", run: (c, r) => npc(r) },
  { id: "name", label: "Names", run: (c, r) => name(r) },
  { id: "hook", label: "Adventure hook", run: (c, r) => hook(r) },
  { id: "rumour", label: "Rumour", run: (c, r) => rumour(r) },
  { id: "tavern", label: "Tavern", run: (c, r) => tavern(r) },
  { id: "shop", label: "Shop", run: (c, r) => shop(r) },
  { id: "room", label: "Dungeon room", run: (c, r) => room(r) },
  { id: "loot", label: "Loot", run: (c, r) => loot(r, { cr: c.level || 3 }) },
  { id: "weather", label: "Weather", run: (c, r) => weather(r, { season: c.season || "spring" }) },
  { id: "wild", label: "Wild magic surge", run: (c, r) => wildMagic(r) },
  {
    id: "encounter", label: "Random encounter",
    run: async (c, r) => {
      const { loadSet } = await import("../systems/dnd5e/data.js");
      const { list } = await loadSet(c.edition || "2014", "monsters");
      return encounter(list, r, { level: c.level || 3, size: c.size || 4, difficulty: c.difficulty || "medium", edition: c.edition || "2014" });
    },
  },
];
