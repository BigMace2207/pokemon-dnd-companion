// Builds a DM's campaign planner for the throwaway test table: twelve sessions on one whiteboard (three played, nine prepared),
// recurring villains and places tied together with connections, a story arc for each of the seven players, a scenario per
// session, and notes / NPCs / quests / locations in the planner's notebook. Prints { dm, players } as JSON for
// tools/seed_test_campaign.py.
//   node tools/seed_plan.mjs

import { addSession, addLink, normalizeBoard, syncSessions } from "../js/planner/board.js";
import { genDungeon } from "../js/systems/dnd5e/engine/generators.js";

let n = 0;
const id = (p = "n") => `${p}${(++n).toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
const now = Date.now();

const list = (title, items) => ({ id: id("l"), title, items: items.map(([text, done]) => ({ id: id("i"), text, done: !!done })), created: now, updated: now });
const note = (title, body, extra = {}) => ({ id: id("t"), title, body, tags: [], pinned: false, created: now, updated: now, ...extra });
const scene = (title, kind, f = {}) => ({ id: id("c"), title, kind, location: "", readAloud: "", body: "", npcs: "", foes: "", secrets: "", rewards: "", branches: "", done: false, ...f });

// ---- the board: 12 session boxes in a 4 x 3 grid, the seven players' arcs in a band above -----------------------------
// roomy on purpose: wide gaps between sessions and between nodes, so the connection lines and labels have space to read
const PX = 1500, PY = 1000, BW = 1300, BH = 800, X0 = -2900, ARC_Y = -1900, GRID_Y = -1200;
const boxes = Array.from({ length: 12 }, (_, i) => ({ kind: "box", x: X0 + (i % 4) * PX, y: GRID_Y + Math.floor(i / 4) * PY, w: BW, h: BH }));
const nodes = [];
const add = (o) => { const x = { id: id(), w: 300, h: 230, ...o }; nodes.push(x); return x; };

// spec: [kind, title, text or lines, extra]. kinds: gen kinds (npc, tavern, shop, hook, rumour, loot, room, encounter), "note", "sticky", "list", "dungeon"
function fill(sessionIndex, specs) {
  const b = boxes[sessionIndex];
  specs.forEach((spec, i) => {
    const [kind, title, content, extra] = spec;
    const pos = { x: b.x + 60 + (i % 3) * 400, y: b.y + 100 + Math.floor(i / 3) * 340 };
    if (kind === "note") add({ type: "note", title, body: content, ...pos });
    else if (kind === "sticky") add({ type: "text", title, body: content, color: extra || "#f6e27a", ...pos });
    else if (kind === "list") add({ type: "list", title, items: content.map(([text, done]) => ({ id: id("i"), text, done: !!done })), ...pos });
    else if (kind === "dungeon") add({ type: "dungeon", title, dungeon: genDungeon(Math.random, { rooms: content }), roomNotes: extra || {}, expanded: false, ...pos });
    else add({ type: "gen", kind, gen: kind, genLabel: { npc: "NPC", tavern: "Tavern", shop: "Shop", hook: "Hook", rumour: "Rumour", loot: "Loot", room: "Room", encounter: "Encounter" }[kind] || kind, title, lines: content, ...pos });
  });
}
const RECAP = "#9be0a8";

// 1 - The Road to Brindlemoor (played)
fill(0, [
  ["npc", "Mayor Odalys Venn", ["Human, 50s, anxious. Hires the party to find the missing tax-collector.", "Wants: the cellar sealed before the Festival of Lanterns.", "Secret: she signed the cult's lease on the cellars. Lyra suspects her."]],
  ["tavern", "The Gilded Boar", ["Brindlemoor's only inn: woodsmoke and wet dog.", "Barkeep Hobb kept the Lantern Players' instruments after their fire.", "A hooded stranger watches from the corner booth."]],
  ["hook", "The Missing Collector", ["Tax-collector Pell Ardway never returned from the old cellars.", "Reward: 200 gp and the town's gratitude."]],
  ["npc", "Captain Ruck", ["Bandit captain on the Old King's Road, once of the Ninth Lancers.", "Ambushes the party; flees at half strength, leaving a cult sigil.", "Thalric knows his face. Serves Lord Caedran."]],
  ["sticky", "Recap", "PLAYED. Bandit ambush (Korg dropped to 1 HP). Sera lifted a cult sigil from Ruck's pockets. Thalric swore to find the man who fled.", RECAP],
  ["list", "Session 1 checklist", [["Bandit ambush", 1], ["Meet Mayor Venn", 1], ["Rooms at the Gilded Boar", 1], ["Learn about the cellars", 1]]],
]);
// 2 - Cellars Below (played)
fill(1, [
  ["dungeon", "Brindlemoor Cellars", 9, { 1: "Entrance: rotting stairs, a lantern still lit.", 3: "Cult shrine. Pell Ardway's journal lies on the altar." }],
  ["encounter", "Rats in the Dark", ["12 giant rats (swarm) and 2 cult acolytes.", "Rats flee at half strength; acolytes fight to the death."]],
  ["npc", "Pell Ardway", ["Rescued tax-collector, shaken but alive.", "Saw robed figures carry a black stone to the shrine. Remembers a name: Sister Nyx."]],
  ["loot", "Pell's Satchel", ["Ardway's journal (clues to the Whispering Fen)", "75 gp, a silver holy symbol of the Dawn Shield", "Potion of healing"]],
  ["rumour", "Whispers Under the Floor", ["Someone is still chanting beneath the town hall at night."]],
  ["sticky", "Recap", "PLAYED. Cleared the cellars, rescued Pell. Elowen learned the cult worships the Sundered Crown. Vaelor recognised the Dawn Shield symbol and wrote to his order.", RECAP],
]);
// 3 - The Whispering Fen (played)
fill(2, [
  ["npc", "Old Marrow the Hermit", ["Half-elf, ancient, speaks in riddles but never lies.", "Knows the way to the Sunken Archive.", "Trades truths for fresh bread."]],
  ["encounter", "Hags of the Fen", ["Three green hags (a coven) disguised as sisters selling eels.", "Weak spot: they hate bells and iron.", "They answer to Sister Nyx."]],
  ["note", "Fen travel notes", "Two days across the fen. Fog gives disadvantage on sight-based Perception. Random encounter each night on a 1 or 2 on d6."],
  ["loot", "The Hags' Hoard", ["Key rune of the Archive", "Cloak of the Fen (counts as a cloak of protection if worn at dusk)", "2 vials of antitoxin"]],
  ["sticky", "Recap", "PLAYED. Outwitted the hags with a stolen bell. Marrow handed Vaelor the Archive's key rune. The party is level 3.", RECAP],
]);
// 4 - Harrowgate Heist
fill(3, [
  ["shop", "The Black Lantern", ["Curios and contraband, run by Madame Vesk.", "Sells: potion of healing (50 gp), thieves' tools, forged papers.", "The back room hides a door into the Duke's vault."]],
  ["npc", "Madame Vesk", ["Tiefling fence, immaculate, dangerous when bored.", "Holds Sera's 500 gp debt. Wants the Duke's ledger stolen.", "Will swap it for a map of the Archive."]],
  ["npc", "Duke Harrow", ["Ruler of Harrowgate, vain and fearful, brother to Lord Caedran.", "He does not know what his brother has become."]],
  ["room", "The Duke's Vault", ["Stone vault, trapped floor tiles (DC 14 to spot).", "A warded safe holds the ledger."]],
  ["note", "The heist", "1. Gala invitations (Lyra performs).\n2. Sera lifts the vault key.\n3. Brannoch distracts the guards.\n4. The ledger names the cult's patron."],
  ["list", "Prep: Session 4", [["Print the Duke's gala floor plan"], ["Stat the Duke's guards"], ["Pick gala music"], ["Decide what the ledger reveals"]]],
]);
// 5 - The Sunken Archive
fill(4, [
  ["dungeon", "The Sunken Archive", 12, { 1: "Flooded hall. Water is waist deep.", 6: "Reading room: puzzle with four colour-coded books." }],
  ["encounter", "Tome Guardian", ["Animated armour x3 and a flameskull.", "They stop attacking anyone carrying the Archive key rune."]],
  ["hook", "The Ledger's Secret", ["The ledger names Lord Caedran Vale as the cult's patron, and the Archive as its library.", "It also lists the festival date: the Ashen Court strikes then."]],
  ["npc", "Ashvane's Echo", ["A voice trapped in a book, Magister Ashvane's last spell.", "Tells Elowen: 'The crown is two halves. Do not let them meet.'"]],
  ["loot", "Archive Treasures", ["The Dawn Half of the crown (cold and heavy)", "Sending stones (pair)", "Tome of the Sundered Crown (plot item)"]],
  ["list", "Prep: Session 5", [["Draw the flooded hall"], ["Prepare the four-book puzzle handout"], ["Track torches and air"]]],
]);
// 6 - The Festival of Lanterns
fill(5, [
  ["room", "Lantern Square", ["Brindlemoor's town square, hung with paper lanterns.", "Stalls, a stage for Lyra, a crowd of 300."]],
  ["npc", "Sister Nyx", ["Cult lieutenant, pale, soft-spoken, commands the hags and the dead.", "Wants the Dawn Half. Knew the Lantern Players' fire was a test of the new ritual."]],
  ["encounter", "Cult Strike at the Festival", ["Cultists in festival masks, a bone golem and Nyx.", "Goal: seize the Dawn Half from the party.", "Environmental: panicked crowd, burning lanterns."]],
  ["hook", "The Burning Temple", ["Across the valley, the Dawn Shield temple in Harrowgate is set alight in the same hour.", "Brannoch sees the smoke. Mother Hesper escapes into the dark."]],
  ["note", "Festival timeline", "6pm lanterns lit. 7pm Lyra's ballad. 8pm Nyx's signal (a green lantern). 8:15 the strike. Nyx escapes with the Dawn Half unless the party stops her."],
  ["list", "Prep: Session 6", [["Festival map"], ["Cultist mask handouts"], ["Decide if the Dawn Half is lost (Nyx wins)"]]],
]);
// 7 - The Dusk Half
fill(6, [
  ["npc", "Thane Brogan Ironvale", ["Brannoch's uncle, stern and proud, lord of Ironvale hold.", "Guards the Dusk Half in the Deep Forge and distrusts everyone, even kin."]],
  ["room", "The Deep Forge", ["A cavern of molten rock and ringing anvils.", "The Dusk Half rests on the anvil of the first smith."]],
  ["npc", "Mother Hesper", ["Brannoch's mentor, burned and bandaged, sheltering in Ironvale.", "She hid the truth: the Dawn Half can unmake the crown if destroyed in the Forge. But it would break the king's curse and release the dead."]],
  ["encounter", "Duergar Raiders", ["Cult-hired duergar and a fire giant's shadow.", "They want the Dusk Half before the party can claim it."]],
  ["loot", "The Dusk Half", ["The Dusk Half of the crown (warm, whispering)", "Thane's gift: a dwarven shield, +1"]],
  ["list", "Prep: Session 7", [["Forge map with lava hazards"], ["Mother Hesper's reveal"], ["Brannoch's choice with his uncle"]]],
]);
// 8 - The Thieves' Court
fill(7, [
  ["tavern", "The Gray Cloak Den", ["Hidden under Harrowgate's old brewery.", "The guild's courtroom: where debts are tried."]],
  ["npc", "Guildmother Sable", ["Head of the Gray Cloaks, ancient and fair.", "Madame Vesk answers to her. Will free Sera if the party delivers the Duke's seal."]],
  ["hook", "Sera's Debt", ["500 gp, or a favour of equal weight.", "Vesk secretly sold Sera's debt to the cult for the Archive map."]],
  ["encounter", "Rooftop Chase", ["Guild enforcers and a cult assassin pursue the party across Harrowgate's roofs.", "Skill challenge: Acrobatics, Athletics, Stealth."]],
  ["room", "The Trial Hall", ["A long table, a ring of judges, a mirrored ceiling.", "Verdict decided by three rolls, each player contributing."]],
  ["list", "Prep: Session 8", [["Rooftop skill challenge"], ["Trial hall roleplay prompts"], ["Vesk's betrayal reveal"]]],
]);
// 9 - Last Stand at Fort Lancer
fill(8, [
  ["room", "Fort Lancer Gatehouse", ["Ruined stone fort on the Old King's Road.", "Where the Ninth Lancers died."]],
  ["npc", "Old Sergeant Maddox", ["The other Lancer survivor, one-armed, bitter.", "Holds Ruck's confession: the Ninth was sold for 1000 gp and a promise."]],
  ["encounter", "Siege of Fort Lancer", ["Skeletal lancers and Captain Ruck, now undead.", "Ruck begs forgiveness before the fight."]],
  ["loot", "The Ninth's Banner", ["The regimental banner (rally: allies gain +1 to hit for 1 min)", "Ruck's sword, a +1 longsword", "Letters proving Duke Harrow was bribed"]],
  ["note", "Ruck's end", "If Thalric offers mercy, Ruck gives the name 'the Hollow King' and the location of the Spire. If not, he dies cursing."],
  ["list", "Prep: Session 9", [["Fort map"], ["Undead lancer stat blocks"], ["Thalric's confrontation scene"]]],
]);
// 10 - The Dreaming Spire
fill(9, [
  ["dungeon", "The Dreaming Spire", 10, { 1: "Gate of dreams: lull, then ambush.", 5: "Ashvane's study: cage of mirrors." }],
  ["npc", "Magister Ashvane", ["Elowen's mentor, thin, dreaming, bound to the crown.", "He is the cult's prisoner and their key: only a wizard of the Spire can bind the halves."]],
  ["encounter", "Dream Wardens", ["Shadow wraiths and dream-bound constructs.", "They fall when the dreamer wakes."]],
  ["hook", "A Choice of Dreams", ["Elowen must choose: wake Ashvane (the cult loses its key but he may die) or leave him bound (the crown stays unfinished)."]],
  ["loot", "Ashvane's Orrery", ["Orrery of the Spire (once per day, *augury* with advantage)", "Letter to Elowen: 'Forgive me.'"]],
  ["list", "Prep: Session 10", [["Dream-logic room tweaks"], ["Elowen's choice"], ["Ashvane's recorded confession"]]],
]);
// 11 - The Gathering Dark
fill(10, [
  ["npc", "Chief Ragna Ashfang", ["Korg's mother and clan chief.", "The clan marches to join Caedran's host, unaware of who pays for it.", "Will take Korg back if he proves himself in the war council."]],
  ["hook", "Korg's Return", ["Korg arrives at the Ashfang camp. The cult's envoy is already there."]],
  ["encounter", "Skeleton Legion at the Gates", ["A thousand dead raised by Caedran's ritual, besieging Harrowgate.", "Mass combat: use the war rules (units of 20)."]],
  ["room", "The Dragon Guard Tomb", ["Beneath Harrowgate's cathedral, the tomb of the king's dragonborn guard.", "Vaelor's ancestors lie here. Dawnbreaker, the blade that can break the crown, waits unguarded."]],
  ["loot", "Dawnbreaker, the Oathblade", ["Dawnbreaker (+2 longsword; sheds light; deals extra radiant damage to the undead)", "Only a Dragon Guard descendant can draw it."]],
  ["note", "War council", "Duke Harrow sues for peace; the party must unite the Ashfang, the Gray Cloaks, the Ninth's survivors and the Order. Each ally brought is +1 to the finale's mass combat."],
]);
// 12 - The Sundered Crown
fill(11, [
  ["npc", "Lord Caedran Vale", ["The Duke's own brother, cult patron.", "Wants: to wear the whole crown and rule the dead.", "Offers each player a bargain before the fight (see their arcs)."]],
  ["room", "The Crown Chamber", ["A circular hall under Harrowgate. The crown floats over a black altar.", "Lair actions each round: cold wind, rising skeletons, a falling pillar."]],
  ["encounter", "Lord Caedran and his Honour Guard", ["Lord Caedran (a cult fanatic) plus 4 skeletal guards.", "Phase 2: the crown cracks and a wraith rises."]],
  ["loot", "The Whole Crown", ["The joined crown, shattering on the party's choice: destroy it in the Forge, keep it hidden, or crown a ruler."]],
  ["note", "Endings", "Brannoch: the temple rebuilt or his uncle's heir. Sera: free, or a guild master. Thalric: Lancer captain. Elowen: Spire archmage. Korg: clan chief. Lyra: the ballad. Vaelor: the oath fulfilled."],
  ["list", "Prep: Session 12", [["Boss stat block with lair actions"], ["Epilogue for each character"], ["Level up to 8 at the end"]]],
]);

// player arcs, in a band above the sessions
const ARCS = [
  ["Arc: Brannoch", "Find Mother Hesper and rebuild the Dawn Shield temple. Pays off in sessions 6 and 7; his uncle's pride is the obstacle.", "#f6c27a"],
  ["Arc: Sera", "Clear her debt to Madame Vesk and walk out of the Gray Cloaks. Sessions 4 and 8; Vesk sold the debt to the cult.", "#d8b4f0"],
  ["Arc: Thalric", "Hunt Captain Ruck, who sold the Ninth Lancers. Sessions 1, 9 and 12; the choice is vengeance or mercy.", "#f6a0a0"],
  ["Arc: Elowen", "Find Magister Ashvane. Sessions 5 and 10; she must choose between waking him and finishing the crown.", "#a0d4f6"],
  ["Arc: Korg", "Win back the Ashfang chief's blessing. Session 11; the clan is being used by the cult.", "#f6e27a"],
  ["Arc: Lyra", "Learn who burned the Lantern Players, and sing the truth. Sessions 1, 6 and 12.", "#f6a0d8"],
  ["Arc: Vaelor", "Find Dawnbreaker and keep the crown from any hand. Sessions 11 and 12; his order's grandmaster is silent for a reason.", "#b4f6a0"],
];
ARCS.forEach(([title, body, color], i) => add({ type: "text", title, body, color, x: X0 + 60 + (i % 4) * 700, y: ARC_Y + Math.floor(i / 4) * 300, w: 520, h: 200 }));
add({ type: "text", title: "Campaign status", body: "The Sundered Crown: 7 players, 3 of 12 sessions played, 9 prepared. Party level 3. Next up: Harrowgate Heist. Ending: the crown's fate rests on the players' choices.", color: "#f6e27a", x: X0 + 60 + 3 * 700, y: ARC_Y + 300, w: 520, h: 200 });

const bd = normalizeBoard({ id: id("b"), name: "The Sundered Crown", bounds: { x: -3000, y: -2000, w: 6000, h: 3700 }, created: now, nodes, sessions: [], links: [], view: { x: 0, y: 0, z: 0.2 } });
boxes.forEach((shape) => addSession(bd, shape));
bd.sessions.sort((a, b) => a.n - b.n);
for (const node of bd.nodes) syncSessions(bd, node);

const byTitle = (t) => { const x = bd.nodes.find((q) => q.title === t); if (!x) throw new Error(`no node: ${t}`); return x; };
const link = (a, rel, b, label = "") => addLink(bd, { from: byTitle(a).id, to: byTitle(b).id, rel, label, fromRoom: null, toRoom: null });
const custom = (a, label, b) => link(a, "custom", b, label);
// the cult's chain of command and how the early clues feed the later sessions
custom("Captain Ruck", "serves", "Lord Caedran Vale");
custom("Mayor Odalys Venn", "signed the lease for", "Lord Caedran Vale");
custom("Duke Harrow", "brother of", "Lord Caedran Vale");
custom("Sister Nyx", "lieutenant to", "Lord Caedran Vale");
custom("Hags of the Fen", "serve", "Sister Nyx");
custom("Skeleton Legion at the Gates", "raised by", "Lord Caedran Vale");
link("Mayor Odalys Venn", "wants", "The Missing Collector");
link("The Missing Collector", "leads to", "Brindlemoor Cellars");
link("Pell's Satchel", "found in", "Brindlemoor Cellars");
link("Rats in the Dark", "guards", "Brindlemoor Cellars");
link("Pell Ardway", "knows", "Sister Nyx");
custom("Pell's Satchel", "points to", "Old Marrow the Hermit");
custom("Old Marrow the Hermit", "knows the way to", "The Sunken Archive");
link("The Hags' Hoard", "found in", "Hags of the Fen");
link("Madame Vesk", "owns", "The Black Lantern");
custom("Madame Vesk", "answers to", "Guildmother Sable");
link("The Black Lantern", "leads to", "The Duke's Vault");
custom("The Duke's Vault", "holds the ledger that opens", "The Ledger's Secret");
link("The Ledger's Secret", "leads to", "The Sunken Archive");
link("Tome Guardian", "guards", "The Sunken Archive");
link("Archive Treasures", "found in", "The Sunken Archive");
custom("Ashvane's Echo", "is an echo of", "Magister Ashvane");
link("Ashvane's Echo", "hides in", "The Sunken Archive");
link("Magister Ashvane", "lives in", "The Dreaming Spire");
custom("Dream Wardens", "guard", "The Dreaming Spire");
custom("Archive Treasures", "the Dawn Half is stolen at", "Cult Strike at the Festival");
custom("Sister Nyx", "leads", "Cult Strike at the Festival");
custom("The Ledger's Secret", "sets the date of", "Cult Strike at the Festival");
custom("The Burning Temple", "ends with her escape to", "Mother Hesper");
custom("Mother Hesper", "sheltered by", "Thane Brogan Ironvale");
link("Thane Brogan Ironvale", "owns", "The Deep Forge");
link("The Dusk Half", "found in", "The Deep Forge");
link("Duergar Raiders", "enemy of", "Thane Brogan Ironvale");
custom("Sera's Debt", "owed to", "Madame Vesk");
custom("Guildmother Sable", "judges", "Sera's Debt");
link("Rooftop Chase", "part of", "The Trial Hall");
custom("Captain Ruck", "betrayed the Ninth at", "Fort Lancer Gatehouse");
link("Old Sergeant Maddox", "carries", "The Ninth's Banner");
custom("Siege of Fort Lancer", "ends at", "Fort Lancer Gatehouse");
custom("Ruck's end", "names", "The Dreaming Spire");
custom("The Ninth's Banner", "carries proof against", "Duke Harrow");
link("Dawnbreaker, the Oathblade", "found in", "The Dragon Guard Tomb");
custom("Dawnbreaker, the Oathblade", "the only blade that can break", "Lord Caedran and his Honour Guard");
custom("Chief Ragna Ashfang", "is wooed by", "Sister Nyx");
link("Chief Ragna Ashfang", "wants", "Korg's Return");
custom("The Dusk Half", "must be joined to the Dawn Half in", "The Crown Chamber");
link("Lord Caedran and his Honour Guard", "guards", "The Crown Chamber");
link("Lord Caedran Vale", "wants", "The Whole Crown");
link("The Whole Crown", "found in", "The Crown Chamber");
// each player's arc is wired to the people and places that pay it off
custom("Arc: Brannoch", "seeks", "Mother Hesper"); custom("Arc: Brannoch", "remembers", "The Burning Temple"); custom("Arc: Brannoch", "kin to", "Thane Brogan Ironvale");
custom("Arc: Sera", "must clear", "Sera's Debt"); custom("Arc: Sera", "wants free of", "Madame Vesk");
custom("Arc: Thalric", "hunts", "Captain Ruck"); custom("Arc: Thalric", "mourns at", "Fort Lancer Gatehouse"); custom("Arc: Thalric", "trusts", "Old Sergeant Maddox");
custom("Arc: Elowen", "seeks", "Magister Ashvane"); custom("Arc: Elowen", "hears", "Ashvane's Echo");
custom("Arc: Korg", "wants the blessing of", "Chief Ragna Ashfang"); custom("Arc: Korg", "is called home by", "Korg's Return");
custom("Arc: Lyra", "suspects", "Mayor Odalys Venn"); custom("Arc: Lyra", "will sing of", "Cult Strike at the Festival"); custom("Arc: Lyra", "learns the truth from", "Sister Nyx");
custom("Arc: Vaelor", "sworn to find", "Dawnbreaker, the Oathblade"); custom("Arc: Vaelor", "sworn to stop", "Lord Caedran Vale"); custom("Arc: Vaelor", "keeps watch at", "The Dragon Guard Tomb");

// ---- scenarios, one per session ---------------------------------------------------------------------------------------
const sc = (title, status, hook, summary, scenes) => ({ id: id("s"), title, status, level: status === "played" ? "3" : "", players: "7", hook, summary, tags: [], scenes, created: now, updated: now });
const scenarios = [
  sc("Session 1: The Road to Brindlemoor", "played", "A town asks strangers to find its missing tax-collector.", "Bandit ambush, meet the mayor, learn of the cellars.", [
    scene("Bandits on the road", "combat", { location: "The Old King's Road", foes: "6 bandits, Captain Ruck", rewards: "Cult sigil", done: true }),
    scene("Arrival in Brindlemoor", "social", { location: "The Gilded Boar", npcs: "Mayor Odalys Venn, Hobb the barkeep", done: true })]),
  sc("Session 2: Cellars Below", "played", "The cellars hide more than rats.", "Clear the cellars and rescue Pell.", [
    scene("Down the stairs", "exploration", { location: "Cellar entrance", done: true }),
    scene("Rats and acolytes", "combat", { foes: "Giant rat swarm, 2 cult acolytes", done: true }),
    scene("The shrine", "reveal", { secrets: "The altar bears the sigil of the Sundered Crown", done: true })]),
  sc("Session 3: The Whispering Fen", "played", "Pell's journal points into the fen.", "Cross the fen, outwit the hags, meet Marrow.", [
    scene("Fog and travel", "travel", { done: true }),
    scene("Eel sellers", "combat", { foes: "Green hag coven", done: true }),
    scene("Old Marrow", "social", { npcs: "Old Marrow", rewards: "The Archive's key rune", done: true })]),
  sc("Session 4: Harrowgate Heist", "ready", "A fence offers a map for a favour. Sera's debt comes due.", "Infiltrate the Duke's gala and steal his ledger.", [
    scene("The gala", "social", { location: "Duke's Hall", npcs: "Madame Vesk, Duke Harrow" }),
    scene("The vault", "puzzle", { location: "Duke's Vault", secrets: "Floor tiles are trapped (DC 14)" }),
    scene("Escape over the rooftops", "combat", { foes: "6 guards, 1 veteran" })]),
  sc("Session 5: The Sunken Archive", "ready", "The ledger names the Archive as the cult's library.", "Delve the flooded archive; Elowen meets Ashvane's echo.", [
    scene("Flooded hall", "exploration"),
    scene("Reading room puzzle", "puzzle", { secrets: "The four books must be shelved in rainbow order" }),
    scene("Tome guardians", "combat", { foes: "3 animated armour, 1 flameskull", rewards: "The Dawn Half" })]),
  sc("Session 6: The Festival of Lanterns", "ready", "The cult strikes on the night of the festival; Lyra's ballad is cut short.", "Defend Brindlemoor; the Dawn Half is lost or held.", [
    scene("The festival", "social", { location: "Lantern Square", npcs: "Mayor Venn, Hobb" }),
    scene("Nyx's strike", "combat", { foes: "Sister Nyx, bone golem, cultists" }),
    scene("Smoke on the horizon", "reveal", { secrets: "The Dawn Shield temple burns. Hesper escapes." })]),
  sc("Session 7: The Dusk Half", "draft", "Mother Hesper sends the party to Ironvale.", "Win the Dusk Half from Brannoch's uncle and learn the Forge's secret.", [
    scene("Journey to the hold", "travel"), scene("Thane Brogan's court", "social", { npcs: "Thane Brogan, Mother Hesper" }),
    scene("The Deep Forge", "combat", { foes: "Duergar raiders, fire elemental" })]),
  sc("Session 8: The Thieves' Court", "draft", "The guild will try Sera's debt, and the party's honour.", "The Gray Cloaks judge; Vesk's betrayal is revealed.", [
    scene("The den", "social", { npcs: "Guildmother Sable" }), scene("The trial", "puzzle", { location: "Trial Hall" }), scene("Rooftop chase", "combat")]),
  sc("Session 9: Last Stand at Fort Lancer", "draft", "Maddox sends word: Ruck has returned to the fort.", "Face the man who sold the Ninth Lancers.", [
    scene("The old road", "travel"), scene("Maddox's story", "reveal", { npcs: "Old Sergeant Maddox" }), scene("Siege of Fort Lancer", "boss", { foes: "Captain Ruck (undead), skeletal lancers" })]),
  sc("Session 10: The Dreaming Spire", "draft", "Ruck's last words name the Spire.", "Wake Ashvane or leave him bound.", [
    scene("Gate of dreams", "exploration"), scene("Dream wardens", "combat", { foes: "Shadow wraiths" }), scene("Ashvane's study", "reveal", { npcs: "Magister Ashvane" })]),
  sc("Session 11: The Gathering Dark", "draft", "The dead march on Harrowgate. Every ally is needed.", "Gather the allies and find Dawnbreaker.", [
    scene("The Ashfang camp", "social", { npcs: "Chief Ragna Ashfang" }), scene("The Dragon Guard tomb", "exploration", { rewards: "Dawnbreaker" }), scene("War at the gates", "combat", { foes: "Skeleton legion" })]),
  sc("Session 12: The Sundered Crown", "draft", "The cult will crown its lord at midnight.", "Confront Lord Caedran in the Crown Chamber and decide the crown's fate.", [
    scene("The offer", "social", { npcs: "Lord Caedran" }), scene("The Crown Chamber", "boss", { foes: "Lord Caedran, skeletal guards, wraith (phase 2)" }), scene("Aftermath", "rest", { rewards: "Level 8" })]),
];

// ---- the DM's notebook: plain notes plus NPC / quest / location / session records -----------------------------------------
const rec = (kind, title, body, fields = {}, tags = []) => note(title, body, { kind, fields, tags });
const dm = {
  notes: [
    note("Campaign pitch", "The Sundered Crown: a dead king's crown has been split in two. The Ashen Court is gathering the halves to crown a ruler of the dead. Tone: spooky fantasy, heroic, with each hero's past coming back to bite.", { tags: ["overview"], pinned: true }),
    note("House rules", "Critical hits max the dice. Inspiration on great roleplay. Long rests only in safe places. Death saves are rolled in the open.", { tags: ["rules"] }),
    rec("session", "Session 1: The Road to Brindlemoor", "Bandits on the road, Brindlemoor, the cellar hook. Korg nearly died; Thalric recognised Ruck.", { date: "2026-10-10", level: "3" }, ["recap"]),
    rec("session", "Session 2: Cellars Below", "Cleared the cellars, found the shrine, rescued Pell. Elowen read the sigil.", { date: "2026-10-17", level: "3" }, ["recap"]),
    rec("session", "Session 3: The Whispering Fen", "Hags outwitted with a stolen bell. Marrow gave Vaelor the key rune.", { date: "2026-10-24", level: "3" }, ["recap"]),
    rec("session", "Session 4: Harrowgate Heist (next)", "Gala heist. Vesk presses Sera. Run the vault as a skill challenge.", { date: "2026-11-07", level: "3" }, ["next"]),
    rec("quest", "Find the missing collector", "Pell Ardway, found in the cellars.", { status: "Completed", giver: "Mayor Venn", reward: "200 gp" }, ["main"]),
    rec("quest", "The two halves of the crown", "Dawn Half: found in the Archive (session 5), stolen at the festival (6). Dusk Half: Ironvale (7).", { status: "Active", giver: "Old Marrow", reward: "The kingdom" }, ["main"]),
    rec("quest", "Brannoch's temple", "Find Mother Hesper, rebuild the Dawn Shield temple.", { status: "Active", giver: "Brannoch", reward: "A home" }, ["arc"]),
    rec("quest", "Sera's debt", "500 gp to Vesk, or a favour of equal weight.", { status: "Active", giver: "Madame Vesk", reward: "Freedom" }, ["arc"]),
    rec("quest", "The Lantern Players' fire", "Who lit it, and why.", { status: "Rumour", giver: "Lyra", reward: "The truth" }, ["arc"]),
    rec("npc", "Lord Caedran Vale", "Wears a plain grey robe over armour. Calm. Offers every hero what they want most, at a price.", { role: "Cult patron", attitude: "Hostile" }, ["villain"]),
    rec("npc", "Madame Vesk", "Fence and guild enforcer. Fond of Sera, fonder of money.", { role: "Fence", attitude: "Wary" }, ["gray cloaks"]),
    rec("npc", "Old Marrow the Hermit", "Speaks in riddles, never lies. Trades truth for bread.", { role: "Hermit", attitude: "Friendly" }, ["ally"]),
    rec("location", "Brindlemoor", "A market town on the river Vael. The cellars, the Gilded Boar, Lantern Square.", { place: "Town" }, ["act 1"]),
    rec("location", "Harrowgate", "The Duke's walled city; the Dawn Shield temple, the Black Lantern, the Gray Cloak Den.", { place: "City" }, ["act 2"]),
    rec("location", "Ironvale", "The dwarven hold under the Grey Teeth; the Deep Forge.", { place: "Hold" }, ["act 2"]),
  ],
  lists: [
    list("Before next session", [["Print party handouts", 1], ["Message players the date", 1], ["Prep the Duke's gala music"], ["Restock potions in the shop"]]),
    list("Plot threads", [["Who is the cult's patron?", 1], ["Where is the second half of the crown?"], ["What did Mayor Venn sign?", 1], ["Why won't the Order answer Vaelor?"], ["Who is the Hollow King?"]]),
    list("Player hooks to pay off", [["Brannoch: Mother Hesper (s6-7)"], ["Sera: Vesk and the debt (s4, s8)"], ["Thalric: Ruck (s9)"], ["Elowen: Ashvane (s10)"], ["Korg: Ashfang blessing (s11)"], ["Lyra: the festival fire (s6)"], ["Vaelor: Dawnbreaker (s11)"]]),
  ],
  scenarios, maps: [], boards: [bd], updated: now, displayName: "", legacyImported: true,
};

// ---- what each player keeps in their own planner (shared with the DM) -------------------------------------------------------
const mine = (name, goal, steps, thing) => ({
  notes: [note("What my character wants", goal, { tags: ["motive"], pinned: true }), note("Session notes", `We found Pell in the cellars. The cult worships the Sundered Crown. Marrow gave us a rune. Next: Harrowgate. ${thing}`, { tags: ["recap"] })],
  lists: [list("My goals", steps.map(([t, d]) => [t, d])), list("Party to-do", [["Buy potions in Harrowgate"], ["Ask Vesk about the Archive map"], ["Sell hag loot", 1]])],
  boards: [], updated: now,
});
const players = {
  aldric: mine("Brannoch", "Find Mother Hesper, who raised me at the Dawn Shield temple, and rebuild what the cult burned.", [["Find out what happened to the temple", 1], ["Find Mother Hesper"], ["Ask uncle Brogan about Ironvale"]], "Brannoch: the sigil matches the one on the temple door."),
  bea: mine("Sera", "Clear my debt to Madame Vesk and leave the Gray Cloaks for good.", [["Count what I owe", 1], ["Find what Vesk really wants"], ["Pick a way out: pay, steal, or bargain"]], "Sera: Vesk knew about the Archive before we did."),
  cal: mine("Thalric", "Find Captain Ruck and learn why the Ninth was sold.", [["Confirm Ruck is alive", 1], ["Find Sergeant Maddox"], ["Decide: justice or mercy"]], "Thalric: that was Ruck's sword on the road."),
  dani: mine("Elowen", "Find Magister Ashvane. His last letter says there is a choice only I can make.", [["Reread the letter", 1], ["Find Ashvane's trail in the Archive"], ["Learn what the choice is"]], "Elowen: Ashvane studied this very crown."),
  eli: mine("Korg", "Win back my clan's blessing from my mother, Chief Ragna.", [["Stay out of trouble"], ["Learn who ordered the raid I refused"], ["Return to the Ashfang"]], "Korg: those cultists smelled like Ashfang war-paint."),
  fern: mine("Lyra", "Find out who burned the Lantern Players, and write the ballad that tells it.", [["Question Hobb about the festival", 1], ["Watch Mayor Venn"], ["Finish the ballad"]], "Lyra: the festival is in three weeks, the same as the fire two years ago."),
  gus: mine("Vaelor", "Find Dawnbreaker and keep the crown from every hand, even mine.", [["Write the Order again", 1], ["Learn where the Dragon Guard lies"], ["Keep the key rune safe"]], "Vaelor: the Order still has not answered."),
};

console.log(JSON.stringify({ dm, players }));
