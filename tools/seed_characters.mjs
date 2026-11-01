// Builds ready-made D&D 5e characters with the real rules engine and prints them as JSON.
// Used by tools/seed_test_campaign.py (seven 3rd-level heroes) and tools/seed_showcase.py (--showcase: eight 7th-level heroes
// halfway through a long campaign, plus the DM's homebrew, saved encounters and a fight in progress). Nothing here touches
// real save data.
//   node tools/seed_characters.mjs [--showcase [--prefix=showcase]]

import { ctxFor, monsters } from "../tests/js/_data.mjs";
import { newDraft, buildCharacter, standardArrayFor, CLASS_PRIORITY } from "../js/systems/dnd5e/engine/builder.js";
import { addLevel, derive, pendingChoices, asiPending, addItemRecord, newItem, presenceSummary } from "../js/systems/dnd5e/engine/character.js";
import { newCombat, monsterCombatant, pcCombatant, customCombatant, orderedCombatants, healthStatus } from "../js/systems/dnd5e/engine/encounter.js";

const SHOWCASE = process.argv.includes("--showcase");
const LEVEL = SHOWCASE ? 7 : 3;
const ctx = ctxFor("2014");

const CAST = {
  wizard: { cantrips: ["fire-bolt", "mage-hand", "prestidigitation"], book: ["magic-missile", "shield", "mage-armor", "sleep", "detect-magic", "find-familiar", "misty-step", "web"], prepared: ["magic-missile", "shield", "mage-armor", "sleep", "misty-step", "web"] },
  cleric: { cantrips: ["sacred-flame", "guidance", "spare-the-dying"], prepared: ["bless", "cure-wounds", "healing-word", "guiding-bolt", "lesser-restoration", "spiritual-weapon"] },
  bard: { cantrips: ["vicious-mockery", "minor-illusion"], known: ["healing-word", "dissonant-whispers", "faerie-fire", "heroism", "hold-person", "suggestion"] },
  paladin: { prepared: ["bless", "cure-wounds", "divine-favor", "shield-of-faith"] },
};
// halfway through the long campaign the casters have grown
const CAST_7 = {
  wizard: { cantrips: ["fire-bolt", "mage-hand", "prestidigitation", "light"], book: ["magic-missile", "shield", "mage-armor", "sleep", "detect-magic", "find-familiar", "misty-step", "web", "scorching-ray", "invisibility", "fireball", "counterspell", "fly", "haste", "ice-storm", "polymorph", "greater-invisibility", "dimension-door"], prepared: ["magic-missile", "shield", "mage-armor", "misty-step", "web", "scorching-ray", "fireball", "counterspell", "haste", "ice-storm", "dimension-door"] },
  cleric: { cantrips: ["sacred-flame", "guidance", "spare-the-dying", "light"], prepared: ["bless", "cure-wounds", "healing-word", "guiding-bolt", "lesser-restoration", "spiritual-weapon", "aid", "spirit-guardians", "revivify", "mass-healing-word", "death-ward", "guardian-of-faith"] },
  bard: { cantrips: ["vicious-mockery", "minor-illusion", "mage-hand"], known: ["healing-word", "faerie-fire", "heroism", "charm-person", "hold-person", "suggestion", "invisibility", "hypnotic-pattern", "tongues", "counterspell", "fireball", "dimension-door"] },
  paladin: { prepared: ["bless", "cure-wounds", "divine-favor", "shield-of-faith", "aid", "find-steed", "lesser-restoration", "magic-weapon"] },
  warlock: { cantrips: ["eldritch-blast", "chill-touch", "minor-illusion"], known: ["hellish-rebuke", "charm-person", "darkness", "misty-step", "hold-person", "fear", "vampiric-touch", "dimension-door"] },
};

// name, player, race[, subrace], class, subclass, background, extras. `multi`: extra class levels at the end (showcase only).
const PARTY = [
  { name: "Brannoch Ironvale", player: "Aldric", race: "dwarf", sub: "hill-dwarf", cls: "cleric", subclass: "life", bg: ["Guild Artisan", ["Insight", "Persuasion"]], align: "Lawful Good", skills: ["Medicine", "Religion"], asi: [["WIS", 2]] },
  { name: "Sera Quickfoot", player: "Bea", race: "halfling", sub: "lightfoot-halfling", cls: "rogue", subclass: "thief", bg: ["Criminal", ["Deception", "Stealth"]], align: "Chaotic Neutral", skills: ["Acrobatics", "Perception", "Sleight of Hand", "Investigation"], asi: [["DEX", 2]] },
  { name: "Thalric Dawnforge", player: "Cal", race: "human", cls: "fighter", subclass: "champion", bg: ["Soldier", ["Athletics", "Intimidation"]], align: "Neutral Good", skills: ["Perception", "Survival"], asi: [["STR", 2], ["CON", 2]] },
  { name: "Elowen Starweave", player: "Dani", race: "elf", sub: "high-elf", cls: "wizard", subclass: "evocation", bg: ["Sage", ["Arcana", "History"]], align: "Neutral Good", skills: ["Investigation", "Insight"], asi: [["INT", 2]] },
  { name: "Korg the Unbroken", player: "Eli", race: "half-orc", cls: "barbarian", subclass: "berserker", bg: ["Outlander", ["Athletics", "Survival"]], align: "Chaotic Good", skills: ["Intimidation", "Perception"], asi: [["STR", 2]], multi: ["fighter", 2] },
  { name: "Lyra Songbird", player: "Fern", race: "half-elf", cls: "bard", subclass: "lore", bg: ["Entertainer", ["Acrobatics", "Performance"]], align: "Chaotic Good", skills: ["Persuasion", "Deception", "Insight"], picks: ["DEX", "CON"], asi: [["CHA", 2]] },
  { name: "Vaelor Emberscale", player: "Gus", race: "dragonborn", cls: "paladin", subclass: "devotion", bg: ["Noble", ["History", "Persuasion"]], align: "Lawful Good", skills: ["Athletics", "Insight"], ancestry: "Draconic Ancestry (Red)", asi: [["STR", 2]] },
  { name: "Mirelle Ashgrove", player: "Hana", race: "tiefling", cls: "warlock", subclass: "fiend", bg: ["Charlatan", ["Deception", "Sleight of Hand"]], align: "Neutral", skills: ["Arcana", "Intimidation"], asi: [["CHA", 2]], showcaseOnly: true },
];

// Each hero's own reason to be on the road. The DM's board (tools/seed_plan.mjs) pays these off across the sessions.
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
  warlock: ["Smiles at the wrong moments; keeps a candle lit at all times.", "A bargain is a bargain, and I keep mine.", "My patron, the Ember Duke, owns my name until I deliver him the Hollow King's heart. I mean to find a way to cheat him first.", "I lie when the truth would do, out of habit.",
    "Mirelle sold her name to a fiend to save her sister from the plague in Harrowgate's lower wards. The Ember Duke wants the Hollow King destroyed (his rival in the hells), and Mirelle joined the party at the end of the first act, after the crown broke and the Hollow King rose.", "Her sister Tamsin, a novice at the rebuilt Dawn Shield temple."],
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
  const cast = (SHOWCASE ? CAST_7 : CAST)[p.cls];
  if (cast) { d.cantrips = cast.cantrips || []; d.spellsKnown = cast.known || []; d.spellbook = cast.book || []; d.prepared = cast.prepared || []; }
  const c = buildCharacter(d, ctx);
  const [mc, mcLevels] = SHOWCASE && p.multi ? p.multi : [null, 0];
  for (let lv = 2; lv <= LEVEL - mcLevels; lv++) addLevel(c, p.cls, null);
  for (let i = 0; i < mcLevels; i++) addLevel(c, mc, null);
  c.subclasses[p.cls] = p.subclass;
  c.xp = SHOWCASE ? 23000 : 900;
  if (cast?.book) c.spells.book = cast.book;
  if (SHOWCASE) {
    // the ability score improvements a level-7 hero has taken, recorded the way the level-up screen records them
    for (const [ab, n] of p.asi.slice(0, asiPending(c))) {
      c.bonuses.push({ src: "Ability Score Improvement", ab, n });
      c.asiLog.push({ level: 4, classId: p.cls, kind: "asi", detail: `${ab} +${n}` });
    }
  }
  autofill(c, p);
  return c;
}

// The decisions the builder leaves for level-up screens (fighting styles, expertise, invocations, ...): the preferred
// pick where the hero has one, otherwise the first options on offer.
const PREFER = { expertise: { rogue: ["Stealth", "Sleight of Hand", "Perception", "Acrobatics"], bard: ["Persuasion", "Performance", "Deception", "Insight"] }, style: ["defense", "great-weapon"] };
function autofill(c, p) {
  for (let guard = 0; guard < 12; guard++) {
    const pend = pendingChoices(c, ctx);
    if (!pend.length) return;
    let progressed = false;
    for (const x of pend) {
      const f = x.feature;
      const key = x.expertise ? `${f.id}:expertise` : f.id;
      const have = c.choices[key] || [];
      const want = x.need - have.length;
      let pool;
      if (x.expertise) {
        const prof = Object.keys(c.skills).filter((s) => c.skills[s] === 1 && !have.includes(s));
        pool = [...(PREFER.expertise[p.cls] || []).filter((s) => prof.includes(s)), ...prof];
      } else {
        const opts = (f.options || f.pick?.options || f.pick?.from || []).map((o) => (typeof o === "string" ? o : o.id ?? o.name)).filter((o) => o && !have.includes(o));
        pool = [...opts.filter((o) => PREFER.style.some((s) => o.includes(s))), ...opts];
      }
      const add = [...new Set(pool)].slice(0, want);
      if (!add.length) continue;
      c.choices[key] = [...have, ...add];
      if (x.expertise) for (const s of add) c.skills[s] = 2;
      progressed = true;
    }
    if (!progressed) return;
  }
}

const party = PARTY.filter((p) => SHOWCASE || !p.showcaseOnly).map(build);
const by = (name) => party.find((c) => c.name.startsWith(name));

// a little life: wounded, spent resources, one inspired
by("Sera").inspiration = true;
by("Korg").hp.current = derive(by("Korg"), ctx).hpMax - 7;
by("Thalric").hp.current = derive(by("Thalric"), ctx).hpMax - 4;
by("Elowen").slotsUsed = { 1: 1 };

if (SHOWCASE) {
  // Twelve sessions in: magic items, money, journals, homebrew attacks and resources, the scars of the last fight.
  const gear = (c, name, extra = {}) => { const rec = ctx.equipmentByName.get(name.toLowerCase()); const it = rec ? addItemRecord(c, rec) : (c.inventory.push(newItem({ name, kind: "gear" })), c.inventory.at(-1)); Object.assign(it, extra); return it; };
  const magic = (c, name, rarity, desc, extra = {}) => { const it = newItem({ name, kind: "gear" }); Object.assign(it, { magic: true, rarity, custom: { kind: "gear", desc }, ...extra }); c.inventory.push(it); return it; };
  // a magic weapon or armour is a real SRD item underneath (so it shows up as an attack or counts for AC), renamed
  const enchanted = (c, base, name, rarity, bonus, desc, extra = {}) => {
    for (const x of c.inventory) if (x.equipped && ctx.equipmentByName.get(base.toLowerCase())?.kind === "armor" && x.kind === "armor" && (base === "Shield") === (x.name === "Shield")) x.equipped = false;
    const it = newItem(ctx.equipmentByName.get(base.toLowerCase()), 1);
    Object.assign(it, { name, magic: true, rarity, bonus, equipped: true, custom: { desc } }, extra);
    c.inventory.push(it);
    return it;
  };
  const journal = (c, entries) => { c.journal = entries.map((text, i) => ({ id: `j${i}${c.id}`, ts: Date.now() - (entries.length - i) * 7 * 864e5, text })).reverse(); };

  const B = by("Brannoch"), S = by("Sera"), T = by("Thalric"), E = by("Elowen"), K = by("Korg"), L = by("Lyra"), V = by("Vaelor"), M = by("Mirelle");
  enchanted(B, "Shield", "Dwarven Shield +1", "uncommon", 1, "Thane Brogan's gift. +1 AC on top of a shield's +2.");
  gear(B, "Potion of Healing", { qty: 3 });
  B.currency = { pp: 2, gp: 340, ep: 0, sp: 45, cp: 12 };
  B.customResources.push({ id: "rtemple", name: "Temple donations promised", max: 5, recharge: "long" });
  journal(B, ["Session 6: watched the temple burn from Lantern Square. Hesper got out.", "Session 7: found Hesper in Ironvale. Uncle Brogan finally knelt.", "Session 12: the crown is broken. The dead did not go quiet. Who is the Hollow King?"]);

  magic(S, "Cloak of Elvenkind", "uncommon", "Advantage on Stealth; Perception to see you has disadvantage. Requires attunement.", { equipped: true, attuned: true });
  gear(S, "Thieves' Tools");
  S.currency = { pp: 0, gp: 512, ep: 0, sp: 9, cp: 0 };
  S.attacks.push({ id: "aknife", name: "Vesk's knife (sentimental)", bonus: 8, damage: "1d4+5 piercing", type: "", notes: "The knife Vesk gave her. Sera hasn't decided whether to return it." });
  journal(S, ["Session 8: the guild ruled my debt paid. Vesk sold it to the cult anyway.", "Session 12: I kept 512 gp of Caedran's treasury. Nobody asked."]);

  enchanted(T, "Plate Armor", "Plate Armor", "", 0, "Bought in Harrowgate with the Duke's reward.", { magic: false });
  enchanted(T, "Longsword", "Ruck's Longsword +1", "uncommon", 1, "Taken from Captain Ruck at Fort Lancer.");
  magic(T, "The Ninth's Banner", "rare", "Rally (1/day): allies within 30 ft gain +1 to attack rolls for 1 minute.");
  T.currency = { pp: 1, gp: 210, ep: 0, sp: 30, cp: 0 };
  T.conditions = ["Poisoned"];
  journal(T, ["Session 9: Ruck asked for mercy. I gave it. He named the Spire.", "Session 12: I carried the banner into the Crown Chamber. The Ninth would be proud."]);

  magic(E, "Ashvane's Orrery", "rare", "Once per day, cast augury with advantage on the roll.", { attuned: true });
  magic(E, "Wand of Magic Missiles", "uncommon", "7 charges; regains 1d6+1 at dawn.");
  E.currency = { pp: 5, gp: 95, ep: 0, sp: 0, cp: 0 };
  E.concentration = "Haste (on Korg)";
  E.slotsUsed = { 1: 2, 2: 1, 3: 2 };
  journal(E, ["Session 5: Ashvane's echo: 'Do not let the halves meet.'", "Session 10: I woke him. He is weak, but alive, and he is sorry.", "Session 12: the Hollow King spoke my name. How?"]);

  magic(K, "Belt of Dwarvenkind", "rare", "A gift from Ironvale for holding the Forge gate.", { attuned: true, equipped: true });
  K.currency = { pp: 0, gp: 44, ep: 0, sp: 3, cp: 70 };
  K.exhaustion = 1; K.hp.temp = 6;
  journal(K, ["Session 11: mother called me 'son' in front of the clan.", "Session 12: took the Hollow King's first blow. Still standing."]);

  magic(L, "Instrument of the Bards (Doss Lute)", "uncommon", "The Lantern Players' lute, returned by Hobb.", { attuned: true });
  L.currency = { pp: 3, gp: 180, ep: 0, sp: 22, cp: 0 };
  L.inspiration = true;
  journal(L, ["Session 6: Nyx admitted the fire was a test. I will sing it to the whole valley.", "Session 12: wrote the second verse of the ballad. It ends badly. Not yet."]);

  enchanted(V, "Plate Armor", "Plate of the Dragon Guard", "", 0, "His ancestors' plate, from the tomb under Harrowgate.", { magic: false });
  enchanted(V, "Longsword", "Dawnbreaker, the Oathblade", "very rare", 2, "+2 longsword; sheds bright light 20 ft; +1d8 radiant against undead. Only a Dragon Guard descendant can draw it.", { attuned: true });
  V.currency = { pp: 10, gp: 600, ep: 0, sp: 0, cp: 0 };
  journal(V, ["Session 11: drew Dawnbreaker in my ancestors' tomb.", "Session 12: the crown is broken. My oath is not finished: the Hollow King wore it first."]);

  magic(M, "Rod of the Pact Keeper +1", "uncommon", "+1 to warlock spell attacks and save DC; once a day, regain a pact slot.", { attuned: true, equipped: true, bonus: 1 });
  M.currency = { pp: 0, gp: 75, ep: 0, sp: 40, cp: 5 };
  M.pactUsed = 1;
  M.customResources.push({ id: "rduke", name: "Favours owed to the Ember Duke", max: 3, recharge: "never" });
  journal(M, ["Session 12: joined these fools in the Crown Chamber. The Duke wants the Hollow King's heart; so, it seems, do they."]);

  // after the last fight
  S.hp.current = derive(S, ctx).hpMax - 12;
  V.hp.current = derive(V, ctx).hpMax - 20;
  L.hp.current = 0; L.deathSaves = { s: 1, f: 1 };
}

const report = party.map((c) => ({ name: c.name, level: c.levelLog.length, asi: asiPending(c), pending: pendingChoices(c, ctx).map((x) => `${x.feature.id} ${x.have}/${x.need}`) }));
console.error(JSON.stringify(report));

if (!SHOWCASE) {
  console.log(JSON.stringify(party));
} else {
  // ---- the DM's own D&D tools: homebrew monsters and items, saved encounters, and the fight the table stopped in ----------
  const mons = monsters("2014");
  const copy = (id, over) => ({ ...structuredClone(mons.byId.get(id)), ...over });
  const customMonsters = [
    copy("lich", { id: "custom-hollow-king", name: "The Hollow King", cr: 12, xp: 8400, hp: 150, desc: "The dead king who wore the crown first. Weakened while the crown's shards are apart. Homebrew: lich with no legendary resistance until the shards are joined." }),
    copy("cult-fanatic", { id: "custom-sister-nyx", name: "Sister Nyx", hp: 66, cr: 4, xp: 1100, desc: "Cult lieutenant. Commands the dead: as a bonus action, one skeleton within 30 ft makes an attack." }),
    copy("wight", { id: "custom-ruck-undead", name: "Captain Ruck (undead)", hp: 70, cr: 4, xp: 1100, desc: "Raised by the cult after Fort Lancer. Begs forgiveness before he fights." }),
  ];
  const customItems = [
    { id: "custom-shard-dawn", name: "Shard of the Dawn Half", kind: "gear", rarity: "artifact", desc: "Warm, humming. While carried, undead within 10 ft have disadvantage on saving throws." },
    { id: "custom-dawnbreaker", name: "Dawnbreaker, the Oathblade", kind: "weapon", rarity: "very rare", desc: "+2 longsword; +1d8 radiant against undead; only a Dragon Guard descendant can draw it." },
  ];
  const customSpells = [
    { id: "custom-lantern-ward", name: "Lantern Ward", level: 2, school: "abjuration", castingTime: "1 action", range: "30 feet", components: "V, S, M (a paper lantern)", duration: "Concentration, up to 10 minutes", classes: ["bard", "cleric"], desc: "Lyra's homebrew. A ring of ghostly lanterns: undead that start their turn inside take 2d6 radiant damage." },
  ];
  const levels = party.map(() => 7);
  const encounters = [
    { id: "e-hollow-court", name: "Session 13: The Hollow Court", edition: "2014", levels, monsters: [{ id: "custom-sister-nyx", name: "Sister Nyx", cr: 4, xp: 1100, count: 1, custom: customMonsters[1] }, { id: "wight", name: "Wight", cr: 3, xp: 700, count: 2 }, { id: "skeleton", name: "Skeleton", cr: 0.25, xp: 50, count: 6 }] },
    { id: "e-barrow-road", name: "Session 14: The Barrow Road", edition: "2014", levels, monsters: [{ id: "ghoul", name: "Ghoul", cr: 1, xp: 200, count: 4 }, { id: "ghast", name: "Ghast", cr: 2, xp: 450, count: 2 }] },
    { id: "e-hollow-king", name: "Finale: The Hollow King", edition: "2014", levels, monsters: [{ id: "custom-hollow-king", name: "The Hollow King", cr: 12, xp: 8400, count: 1, custom: customMonsters[0] }, { id: "wraith", name: "Wraith", cr: 5, xp: 1800, count: 2 }] },
  ].map((e) => ({ ...e, monsters: e.monsters.filter((m) => m.custom || mons.byId.has(m.id)) }));

  // The fight the table stopped in at the end of session 12: round 3 against the Hollow King's honour guard.
  const combat = newCombat();
  const prefix = (process.argv.find((x) => x.startsWith("--prefix=")) || "--prefix=seed").slice(9);   // the players' network ids, "<prefix>-<key>"
  const owners = Object.fromEntries(PARTY.map((p) => [p.name.split(" ")[0], `${prefix}-${p.player.toLowerCase()}`]));
  const inits = [14, 22, 17, 19, 12, 16, 9, 15];
  party.forEach((c, i) => { const pc = pcCombatant({ ...presenceSummary(c, ctx), owner: owners[c.name.split(" ")[0]] }); pc.init = inits[i]; combat.combatants.push(pc); });
  const foes = [["wight", "Hollow Guard 1", 18, 30], ["wight", "Hollow Guard 2", 11, 45], ["skeleton", "Skeleton 1", 13, 0], ["skeleton", "Skeleton 2", 13, 9], ["specter", "Specter", 20, 14]];
  for (const [mid, name, init, hp] of foes) { const m = monsterCombatant(mons.byId.get(mid), { name }); m.init = init; m.hp = hp; m.dead = hp <= 0; combat.combatants.push(m); }
  const sky = customCombatant({ name: "Hobb (ally)", hp: 18, ac: 12, initBonus: 1, kind: "npc" }); sky.init = 8; combat.combatants.push(sky);
  combat.combatants.find((c) => c.name === "Hollow Guard 1").conditions = ["Restrained"];
  combat.combatants.find((c) => c.name === "Specter").hidden = true;
  combat.started = true; combat.round = 3;
  const order = orderedCombatants(combat);
  combat.turn = order.findIndex((c) => c.name.startsWith("Thalric"));
  combat.log = [
    { t: Date.now() - 600000, text: "Round 1: Sera crits Hollow Guard 2 for 31." },
    { t: Date.now() - 420000, text: "Round 2: Elowen's web restrains Hollow Guard 1. Skeleton 1 falls to Vaelor." },
    { t: Date.now() - 120000, text: "Round 3: Lyra drops to 0 HP. Brannoch is next to reach her." },
  ];
  // the public view players see (what publishCombat in combatState.js uploads)
  const cur = order[combat.turn];
  const visible = order.filter((c) => !c.hidden);
  const publicCombat = {
    combatants: visible.map((c) => ({
      id: c.id, kind: c.kind, name: c.name, init: c.init, dead: !!c.dead || (c.kind === "monster" && c.hp <= 0),
      status: healthStatus(c), conditions: c.conditions || [], concentrating: !!c.concentration,
      ...(c.kind === "pc" ? { hp: c.hp, maxHp: c.maxHp, tempHp: c.tempHp, ac: c.ac, pcId: c.pcId, owner: c.owner || null, deathSaves: c.hp === 0 ? c.deathSaves : null } : {}),
      active: cur?.id === c.id,
    })),
    currentIndex: Math.max(0, visible.findIndex((c) => c.id === cur?.id)), round: combat.round, phase: "live",
  };
  const dmTools = { notes: [], npcs: [], quests: [], locations: [], sessions: [], encounters, combat, customMonsters, customSpells, customItems };
  console.log(JSON.stringify({ party, dmTools, publicCombat }));
}
