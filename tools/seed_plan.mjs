// Builds a DM's campaign planner for the throwaway test table: twelve sessions on one whiteboard (three played, nine prepared),
// recurring villains and places tied together with connections, a story arc for each of the seven players, a scenario per
// session, and notes / NPCs / quests / locations in the planner's notebook. Prints { dm, players } as JSON for
// tools/seed_test_campaign.py.
// --showcase (tools/seed_showcase.py): the same story run long, twenty-four sessions with the first twelve played, an eighth
// player, and a second act that grows out of the first.
//   node tools/seed_plan.mjs [--showcase]

import { addSession, addLink, normalizeBoard, syncSessions } from "../js/planner/board.js";
import { genDungeon } from "../js/systems/dnd5e/engine/generators.js";

const SHOWCASE = process.argv.includes("--showcase");
let n = 0;
const id = (p = "n") => `${p}${(++n).toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
const now = Date.now();

const list = (title, items) => ({ id: id("l"), title, items: items.map(([text, done]) => ({ id: id("i"), text, done: !!done })), created: now, updated: now });
const note = (title, body, extra = {}) => ({ id: id("t"), title, body, tags: [], pinned: false, created: now, updated: now, ...extra });
const scene = (title, kind, f = {}) => ({ id: id("c"), title, kind, location: "", readAloud: "", body: "", npcs: "", foes: "", secrets: "", rewards: "", branches: "", done: false, ...f });

// ---- the board: 12 session boxes in a 4 x 3 grid, the seven players' arcs in a band above -----------------------------
// roomy on purpose: wide gaps between sessions and between nodes, so the connection lines and labels have space to read
const SESSIONS = SHOWCASE ? 24 : 12, COLS = SHOWCASE ? 6 : 4;
const PX = 1500, PY = 1000, BW = 1300, BH = 800, X0 = SHOWCASE ? -4400 : -2900, ARC_Y = -1900, GRID_Y = -1200;
const boxes = Array.from({ length: SESSIONS }, (_, i) => ({ kind: "box", x: X0 + (i % COLS) * PX, y: GRID_Y + Math.floor(i / COLS) * PY, w: BW, h: BH }));
const nodes = [];
const add = (o) => { const x = { id: id(), w: 300, h: 230, ...o }; nodes.push(x); return x; };

// spec: [kind, title, text or lines, extra]. kinds: gen kinds (npc, tavern, shop, hook, rumour, loot, room, encounter), "note", "sticky", "list", "dungeon"
// In the showcase every one of the first twelve sessions has been played: its prep checklist becomes the recap.
const PLAYED_RECAPS = {
  3: "PLAYED. The gala heist went sideways when Korg 'distracted' the guards with a toast. Sera lifted the ledger; it names Lord Caedran Vale.",
  4: "PLAYED. Solved the four-book puzzle on the third try. Elowen heard Ashvane's echo. The Dawn Half is ours, for now.",
  5: "PLAYED. Nyx struck at the festival; Lyra kept singing through it. The Dawn Half was lost. The temple in Harrowgate burned.",
  6: "PLAYED. Brannoch found Mother Hesper alive in Ironvale. Uncle Brogan gave up the Dusk Half after the duergar raid.",
  7: "PLAYED. The guild judged Sera's debt paid, then Vesk's betrayal came out. Rooftop chase: nobody fell, barely.",
  8: "PLAYED. Thalric spared Ruck. Ruck named the Dreaming Spire and died at peace. Maddox carries the banner again.",
  9: "PLAYED. Elowen woke Ashvane. He is weak but free, and the cult has lost its key.",
  10: "PLAYED. Korg won the Ashfang to the cause. Vaelor drew Dawnbreaker in the Dragon Guard tomb. The legion broke at the gates.",
  11: "PLAYED. Caedran fell, the crown shattered, and the Hollow King rose from the pieces. Mirelle arrived with a bargain. Party level 7.",
};
function fill(sessionIndex, specs) {
  const b = boxes[sessionIndex];
  specs.forEach((spec, i) => {
    if (SHOWCASE && PLAYED_RECAPS[sessionIndex] && (spec[0] === "list" || (sessionIndex === 10 && spec[0] === "note"))) spec = ["sticky", "Recap", PLAYED_RECAPS[sessionIndex], RECAP];
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

if (SHOWCASE) {
  // ---- act two: the Hollow King (sessions 13 to 24, three ready and nine drafted) ----
  fill(12, [
    ["npc", "The Hollow King", ["The first king to wear the crown, dead three hundred years.", "Woke when the crown shattered. Wants the shards, and a body.", "Speaks to Elowen in her dreams. Knows her name."]],
    ["room", "The Crypt Court", ["Under Harrowgate's cathedral: a throne of bones and a court of the dead.", "Lair: candles relight every round; the dead kneel when he speaks."]],
    ["encounter", "The Hollow Court", ["Sister Nyx (homebrew), 2 wights, 6 skeletons.", "Nyx flees at half HP through the ossuary."]],
    ["npc", "Sister Nyx, the Herald", ["Survived the festival. Now the Hollow King's herald.", "Offers Lyra the name of the fire-setter for a shard."]],
    ["hook", "Shards of the Crown", ["Seven shards scattered when the crown broke.", "The Hollow King needs all seven; the party needs one to bind him."]],
    ["list", "Prep: Session 13", [["Crypt Court map", 1], ["Nyx's homebrew stat block", 1], ["Hollow King's dream speech"]]],
  ]);
  fill(13, [
    ["encounter", "The Barrow Road", ["4 ghouls, 2 ghasts in the fog.", "The dead walk toward Harrowgate; the road is a river of them."]],
    ["npc", "Warden Elsabet", ["Keeper of the Barrowlands, half-blind, carries a bell.", "Knows which barrows hold shards."]],
    ["tavern", "The Last Lantern", ["A crossroads inn that never lets its fire go out.", "The landlord is an imp in disguise (the Ember Duke's)."]],
    ["rumour", "Ghost Lights", ["Lights move over the barrows on moonless nights. Something is digging."]],
    ["loot", "Barrow Shard", ["Shard of the crown (1 of 7)", "Elsabet's bell: undead within 30 ft must save or flee"]],
    ["list", "Prep: Session 14", [["Fog travel table", 1], ["Elsabet's barrow map"], ["Imp landlord's tells"]]],
  ]);
  fill(14, [
    ["npc", "The Ember Duke", ["Mirelle's patron, a fiend of courtly manners.", "Wants the Hollow King destroyed: a rival in the hells.", "Will free Mirelle's name for the Hollow King's heart."]],
    ["hook", "Mirelle's Bargain", ["The Duke's envoy offers the party power against the dead, at Mirelle's expense."]],
    ["encounter", "Contract Hellhounds", ["2 hell hounds and the imp landlord, if the bargain is refused."]],
    ["note", "The fine print", "The contract has a clause no one has read: whoever lands the killing blow on the Hollow King owes the Duke a favour. Let Sera find it with a DC 18 Investigation."],
    ["shop", "The Duke's Wares", ["Infernal goods for souls or secrets.", "Potion of fire breath, a +1 rod, a whispering map to a shard."]],
    ["list", "Prep: Session 15", [["The Duke's voice"], ["Contract handout"], ["Who signs?"]]],
  ]);
  fill(15, [
    ["dungeon", "The Ironvale Deeps", 10, { 2: "Collapsed mine: shard hums behind the rubble.", 7: "Duergar war-chapel." }],
    ["npc", "Thane Brogan Ironvale (again)", ["Now an ally, but his hold is split: half want to hide the shard forever."]],
    ["encounter", "Deep Dwellers", ["Duergar remnants and a hungry earth elemental."]],
    ["loot", "Forge Shard", ["Shard of the crown (2 of 7)", "Ironvale masterwork plate (for whoever needs it)"]],
  ]);
  fill(16, [
    ["npc", "Mayor Odalys Venn (redeemed?)", ["Confesses she signed the cult's lease to save the town from debt.", "Wants to make it right; Lyra decides if she gets the chance."]],
    ["encounter", "Brindlemoor Under Siege", ["The dead at the walls; mass combat in units of 20.", "Lyra's ballad (Performance DC 17) gives everyone advantage on fear saves."]],
    ["room", "Lantern Square, Again", ["The festival stage, now a barricade."]],
    ["hook", "The Ballad", ["Lyra performs the whole truth: the fire, Venn's lease, Nyx's test."]],
  ]);
  fill(17, [
    ["npc", "Madame Vesk (returned)", ["Back from the cult, broke and hunted.", "Offers Sera the guild in exchange for protection."]],
    ["hook", "The Gray Cloaks' Gambit", ["Guildmother Sable is dying. The guild will be Sera's, Vesk's, or nobody's."]],
    ["room", "The Vault of Names", ["Where the guild keeps every debt ever owed.", "A shard is hidden among the ledgers."]],
    ["loot", "Ledger Shard", ["Shard of the crown (3 of 7)", "Sera's own debt slip, to burn or keep"]],
  ]);
  fill(18, [
    ["npc", "Old Sergeant Maddox (again)", ["Rides with twenty volunteers under the Ninth's banner."]],
    ["hook", "The Lancer Reborn", ["Thalric is offered the captaincy of a new Ninth."]],
    ["encounter", "Riders of the Barrow", ["Dead cavalry: 6 wights on skeletal horses."]],
    ["loot", "Lancer Shard", ["Shard of the crown (4 of 7)"]],
  ]);
  fill(19, [
    ["dungeon", "The Spire Awakened", 8, { 1: "The gate of dreams, now open.", 5: "Ashvane's new study." }],
    ["npc", "Magister Ashvane (recovered)", ["Stronger, but frightened of what the crown taught him."]],
    ["hook", "A Choice of Spires", ["Elowen can become the Spire's archmage, binding herself to it."]],
    ["loot", "Spire Shard", ["Shard of the crown (5 of 7)"]],
  ]);
  fill(20, [
    ["npc", "Chief Ragna Ashfang (again)", ["Ready to step down. Korg must win the moot."]],
    ["encounter", "The Ashfang Moot", ["Trials of strength, wit and mercy; a cult plant tries to poison Korg."]],
    ["loot", "Clan Shard", ["Shard of the crown (6 of 7)"]],
  ]);
  fill(21, [
    ["npc", "Grandmaster Aurel", ["Head of the Order of the Dawn Shield. Silent for a year.", "He has been wearing a shard. It has been talking to him."]],
    ["hook", "The Order's Silence", ["Vaelor's order has been the Hollow King's since the crown broke."]],
    ["encounter", "Fallen Paladins", ["Grandmaster Aurel and 4 knights."]],
    ["loot", "Order Shard", ["Shard of the crown (7 of 7)"]],
  ]);
  fill(22, [
    ["dungeon", "The Barrow of Kings", 14, { 1: "The kings' road: every statue turns its head.", 9: "The empty tomb: the Hollow King's own." }],
    ["encounter", "Honour Guard of the Dead", ["2 wraiths and a specter in the ossuary."]],
    ["hook", "The Seventh Seal", ["The tomb opens only to someone who has worn the crown."]],
  ]);
  fill(23, [
    ["npc", "The Hollow King (finale)", ["Homebrew lich in the bestiary.", "Gains legendary resistance for each shard he holds."]],
    ["room", "The Throne Without a Crown", ["A hall of mirrors under the barrow; each mirror shows one hero's ending."]],
    ["encounter", "The Hollow King, at last", ["The Hollow King and 2 wraiths (saved encounter 'Finale: The Hollow King')."]],
    ["note", "Endings, act two", "Each hero's arc ends here: Brannoch's temple, Sera's guild, Thalric's Ninth, Elowen's Spire, Korg's clan, Lyra's ballad, Vaelor's oath and Mirelle's name."],
  ]);
}

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
if (SHOWCASE) ARCS.push(["Arc: Mirelle", "Cheat the Ember Duke and win back her name. Sessions 15 and 24; the contract's fine print is the key.", "#f0c0a0"]);
const ARC_COLS = SHOWCASE ? 5 : 4;
ARCS.forEach(([title, body, color], i) => add({ type: "text", title, body, color, x: X0 + 60 + (i % ARC_COLS) * 700, y: ARC_Y + Math.floor(i / ARC_COLS) * 300, w: 520, h: 200 }));
add({ type: "text", title: "Campaign status", body: SHOWCASE
  ? "The Sundered Crown: 8 players, 12 of 24 sessions played, the second act prepared. Party level 7. The crown is broken and the Hollow King is awake. Next up: The Hollow Court."
  : "The Sundered Crown: 7 players, 3 of 12 sessions played, 9 prepared. Party level 3. Next up: Harrowgate Heist. Ending: the crown's fate rests on the players' choices.",
color: "#f6e27a", x: X0 + 60 + 3 * 700, y: ARC_Y + 300, w: 520, h: 200 });

const bounds = SHOWCASE ? { x: -4500, y: -2000, w: 9200, h: 4900 } : { x: -3000, y: -2000, w: 6000, h: 3700 };
const bd = normalizeBoard({ id: id("b"), name: "The Sundered Crown", bounds, created: now, nodes, sessions: [], links: [], view: { x: 0, y: 0, z: SHOWCASE ? 0.14 : 0.2 } });
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
if (SHOWCASE) {
  // act two grows out of act one
  custom("The Whole Crown", "shattered into", "Shards of the Crown");
  custom("Lord Caedran and his Honour Guard", "his fall wakes", "The Hollow King");
  custom("Sister Nyx", "survives as", "Sister Nyx, the Herald");
  custom("Sister Nyx, the Herald", "heralds", "The Hollow King");
  link("The Hollow King", "lives in", "The Crypt Court");
  link("The Hollow Court", "guards", "The Crypt Court");
  link("The Hollow King", "wants", "Shards of the Crown");
  for (const t of ["Barrow Shard", "Forge Shard", "Ledger Shard", "Lancer Shard", "Spire Shard", "Clan Shard", "Order Shard"]) custom(t, "one of", "Shards of the Crown");
  link("Barrow Shard", "found in", "The Barrow Road");
  custom("Warden Elsabet", "knows the barrows of", "The Barrow Road");
  custom("The Last Lantern", "is a front for", "The Ember Duke");
  link("The Ember Duke", "wants", "Mirelle's Bargain");
  custom("The fine print", "hides in", "Mirelle's Bargain");
  link("Forge Shard", "found in", "The Ironvale Deeps");
  custom("Thane Brogan Ironvale (again)", "is", "Thane Brogan Ironvale");
  custom("Mayor Odalys Venn (redeemed?)", "is", "Mayor Odalys Venn");
  custom("The Ballad", "sung in", "Lantern Square, Again");
  custom("Madame Vesk (returned)", "is", "Madame Vesk");
  link("Ledger Shard", "found in", "The Vault of Names");
  custom("Old Sergeant Maddox (again)", "is", "Old Sergeant Maddox");
  custom("Magister Ashvane (recovered)", "is", "Magister Ashvane");
  link("Spire Shard", "found in", "The Spire Awakened");
  custom("Chief Ragna Ashfang (again)", "is", "Chief Ragna Ashfang");
  custom("Grandmaster Aurel", "carries", "Order Shard");
  custom("The Hollow King (finale)", "is", "The Hollow King");
  link("The Hollow King (finale)", "lives in", "The Throne Without a Crown");
  custom("The Seventh Seal", "opens", "The Barrow of Kings");
  custom("Arc: Mirelle", "bound to", "The Ember Duke"); custom("Arc: Mirelle", "must read", "The fine print");
  custom("Arc: Lyra", "finishes", "The Ballad"); custom("Arc: Sera", "is offered", "The Gray Cloaks' Gambit");
  custom("Arc: Thalric", "may lead", "The Lancer Reborn"); custom("Arc: Elowen", "chooses", "A Choice of Spires");
  custom("Arc: Korg", "must win", "The Ashfang Moot"); custom("Arc: Vaelor", "must face", "Grandmaster Aurel");
  custom("Arc: Brannoch", "returns to", "Thane Brogan Ironvale (again)");
}

// ---- scenarios, one per session ---------------------------------------------------------------------------------------
const sc = (title, status, hook, summary, scenes) => {
  const i = Number(title.match(/\d+/)[0]);
  if (SHOWCASE && i <= 12) { status = "played"; for (const x of scenes) x.done = true; }
  const level = SHOWCASE ? (status === "played" ? String(Math.min(7, 2 + Math.ceil(i / 2.4))) : "7") : status === "played" ? "3" : "";
  return { id: id("s"), title, status, level, players: SHOWCASE ? "8" : "7", hook, summary, tags: [], scenes, created: now, updated: now };
};
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

if (SHOWCASE) scenarios.push(
  sc("Session 13: The Hollow Court", "ready", "The crown broke and the dead king woke. His court gathers under the cathedral.", "Break up the Hollow Court; Nyx escapes with a shard's location.", [
    scene("Down into the crypts", "exploration", { location: "Cathedral ossuary" }), scene("The court in session", "social", { npcs: "The Hollow King (a voice), Sister Nyx" }), scene("Court of bones", "combat", { foes: "Sister Nyx, 2 wights, 6 skeletons" })]),
  sc("Session 14: The Barrow Road", "ready", "Warden Elsabet sends word: something digs in the barrows.", "Travel the fog road and win the first shard.", [
    scene("Fog and the dead", "travel"), scene("The Last Lantern", "social", { npcs: "Imp landlord" }), scene("Ghouls at the barrow", "combat", { foes: "4 ghouls, 2 ghasts", rewards: "Barrow Shard" })]),
  sc("Session 15: The Ember Duke's Bargain", "ready", "Mirelle's patron sends an envoy with an offer for the whole party.", "Read the fine print; accept, refuse, or cheat the Duke.", [
    scene("The envoy", "social", { npcs: "The Ember Duke" }), scene("The contract", "puzzle", { secrets: "Killing-blow clause, DC 18 Investigation" }), scene("Hellhounds", "combat", { foes: "2 hell hounds" })]),
  sc("Session 16: The Ironvale Deeps", "draft", "Uncle Brogan's miners broke into a humming vault.", "Delve the Deeps for the Forge Shard.", [scene("The collapsed mine", "exploration"), scene("Duergar chapel", "combat")]),
  sc("Session 17: Brindlemoor Under Siege", "draft", "The dead march on Brindlemoor.", "Hold the town; Lyra sings the ballad.", [scene("Barricades", "combat"), scene("The ballad", "social")]),
  sc("Session 18: The Gray Cloaks' Gambit", "draft", "Guildmother Sable is dying.", "Win the guild, and the Ledger Shard.", [scene("The Vault of Names", "puzzle"), scene("Vesk's offer", "social")]),
  sc("Session 19: The Lancer Reborn", "draft", "Maddox rides with twenty volunteers.", "Thalric's Ninth rides again.", [scene("Riders of the Barrow", "combat")]),
  sc("Session 20: The Spire Awakens", "draft", "Ashvane can open the Spire again.", "Elowen's choice of Spires.", [scene("The gate of dreams", "exploration"), scene("The archmage's seat", "reveal")]),
  sc("Session 21: The Ashfang Moot", "draft", "Chief Ragna will step down.", "Korg wins the moot, or doesn't.", [scene("Trials", "social"), scene("Poison", "combat")]),
  sc("Session 22: The Order's Silence", "draft", "Vaelor's order finally answers: come home.", "Face Grandmaster Aurel.", [scene("Fallen paladins", "boss")]),
  sc("Session 23: The Barrow of Kings", "draft", "Seven shards, one tomb.", "Delve the Barrow of Kings.", [scene("The kings' road", "exploration"), scene("The empty tomb", "reveal")]),
  sc("Session 24: The Hollow King", "draft", "The dead king waits on a throne without a crown.", "The finale.", [scene("The mirrors", "social"), scene("The Hollow King", "boss", { foes: "The Hollow King (homebrew), 2 wraiths" }), scene("Epilogues", "rest")]),
);

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
    ...(SHOWCASE ? [list("Act two shards", [["Barrow (s14)"], ["Forge (s16)"], ["Ledger (s18)"], ["Lancer (s19)"], ["Spire (s20)"], ["Clan (s21)"], ["Order (s22)"]])] : []),
    list("Before next session", [["Print party handouts", 1], ["Message players the date", 1], ["Prep the Duke's gala music"], ["Restock potions in the shop"]]),
    list("Plot threads", [["Who is the cult's patron?", 1], ["Where is the second half of the crown?"], ["What did Mayor Venn sign?", 1], ["Why won't the Order answer Vaelor?"], ["Who is the Hollow King?"]]),
    list("Player hooks to pay off", [["Brannoch: Mother Hesper (s6-7)"], ["Sera: Vesk and the debt (s4, s8)"], ["Thalric: Ruck (s9)"], ["Elowen: Ashvane (s10)"], ["Korg: Ashfang blessing (s11)"], ["Lyra: the festival fire (s6)"], ["Vaelor: Dawnbreaker (s11)"]]),
  ],
  scenarios, maps: [], boards: [bd], updated: now, displayName: "", legacyImported: true,
};
if (SHOWCASE) {
  // twelve sessions of records: every recap, the quests resolved since, the people met along the way
  const dates = (i) => new Date(Date.UTC(2026, 4, 2) + (i - 1) * 14 * 864e5).toISOString().slice(0, 10);
  dm.notes = dm.notes.filter((x) => x.kind !== "session" && x.kind !== "quest");
  const recaps = ["Bandits on the road, Brindlemoor, the cellar hook.", "Cleared the cellars, rescued Pell.", "Hags outwitted with a stolen bell.", ...Object.values(PLAYED_RECAPS).map((r) => r.replace(/^PLAYED\. /, ""))];
  scenarios.slice(0, 12).forEach((x, i) => dm.notes.push(rec("session", x.title, recaps[i], { date: dates(i + 1), level: x.level }, ["recap"])));
  dm.notes.push(rec("session", "Session 13: The Hollow Court (next)", "Crypt court; Nyx has a shard's location. Run the dream speech first.", { date: "2026-11-07", level: "7" }, ["next"]));
  for (const [t, b, status, giver, reward, tag] of [
    ["Find the missing collector", "Pell Ardway, found in the cellars.", "Completed", "Mayor Venn", "200 gp", "main"],
    ["The two halves of the crown", "Both halves found, joined by Caedran, shattered in session 12.", "Completed", "Old Marrow", "The kingdom", "main"],
    ["Seven shards", "Gather the shards before the Hollow King does.", "Active", "Warden Elsabet", "The end of the dead", "main"],
    ["Brannoch's temple", "Hesper found; the temple is being rebuilt.", "Completed", "Brannoch", "A home", "arc"],
    ["Sera's debt", "Ruled paid by the guild. Vesk sold it anyway.", "Completed", "Madame Vesk", "Freedom", "arc"],
    ["The Lantern Players' fire", "Nyx admitted it was a test of the ritual. The ballad is half written.", "Active", "Lyra", "The truth", "arc"],
    ["Ruck's betrayal", "Ruck spared at Fort Lancer; died at peace.", "Completed", "Thalric", "Justice", "arc"],
    ["Mirelle's name", "Owned by the Ember Duke until the Hollow King's heart is delivered.", "Active", "Mirelle", "Her name", "arc"],
    ["The Order's silence", "Why has Grandmaster Aurel not written in a year?", "Rumour", "Vaelor", "The truth", "arc"],
  ]) dm.notes.push(rec("quest", t, b, { status, giver, reward }, [tag]));
  dm.notes.push(rec("npc", "The Hollow King", "The dead king. Speaks in Elowen's dreams.", { role: "Act two villain", attitude: "Hostile" }, ["villain"]),
    rec("npc", "The Ember Duke", "Mirelle's patron. Courtly, patient, never lies outright.", { role: "Fiend patron", attitude: "Wary" }, ["infernal"]),
    rec("npc", "Warden Elsabet", "Keeper of the Barrowlands.", { role: "Warden", attitude: "Friendly" }, ["ally"]),
    rec("location", "The Barrowlands", "Fog, barrows, the road of the dead.", { place: "Wilds" }, ["act 3"]));
}

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
  ...(SHOWCASE ? { hana: mine("Mirelle", "Win back my name from the Ember Duke without handing him what he really wants.", [["Read the whole contract"], ["Learn what the Hollow King's heart is"], ["Tell the party the truth (eventually)"]], "Mirelle: the Duke's imp runs the Last Lantern.") } : {}),
  gus: mine("Vaelor", "Find Dawnbreaker and keep the crown from every hand, even mine.", [["Write the Order again", 1], ["Learn where the Dragon Guard lies"], ["Keep the key rune safe"]], "Vaelor: the Order still has not answered."),
};

console.log(JSON.stringify({ dm, players }));
