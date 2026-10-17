// Table-side generators: names, NPCs, loot, taverns, weather, plot hooks, dungeon dressing.
// All of it is original text/tables (not from any published adventure). Every function takes
// an optional rng so tests can be deterministic.

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const chance = (p, rng) => rng() < p;
const d = (n, rng) => 1 + Math.floor(rng() * n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ names

const SYL = {
  human: { first: [["Al", "Bran", "Cal", "Dar", "El", "Fen", "Gar", "Hal", "Jo", "Kel", "Lor", "Mar", "Nor", "Ro", "Sel", "Tor", "Wil"], ["a", "e", "i", "o", "u", "ia", "en", "an"], ["dric", "ton", "wyn", "mund", "lin", "ric", "sa", "na", "bert", "len", "ra", "mer"]], last: ["Ashdown", "Blackwood", "Carrow", "Dunmere", "Eastley", "Fairweather", "Greymantle", "Hollis", "Ironside", "Kettleby", "Longstride", "Marsh", "Northcott", "Oakheart", "Pellam", "Quill", "Ravenscroft", "Stonebridge", "Thornfield", "Underhill", "Vance", "Whitlock"] },
  elf: { first: [["Ae", "Ela", "Fae", "Gal", "Ili", "Lae", "Mi", "Nae", "Qu", "Sy", "Thae", "Vae"], ["l", "r", "n", "th", "v", "li", "ra"], ["wen", "dor", "iel", "ath", "ion", "eth", "ael", "yn", "alas"]], last: ["Moonwhisper", "Starweaver", "Silverleaf", "Dawnstrider", "Nightbloom", "Amakiir", "Galanodel", "Holimion", "Liadon", "Meliamne", "Naïlo", "Siannodel"] },
  dwarf: { first: [["Bar", "Bru", "Dur", "Eber", "Fal", "Gim", "Har", "Kil", "Mor", "Nor", "Rur", "Thor", "Tor", "Vei"], ["a", "i", "o", "u", "ga", "di"], ["din", "rik", "grim", "gar", "ra", "li", "dak", "mund", "bek", "nir"]], last: ["Battlehammer", "Brightforge", "Deepdelver", "Fireforge", "Gorunn", "Ironfist", "Loderr", "Rumnaheim", "Stonebeard", "Strakeln", "Torunn", "Ungart"] },
  halfling: { first: [["Alt", "Bil", "Cor", "Dil", "Eld", "Fin", "Gar", "Hob", "Lin", "Mer", "Ped", "Ros", "Sam", "Tan"], ["a", "e", "i", "o"], ["by", "bo", "wise", "rin", "dra", "wen", "ric", "ton", "lo", "cent"]], last: ["Brushgather", "Goodbarrel", "Greenbottle", "Highhill", "Hilltopple", "Leagallow", "Tealeaf", "Thorngage", "Tosscobble", "Underbough"] },
  orc: { first: [["Dr", "Gr", "Gh", "Kr", "Mor", "Ng", "Or", "Ruk", "Sh", "Thr", "Ug", "Vr", "Zug"], ["a", "o", "u", "ok", "ug"], ["ash", "gar", "nak", "mog", "tok", "rak", "bar", "zul", "gash", "dush"]], last: ["Bonecrusher", "Skullsplitter", "Ironhide", "Redtusk", "Stormcaller", "Blackmaw", "Gorefang", "Ashbringer", "Wolfrider", "Hollowspear"] },
  tiefling: { first: [["Ak", "Ba", "Ca", "Da", "Ka", "Le", "Mel", "Mor", "Nem", "Ori", "Pha", "Rai", "Sky", "Zar"], ["l", "r", "m", "n", "th", "z"], ["ios", "ia", "eus", "ana", "oth", "is", "ek", "ara", "ius"]], last: ["Ashgrave", "Cinder", "Dusk", "Embers", "Nightbrand", "Hallowed", "Sorrow", "Vesper", "Hex", "Candlewick"] },
  dragonborn: { first: [["Arj", "Bal", "Dar", "Ghe", "Hes", "Kri", "Med", "Nad", "Pand", "Rho", "Sho", "Tor", "Tur"], ["a", "e", "i", "o"], ["han", "ar", "dra", "jin", "ash", "ran", "inn", "ek", "gar"]], last: ["Clethtinthiallor", "Daardendrian", "Delmirev", "Kepeshkmolik", "Myastan", "Nemmonis", "Norixius", "Ophinshtalajiir", "Turnuroth", "Yarjerit"] },
  gnome: { first: [["Al", "Bod", "Cim", "Dim", "El", "Fon", "Gim", "Jeb", "Nis", "Orr", "Pog", "Qui", "Rol", "Wren", "Zoo"], ["a", "i", "o", "e"], ["ble", "kin", "wick", "bin", "dle", "ling", "nick", "dock", "fizz", "tink"]], last: ["Beren", "Daergel", "Folkor", "Garrick", "Nackle", "Murnig", "Ningel", "Raulnor", "Scheppen", "Timbers", "Turen", "Cogsworth"] },
};
export const NAME_STYLES = [...Object.keys(SYL)];

export function genName(style = "human", rng = Math.random) {
  const s = SYL[style] || SYL.human;
  const [a, b, c] = s.first;
  const first = cap(pick(a, rng).toLowerCase() + (chance(0.5, rng) ? pick(b, rng) : "") + pick(c, rng));
  return `${first} ${pick(s.last, rng)}`;
}

// ------------------------------------------------------------------ NPCs

const RACES = ["Human", "Human", "Human", "Elf", "Dwarf", "Halfling", "Half-orc", "Gnome", "Tiefling", "Dragonborn", "Half-elf"];
const OCCUPATIONS = ["innkeeper", "blacksmith", "apothecary", "town guard", "wandering priest", "retired soldier", "fishmonger", "scribe", "ferryman", "farmhand", "smuggler", "bard", "herbalist", "stablehand", "cartographer", "bounty hunter", "minor noble", "merchant", "gravedigger", "tax collector", "street urchin", "hedge wizard", "librarian", "baker"];
const APPEARANCE = ["a missing finger", "a prominent scar", "unusually fine clothes", "ink-stained hands", "a nervous twitch", "an enormous hat", "braided beard decorated with beads", "a heavy limp", "mismatched eyes", "a booming laugh", "a quiet, careful voice", "a tattoo of a spiral on their neck", "very tall and thin", "short and broad", "a perpetually sunburnt nose", "polished boots despite the mud"];
const MANNERISM = ["speaks in whispers", "never makes eye contact", "talks to their hands", "hums while thinking", "collects odd trinkets", "answers questions with questions", "is always eating something", "overuses a pet phrase", "is painfully polite", "gestures wildly", "counts things aloud", "is easily distracted"];
const TRAIT = ["generous to a fault", "deeply suspicious of strangers", "relentlessly curious", "quick to anger and quicker to forgive", "terrified of the dark", "obsessed with a local legend", "fiercely loyal to family", "boastful about minor achievements", "secretly kind", "greedy but honest", "haunted by a past failure", "cheerful no matter what"];
const WANT = ["to pay off a debt", "to find a missing sibling", "revenge on a rival", "to be taken seriously", "to leave this town forever", "to protect a secret", "a rare ingredient", "to prove their innocence", "to win a local contest", "to see their child safely married", "to recover a stolen heirloom", "someone to deliver a letter"];
const SECRET = ["is an informant for a rival faction", "owes a dangerous favour", "isn't who they claim to be", "knows where something valuable is buried", "witnessed a crime and said nothing", "is slowly being poisoned", "once served the villain", "has a hidden talent for magic", "is much older than they look", "forged their credentials"];

export function genNpc(rng = Math.random, { style } = {}) {
  const race = pick(RACES, rng);
  const nameStyle = style || ({ Elf: "elf", Dwarf: "dwarf", Halfling: "halfling", "Half-orc": "orc", Gnome: "gnome", Tiefling: "tiefling", Dragonborn: "dragonborn" }[race] || "human");
  return {
    name: genName(nameStyle, rng), race, occupation: pick(OCCUPATIONS, rng),
    age: pick(["young", "adult", "adult", "middle-aged", "elderly"], rng),
    appearance: pick(APPEARANCE, rng), mannerism: pick(MANNERISM, rng), trait: pick(TRAIT, rng),
    wants: pick(WANT, rng), secret: pick(SECRET, rng),
    attitude: pick(["hostile", "unfriendly", "indifferent", "indifferent", "friendly", "helpful"], rng),
  };
}

// ------------------------------------------------------------------ taverns & shops

const TAV_A = ["Gilded", "Sleeping", "Rusty", "Laughing", "Drunken", "Crooked", "Silver", "Wandering", "Broken", "Prancing", "Weeping", "Smiling", "Hungry", "Last", "Foggy"];
const TAV_B = ["Dragon", "Goat", "Lantern", "Anchor", "Boar", "Tankard", "Crown", "Raven", "Hearth", "Barrel", "Griffon", "Compass", "Wyvern", "Mermaid", "Candle"];
const TAV_FEATURE = ["a roaring fireplace with a stuffed bear above it", "a stage where a local bard performs nightly", "a famously terrible stew", "a trapdoor to a cellar nobody mentions", "a dartboard with a feud attached", "a rooftop garden of herbs", "a collection of old adventurers' trophies", "a resident ghost who tips well", "a fighting pit in the back", "a ceiling hung with hundreds of keys"];
const TAV_DRINK = ["Honeyed mead", "Dark stout", "Spiced cider", "Sour plum wine", "Smoky whisky", "Elderflower ale", "Hot mulled wine", "Pine-needle beer"];
const TAV_FOOD = ["roast boar and turnips", "river trout with almonds", "mushroom pie", "salt-crusted bread and soft cheese", "lamb stew", "fried onion rings and sausage", "pickled eggs", "game pasty"];

export function genTavern(rng = Math.random) {
  return {
    name: `The ${pick(TAV_A, rng)} ${pick(TAV_B, rng)}`, owner: genNpc(rng), feature: pick(TAV_FEATURE, rng), drink: pick(TAV_DRINK, rng), food: pick(TAV_FOOD, rng),
    quality: pick(["squalid", "shabby", "modest", "modest", "comfortable", "fine"], rng),
    patrons: Array.from({ length: 3 }, () => { const n = genNpc(rng); return `${n.name}, ${n.age} ${n.race.toLowerCase()} ${n.occupation} (${n.trait})`; }),
    rumor: genRumor(rng),
    price: `${[1, 2, 5, 8, 12][d(5, rng) - 1]} sp for a bed, ${[2, 3, 5][d(3, rng) - 1]} cp for ale`,
  };
}

const SHOP_TYPE = ["general store", "blacksmith", "alchemist", "bookseller", "jeweller", "tailor", "fletcher", "curiosities dealer", "herbalist", "armourer", "magic shop", "stable"];
const SHOP_HOOK = ["has a locked room upstairs", "is secretly a front for a thieves' guild", "is about to go out of business", "sells one genuinely magical item without knowing", "has a cat that watches customers closely", "just received a mysterious crate", "is robbed regularly", "is owned by a retired adventurer"];
export function genShop(rng = Math.random) {
  const type = pick(SHOP_TYPE, rng);
  return { name: `${genNpc(rng).name.split(" ")[1]}'s ${cap(type)}`, type, keeper: genNpc(rng), hook: pick(SHOP_HOOK, rng), prices: pick(["fair", "fair", "steep", "bargain", "haggler's paradise"], rng) };
}

// ------------------------------------------------------------------ rumours, hooks, weather

const RUMOR = [
  "Lights have been seen moving in the old watchtower at night.", "A caravan went north last week and nobody has seen it since.", "The mayor's new advisor never sleeps and never eats.",
  "There's a reward for anyone who can silence the singing in the well.", "A noble's heir has run off with a travelling performer.", "The river has been running slightly warm.",
  "Someone is buying every scrap of silver in town, no questions asked.", "A strange merchant sells maps to places that aren't on any map.", "Wolves have stopped howling at the moon, and that worries the hunters.",
  "The temple's bells rang by themselves at midnight.", "A giant skeleton was seen walking the ridge, then vanished.", "The old miller swears his grain mill grinds backwards some mornings.",
];
export const genRumor = (rng = Math.random) => pick(RUMOR, rng);

const HOOK_WHO = ["A frightened child", "A wealthy merchant", "A dying soldier", "The local priest", "A cloaked stranger", "A rival adventuring party", "The town's mayor", "A talking raven", "An old friend of a party member"];
const HOOK_WANTS = ["begs the party to find something stolen from the shrine", "offers gold to escort a wagon through bandit country", "claims the party is being followed", "needs a missing person found before the next full moon", "says a ruin has opened beneath the old oak", "hires the party to quietly investigate a rival", "delivers a map with half its markings scratched out", "asks the party to break a curse before it spreads"];
const HOOK_TWIST = ["but the person is lying about the reason", "but someone else has already been hired to stop them", "and the reward is far larger than it should be", "and the clock is ticking — three days at most", "but the culprit is someone the party trusts", "and a faction wants the party to fail", "but the task is secretly a test", "and it ties back to something the party did earlier"];
export const genHook = (rng = Math.random) => `${pick(HOOK_WHO, rng)} ${pick(HOOK_WANTS, rng)}, ${pick(HOOK_TWIST, rng)}.`;

const WEATHER_SKY = ["clear skies", "scattered clouds", "overcast", "light rain", "heavy rain", "thick fog", "drizzle", "thunderstorm", "snow flurries", "a bitter wind"];
const SEASON_TEMP = { spring: [8, 8], summer: [18, 10], autumn: [10, 9], winter: [-4, 8] };
export function genWeather(rng = Math.random, season = "spring") {
  const [base, spread] = SEASON_TEMP[season] || SEASON_TEMP.spring;
  const temp = base + Math.round((rng() - 0.5) * 2 * spread);
  let sky = pick(WEATHER_SKY, rng);
  if (season === "winter" && /rain|drizzle/.test(sky)) sky = "sleet";
  if (season === "summer" && /snow/.test(sky)) sky = "heat haze";
  const wind = pick(["calm", "a light breeze", "a steady wind", "gusts", "a howling gale"], rng);
  const effects = [];
  if (/heavy rain|thunderstorm/.test(sky)) effects.push("Disadvantage on Perception checks that rely on hearing; open flames are doused.");
  if (/fog/.test(sky)) effects.push("Heavily obscured beyond 60 ft.; lightly obscured closer.");
  if (/gale/.test(wind)) effects.push("Ranged attacks have disadvantage; flying is hazardous.");
  if (temp <= -5) effects.push("Extreme cold: DC 10 Constitution save each hour or gain a level of exhaustion without warm clothing.");
  if (temp >= 35) effects.push("Extreme heat: DC 5 Constitution save each hour or gain exhaustion without water.");
  return { sky, wind, tempC: temp, tempF: Math.round(temp * 9 / 5 + 32), effects };
}

// ------------------------------------------------------------------ loot

// Individual treasure, by challenge band (original table inspired by common 5e pacing).
const BANDS = [
  { max: 4, cp: [6, 6, 100], sp: [3, 6, 10], gp: [2, 6, 10], pp: [0, 0, 0] },
  { max: 10, cp: [2, 6, 100], sp: [2, 6, 100], gp: [6, 6, 10], pp: [3, 6, 1] },
  { max: 16, cp: [0, 0, 0], sp: [4, 6, 100], gp: [6, 6, 100], pp: [5, 6, 10] },
  { max: 30, cp: [0, 0, 0], sp: [0, 0, 0], gp: [6, 6, 1000], pp: [8, 6, 100] },
];
const GEMS = ["a polished agate", "a tiny garnet", "a blue quartz", "a moonstone", "a piece of jade", "a pearl", "a small sapphire", "an uncut ruby", "a black opal"];
const ART = ["a silver ewer", "a carved bone statuette", "a small gold bracelet", "a jewelled goblet", "an embroidered tapestry fragment", "a gold music box", "a brass astrolabe", "an ornate silver mirror"];
const MUNDANE = ["a crude map", "a love letter", "a vial of cheap perfume", "a lucky rabbit's foot", "a set of loaded dice", "a ring of keys", "a battered holy symbol", "a pouch of strange seeds", "a child's wooden toy", "a half-burnt journal", "a rusty dagger", "a flask of good brandy"];

export function genLoot(avgCr = 1, { hoard = false, rng = Math.random } = {}) {
  const band = BANDS.find((b) => avgCr <= b.max) || BANDS[BANDS.length - 1];
  const roll = ([n, s, mult]) => { let t = 0; for (let i = 0; i < n; i++) t += d(s, rng); return t * mult; };
  const mult = hoard ? 3 : 1;
  const coins = { cp: roll(band.cp) * mult, sp: roll(band.sp) * mult, gp: roll(band.gp) * mult, pp: roll(band.pp) * mult };
  const items = [];
  const n = hoard ? 2 + d(4, rng) : d(3, rng) - 1;
  for (let i = 0; i < n; i++) {
    const r = d(10, rng);
    items.push(r <= 4 ? pick(MUNDANE, rng) : r <= 7 ? `${pick(GEMS, rng)} (${[10, 50, 100][Math.min(2, Math.floor(avgCr / 5))]} gp)` : r <= 9 ? `${pick(ART, rng)} (${[25, 250, 750][Math.min(2, Math.floor(avgCr / 5))]} gp)` : "a potion (roll on the Magic Item Table A of your DMG)");
  }
  const magicChance = hoard ? Math.min(0.9, 0.35 + avgCr / 25) : 0.05 + avgCr / 100;
  const magic = chance(magicChance, rng) ? [pick(["Common", "Uncommon", "Uncommon", "Rare"].slice(0, avgCr < 5 ? 2 : avgCr < 11 ? 3 : 4), rng)] : [];
  return { coins, items, magic: magic.map((r) => `A ${r.toLowerCase()} magic item (choose or roll)`) };
}

// ------------------------------------------------------------------ dungeons

const ROOM_TYPE = ["empty chamber", "guard post", "storeroom", "shrine", "barracks", "library", "crypt", "flooded cellar", "collapsed hall", "trophy room", "workshop", "prison cells", "garden cavern", "ritual circle", "armoury"];
const ROOM_FEATURE = ["a cracked mosaic floor", "water dripping from the ceiling", "an unnervingly cold draft", "flickering, unnatural torchlight", "scratch marks along one wall", "a heavy iron door, rusted shut", "a pile of old bones", "faint music from somewhere below", "strange glowing fungus", "a statue with its face chiselled off", "a chandelier hanging by one chain"];
const ROOM_OCC = ["Nothing", "Nothing", "A monster appropriate to the area, asleep", "A group of monsters on patrol", "A trap", "A puzzle or locked mechanism", "A hidden treasure cache", "A wandering NPC prisoner", "A rival party"];
const TRAP = ["pit trap (DC 12 Dexterity save, 2d6 falling damage)", "poison dart (DC 13 Constitution save, 2d10 poison damage)", "swinging blade (+6 to hit, 3d8 slashing)", "collapsing ceiling (DC 14 Dexterity save, 4d10 bludgeoning)", "fire jet (DC 13 Dexterity save, 3d6 fire)", "alarm runes that summon guards", "sleeping gas (DC 13 Constitution save or unconscious 1 minute)"];
export function genRoom(rng = Math.random) {
  const occ = pick(ROOM_OCC, rng);
  return { type: pick(ROOM_TYPE, rng), feature: pick(ROOM_FEATURE, rng), occupant: occ, trap: occ === "A trap" ? pick(TRAP, rng) : null, exits: 1 + d(3, rng) };
}

// ------------------------------------------------------------------ misc

export const DRAGON_COLORS = ["black", "blue", "green", "red", "white", "brass", "bronze", "copper", "gold", "silver"];
export const genWildMagic = (rng = Math.random) => pick([
  "You turn blue for 1 minute.", "A harmless illusory butterfly flock bursts from your sleeves.", "Everyone within 30 ft. is momentarily weightless.", "You grow a long beard of feathers until your next long rest.",
  "A distant bell rings once, loudly.", "You and a random creature within 30 ft. swap places.", "Flowers sprout from the ground around you.", "You can't speak except in rhyme for 1 minute.",
  "You cast fireball (DC 15) centred on yourself.", "You heal 2d10 hit points.", "All metal within 10 ft. becomes magnetic for 1 round.", "A spectral hound appears and follows you for 1 hour.",
], rng);

// ------------------------------------------------------------------ whole dungeons

const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const OPPOSITE = { N: "S", E: "W", S: "N", W: "E" };
const DIR_NAME = { N: "north", E: "east", S: "south", W: "west" };

const DOORS = [
  { kind: "open archway", w: 18, note: "No door; sound and light pass freely." },
  { kind: "wooden door", w: 34, note: "Unlocked, swings freely." },
  { kind: "stuck door", w: 9, note: "DC 12 Strength check to force." },
  { kind: "locked door", w: 14, note: "DC 15 Dexterity (thieves' tools) to pick, or DC 17 Strength to break." },
  { kind: "iron-bound door", w: 6, note: "Barred from the far side; DC 20 Strength to break." },
  { kind: "secret door", w: 7, note: "Hidden: DC 15 Wisdom (Perception) or Intelligence (Investigation) to find." },
  { kind: "portcullis", w: 4, note: "A lever in a nearby room raises it; DC 25 Strength to lift by hand." },
  { kind: "trapped door", w: 4, note: "Wooden door with a trap on the handle (see the room's trap table)." },
  { kind: "collapsed doorway", w: 4, note: "Rubble blocks it: 20 minutes to clear, or squeeze through at half speed." },
];
const PASSAGES = [
  { kind: "short passage", len: [10, 20], w: 36 }, { kind: "corridor", len: [30, 60], w: 28 }, { kind: "winding tunnel", len: [40, 90], w: 12 },
  { kind: "stairs down", len: [10, 20], w: 6, vertical: "down" }, { kind: "stairs up", len: [10, 20], w: 6, vertical: "up" },
  { kind: "narrow crawlway", len: [15, 30], w: 6 }, { kind: "rope bridge over a chasm", len: [30, 50], w: 4 }, { kind: "flooded passage", len: [20, 40], w: 2 },
];
const weighted = (list, rng) => { let n = rng() * list.reduce((t, x) => t + x.w, 0); for (const x of list) { n -= x.w; if (n <= 0) return x; } return list[0]; };
const SIZES = [[10, 10], [10, 20], [20, 20], [20, 30], [30, 30], [30, 40], [40, 40], [50, 30]];
const AIR = ["still and musty", "cold and damp", "warm and smelling of smoke", "thick with dust", "faintly sulphurous", "fresh, with a draught from somewhere", "heavy with incense"];
const LIGHT = ["pitch dark", "pitch dark", "dim torchlight", "faint glowing fungus", "a shaft of daylight from above", "embers glowing in a brazier", "bright magical light"];
const MONSTER_POWER = ["weak (CR ¼–½)", "moderate (CR 1–2)", "tough (CR 3–5)"];
const LOOT = ["a handful of coins", "a locked chest", "a gem hidden in a statue's eye", "a forgotten weapon on a rack", "a scroll tucked into a skeleton's hand", "a potion on a shelf", "nothing but old bones", "a trapped strongbox", "a hidden cache behind loose stones"];

// Builds a connected dungeon on a grid: a spanning tree of rooms, some extra loops, one entrance,
// the farthest room as the lair, dead ends as vaults. Each room lists every exit with direction,
// door type, passage and where it leads.
export function genDungeon(rng = Math.random, { rooms = 8, loops = 0.25, theme = "" } = {}) {
  const n = Math.max(3, Math.min(24, Math.round(rooms)));
  const at = new Map(); // "x,y" -> room
  const list = [];
  const key = (x, y) => `${x},${y}`;
  const make = (x, y) => {
    const [w, h] = pick(SIZES, rng);
    const r = { id: list.length + 1, x, y, w, h, exits: [] };
    at.set(key(x, y), r);
    list.push(r);
    return r;
  };
  make(0, 0);
  let guard = 0;
  while (list.length < n && guard++ < 2000) {
    const from = pick(list, rng);
    const dir = pick(Object.keys(DIRS), rng);
    const [dx, dy] = DIRS[dir];
    if (at.has(key(from.x + dx, from.y + dy))) continue;
    const to = make(from.x + dx, from.y + dy);
    link(from, to, dir);
  }
  function link(a, b, dir) {
    const door = weighted(DOORS, rng);
    const pass = weighted(PASSAGES, rng);
    const len = pass.len[0] + Math.floor(rng() * (pass.len[1] - pass.len[0] + 1));
    const common = { door: door.kind, doorNote: door.note, passage: pass.kind, length: len, vertical: pass.vertical || null };
    a.exits.push({ dir, to: b.id, ...common });
    b.exits.push({ dir: OPPOSITE[dir], to: a.id, ...common, vertical: pass.vertical ? (pass.vertical === "down" ? "up" : "down") : null });
  }
  // extra connections between neighbouring rooms make loops, so there is more than one route
  for (const a of list) for (const dir of Object.keys(DIRS)) {
    const [dx, dy] = DIRS[dir];
    const b = at.get(key(a.x + dx, a.y + dy));
    if (b && b.id > a.id && !a.exits.some((e) => e.to === b.id) && chance(loops, rng)) link(a, b, dir);
  }
  // distance from the entrance (room 1)
  const dist = new Map([[1, 0]]);
  const queue = [list[0]];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of cur.exits) if (!dist.has(e.to)) { dist.set(e.to, dist.get(cur.id) + 1); queue.push(list.find((r) => r.id === e.to)); }
  }
  const far = Math.max(...dist.values());
  const lair = list.filter((r) => dist.get(r.id) === far).pop();
  for (const r of list) {
    r.distance = dist.get(r.id);
    r.deadEnd = r.exits.length === 1 && r.id !== 1;
    r.role = r.id === 1 ? "entrance" : r.id === lair.id ? "lair" : r.deadEnd ? "vault" : r.exits.length >= 3 ? "junction" : "chamber";
    r.type = r.role === "entrance" ? pick(["gatehouse", "entry hall", "crumbling vestibule", "guard room"], rng)
      : r.role === "lair" ? pick(["throne room", "ritual circle", "grand crypt", "treasure hall", "den"], rng)
      : r.role === "vault" ? pick(["treasury", "hidden shrine", "sealed vault", "forgotten cell", "relic room"], rng)
      : pick(ROOM_TYPE, rng);
    r.light = r.role === "entrance" ? pick(["dim torchlight", "a shaft of daylight from above"], rng) : pick(LIGHT, rng);
    r.air = pick(AIR, rng);
    r.feature = pick(ROOM_FEATURE, rng);
    const occ = r.role === "entrance" ? (chance(0.5, rng) ? "A bored guard or two" : "Nothing, for now")
      : r.role === "lair" ? "The dungeon's master and its allies"
      : r.role === "vault" ? pick(["A trap", "A guardian construct", "A puzzle lock", "Nothing"], rng)
      : pick(ROOM_OCC, rng);
    r.occupant = occ;
    r.threat = /monster|patrol|guardian|master|guard/i.test(occ) ? (r.role === "lair" ? "tough (CR 3–5) with minions" : pick(MONSTER_POWER, rng)) : null;
    r.trap = /trap/i.test(occ) || (r.role === "vault" && chance(0.5, rng)) ? pick(TRAP, rng) : null;
    r.treasure = r.role === "lair" ? "A hoard (see the Loot tab)" : r.role === "vault" ? pick(LOOT.slice(0, 5).concat(["a locked chest"]), rng) : chance(0.3, rng) ? pick(LOOT, rng) : null;
  }
  const minX = Math.min(...list.map((r) => r.x)), minY = Math.min(...list.map((r) => r.y));
  for (const r of list) { r.gx = r.x - minX; r.gy = r.y - minY; }
  const secrets = list.reduce((t, r) => t + r.exits.filter((e) => e.door === "secret door").length, 0) / 2;
  return {
    theme, rooms: list, entrance: 1, lair: lair.id,
    cols: Math.max(...list.map((r) => r.gx)) + 1, rows: Math.max(...list.map((r) => r.gy)) + 1,
    loops: list.reduce((t, r) => t + r.exits.length, 0) / 2 - (list.length - 1),
    secrets: Math.round(secrets), dirName: DIR_NAME,
  };
}
