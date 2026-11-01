// Builds seven ready-made 3rd-level D&D 5e characters with the real rules engine and prints them as JSON.
// Used by tools/seed_test_campaign.py to fill a throwaway test server; nothing here touches real save data.
//   node tools/seed_characters.mjs

import { ctxFor } from "../tests/js/_data.mjs";
import { newDraft, buildCharacter, standardArrayFor, CLASS_PRIORITY } from "../js/systems/dnd5e/engine/builder.js";
import { addLevel, derive, pendingChoices } from "../js/systems/dnd5e/engine/character.js";

const ctx = ctxFor("2014");

const CAST = {
  wizard: { cantrips: ["fire-bolt", "mage-hand", "prestidigitation"], book: ["magic-missile", "shield", "mage-armor", "sleep", "detect-magic", "find-familiar", "misty-step", "web"], prepared: ["magic-missile", "shield", "mage-armor", "sleep", "misty-step", "web"] },
  cleric: { cantrips: ["sacred-flame", "guidance", "spare-the-dying"], prepared: ["bless", "cure-wounds", "healing-word", "guiding-bolt", "lesser-restoration", "spiritual-weapon"] },
  bard: { cantrips: ["vicious-mockery", "minor-illusion"], known: ["healing-word", "dissonant-whispers", "faerie-fire", "heroism", "hold-person", "suggestion"] },
  paladin: { prepared: ["bless", "cure-wounds", "divine-favor", "shield-of-faith"] },
};

// name, player, race[, subrace], class, subclass, background, scores priority, extras
const PARTY = [
  { name: "Brannoch Ironvale", player: "Aldric", race: "dwarf", sub: "hill-dwarf", cls: "cleric", subclass: "life", bg: ["Guild Artisan", ["Insight", "Persuasion"]], align: "Lawful Good", skills: ["Medicine", "Religion"], xp: 900 },
  { name: "Sera Quickfoot", player: "Bea", race: "halfling", sub: "lightfoot-halfling", cls: "rogue", subclass: "thief", bg: ["Criminal", ["Deception", "Stealth"]], align: "Chaotic Neutral", skills: ["Acrobatics", "Perception", "Sleight of Hand", "Investigation"], xp: 900 },
  { name: "Thalric Dawnforge", player: "Cal", race: "human", cls: "fighter", subclass: "champion", bg: ["Soldier", ["Athletics", "Intimidation"]], align: "Neutral Good", skills: ["Perception", "Survival"], xp: 900 },
  { name: "Elowen Starweave", player: "Dani", race: "elf", sub: "high-elf", cls: "wizard", subclass: "evocation", bg: ["Sage", ["Arcana", "History"]], align: "Neutral Good", skills: ["Investigation", "Insight"], xp: 900 },
  { name: "Korg the Unbroken", player: "Eli", race: "half-orc", cls: "barbarian", subclass: "berserker", bg: ["Outlander", ["Athletics", "Survival"]], align: "Chaotic Good", skills: ["Intimidation", "Perception"], xp: 900 },
  { name: "Lyra Songbird", player: "Fern", race: "half-elf", cls: "bard", subclass: "lore", bg: ["Entertainer", ["Acrobatics", "Performance"]], align: "Chaotic Good", skills: ["Persuasion", "Deception", "Insight"], picks: ["DEX", "CON"], xp: 900 },
  { name: "Vaelor Emberscale", player: "Gus", race: "dragonborn", cls: "paladin", subclass: "devotion", bg: ["Noble", ["History", "Persuasion"]], align: "Lawful Good", skills: ["Athletics", "Insight"], ancestry: "Draconic Ancestry (Red)", xp: 900 },
];

// Each hero's own reason to be on the road. The DM's board (tools/seed_plan.mjs) pays these off across the twelve sessions.
const TRAITS = {
  cleric: ["Warm and patient, hums hymns while working.", "Mercy: everyone deserves a second chance.", "Mother Hesper raised me at the Dawn Shield temple in Harrowgate. Cultists burned it and she vanished. I will find her.", "I trust too easily, and I never turn away the wounded, even enemies.",
    "Raised by Mother Hesper after the Ashen Court burned the temple in Harrowgate. She was the keeper of the Dawn Half of the crown and has been missing ever since. Brannoch took up the mace to find her, and to rebuild the temple.", "Thane Brogan Ironvale, his uncle in the dwarven hold of Ironvale."],
  rogue: ["Fidgets with a coin she never spends.", "Freedom: no one should own anyone.", "I owe 500 gp to Madame Vesk and the Gray Cloaks, who took me in as a child. I want out of the guild, clean.", "I can't resist a locked door, or a bet.",
    "Grew up in the Gray Cloaks' den under Harrowgate. Madame Vesk fronted her first thieves' tools and has held the debt over her ever since. Sera joined the party for the one thing the guild cannot give her: a way out.", "Madame Vesk (it's complicated)."],
  fighter: ["Salutes the dawn, even in a dungeon.", "Duty: protect the people who cannot protect themselves.", "The Ninth Lancers were my family. Captain Ruck sold us out to the Ashen Court and I am the last one alive who knows it.", "I follow orders long after they stop making sense.",
    "Served six years with the Ninth Lancers until their captain, Ruck, led them into an ambush at Fort Lancer. Thalric survived by playing dead, and has hunted the man ever since. He doesn't yet know Ruck serves the cult.", "Old Sergeant Maddox, one other survivor, last seen near Fort Lancer."],
  wizard: ["Reads over dinner and forgets to eat.", "Knowledge belongs to everyone.", "My mentor, Magister Ashvane, vanished while studying the Sundered Crown. I carry his last letter and I will not stop until I know what happened.", "Curiosity beats caution, every time.",
    "Apprenticed to Magister Ashvane at the Dreaming Spire. He vanished while studying the crown's history, and his last letter spoke of a choice only Elowen could make. She believes he is alive.", "Her familiar, Quill, an owl who steals sealing wax."],
  barbarian: ["Laughs loudly, sleeps under the sky.", "Strength is for shielding the weak.", "I was exiled from the Ashfang clan for refusing to raid a village. I want the chief's blessing to come home and to prove I chose right.", "I answer insults with fists, and regret it after.",
    "Exiled from the Ashfang clan for refusing a raid on Brindlemoor's outskirts. Korg wanders to earn back his name, and doesn't know the raid order came from the cult through Captain Ruck.", "Chief Ragna Ashfang, his mother, who has not spoken to him in three years."],
  bard: ["Names every sword and gives them voices.", "Stories change the world.", "My troupe, the Lantern Players, died in a fire at the Festival of Lanterns two years ago. Mayor Venn closed the inquiry. I will learn who lit it.", "I exaggerate. A lot.",
    "Lyra was the Lantern Players' youngest. When the troupe died in a festival fire that was ruled an accident, she began collecting every rumour about the cult and a ballad to tell the truth one day.", "Hobb, the barkeep at the Gilded Boar, who kept her troupe's instruments."],
  paladin: ["Speaks softly, stands like a wall.", "Honour above glory.", "I swore on my ancestors' tomb to find Dawnbreaker, the blade of the Dragon Guard, and to keep the crown from any hand.", "I judge others harshly, and myself harder.",
    "Vaelor descends from the Dragon Guard, who swore to protect the king and failed when the crown was sundered. He joined the Order of the Dawn Shield to atone, and carries their oath: the crown must never be whole in the wrong hands.", "The Order of the Dawn Shield, though its grandmaster has not answered his letters."],
};

function build(p) {
  const d = newDraft("2014");
  d.name = p.name; d.player = p.player; d.alignment = p.align;
  d.raceId = p.race; d.subraceId = p.sub || ""; d.raceAbilityPicks = p.picks || [];
  d.classId = p.cls; d.scores = standardArrayFor(CLASS_PRIORITY[p.cls]);
  d.backgroundId = ""; d.bgCustom = { name: p.bg[0], skills: p.bg[1], tools: "", feature: "" };
  d.classSkills = p.skills;
  if (p.ancestry) d.raceTraitPicks = { "Draconic Ancestry": p.ancestry };
  const [traits, ideals, bonds, flaws, backstory, allies] = TRAITS[p.cls];
  d.details = { ...d.details, traits, ideals, bonds, flaws, backstory, allies };
  const cast = CAST[p.cls];
  if (cast) { d.cantrips = cast.cantrips || []; d.spellsKnown = cast.known || []; d.spellbook = cast.book || []; d.prepared = cast.prepared || []; }
  const c = buildCharacter(d, ctx);
  addLevel(c, p.cls, null); addLevel(c, p.cls, null);
  c.subclasses[p.cls] = p.subclass;
  c.xp = p.xp;
  if (p.cls === "wizard") c.spells.book = cast.book;
  return c;
}

const party = PARTY.map(build);
// the decisions the builder leaves for level-up screens: fighting styles and expertise
const choose = (c, key, picks) => { c.choices[key] = picks; };
const expert = (c, key, skills) => { choose(c, key, skills); for (const s of skills) c.skills[s] = 2; };
expert(party[1], "rogue-expertise-1:expertise", ["Stealth"]);
choose(party[2], "fighter-fighting-style", ["fighter-fighting-style-defense"]);
expert(party[5], "bard-expertise-1:expertise", ["Persuasion", "Performance"]);
choose(party[6], "paladin-fighting-style", ["fighting-style-defense"]);

// a little life: wounded, spent resources, one inspired
party[1].inspiration = true;
party[4].hp.current = derive(party[4], ctx).hpMax - 7;
party[2].hp.current = derive(party[2], ctx).hpMax - 4;
party[3].slotsUsed = { 1: 1 };

const report = party.map((c) => ({ name: c.name, pending: pendingChoices(c, ctx).map((x) => `${x.feature.id} ${x.have}/${x.need}${x.expertise ? " (expertise)" : ""} opts=${JSON.stringify(x.feature.options || x.feature.pick || x.feature.expertise).slice(0, 260)}`) }));
console.error(JSON.stringify(report, null, 1));
console.log(JSON.stringify(party));
