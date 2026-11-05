// Builds a whole Pokémon D&D campaign for the throwaway test server: "The Aurora Circuit", eight trainers chasing eight
// badges across the Veyra region while Team Eclipse tries to wake the legendary Lumarix. Prints JSON for
// tools/seed_pokemon_campaign.py, which sends it through the app's normal API as each account.
//
//   node tools/seed_pokemon_world.mjs
//
// What it makes (all from the app's own rules data, so species, moves, abilities and levels are real):
//  - eight players: a full trainer sheet (abilities, skills, backstory, portrait), six Pokémon in the party and more in
//    the PC (levels around 16-20, moves they'd know, abilities, held items, a few hurt or statused), a stocked bag,
//    and a personal planner with their own motive, goals and notes;
//  - the DM's NPC Library (the rival, Team Eclipse's admins and boss, the Professor) and Wild Library;
//  - the DM's planner: a Whiteboard with ten sessions (three played, seven planned) holding every gym leader,
//    trainers, wild encounters, routes, hooks, treasure, notes, stickies, checklists and the players' arcs, with
//    connections between them; a scenario per session; NPC / quest / location / session records; prep lists;
//  - the hub: encounter buttons (Whiteboard gyms, the NPC Library, the Wild Library), notes, props, labels, shapes,
//    a drawn route, Pokédex / Move Dex / item cards;
//  - a battle in progress (players send out one each, the rival several, everyone else on the bench).

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { addSession, addLink } from "../js/planner/board.js";
import { generateMon, trainerNpc, gymLeader, wildEncounter, route, hook, loot, learnedMoves } from "../js/planner/pokeGenerators.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf-8"));

// ---- the rules data, the same shape js/data.js builds in the browser ----------------------------------------------
const pokemon = json("data/pokemon.json"), moves = json("data/moves.json"), movesets = json("data/movesets.json");
const items = json("data/items.json"), evolutions = json("data/evolutions.json");
const state = {
  pokemon, moves, items,
  pokemonByName: new Map(pokemon.map((p) => [p.name, p])),
  moveByName: new Map(moves.map((m, i) => [m.name, i])),
  itemByName: new Map(items.map((i) => [i.name, i])),
  movesetsByDex: new Map(), evolvesFrom: new Map(),
};
for (const [dex, moveIdx, method, level, game] of movesets) {
  if (!state.movesetsByDex.has(dex)) state.movesetsByDex.set(dex, []);
  state.movesetsByDex.get(dex).push({ moveIdx, method, level, game });
}
for (const { from, to, method } of evolutions) {
  if (!state.evolvesFrom.has(to)) state.evolvesFrom.set(to, []);
  state.evolvesFrom.get(to).push({ name: from, method });
}
const SPRITES = new Set(readdirSync(join(ROOT, "sprites/trainers")));
const sprite = (...names) => names.find((n) => SPRITES.has(n)) || "";

// a seeded random, so every run makes the same world
let seed = 20261105;
const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
let counter = 0;
const id = (p = "n") => `${p}${(++counter).toString(36)}${Math.floor(rng() * 1e6).toString(36)}`;
const now = Date.now();
const warn = (m) => process.stderr.write(`warning: ${m}\n`);

// ---- one Pokémon on a player's team ---------------------------------------------------------------------------------
const STATUSES = ["Burn", "Poison", "Paralysis", "Sleep"];
function hpAt(p, level) { return Math.floor(((2 * p.hp + 15) * level) / 100) + level + 10; }
const HP_MAX = {};   // each Pokémon's max HP at its level (average IVs, no EVs), for hub cards and the battle
function teamMon(name, level, { nickname = "", item = "", hurt = 0, status = "None", ability = "" } = {}) {
  const m = generateMon(state, name, level, rng);
  if (!m) { warn(`no species ${name}`); return null; }
  const p = state.pokemonByName.get(name);
  const max = hpAt(p, level);
  const mid = id("m");
  HP_MAX[mid] = max;
  return {
    id: mid, dex: p.dex, name, nickname, level,
    currentHp: hurt ? Math.max(0, Math.round(max * (1 - hurt))) : null,
    item, ability: ability || m.ability || p.ability1 || "", status,
    moves: [...m.moves, "", "", "", ""].slice(0, 4),
  };
}
const tm = (move) => `TM: ${move}`;

// ---- the eight trainers ---------------------------------------------------------------------------------------------
// [key, name, portrait, sheet, motive, goals, party, pc, bag]
const PLAYERS = [
  {
    key: "rowan", name: "Rowan Hale", sprite: sprite("acetrainer-gen4dp.png", "acetrainer.png"),
    sheet: { gender: "Male", age: "17", occupation: "Ace Trainer", originRegion: "Veyra (Port Aster)", cash: 4200, badges: 3, abilities: { Strength: 12, Charisma: 14, Intelligence: 11, Pokémon: 16 }, plus2: "Pokémon", plus1: "Charisma", skills: ["Training", "Persuasion", "Athletics"] },
    backstory: "Rowan's mother, Champion Selene Hale, left to defend the Veyra title when he was eight and never came home. He has beaten every trainer in Port Aster and still can't make her answer a letter. He means to win the Aurora Circuit and ask her, face to face, why.",
    motive: "Win all eight badges and challenge the Champion, my mother, to ask why she left.",
    goals: [["Win the Pebble Badge", 1], ["Win the Tide Badge", 1], ["Win the Spark Badge", 1], ["Find out why Selene stopped writing"], ["Beat Vex once, properly"]],
    party: [["Monferno", 20, { nickname: "Ember", item: "Charcoal" }], ["Staravia", 18, { nickname: "Gale" }], ["Luxio", 18, { hurt: 0.4 }], ["Riolu", 17, { item: "Black Belt" }], ["Gabite", 19, { nickname: "Fang" }], ["Kirlia", 17, { status: "Paralysis", hurt: 0.2 }]],
    pc: [["Bidoof", 9, { nickname: "Captain" }], ["Shinx", 8], ["Budew", 10]],
    bag: { "Poké Ball": 6, "Great Ball": 3, "Potion": 4, "Super Potion": 2, "Full Heal": 1, [tm("Dragon Claw")]: 1, "Exp. Share": 1 },
  },
  {
    key: "isla", name: "Isla Marin", sprite: sprite("swimmerf-gen4dp.png", "swimmerf-gen4.png", "swimmerf.png"),
    sheet: { gender: "Female", age: "22", occupation: "Marine Researcher", originRegion: "Coralline Isles", cash: 2600, badges: 3, abilities: { Strength: 11, Charisma: 12, Intelligence: 16, Pokémon: 14 }, plus2: "Intelligence", plus1: "Pokémon", skills: ["Medicine", "Perception", "Communication"] },
    backstory: "Isla's mentor, Professor Coral Venn, sailed out after a pod of wild Lapras a year ago and her boat came back empty. The only clue is a song Isla's Lapras-tracker picked up off the Shimmer Reef: a song no Lapras should know.",
    motive: "Find Professor Venn and the Lapras pod, and learn who taught them that song.",
    goals: [["Record the reef song", 1], ["Ask the Tide Gym leader about the pod", 1], ["Get a boat to the Shimmer Reef"], ["Find Professor Venn"]],
    party: [["Wartortle", 19, { nickname: "Shellby", item: "Mystic Water" }], ["Lapras", 18, { nickname: "Aria" }], ["Floatzel", 18], ["Shellos", 16], ["Chinchou", 17, { hurt: 0.5 }], ["Spheal", 16, { nickname: "Pudding" }]],
    pc: [["Magikarp", 12, { nickname: "Sir Splash" }], ["Finneon", 14], ["Wingull", 13], ["Corsola", 15]],
    bag: { "Dive Ball": 0, "Poké Ball": 4, "Great Ball": 2, "Potion": 3, "Antidote": 2, "Fresh Water": 4, [tm("Water Pulse")]: 1, "Old Rod": 1 },
  },
  {
    key: "kai", name: "Kai Draven", sprite: sprite("teamgalacticgrunt.png", "punkguy-gen4.png", "roughneck-gen4.png", "guitarist-gen4.png"),
    sheet: { gender: "Male", age: "19", occupation: "Ex-Team Eclipse grunt", originRegion: "Duskhollow", cash: 900, badges: 2, abilities: { Strength: 14, Charisma: 10, Intelligence: 13, Pokémon: 14 }, plus2: "Strength", plus1: "Intelligence", skills: ["Stealth", "Deception", "Intimidation"] },
    backstory: "Kai ran Team Eclipse's lockpicks for two years until the night they tried to cage a Riolu pup and he let it go. Now Admin Morrow wants him back or buried, and the rest of the party doesn't know where his Houndour came from.",
    motive: "Make up for what I did with Team Eclipse, and stop Admin Morrow before he finds me.",
    goals: [["Tell the party the truth"], ["Free the Pokémon in the Duskhollow lab"], ["Get the stolen Moon Stone back", 1], ["Face Morrow"]],
    party: [["Houndour", 18, { nickname: "Ash", item: "Black Glasses" }], ["Croagunk", 17], ["Murkrow", 17, { nickname: "Pickpocket" }], ["Gligar", 16, { hurt: 0.3 }], ["Stunky", 16, { status: "Poison" }], ["Sneasel", 18]],
    pc: [["Zubat", 11], ["Poochyena", 10, { nickname: "Scraps" }], ["Purrloin", 12]],
    bag: { "Poké Ball": 3, "Potion": 2, "Smoke Ball": 1, "Ultra Ball": 1, [tm("Dark Pulse")]: 1, "Moon Stone": 1 },
  },
  {
    key: "mina", name: "Mina Sol", sprite: sprite("pokemonbreederf-gen4.png", "pokemonbreederf.png", "breederf.png"),
    sheet: { gender: "Female", age: "24", occupation: "Pokémon Breeder", originRegion: "Bloomvale", cash: 3100, badges: 2, abilities: { Strength: 10, Charisma: 15, Intelligence: 12, Pokémon: 15 }, plus2: "Charisma", plus1: "Pokémon", skills: ["Medicine", "Communication", "Persuasion"] },
    backstory: "Mina grew up in her grandmother's Pokémon Daycare in Bloomvale, which the town sold to Team Eclipse's 'Aurora Wellness' company when her grandmother died. Something is wrong with the eggs coming out of it now.",
    motive: "Win back Grandma Sol's daycare in Bloomvale and find out what Aurora Wellness is doing to the eggs.",
    goals: [["Hatch the egg the DM gave me"], ["Sneak a look at the daycare ledger"], ["Raise the money to buy it back"], ["Prove Aurora Wellness is Team Eclipse"]],
    party: [["Clefairy", 17, { nickname: "Moonbeam", item: "Moon Stone" }], ["Togetic", 18, { nickname: "Halo" }], ["Eevee", 16, { nickname: "Button" }], ["Chansey", 18, { item: "Lucky Egg" }], ["Snubbull", 16], ["Audino", 17]],
    pc: [["Happiny", 6], ["Igglybuff", 5], ["Azurill", 7], ["Pichu", 6, { nickname: "Static" }]],
    bag: { "Poké Ball": 5, "Friend Ball": 0, "Potion": 6, "Super Potion": 3, "Revive": 2, "Oran Berry": 5, "Everstone": 1 },
  },
  {
    key: "theo", name: "Theo Granger", sprite: sprite("hiker-gen4dp.png", "hiker-gen4.png", "hiker.png"),
    sheet: { gender: "Male", age: "34", occupation: "Hiker and cartographer", originRegion: "Skyreach foothills", cash: 1800, badges: 3, abilities: { Strength: 16, Charisma: 11, Intelligence: 13, Pokémon: 12 }, plus2: "Strength", plus1: "Intelligence", skills: ["Athletics", "Physicality", "Perception"] },
    backstory: "Theo has mapped every trail in Veyra except one: the Skyreach summit, where his brother disappeared chasing lights in the clouds. The Pebble Gym leader says the lights came back last month.",
    motive: "Map the Skyreach summit and find out what happened to my brother.",
    goals: [["Chart Route 3", 1], ["Get the climbing permit from the Pebble Gym", 1], ["Reach the cloud cave"], ["Find Owen's camp"]],
    party: [["Graveler", 19, { nickname: "Boulder" }], ["Onix", 18, { item: "Hard Stone" }], ["Gible", 16], ["Hippopotas", 17], ["Machoke", 18, { nickname: "Pack Mule" }], ["Bronzor", 16, { hurt: 0.6 }]],
    pc: [["Geodude", 10], ["Sandshrew", 11], ["Rhyhorn", 14], ["Nosepass", 13], ["Larvitar", 9]],
    bag: { "Poké Ball": 4, "Great Ball": 2, "Potion": 3, "Escape Rope": 3, "Repel": 4, [tm("Rock Slide")]: 1, "Town Map": 1 },
  },
  {
    key: "juno", name: "Juno Bright", sprite: sprite("idol-gen4.png", "idol.png", "beauty-gen4.png", "beauty.png"),
    sheet: { gender: "Female", age: "18", occupation: "Pokémon Idol", originRegion: "Neon Port", cash: 5200, badges: 2, abilities: { Strength: 10, Charisma: 17, Intelligence: 11, Pokémon: 13 }, plus2: "Charisma", plus1: "Pokémon", skills: ["Persuasion", "Deception", "Acrobatics"] },
    backstory: "Juno's livestreams made her famous; her manager made her rich. She found out he sold her fans' data to Aurora Wellness and quit on air. Now she battles under her own name and needs the Circuit to prove she is more than a face.",
    motive: "Win the Grand Festival on my own terms and expose my old manager's deal with Aurora Wellness.",
    goals: [["Win the Spark Badge", 1], ["Enter the Neon Port contest"], ["Get the recording off my old phone"], ["Go live with the truth"]],
    party: [["Pikachu", 18, { nickname: "Sparkle", item: "Light Ball" }], ["Jigglypuff", 17, { nickname: "Encore" }], ["Pachirisu", 17], ["Glameow", 16], ["Roselia", 17], ["Mime Jr.", 15]],
    pc: [["Plusle", 14], ["Minun", 14], ["Skitty", 12, { nickname: "Glitter" }]],
    bag: { "Poké Ball": 3, "Luxury Ball": 0, "Potion": 2, "Super Potion": 2, "Full Heal": 2, [tm("Charge Beam")]: 1, "Silk Scarf": 1 },
  },
  {
    key: "ezra", name: "Ezra Quill", sprite: sprite("psychic-gen4dp.png", "psychic-gen4.png", "psychic.png"),
    sheet: { gender: "Non-binary", age: "15", occupation: "Psychic", originRegion: "Veilwood", cash: 1200, badges: 2, abilities: { Strength: 8, Charisma: 12, Intelligence: 16, Pokémon: 15 }, plus2: "Intelligence", plus1: "Pokémon", skills: ["Perception", "Communication", "Medicine"] },
    backstory: "Every night for a month Ezra has dreamed of a great white bird made of light, chained under a mountain, singing for help. Their Kirlia dreams it too. Last night the dream had a date in it: the night of the next aurora.",
    motive: "Find the bird of light from my dreams, Lumarix, before Team Eclipse chains it for good.",
    goals: [["Write down every dream", 1], ["Find the shrine from the dream"], ["Learn the aurora date"], ["Reach Lumarix first"]],
    party: [["Kirlia", 19, { nickname: "Lumen", item: "Twisted Spoon" }], ["Haunter", 18, { nickname: "Whisper" }], ["Natu", 16], ["Drowzee", 17], ["Misdreavus", 17, { status: "Sleep" }], ["Chingling", 15]],
    pc: [["Abra", 10, { nickname: "Blink" }], ["Gastly", 12], ["Spoink", 11]],
    bag: { "Poké Ball": 3, "Potion": 3, "Awakening": 2, "Dusk Ball": 0, [tm("Psybeam")]: 1, "Spell Tag": 1 },
  },
  {
    key: "sol", name: "Sol Rivera", sprite: sprite("pokemonranger-gen4.png", "pokemonranger.png", "ranger-gen4.png"),
    sheet: { gender: "Male", age: "26", occupation: "Pokémon Ranger", originRegion: "Greenmantle Forest", cash: 2200, badges: 2, abilities: { Strength: 13, Charisma: 12, Intelligence: 12, Pokémon: 15 }, plus2: "Pokémon", plus1: "Strength", skills: ["Stealth", "Catching", "Training"] },
    backstory: "Sol keeps the Greenmantle Forest. Since spring, Aurora Wellness trucks have been logging the old heart-trees by night, and the forest's Pokémon are fleeing into the towns. The Rangers' office says it can't prove anything.",
    motive: "Stop the logging in Greenmantle and bring the forest's Pokémon home.",
    goals: [["Photograph the logging trucks", 1], ["Find where the heart-trees go"], ["Get the Rangers to act"], ["Plant the seed of the old tree"]],
    party: [["Grotle", 19, { nickname: "Moss", item: "Miracle Seed" }], ["Kricketune", 17], ["Combee", 15], ["Budew", 16], ["Burmy", 15, { nickname: "Leafcoat" }], ["Cherubi", 16]],
    pc: [["Caterpie", 8], ["Weedle", 8], ["Oddish", 11], ["Seedot", 10, { nickname: "Acorn" }]],
    bag: { "Poké Ball": 5, "Nest Ball": 0, "Potion": 3, "Antidote": 3, "Paralyze Heal": 2, [tm("Bullet Seed")]: 1, "Honey": 2 },
  },
];
function buildPlayer(p) {
  const mk = ([name, level, opts]) => teamMon(name, level, opts);
  const party = p.party.map(mk).filter(Boolean);
  const pc = p.pc.map(mk).filter(Boolean);
  const bag = Object.fromEntries(Object.entries(p.bag).filter(([, n]) => n > 0));
  const trainer = {
    name: p.name, trainerId: String(100000 + Math.floor(rng() * 899999)), gender: p.sheet.gender, age: p.sheet.age, occupation: p.sheet.occupation,
    originRegion: p.sheet.originRegion, cash: p.sheet.cash, badges: p.sheet.badges, proficiencyBonus: 2,
    abilities: p.sheet.abilities, abilityBonus: { plus2: p.sheet.plus2, plus1: p.sheet.plus1 },
    skillProficiencies: Object.fromEntries(p.sheet.skills.map((s) => [s, true])), backstory: p.backstory, sprite: p.sprite,
  };
  return { key: p.key, name: p.name, sprite: p.sprite, trainer, party, pc, bag, motive: p.motive, goals: p.goals };
}
const players = PLAYERS.map(buildPlayer);

// ---- the DM's libraries -------------------------------------------------------------------------------------------
const libMon = (name, level, opts = {}) => { const m = teamMon(name, level, opts); return m && { ...m, currentHp: null, status: "None" }; };
const NPCS = [
  { id: "npc-vex", name: "Rival Vex Calder", sprite: sprite("blue-gen4.png", "rival-gen4.png", "barry.png", "blue.png"), party: [["Prinplup", 21, { item: "Mystic Water" }], ["Staravia", 19], ["Monferno", 20], ["Roselia", 19]] },
  { id: "npc-morrow", name: "Eclipse Admin Morrow", sprite: sprite("mars.png", "saturn.png", "teamgalacticgrunt.png"), party: [["Golbat", 23], ["Skuntank", 24, { item: "Black Sludge" }], ["Bronzong", 25]] },
  { id: "npc-nyra", name: "Eclipse Admin Nyra", sprite: sprite("jupiter.png", "mars.png", "teamgalacticgruntf.png"), party: [["Purugly", 24], ["Honchkrow", 25], ["Toxicroak", 24]] },
  { id: "npc-aurelius", name: "Eclipse Boss Aurelius", sprite: sprite("cyrus.png", "giovanni.png"), party: [["Weavile", 34], ["Crobat", 34], ["Gyarados", 35], ["Houndoom", 35], ["Honchkrow", 36]] },
  { id: "npc-grunt", name: "Eclipse Grunts", sprite: sprite("teamgalacticgrunt.png", "teamrocketgrunt.png"), party: [["Zubat", 15], ["Stunky", 15], ["Glameow", 16]] },
  { id: "npc-oakley", name: "Professor Oakley", sprite: sprite("rowan.png", "professor.png", "oak.png"), party: [["Chatot", 30]] },
  { id: "npc-selene", name: "Champion Selene Hale", sprite: sprite("cynthia.png", "cynthia-gen4.png"), party: [["Garchomp", 55], ["Lucario", 52], ["Togekiss", 52], ["Milotic", 53], ["Roserade", 52], ["Spiritomb", 51]] },
];
const npcs = NPCS.map((n) => ({ id: n.id, name: n.name, sprite: n.sprite, team: { party: n.party.map(([s, l, o]) => libMon(s, l, o)).filter(Boolean) } }));
const WILD = [
  ["wild-lumarix", "Lugia", 60, "Lumarix (Lugia stands in for the legend)"], ["wild-snorlax", "Snorlax", 22, ""], ["wild-ralts", "Ralts", 14, ""],
  ["wild-gible", "Gible", 18, ""], ["wild-riolu", "Riolu", 15, "The pup Kai freed"], ["wild-lapras", "Lapras", 24, "Pod leader"],
  ["wild-spiritomb", "Spiritomb", 28, ""], ["wild-shinyeevee", "Eevee", 12, "Shiny, scared"],
];
const wild = WILD.map(([wid, name, level, nick]) => { const m = libMon(name, level, { nickname: nick.startsWith("Lumarix") ? "Lumarix" : "" }); if (m) HP_MAX[wid] = HP_MAX[m.id]; return m && { wildId: wid, mon: { ...m, id: wid } }; }).filter(Boolean);

// ---- the DM's planner Whiteboard ----------------------------------------------------------------------------------
const BOARD_ID = "aurora-board";
const SESSIONS = 10, COLS = 5, PX = 1500, PY = 1100, BW = 1350, BH = 900, X0 = -3600, Y0 = -1100;
const boxes = Array.from({ length: SESSIONS }, (_, i) => ({ kind: "box", x: X0 + (i % COLS) * PX, y: Y0 + Math.floor(i / COLS) * PY, w: BW, h: BH }));
const nodes = [];
const add = (o) => { const x = { id: id("n"), w: 320, h: 260, ...o }; nodes.push(x); return x; };
const genNode = (gen, res, pos, extra = {}) => add({ type: "gen", gen, kind: gen === "wild" ? "wildmon" : gen, genLabel: { wild: "Wild encounter", trainer: "Trainer", gym: "Gym leader", route: "Route", hook: "Hook", loot: "Treasure" }[gen], title: res.title, lines: res.lines, ...(res.mons ? { mons: res.mons.map((m) => ({ ...m, moves: m.moves.slice(0, 4) })) } : {}), ...pos, ...extra });
const GYMS = [
  ["Rock", "Garnet", "Brawly", sprite("roark.png", "brock.png"), 14], ["Water", "Marisol", "", sprite("crasherwake.png", "misty.png"), 16],
  ["Electric", "Volta", "", sprite("volkner.png", "wattson.png"), 18], ["Grass", "Fern", "", sprite("gardenia.png", "erika.png"), 21],
  ["Ghost", "Morticia", "", sprite("fantina.png", "morty.png"), 24], ["Fighting", "Kenji", "", sprite("maylene.png", "brawly.png"), 27],
  ["Ice", "Frost", "", sprite("candice.png", "pryce.png"), 30], ["Dragon", "Draco", "", sprite("clair.png", "drake.png"), 34],
];
const SESSION_TITLES = [
  "1: Port Aster and the Pebble Badge (played)", "2: Tides of the Shimmer Reef (played)", "3: Spark City Blackout (played)",
  "4: Greenmantle Burns", "5: Night at Veilwood Shrine", "6: The Duskhollow Lab", "7: Bloomvale Daycare", "8: Frostpeak Pass",
  "9: Skyreach and the Aurora", "10: The Draco Gym and the League",
];
const board = { id: BOARD_ID, name: "The Aurora Circuit", bg: "cosmic", nodes, links: [], sessions: [], view: { x: 0, y: 0, z: 0.35 } };

const gymNodes = [];
const GYM_SESSION = [0, 1, 2, 3, 4, 5, 7, 9];   // which session each gym is in (6: Bloomvale and 8: Skyreach have none)
GYMS.forEach(([type, leader, , portrait, level], i) => {
  const b = boxes[GYM_SESSION[i]];
  const g = gymLeader(state, rng, { type, level, badge: i + 1 });
  const node = genNode("gym", g, { x: b.x + 60, y: b.y + 90, w: 380, h: 520 }, { level, identity: { name: `Gym Leader ${leader}`, npcId: "", sprite: portrait } });
  node.title = `Gym Leader ${leader}`;
  gymNodes.push(node);
});
const sticky = (title, body, pos, color = "#f6e27a") => add({ type: "text", title, body, color, ...pos });
const note = (title, body, pos) => add({ type: "note", title, body, ...pos });
const list = (title, its, pos) => add({ type: "list", title, items: its.map(([t, d]) => ({ id: id("i"), text: t, done: !!d })), ...pos });
const at = (i, col, row) => ({ x: boxes[i].x + 480 + col * 420, y: boxes[i].y + 90 + row * 320 });
const ENVS = ["mountain", "water", "urban", "forest", "ruins", "cave", "grassland", "snow", "mountain", "volcano"];
const RECAPS = [
  "PLAYED. Everyone met at Professor Oakley's lab. Vex picked a fight with Rowan on day one. Garnet's Onix nearly flattened Theo's team; Rowan won the Pebble Badge with Ember's Mach Punch.",
  "PLAYED. Isla recorded the reef song. Eclipse grunts were already netting Lapras; Kai knew their call-signs and went very quiet. The Tide Badge fell to a double battle.",
  "PLAYED. Spark City went dark: Eclipse stole the power plant's generator coils. Juno streamed the rescue. Volta gave the badge and a warning about Admin Morrow.",
];
for (let i = 0; i < SESSIONS; i++) {
  const lv = [14, 16, 18, 20, 22, 24, 26, 29, 32, 35][i];
  if (i < 3) sticky("Recap", RECAPS[i], at(i, 1, 1), "#9be0a8");
  const tr = trainerNpc(state, rng, { level: lv - 1 });
  genNode("trainer", tr, { ...at(i, 0, 0), h: 330 }, { level: lv - 1 });
  const w = wildEncounter(state, rng, { env: ENVS[i], level: lv - 2, count: 2 });
  genNode("wild", w, { ...at(i, 1, 0), h: 300 }, { level: lv - 2 });
  if (i % 2 === 0) genNode("route", route(state, rng, { env: ENVS[i], level: lv - 2 }), at(i, 0, 1));
  else genNode("loot", loot(state, rng, { tier: lv < 22 ? "low" : "mid" }), at(i, 0, 1));
  if (i >= 3) genNode("hook", hook(rng), at(i, 1, 1));
}
// the players' arcs and the villains, along the top
const ARC_Y = Y0 - 700;
players.forEach((p, i) => sticky(`${p.name.split(" ")[0]}'s arc`, p.motive, { x: X0 + i * 900, y: ARC_Y, w: 320, h: 220 }, ["#ffb8c8", "#9fd8ff", "#d9c2ff", "#f6e27a", "#b5eab0", "#ffb8c8", "#d9c2ff", "#b5eab0"][i]));
const villain = note("Team Eclipse", "Front company: Aurora Wellness. Boss Aurelius wants to chain Lumarix and sell 'eternal auroras' to the highest bidder. Admins: Morrow (Duskhollow, Kai's old boss) and Nyra (Bloomvale daycare).", { x: X0 + 8 * 900, y: ARC_Y, w: 380, h: 260 });
const legend = note("Lumarix", "A great white bird of light that sings the aurora into the sky. Sleeps under Skyreach. Ezra dreams of it; Isla's Lapras learned its song; Theo's brother went looking for its lights.", { x: X0 + 9 * 900, y: ARC_Y, w: 380, h: 260 });
list("Campaign prep", [["Stat all eight gym leaders", 1], ["Name every town", 1], ["Battle backgrounds for each gym"], ["Print the badge cards"], ["Decide what Selene knows about Lumarix"]], { x: X0 + 10 * 900, y: ARC_Y, w: 340, h: 300 });
// library cards on the board: the rival and the boss, ready to drop into slots
const vexCard = add({ type: "libtrainer", title: npcs[0].name, npcId: npcs[0].id, sprite: npcs[0].sprite, mons: npcs[0].team.party.map(({ name, nickname, dex, level, ability, item, moves }) => ({ name, nickname, dex, level, ability, item, moves: moves.filter(Boolean) })), x: X0 + 11 * 900, y: ARC_Y, w: 320, h: 230, level: 20 });
add({ type: "libmon", title: "Lumarix", mon: { name: wild[0].mon.name, nickname: "Lumarix", dex: wild[0].mon.dex, level: 60, ability: wild[0].mon.ability, item: "", moves: wild[0].mon.moves.filter(Boolean) }, source: { kind: "wild", id: "wild-lumarix" }, x: X0 + 12 * 900, y: ARC_Y, w: 300, h: 210 });
// connections: villains to sessions they touch, arcs to their payoffs, gyms in order
const link = (a, b, rel, label = "") => addLink(board, { from: a.id, to: b.id, rel, label });
const arcNodes = nodes.filter((n) => n.title?.endsWith("'s arc"));
const sessionHub = (i) => nodes.find((n) => n.type === "gen" && n.gen === "trainer" && n.x === at(i, 0, 0).x && n.y === at(i, 0, 0).y);
[[0, 0], [1, 1], [2, 2], [3, 6], [4, 3], [5, 7], [6, 4], [7, 8]].forEach(([p, s]) => { const t = sessionHub(s); if (arcNodes[p] && t) link(arcNodes[p], t, "custom", "pays off here"); });
link(villain, sessionHub(5), "custom", "Morrow's lab");
link(villain, sessionHub(6), "custom", "Nyra's daycare");
link(legend, sessionHub(8), "custom", "the aurora");
link(vexCard, sessionHub(3), "custom", "rematch");
// a session box round each session's nodes (numbered 1 to 10 on the board)
boxes.forEach((b) => addSession(board, b));
board.bounds = undefined;

// ---- scenarios, notebook and prep lists ------------------------------------------------------------------------------
const scene = (title, kind, f = {}) => ({ id: id("c"), title, kind, location: "", readAloud: "", body: "", npcs: "", foes: "", secrets: "", rewards: "", branches: "", done: false, ...f });
const sc = (title, status, hookText, goal, scenes, level) => ({ id: id("s"), title, status, hook: hookText, goal, level: String(level), summary: goal, scenes, created: now, updated: now });
const scenarios = SESSION_TITLES.map((t, i) => {
  const [type, leader] = GYMS[Math.max(0, GYM_SESSION.filter((g) => g <= i).length - 1)];
  const done = i < 3;
  return sc(`Session ${t}`, done ? "played" : i === 3 ? "ready" : "draft",
    ["Professor Oakley hands out the Circuit passes.", "The Lapras pod is in trouble on the reef.", "Spark City's power fails at the worst moment.", "Smoke over Greenmantle at dawn.", "Ezra's dream points to the Veilwood Shrine.", "Kai's old lab is lit again.", "The daycare sells 'perfect' eggs.", "The pass to Frostpeak is snowed in.", "The aurora is coming.", "Eight badges. One League."][i],
    GYM_SESSION.includes(i) ? `Win the ${type} badge from ${leader} and push the Eclipse plot forward.` : "No gym here: follow the Eclipse plot.",
    [scene("Arrival", "travel", { location: ["Port Aster", "Shimmer Reef", "Spark City", "Greenmantle", "Veilwood", "Duskhollow", "Bloomvale", "Frostpeak", "Skyreach", "Draco City"][i], done }),
      scene("Trouble", i % 2 ? "combat" : "social", { foes: i >= 3 ? "Eclipse grunts" : "", done }),
      GYM_SESSION.includes(i) ? scene(`${leader}'s gym`, "boss", { foes: `Gym Leader ${leader}`, rewards: `${type} Badge`, done }) : scene(i === 6 ? "Inside the daycare" : "The aurora", "boss", { foes: i === 6 ? "Admin Nyra" : "Boss Aurelius, Lumarix", done })],
    [14, 16, 18, 20, 22, 24, 26, 29, 32, 35][i]);
});
const nnote = (title, body, extra = {}) => ({ id: id("t"), title, body, tags: [], pinned: false, created: now, updated: now, ...extra });
const rec = (kind, title, body, fields = {}, tags = []) => nnote(title, body, { kind, fields, tags });
const plist = (title, its) => ({ id: id("l"), title, items: its.map(([text, done]) => ({ id: id("i"), text, done: !!done })), created: now, updated: now });
const dmPlan = {
  notes: [
    nnote("Campaign pitch", "The Aurora Circuit: eight trainers chase eight badges across Veyra, while Team Eclipse, hiding behind the Aurora Wellness company, hunts Lumarix, the bird of light that sings the aurora. Every trainer's story leads to Skyreach on the night of the aurora.", { tags: ["overview"], pinned: true }),
    nnote("House rules", "Players send out one Pokémon each; switching uses your turn. Catches: d20 x5 against the catch chance (level, HP, status, ball). Gym leaders get a free switch. Eggs hatch at the DM's call.", { tags: ["rules"] }),
    ...RECAPS.map((r, i) => rec("session", `Session ${SESSION_TITLES[i]}`, r.replace("PLAYED. ", ""), { date: `2026-10-${String(10 + i * 7).padStart(2, "0")}`, level: String([14, 16, 18][i]) }, ["recap"])),
    rec("session", "Session 4: Greenmantle Burns (next)", "Logging trucks, a forest fire, Fern's gym in a greenhouse. Sol's arc lands. Vex rematch.", { date: "2026-11-07", level: "20" }, ["next"]),
    rec("quest", "The Aurora Circuit", "Eight badges, then the League at Draco City.", { status: "Active", giver: "Professor Oakley", reward: "A shot at the Champion" }, ["main"]),
    rec("quest", "Stop Team Eclipse", "Find out what Aurora Wellness really is and stop the Lumarix plan.", { status: "Active", giver: "Gym Leader Volta", reward: "Veyra" }, ["main"]),
    ...players.map((p) => rec("quest", `${p.name.split(" ")[0]}: ${p.goals[0][0]}`, p.motive, { status: "Active", giver: p.name, reward: "Their story" }, ["arc"])),
    rec("npc", "Professor Oakley", "Runs the Port Aster lab. Knew Champion Selene. Hides a Lumarix feather in a drawer.", { role: "Mentor", attitude: "Friendly" }, ["ally"]),
    rec("npc", "Vex Calder", "Rowan's rival. Loud, gifted, secretly sponsored by Aurora Wellness without knowing it.", { role: "Rival", attitude: "Competitive" }, ["rival"]),
    rec("npc", "Admin Morrow", "Kai's old boss. Calm, cruel, collects debts.", { role: "Eclipse admin", attitude: "Hostile" }, ["villain"]),
    rec("npc", "Admin Nyra", "Runs the Bloomvale 'daycare'. Smiles a lot.", { role: "Eclipse admin", attitude: "Hostile" }, ["villain"]),
    rec("npc", "Boss Aurelius", "Founder of Aurora Wellness. Wants to own the sky.", { role: "Villain", attitude: "Hostile" }, ["villain"]),
    rec("npc", "Champion Selene Hale", "Rowan's mother. Left to guard Skyreach, not the title.", { role: "Champion", attitude: "Unknown" }, ["secret"]),
    ...["Port Aster", "Shimmer Reef", "Spark City", "Greenmantle Forest", "Veilwood Shrine", "Duskhollow", "Bloomvale", "Frostpeak", "Skyreach", "Draco City"].map((place, i) => rec("location", place, GYM_SESSION.includes(i) ? `Session ${i + 1}. ${GYMS[GYM_SESSION.indexOf(i)][0]}-type gym.` : `Session ${i + 1}. No gym.`, { place: i === 8 ? "Mountain" : "Town" }, [i < 3 ? "visited" : "ahead"])),
  ],
  lists: [
    plist("Before next session", [["Text everyone the date", 1], ["Prep Greenmantle fire map"], ["Pick battle music for Fern"], ["Give Mina's egg a hatch time"]]),
    plist("Plot threads", [["What is in the daycare eggs?"], ["Who taught the Lapras the song?", 1], ["Why did Selene really leave?"], ["Where is Theo's brother?"], ["Can Kai be trusted?", 1]]),
    plist("Badges won", [["Pebble Badge (Garnet)", 1], ["Tide Badge (Marisol)", 1], ["Spark Badge (Volta)", 1], ["Leaf Badge (Fern)"], ["Shade Badge (Morticia)"], ["Fist Badge (Kenji)"], ["Frost Badge (Frost)"], ["Scale Badge (Draco)"]]),
  ],
  scenarios, maps: [], boards: [board], updated: now, displayName: "", legacyImported: true,
};

// ---- each player's own planner (shared with the DM) -----------------------------------------------------------------
const playerPlans = Object.fromEntries(players.map((p) => [p.key, {
  notes: [nnote("What I want", p.motive, { tags: ["motive"], pinned: true }), nnote("Session notes", `Three badges in. Team Eclipse is behind Aurora Wellness. Vex is everywhere. ${p.name.split(" ")[0]}'s next step: ${p.goals.find((g) => !g[1])?.[0] || "keep going"}.`, { tags: ["recap"] })],
  lists: [plist("My goals", p.goals), plist("Party to-do", [["Restock Potions in Greenmantle"], ["Ask Oakley about the feather"], ["Train for Fern's gym", 1]])],
  boards: [], updated: now,
}]));

// ---- the hub ------------------------------------------------------------------------------------------------------
const H = [];
const hub = (o) => { const x = { id: id("h"), ...o }; H.push(x); return x; };
hub({ type: "text", text: "THE AURORA CIRCUIT", x: 600, y: -620, size: 64, color: "#ffffff" });
hub({ type: "text", text: "Next stop: Greenmantle Forest", x: 640, y: -540, size: 28, color: "#b5eab0" });
hub({ type: "note", text: "Session 4 tonight: Greenmantle is burning. Restock before you go!\nHouse rule: switching uses your turn.", x: -400, y: -520, w: 300, h: 180, color: "#f6e27a" });
hub({ type: "note", text: "DM: Vex rematch after the fire. Fern's Roserade holds a Big Root.", x: -400, y: -300, w: 260, h: 150, color: "#ffb8c8", dmOnly: true });
// the road between the towns, drawn
const road = [[-200, 300], [100, 240], [400, 320], [700, 260], [1000, 340], [1300, 280], [1600, 360], [1900, 300], [2200, 380]];
hub({ type: "stroke", pts: road, width: 6, color: "#e8a33a" });
["Port Aster", "Shimmer Reef", "Spark City", "Greenmantle", "Veilwood", "Duskhollow", "Bloomvale", "Frostpeak", "Skyreach"].forEach((town, i) => {
  const [x, y] = road[i];
  hub({ type: "prop", prop: i === 8 ? "mountain" : i === 3 ? "tree" : i === 1 ? "water" : "house", x: x - 28, y: y - 90, size: 56 });
  hub({ type: "text", text: town, x: x - 50, y: y + 30, size: 18, color: i < 3 ? "#ffffff" : "#a1a1aa" });
});
hub({ type: "prop", prop: "fire", x: 680, y: 150, size: 70 });
hub({ type: "prop", prop: "star", x: 2180, y: 200, size: 80 });
hub({ type: "shape", shape: "ellipse", x: 600, y: 140, x2: 820, y2: 420, width: 4, color: "#f05a5a", fill: false });
hub({ type: "shape", shape: "arrow", x: 1700, y: 120, x2: 2120, y2: 250, width: 4, color: "#9b7be0", fill: false });
// encounter buttons: each gym from the Whiteboard, the rival and admins from the NPC Library, wild ones from the Wild Library
const btnRow = (i) => ({ x: -200 + i * 300, y: 620 });
gymNodes.forEach((g, i) => hub({ type: "button", label: g.title, x: btnRow(i).x, y: btnRow(i).y, color: "#e8a33a", reveal: i < 4 ? "sprite" : "hidden",
  source: { kind: "plan", id: `${BOARD_ID}:${g.id}`, title: g.title, trainer: g.title, sprite: g.identity.sprite, mons: g.mons.map((m) => ({ name: m.name, level: m.level })) } }));
[["npc-vex", "Rival Vex"], ["npc-morrow", "Admin Morrow"], ["npc-nyra", "Admin Nyra"], ["npc-grunt", "Eclipse Grunts"]].forEach(([nid, label], i) =>
  hub({ type: "button", label, x: -200 + i * 300, y: 820, color: "#9b7be0", reveal: "hidden", source: { kind: "npc", id: nid } }));
[["wild-snorlax", "Sleeping Snorlax"], ["wild-gible", "Cave Gible"], ["wild-shinyeevee", "Shiny Eevee"], ["wild-lumarix", "???"]].forEach(([wid, label], i) =>
  hub({ type: "button", label, x: 1100 + i * 300, y: 820, color: "#5aa8f0", reveal: i === 3 ? "hidden" : "sprite", source: { kind: "wild", id: wid } }));
// reference cards the DM pinned up: what's coming, what to fear
hub({ type: "mon", name: "Lugia", dex: state.pokemonByName.get("Lugia").dex, level: 60, x: 2300, y: -420, open: true });
hub({ type: "move", name: "Aeroblast", x: 2300, y: -100, open: false });
hub({ type: "move", name: "Flamethrower", x: 2560, y: -100, open: false });
hub({ type: "item", name: "Burn Heal", x: 2300, y: 60, open: true });
hub({ type: "mon", name: "Roserade", dex: state.pokemonByName.get("Roserade").dex, level: 22, x: 2560, y: -420, open: false });
const hubItems = H;


console.log(JSON.stringify({ players, playerPlans, dmPlan, npcs, wild, hubItems, hpMax: HP_MAX }));
