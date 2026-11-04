// Generators for a Pokémon D&D campaign, built on the app's own data (js/data.js loadData(): species, moves,
// learnsets, evolutions, items). Pure functions of (state, rng, options) so they can be tested in Node.
// Every generator returns { title, lines: [string], mons?: [...] } -- the planner shows these as cards and
// can drop them straight into a note or a scenario scene as text.

import { genName } from "../systems/dnd5e/engine/generators.js";

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const between = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const toText = (r) => [r.title, ...r.lines.map((l) => (l.startsWith("#") || l === "" ? l.replace(/^#\s?/, "") : `- ${l}`))].join("\n");

// ---------------------------------------------------------------- species

export const ENVIRONMENTS = {
  forest: { label: "Forest", types: ["Grass", "Bug", "Normal", "Flying", "Poison", "Fairy"], hazards: ["Tangled roots (DC 12 Dex or lose a turn)", "Pollen clouds (Sleep or Poison chance)", "Hidden Bug nests", "Getting lost: DC 12 Survival to keep the path"] },
  cave: { label: "Cave", types: ["Rock", "Ground", "Bug", "Dark", "Poison", "Fighting", "Ghost"], hazards: ["Pitch dark (need light or Flash)", "Rockfall (DC 13 Dex, 2d6)", "Echoes that wake sleeping Pokémon", "Underground stream"] },
  water: { label: "Sea / Lake", types: ["Water", "Flying", "Electric", "Dragon", "Ice"], hazards: ["Strong currents (needs a Water Pokémon)", "Whirlpools", "Fog banks", "Slippery rocks (DC 12 Dex)"] },
  mountain: { label: "Mountain", types: ["Rock", "Fighting", "Steel", "Ground", "Fire", "Flying", "Dragon"], hazards: ["Thin air (slower travel)", "Avalanche risk (DC 14 Survival to spot)", "Sheer cliffs: Climb checks", "Sudden storms"] },
  urban: { label: "City", types: ["Normal", "Electric", "Poison", "Psychic", "Steel", "Dark", "Fairy"], hazards: ["Crowds and pickpockets", "Traffic", "Rival trainers looking for a fight", "Police checkpoints"] },
  desert: { label: "Desert", types: ["Ground", "Fire", "Rock", "Dark", "Bug", "Poison"], hazards: ["Scorching heat (water every few hours)", "Sandstorms (low visibility)", "Quicksand (DC 13 Str)", "Mirages"] },
  snow: { label: "Snowfield", types: ["Ice", "Water", "Fighting", "Steel", "Normal", "Psychic"], hazards: ["Bitter cold (DC 12 Con each hour without gear)", "Whiteouts", "Thin ice", "Hidden crevasses"] },
  grassland: { label: "Grassland", types: ["Normal", "Grass", "Flying", "Bug", "Electric", "Fairy", "Fire"], hazards: ["Tall grass hides ambushes", "Stampedes", "Sudden rain", "Wild fires in dry weather"] },
  swamp: { label: "Swamp", types: ["Poison", "Water", "Grass", "Ground", "Bug", "Dark"], hazards: ["Sucking mud (slow terrain)", "Toxic gas pockets (DC 13 Con)", "Leeches and swarms", "Hard to find dry ground"] },
  ruins: { label: "Ancient ruins", types: ["Ghost", "Psychic", "Dark", "Rock", "Steel", "Dragon"], hazards: ["Pressure-plate traps", "Whispering voices (Wis save or frightened)", "Collapsing floors", "Sealed doors with puzzle locks"] },
  volcano: { label: "Volcano", types: ["Fire", "Rock", "Ground", "Dragon", "Steel"], hazards: ["Lava flows (Dex save or 4d6 fire)", "Toxic fumes", "Tremors", "Ash clouds"] },
};

// how many evolutions come before this species (so a Charizard is not a level-5 wild spawn)
export function stageDepth(state, name) {
  let depth = 0, cur = name;
  const seen = new Set();
  while (depth < 4) {
    const from = state.evolvesFrom?.get(cur)?.[0];
    if (!from || seen.has(from.name)) break;
    seen.add(from.name);
    cur = from.name;
    depth++;
  }
  return depth;
}

const rarityOf = (catchRate) => (catchRate >= 150 ? "Common" : catchRate >= 75 ? "Uncommon" : catchRate >= 30 ? "Rare" : "Very rare");

// Species that plausibly turn up at this level in this kind of place, each with a weight.
export function candidates(state, { env = "grassland", level = 10, types = null, allowRare = false } = {}) {
  const wanted = types || ENVIRONMENTS[env]?.types || [];
  const cap = 270 + level * 7;
  const out = [];
  for (const p of state.pokemon) {
    if (/^mega |primal|gigantamax|-gmax/i.test(p.name)) continue;
    const depth = stageDepth(state, p.name);
    const minLevel = depth === 0 ? 1 : depth === 1 ? 14 : 30;
    if (level < minLevel) continue;
    if (p.total > cap) continue;
    if (!allowRare && p.catchRate < 45) continue;
    const match = wanted.includes(p.type1) ? 3 : wanted.includes(p.type2) ? 1.2 : 0;
    if (!match) continue;
    out.push({ p, w: match * (0.15 + p.catchRate / 255) });
  }
  return out;
}

function weighted(list, rng) {
  let n = rng() * list.reduce((t, x) => t + x.w, 0);
  for (const x of list) { n -= x.w; if (n <= 0) return x.p; }
  return list[list.length - 1]?.p;
}

export function learnedMoves(state, p, level, rng) {
  const rows = state.movesetsByDex?.get(p.dex) || [];
  let pool = rows.filter((r) => r.method === "L" && r.level <= level && String(r.game) === "1");
  if (!pool.length) pool = rows.filter((r) => r.method === "L" && r.level <= level);
  const byMove = new Map();
  for (const r of pool) if (!byMove.has(r.moveIdx) || byMove.get(r.moveIdx).level < r.level) byMove.set(r.moveIdx, r);
  const picked = [...byMove.values()].sort((a, b) => b.level - a.level).slice(0, 6);
  // a trainer's Pokémon know their four most recent moves; shuffle a little so they aren't identical
  const four = picked.slice(0, 4 + (rng() < 0.5 ? 1 : 0)).sort(() => rng() - 0.5).slice(0, 4);
  return four.map((r) => state.moves[r.moveIdx]?.name).filter(Boolean);
}

function describeMon(state, p, level, rng) {
  const ability = pick([p.ability1, p.ability2, p.ability1].filter(Boolean), rng);
  return { name: p.name, dex: p.dex, level, types: [p.type1, p.type2].filter(Boolean), ability, moves: learnedMoves(state, p, level, rng), catchRate: p.catchRate };
}
// One Pokémon of a given species at a given level, with moves it would know by then (the Whiteboard's Dex drop).
export function generateMon(state, name, level, rng = Math.random) {
  const p = state?.pokemonByName?.get(name);
  return p ? describeMon(state, p, Math.max(1, Math.min(100, Math.round(level) || 1)), rng) : null;
}

const monLine = (m) => `${m.name} (Lv ${m.level}, ${m.types.join("/")})${m.moves.length ? ` — ${m.moves.join(", ")}` : ""}`;

// ---------------------------------------------------------------- generators

export function wildEncounter(state, rng = Math.random, { env = "grassland", level = 10, count = 0, allowRare = false } = {}) {
  const pool = candidates(state, { env, level, allowRare });
  if (!pool.length) return { title: "Nothing lives here", lines: ["No species fit that level and place. Try a higher level or another environment."], mons: [] };
  const n = count || between(1, level < 15 ? 3 : 4, rng);
  const mons = Array.from({ length: n }, () => describeMon(state, weighted(pool, rng), Math.max(1, level + between(-2, 2, rng)), rng));
  const lines = mons.map((m) => `${monLine(m)} — ${rarityOf(m.catchRate).toLowerCase()} to find, catch rate ${m.catchRate}`);
  lines.push(`Behaviour: ${pick(["curious, keeps its distance", "territorial, attacks first", "scared, will flee at half HP", "protecting a nest or egg", "hunting something else and ignores you", "guarding a berry bush", "part of a bigger group nearby", "injured and aggressive"], rng)}`);
  return { title: `Wild encounter — ${ENVIRONMENTS[env]?.label || env}, level ~${level}`, lines, mons };
}

const TRAINER_CLASSES = [
  { name: "Bug Catcher", types: ["Bug"], quote: "I'll show you how strong my bugs are!", item: "a net and a jar of berries" },
  { name: "Hiker", types: ["Rock", "Ground", "Fighting"], quote: "The mountains made me tough, and so are my partners.", item: "a sturdy walking stick" },
  { name: "Swimmer", types: ["Water"], quote: "The water's perfect, and so is my team!", item: "a waterproof pack" },
  { name: "Psychic", types: ["Psychic", "Ghost"], quote: "I already know how this battle ends.", item: "a silver spoon" },
  { name: "Ace Trainer", types: [], quote: "I've been training for this day.", item: "a well-worn trainer card" },
  { name: "Breeder", types: ["Normal", "Fairy", "Grass"], quote: "Every one of mine has been raised with love.", item: "a basket of Pokémon eggs" },
  { name: "Fisherman", types: ["Water"], quote: "Patience wins every time.", item: "a rod and a bucket" },
  { name: "Rocker", types: ["Electric", "Steel", "Fire"], quote: "Turn it up! My team's going to rock you!", item: "a guitar with a cracked neck" },
  { name: "Ranger", types: ["Grass", "Normal", "Flying", "Ground"], quote: "Protecting the wild is my job.", item: "a field radio" },
  { name: "Scientist", types: ["Electric", "Poison", "Steel", "Psychic"], quote: "A perfect chance to test my theory.", item: "a notebook of sketches" },
  { name: "Dragon Tamer", types: ["Dragon"], quote: "Only the worthy see my dragons' full power.", item: "a scale on a leather cord" },
  { name: "Team grunt", types: ["Poison", "Dark"], quote: "Hand over your Pokémon, kid!", item: "a stolen Pokédex" },
];

export function trainerTeam(state, rng, level, size, types) {
  const pool = candidates(state, { level, types: types && types.length ? types : Object.values(ENVIRONMENTS).flatMap((e) => e.types), allowRare: level > 30 });
  if (!pool.length) return [];
  const team = [];
  const seen = new Set();
  let guard = 0;
  while (team.length < size && guard++ < 80) {
    const p = weighted(pool, rng);
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    team.push(describeMon(state, p, Math.max(1, level + between(-2, 1, rng) + (team.length === size - 1 ? 1 : 0)), rng));
  }
  return team;
}

export function trainerNpc(state, rng = Math.random, { level = 12, cls = "" } = {}) {
  const c = TRAINER_CLASSES.find((x) => x.name === cls) || pick(TRAINER_CLASSES, rng);
  const name = genName(pick(["human", "human", "elf", "halfling", "dwarf"], rng), rng);
  const size = level < 10 ? between(1, 2, rng) : level < 25 ? between(2, 3, rng) : level < 40 ? between(3, 4, rng) : between(4, 6, rng);
  const team = trainerTeam(state, rng, level, size, c.types);
  const lines = [
    `Looks and manner: ${pick(["cheerful and loud", "calm and watchful", "gruff but fair", "nervous, over-prepares", "showy, loves an audience", "quiet, speaks only after the battle"], rng)}`,
    `Carries: ${c.item}`,
    `Says: “${c.quote}”`,
    `Tactic: ${pick(["leads with their weakest to bait a switch", "stacks status moves first", "goes all-out on the first turn", "swaps often to keep type advantage", "saves the best for last", "uses held items cleverly"], rng)}`,
    "# Team",
    ...team.map(monLine),
    `Reward: ${level * between(30, 50, rng)} money${rng() < 0.3 ? `, plus ${pick(["a Potion", "an Antidote", "a Great Ball", "a rare berry", "a TM"], rng)}` : ""}`,
  ];
  return { title: `${c.name} ${name} (level ~${level})`, lines, mons: team };
}

const TOWN_A = ["Pebble", "Amber", "Cedar", "Mist", "Coral", "Iron", "Sunny", "Dusk", "Willow", "Rustle", "Harbor", "Ember", "Frost", "Maple", "Violet", "Granite"];
const TOWN_B = ["brook", "ville", "port", "haven", "field", "ridge", "cove", "wick", "dale", "gate", "stead", "bay"];
export const townName = (rng = Math.random) => pick(TOWN_A, rng) + pick(TOWN_B, rng);

const GYM_THEMES = {
  Normal: ["Everyone underestimates the plain, so the gym is a friendly arena with surprising tricks.", "Ordinary-looking floors hide trapdoors; trainers ask you to defeat them with exactly one move each."],
  Fire: ["A hot, red-lit arena with vents that blast steam every few rounds.", "A forge-gym: apprentices challenge you while the floor heats up over time."],
  Water: ["A flooded arena of platforms; falling in costs the battler a turn.", "Tide pools and a fountain maze: reach the leader by solving the water-level puzzle."],
  Electric: ["Charged floor panels: trainers are blocked until you route power through the right switches.", "A neon arena where lights go out each round; battles continue in the dark."],
  Grass: ["A greenhouse maze: overgrown vines block paths until burned or cut.", "Garden beds the leader tends; the gym changes with the season."],
  Ice: ["A frozen rink where you slide between trainers, and stopping needs planning.", "Snow-covered hall with ice puzzles: push blocks to open the way."],
  Fighting: ["A dojo with trial after trial; no Pokémon may be switched in the apprentices' fights.", "A boxing ring and a gauntlet of sparring partners."],
  Poison: ["A toxic-looking lab with colour-coded vats and gas that rises each turn.", "A sewer-like gym of pipe puzzles."],
  Ground: ["Shifting sand and a pit-trap maze to reach the leader.", "A quarry arena; boulders block paths until moved."],
  Flying: ["A tall tower with cannon launch pads between platforms.", "Open-air arena: fliers have the advantage in the opening rounds."],
  Psychic: ["Teleport pads linking rooms in a pattern you have to read.", "A mirror hall: some trainers are illusions."],
  Bug: ["A web-covered arena; each cut strand changes the route.", "A giant tree with branching paths and lookouts."],
  Rock: ["A mine-gym with minecart rails and collapsing tunnels.", "A boulder arena with sparring partners that knock rocks onto the field."],
  Ghost: ["A mansion with doors that lead somewhere else each time.", "A candlelit hall; flames go out as your team faints."],
  Dragon: ["A shrine hall guarded by statues; riddles about dragons open each door.", "A stormy summit arena reached by a long trial."],
  Dark: ["A back-alley arena in near darkness, with traps and ambushes.", "A casino-style gym: wager something to enter each fight."],
  Steel: ["A factory floor with conveyor belts and presses.", "A gleaming hall of mirrors and moving gears."],
  Fairy: ["A glowing garden, with charm-based challenges.", "A twilight ballroom: trainers duel in costume."],
};

export function gymLeader(state, rng = Math.random, { badge = 1, type = "" } = {}) {
  const t = type || pick(Object.keys(GYM_THEMES), rng);
  const level = 10 + (badge - 1) * 7;
  const size = Math.min(6, 2 + Math.floor((badge - 1) / 2) + (badge === 8 ? 1 : 0));
  const team = trainerTeam(state, rng, level, size, [t]);
  if (team.length) team[team.length - 1].level += 2;
  const name = genName(pick(["human", "elf", "dwarf", "orc"], rng), rng);
  const badgeName = `${pick(["Ember", "Tide", "Gale", "Stone", "Leaf", "Spark", "Shade", "Frost", "Iron", "Dawn", "Thunder", "Quake"], rng)} Badge`;
  const tm = (state.moves || []).filter((m) => m.type === t && m.power && !m.stub);
  const reward = tm.length ? pick(tm, rng).name : "a rare TM";
  return {
    title: `${t}-type Gym — ${name} of ${townName(rng)} (badge ${badge})`,
    lines: [
      `Leader: ${name}. ${pick(["Proud but fair", "Cheerful and theatrical", "Stern, rarely speaks", "A retired champion", "Young, with something to prove", "Warm, treats challengers like family"], rng)}`,
      `Gym: ${pick(GYM_THEMES[t] || ["A themed arena with puzzles."], rng)}`,
      `Apprentices: ${between(2, 4, rng)} trainers at level ~${Math.max(5, level - 3)} with ${t}-type Pokémon, one hidden in the maze`,
      "# Leader's team",
      ...team.map((m, i) => `${monLine(m)}${i === team.length - 1 ? " — ace" : ""}`),
      `Rewards: the ${badgeName}, ${reward} (TM), ${level * between(60, 90, rng)} money`,
      `The badge allows obedience up to level ${level + 12} and boosts ${t}-type moves a little, if you use that house rule.`,
    ],
    mons: team,
  };
}

export function route(state, rng = Math.random, { env = "forest", level = 8 } = {}) {
  const e = ENVIRONMENTS[env] || ENVIRONMENTS.forest;
  const pool = candidates(state, { env, level, allowRare: true });
  const table = [];
  const seen = new Set();
  let guard = 0;
  const rarities = ["Common", "Common", "Common", "Uncommon", "Uncommon", "Rare"];
  while (table.length < 6 && guard++ < 200 && pool.length) {
    const p = weighted(pool, rng);
    if (seen.has(p.name)) continue;
    const want = rarities[table.length];
    if (rarityOf(p.catchRate) !== want && guard < 120) continue;
    seen.add(p.name);
    table.push(`${want}: ${p.name} (${[p.type1, p.type2].filter(Boolean).join("/")}) Lv ${Math.max(1, level + between(-2, 2, rng))}`);
  }
  const items = (state.items || []).filter((i) => ["medicine", "training", "standard-balls", "spelunking", "vitamins", "healing"].includes(i.category) || /ball|potion|berry|repel|antidote/i.test(i.name));
  const found = Array.from({ length: between(2, 3, rng) }, () => (items.length ? pick(items, rng).name : "a Potion"));
  return {
    title: `${cap(pick(["Route", "Trail", "Passage", "Way"], rng))} ${between(1, 30, rng)}: ${e.label.toLowerCase()} near ${townName(rng)}`,
    lines: [
      `Terrain: ${e.label.toLowerCase()}, about ${between(2, 8, rng)} miles end to end`,
      `Hazard: ${pick(e.hazards, rng)}`,
      `Trainers: ${between(2, 4, rng)} (suggested: ${Array.from({ length: 2 }, () => pick(TRAINER_CLASSES, rng).name).join(", ")})`,
      `Items to find: ${found.join(", ")}`,
      `Event: ${pick(["a lost child asks you to find their Pokémon", "a rare Pokémon is seen at dusk", "a trainer is being bullied by a gang", "an abandoned research camp with notes", "a hidden shortcut behind a waterfall or wall", "a Pokémon is stuck and needs help", "a travelling merchant with odd stock", "a storm forces you to shelter overnight"], rng)}`,
      "# Wild Pokémon",
      ...table,
    ],
  };
}

const HOOK_WHO = ["A frightened Nurse Joy-like healer", "A rival trainer", "A gym apprentice", "A researcher", "The town mayor", "A shy kid", "A wandering breeder", "A ranger on the road"];
const HOOK_WANT = [
  "asks the party to find a Pokémon that wandered off a ranch", "needs an egg delivered before it hatches", "says a strange Pokémon is evolving in an unusual way",
  "begs for help against a gang stealing Pokémon", "challenges the party to a double battle with an odd rule", "wants a rare berry from a dangerous route",
  "asks for an escort through a cave full of wild Pokémon", "reports ghostly lights near an old shrine", "needs badges verified before the league deadline",
];
const HOOK_TWIST = ["but the Pokémon doesn't want to go home", "and the reward is far too generous", "but a rival got the same request", "and a gang is already watching the party", "but there is a time limit of two days", "and one of the party's Pokémon reacts strangely to it"];
export function hook(rng = Math.random) {
  return { title: "Adventure hook", lines: [`${pick(HOOK_WHO, rng)} ${pick(HOOK_WANT, rng)}, ${pick(HOOK_TWIST, rng)}.`] };
}

export function loot(state, rng = Math.random, { tier = "mid" } = {}) {
  const sets = {
    low: ["medicine", "standard-balls", "healing", "vitamins"],
    mid: ["medicine", "training", "held-items", "type-enhancement", "healing", "vitamins"],
    high: ["held-items", "choice", "type-enhancement", "plates", "scarves", "mega-stones", "training"],
  };
  const cats = sets[tier] || sets.mid;
  const pool = (state.items || []).filter((i) => cats.includes(i.category));
  const n = tier === "low" ? between(1, 3, rng) : tier === "mid" ? between(2, 4, rng) : between(3, 5, rng);
  const found = Array.from({ length: n }, () => (pool.length ? pick(pool, rng) : { name: "Potion", effect: "" }));
  return {
    title: `Treasure (${tier})`,
    lines: [...found.map((i) => `${i.name}${i.effect ? ` — ${i.effect}` : ""}`), `Money: ${between(1, 9, rng) * (tier === "low" ? 100 : tier === "mid" ? 500 : 2000)}`],
  };
}

export const GENERATORS = [
  { id: "wild", label: "Wild encounter", run: (s, r, o) => wildEncounter(s, r, o) },
  { id: "trainer", label: "Trainer", run: (s, r, o) => trainerNpc(s, r, o) },
  { id: "gym", label: "Gym leader", run: (s, r, o) => gymLeader(s, r, o) },
  { id: "route", label: "Route", run: (s, r, o) => route(s, r, o) },
  { id: "hook", label: "Hook", run: (s, r) => hook(r) },
  { id: "loot", label: "Treasure", run: (s, r, o) => loot(s, r, o) },
];
export const TRAINER_CLASS_NAMES = TRAINER_CLASSES.map((c) => c.name);
export const GYM_TYPES = Object.keys(GYM_THEMES);
