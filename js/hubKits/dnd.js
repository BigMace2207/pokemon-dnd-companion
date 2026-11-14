// The hub for a Dungeons & Dragons campaign. js/views/hub.js is the shared board (cursors, notes, drawing, pings, the
// map and minimap, zoom, sounds, the phone wheel and touch dragging); this file is everything D&D brings to it:
//
//  - the sky: a molten lava sea, heavily blurred, slowly churning, with embers rising (instead of the cosmic stars);
//  - your character at the bottom left (portrait, class and level, hit points, AC) with a vitals strip under it;
//    drag the character onto the board for a card of your sheet that follows it as it changes;
//  - the Inventory (the hub's bag): your character's items and coins, each draggable onto the board as a card;
//  - the Compendium pull-out (the hub's Dex): the Bestiary, Spells and Items, any row draggable onto the board;
//  - cards for monsters, spells and items, drawn from the SRD data (the board stores only the name);
//  - the DM's encounters: saved encounters (Encounter Builder), encounters rolled on the Whiteboard and any monster
//    from the Bestiary become buttons on the board. The DM's click starts the fight: the monsters and every online
//    character go into the combat tracker, initiative is rolled, the fight is published, and the tracker opens.
//    A player's click opens the Combat page to follow it.

import { el } from "../components.js";
import { activeCharacter, getSettings, getDm } from "../systems/dnd5e/store.js";
import { loadSet, peekCtx, loadCtx, spellLevelLabel } from "../systems/dnd5e/data.js";
import { derive, classLabel } from "../systems/dnd5e/engine/character.js";
import { pcCombatant, rollInitiative } from "../systems/dnd5e/engine/encounter.js";
import { resetCombat, mutateCombat, addMonsterToCombat, publishCombat } from "../systems/dnd5e/combatState.js";
import { listTrainers, getTrainerTeam } from "../network.js";
import { getPlan } from "../planner/store.js";
import { placeNodes, placeOnMaps, pinFields } from "../planner/places.js";
import { widgetsFor, widgetIcon, WEATHER_DEFAULT, placeHere } from "./widgets.js";
import { PAGE_TEMPLATES } from "./paper.js";
export { fillWidget, refreshWidgetData, defaultSize } from "./widgets.js";

const edition = () => activeCharacter()?.edition || getSettings().edition || "2014";
const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
const mod = (n) => { const m = Math.floor((Number(n) - 10) / 2); return m >= 0 ? `+${m}` : String(m); };
const crLabel = (cr) => (cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr ?? "?"));
const plainText = (d) => (Array.isArray(d) ? d : [d]).filter(Boolean).join("\n\n");

// ---- the top bar's buttons and the pages down the right (the same line-icon style as the Pokémon hub)
export const QUICK = [
  ["dndSheet", "Sheet", "M6 3h9l3 3v15H6zM14 3v4h4M9 11h6M9 15h6M9 19h4"],
  ["bag", "Inventory", "M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2M9 12h6"],
  ["dex", "Compendium", "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6"],
  ["widgets", "Widgets", "M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z"],
  ["dndParty", "Party", "M9 11a3 3 0 1 0 0-.01M3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-.01M15.5 15.5A5 5 0 0 1 21 20"],
  ["all", "All pages", "M4 6h16M4 12h16M4 18h16"],   // every page (the hub's menu of them), right after Party where it's easy to find
];
export const SWORDS = "M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2";
export const PAGES = [["dndCompendium", "Compendium"], ["mapeditor", "Map editor"], ["planner", "Whiteboard"], ["dndCombat", "Combat"], ["dndDmScreen", "DM screen"]];
export const DM_PAGES = new Set(["dndDmScreen"]);
export const PAGE_ICONS = {
  dndCompendium: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5C6.5 4 9.5 4 12 5.5v14C9.5 18 6.5 18 4 19.5zM20 5.5C17.5 4 14.5 4 12 5.5v14c2.5-1.5 5.5-1.5 8 0zM7 9h2M7 12h2M15 9h2M15 12h2"/></svg>',
  dndCombat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/></svg>',
  dndDmScreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5l6 2v13l-6-2zM9 7l6-2v13l-6 2zM15 5l6 2v13l-6-2z"/></svg>',
};
export const TITLE = "Dungeons & Dragons";
export const WELCOME = "Everyone in the campaign is here. Leave notes, draw, and watch for the DM's encounters: when one is started, the fight begins.";

// ---- the sky: a sea of lava, blurred, churning slowly, with embers drifting up -----------------------------------------
export { lavaSky } from "../lavaTheme.js";   // the same sea that sits behind every D&D page

// ---- your character ------------------------------------------------------------------------------------------------------
function summary() {
  const c = activeCharacter();
  if (!c) return null;
  const ctx = peekCtx(c.edition);
  if (!ctx) { loadCtx(c.edition).then(() => window.dispatchEvent(new CustomEvent("pokemon-dnd-save-changed"))).catch(() => {}); }
  let d = null;
  try { d = ctx ? derive(c, ctx) : null; } catch { d = null; }
  return {
    c, d, name: c.name || "Your character",
    label: ctx ? classLabel(c, ctx) : "", level: c.levelLog?.length || 1,
    hp: d ? d.hp.current : c.hp?.current ?? null, maxHp: d ? d.hp.max : null, temp: d ? d.hp.temp : 0,
    ac: d ? d.ac.value : null, speed: d ? d.speed : null, init: d ? d.initiative : null,
    conditions: c.conditions || [],
  };
}
const face = (s) => (s?.c?.portrait ? el("img", { class: "hub-me-face dnd-portrait", src: s.c.portrait, alt: "", draggable: "false" }) : el("span", { class: "hub-me-face hub-me-initial" }, (s?.name || "?")[0].toUpperCase()));

export function meSig() { const s = summary(); return JSON.stringify(s ? [s.name, s.label, s.level, s.hp, s.maxHp, s.ac, s.c.portrait?.length, s.conditions] : null); }
export const hasCharacter = () => !!activeCharacter();
/** The active character at a glance, for the widgets: { name, label, level, hp, maxHp, ac, conditions }, or null. */
export function mySummary() {
  const s = summary();
  return s ? { name: s.name, label: s.label, level: s.level, hp: s.hp, maxHp: s.maxHp, ac: s.ac, conditions: s.conditions } : null;
}
export const characterName = () => activeCharacter()?.name?.trim() || "";
export function drawMe(badge) {
  const s = summary();
  badge.title = "Your character: click for the sheet, drag onto the board for a card";
  badge.replaceChildren(face(s), el("span", { class: "hub-me-text" }, [
    el("strong", {}, s ? s.name : "No character yet"),
    el("span", {}, s ? [s.label || `Level ${s.level}`].join("") : "Click to make one"),
  ]));
}
// the strip under the character: hit points, armour class, initiative and conditions at a glance
export function drawVitals(strip, openFromHub) {
  const s = summary();
  strip.classList.add("dnd-vitals");
  strip.hidden = !s;   // no character yet: the badge above says so, and opens Characters
  if (!s) { strip.replaceChildren(); return; }
  const pct = s.maxHp ? Math.max(0, Math.min(100, ((s.hp ?? s.maxHp) / s.maxHp) * 100)) : 100;
  strip.replaceChildren(
    el("div", { class: "dnd-vital hp", title: "Hit points" }, [
      el("span", { class: "dnd-vital-label" }, "HP"),
      el("strong", {}, s.maxHp ? `${s.hp ?? s.maxHp}/${s.maxHp}${s.temp ? ` +${s.temp}` : ""}` : String(s.hp ?? "?")),
      el("span", { class: "dnd-hpbar" }, el("span", { class: pct > 50 ? "good" : pct > 20 ? "warn" : "bad", style: `width:${pct}%` })),
    ]),
    el("div", { class: "dnd-vital", title: "Armour class" }, [el("span", { class: "dnd-vital-label" }, "AC"), el("strong", {}, String(s.ac ?? "?"))]),
    el("div", { class: "dnd-vital", title: "Initiative" }, [el("span", { class: "dnd-vital-label" }, "Init"), el("strong", {}, s.init == null ? "?" : s.init >= 0 ? `+${s.init}` : String(s.init))]),
    ...(s.conditions.length ? [el("div", { class: "dnd-vital conds", title: "Conditions" }, s.conditions.slice(0, 3).map((x) => el("span", { class: "dnd-cond" }, x)))] : []),
  );
  strip.onclick = () => openFromHub("dndSheet");
}
// the character card on the board (the hub's "trainer" card): your sheet at a glance, kept up to date
export function characterCard() {
  const s = summary();
  if (!s) return null;
  const { c, d } = s;
  const scores = d ? ABILITIES.map((ab) => [ab, `${d.scores[ab].score} (${mod(d.scores[ab].score)})`]) : [];
  const fields = [
    ["Class", s.label || `Level ${s.level}`], ["Species", c.race?.name || ""], ["Background", c.background?.name || ""],
    ["Hit points", s.maxHp ? `${s.hp ?? s.maxHp} / ${s.maxHp}${s.temp ? ` (+${s.temp} temp)` : ""}` : ""], ["Armour class", s.ac == null ? "" : String(s.ac)],
    ["Speed", s.speed == null ? "" : `${s.speed} ft.`], ["Initiative", s.init == null ? "" : s.init >= 0 ? `+${s.init}` : String(s.init)],
    ["Passive Perception", d ? String(d.passive.perception) : ""], ["Spell save DC", d?.casting?.[0]?.dc ? String(d.casting[0].dc) : ""],
    ...scores, ["Conditions", s.conditions.join(", ")],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").map(([k, v]) => [k, String(v).slice(0, 200)]);
  return { type: "trainer", link: "trainer", name: s.name, sprite: "", fields, backstory: String(c.details?.backstory || "").slice(0, 1500), party: [] };
}

// ---- the Inventory (the hub's bag) -----------------------------------------------------------------------------------------
const KIND_GLYPH = { weapon: "⚔️", armor: "🛡️", potion: "🧪", scroll: "📜", ring: "💍", wand: "🪄", staff: "🪄", rod: "🪄", ammunition: "🏹", tool: "🔧", gear: "🎒", magic: "✨", coin: "🪙" };
export function itemGlyph(rec, it = {}) {
  const n = String(it.name || rec?.name || "").toLowerCase(), cat = String(rec?.category || (rec?.categories || []).join(" ")).toLowerCase();
  if (/potion|elixir|philter|oil of/.test(n) || /potion/.test(cat)) return KIND_GLYPH.potion;
  if (/scroll/.test(n) || /scroll/.test(cat)) return KIND_GLYPH.scroll;
  if (/ring/.test(n) || /ring/.test(cat)) return KIND_GLYPH.ring;
  if (/wand|staff|rod/.test(n) || /wand|staff|rod/.test(cat)) return KIND_GLYPH.wand;
  if (/arrow|bolt|bullet|ammunition/.test(n + cat)) return KIND_GLYPH.ammunition;
  const kind = it.kind || rec?.kind;
  if (kind === "weapon" || /weapon/.test(cat)) return KIND_GLYPH.weapon;
  if (kind === "armor" || /armor|shield/.test(cat)) return KIND_GLYPH.armor;
  if (/tool|kit|supplies|instrument/.test(cat + n)) return KIND_GLYPH.tool;
  if (it.magic || rec?.rarity) return KIND_GLYPH.magic;
  return KIND_GLYPH.gear;
}
// which bag sound an item makes when it's picked up (js/hubSound.js itemSound)
export function itemSoundKind(glyph) {
  return { [KIND_GLYPH.potion]: "medicine", [KIND_GLYPH.scroll]: "tm", [KIND_GLYPH.weapon]: "held", [KIND_GLYPH.armor]: "held", [KIND_GLYPH.ring]: "money", [KIND_GLYPH.wand]: "tm", [KIND_GLYPH.magic]: "held", [KIND_GLYPH.coin]: "money" }[glyph] || "key";
}
const BAG_SECTIONS = [["weapon", "Weapons"], ["armor", "Armour"], ["magic", "Magic items"], ["gear", "Gear"]];
const sectionOf = (it) => (it.magic ? "magic" : it.kind === "weapon" ? "weapon" : it.kind === "armor" ? "armor" : "gear");

export function drawBag(bagDrop, { CARD_MIME, itemSound, openFromHub }) {
  const c = activeCharacter();
  const head = el("div", { class: "hub-bag-head" }, [el("strong", {}, "Inventory"), el("span", { class: "hub-menu-note" }, c ? `${c.name}: drag anything onto the board` : "")]);
  if (!c) { bagDrop.replaceChildren(head, el("p", { class: "hub-menu-note" }, "Make a character first (Characters).")); return; }
  const coins = c.currency || {};
  const coinRow = el("div", { class: "dnd-coins", title: "Coins" }, ["pp", "gp", "ep", "sp", "cp"].filter((k) => Number(coins[k]) > 0).map((k) => el("span", { class: `dnd-coin ${k}` }, [el("strong", {}, String(coins[k])), ` ${k}`])));
  const inv = (c.inventory || []).filter((it) => it && it.name);
  const sections = BAG_SECTIONS.map(([key, label]) => [label, inv.filter((it) => sectionOf(it) === key)]).filter(([, list]) => list.length).map(([label, list]) => el("section", { class: "hub-bag-sec" }, [
    el("h4", {}, `${label} (${list.length})`),
    el("div", { class: "hub-bag-grid" }, list.sort((a, b) => a.name.localeCompare(b.name)).map((it) => {
      const glyph = itemGlyph(null, it);
      const cell = el("div", { class: `hub-bag-item dnd${it.equipped ? " equipped" : ""}`, draggable: "true", tabindex: "0", role: "listitem",
        title: `${it.name}${it.qty > 1 ? ` ×${it.qty}` : ""}${it.equipped ? " (equipped)" : ""}${it.attuned ? " (attuned)" : ""}\nDrag onto the board` }, [
        el("span", { class: "dnd-item-glyph", "aria-hidden": "true" }, glyph),
        el("span", { class: "hub-bag-name" }, it.name), el("span", { class: "hub-bag-count" }, it.qty > 1 ? `×${it.qty}` : it.equipped ? "Equipped" : ""),
      ]);
      cell.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer.setData(CARD_MIME, JSON.stringify({ type: "item", name: it.name }));
        e.dataTransfer.effectAllowed = "copy";
        itemSound(itemSoundKind(glyph), e.clientX);
      });
      cell.addEventListener("pointerdown", (e) => e.stopPropagation());
      return cell;
    })),
  ]));
  const sheet = el("button", { type: "button", class: "hub-pill" }, "Open the character sheet");
  sheet.addEventListener("click", () => openFromHub("dndSheet"));
  bagDrop.replaceChildren(head, ...(coinRow.childElementCount ? [coinRow] : []),
    ...(sections.length ? sections : [el("p", { class: "hub-menu-note" }, "No items yet. Add equipment on the character sheet.")]), el("div", { class: "dnd-bag-foot" }, sheet));
}

// ---- the rules data, loaded once per edition ---------------------------------------------------------------------------
const sets = new Map();
// a name lookup that ignores capitals (the loader keys some sets by lower-case name, and magic items by none)
class NameMap extends Map { get(k) { return super.get(String(k ?? "").toLowerCase()); } }
function data(name) {
  const key = `${edition()}/${name}`;
  if (!sets.has(key)) sets.set(key, loadSet(edition(), name).then((s) => {
    const list = s.list || s;
    return { list, byName: new NameMap(list.map((x) => [String(x.name).toLowerCase(), x])), byId: s.byId || new Map(list.map((x) => [x.id, x])) };
  }).catch(() => ({ list: [], byName: new NameMap(), byId: new Map() })));
  return sets.get(key);
}
async function findItem(name) {
  const [eq, magic] = await Promise.all([data("equipment"), data("magicItems")]);
  return magic.byName.get(name) || eq.byName.get(name) || null;
}

// ---- cards on the board: monsters, spells and items ---------------------------------------------------------------------
const MONSTER_GLYPH = { aberration: "👁️", beast: "🐺", celestial: "😇", construct: "🗿", dragon: "🐉", elemental: "🌪️", fey: "🧚", fiend: "😈", giant: "🗻", humanoid: "🧑", monstrosity: "🦂", ooze: "🫧", plant: "🌿", undead: "💀", swarm: "🐀" };
const SCHOOL_COLOUR = { Abjuration: "#5aa8f0", Conjuration: "#e0c05a", Divination: "#c9d6e8", Enchantment: "#f07ab8", Evocation: "#ff6a3d", Illusion: "#9b7be0", Necromancy: "#7bc96f", Transmutation: "#e8a33a" };
const RARITY_COLOUR = { common: "#c9c9c9", uncommon: "#5fd17a", rare: "#5aa8f0", "very rare": "#b07bf0", legendary: "#ffa13d", artifact: "#e05a5a" };
export const monsterGlyph = (m) => MONSTER_GLYPH[String(m?.type || "").toLowerCase().split(" ")[0]] || "👹";
const chip = (k, v) => el("span", { class: "dnd-chip" }, [el("span", {}, k), el("strong", {}, v)]);

// A player's character on the board (the hub's "trainer" card, kept in step with their sheet): who they are, their
// hit points as a bar, AC / speed / initiative / passive Perception as chips, the six ability scores like a monster's,
// and any conditions. Open, it also shows the backstory.
export function fillCharacterCard(node, it) {
  const f = Object.fromEntries((it.fields || []).map(([k, v]) => [k, String(v)]));
  const sig = JSON.stringify([it.name, it.fields, it.backstory, it.open]);
  node.className = `hub-card kind-trainer dnd-card dnd-pc${it.open ? " open" : ""}`;
  if (node.dataset.sig === sig) return;
  node.dataset.sig = sig;
  node.style.setProperty("--tc", "#e9c27a");
  const sub = [f.Class, f.Species].filter(Boolean).join(" · ") || "Adventurer";
  const hp = /^(\d+)\s*\/\s*(\d+)/.exec(f["Hit points"] || "");
  const pct = hp ? Math.max(0, Math.min(100, (Number(hp[1]) / Math.max(1, Number(hp[2]))) * 100)) : null;
  const conds = (f.Conditions || "").split(",").map((x) => x.trim()).filter(Boolean);
  const score = (ab) => /^(\d+)\s*\(([-+]\d+)\)/.exec(f[ab] || "");
  node.replaceChildren(...[
    el("div", { class: "hub-card-head" }, [
      el("span", { class: "dnd-pc-face", "aria-hidden": "true" }, (it.name || "?").trim()[0]?.toUpperCase() || "?"),
      el("div", { class: "hub-card-title" }, [el("strong", {}, it.name), el("span", {}, sub)]),
    ]),
    f["Hit points"] ? el("div", { class: "dnd-pc-hp", title: "Hit points" }, [
      el("span", { class: "dnd-pc-hp-row" }, [el("small", {}, "HP"), el("strong", {}, f["Hit points"])]),
      pct === null ? null : el("span", { class: "dnd-hpbar" }, el("span", { class: pct > 50 ? "good" : pct > 20 ? "warn" : "bad", style: `width:${pct}%` })),
    ].filter(Boolean)) : null,
    el("div", { class: "dnd-chips" }, [
      f["Armour class"] && chip("AC", f["Armour class"]), f.Speed && chip("Speed", f.Speed), f.Initiative && chip("Init", f.Initiative),
      f["Passive Perception"] && chip("Perception", f["Passive Perception"]), f["Spell save DC"] && chip("Spell DC", f["Spell save DC"]),
    ].filter(Boolean)),
    ABILITIES.some((ab) => f[ab]) ? el("div", { class: "dnd-abilities" }, ABILITIES.map((ab) => { const m = score(ab); return el("span", {}, [el("small", {}, ab), el("strong", {}, m ? m[1] : "?"), el("small", {}, m ? m[2] : "")]); })) : null,
    conds.length ? el("div", { class: "dnd-pc-conds" }, conds.map((c) => el("span", { class: "dnd-cond" }, c))) : null,
    f.Background ? el("p", { class: "hub-card-more" }, `Background: ${f.Background}`) : null,
    it.backstory ? (it.open ? el("div", { class: "dnd-card-body" }, [el("strong", {}, "Backstory"), el("p", {}, it.backstory)]) : el("p", { class: "hub-card-more" }, "Open for the backstory")) : null,
  ].filter(Boolean));
}

export function fillCard(node, it) {
  const sig = JSON.stringify([it.type, it.name, it.open, edition()]);
  node.className = `hub-card kind-${it.type} dnd-card${it.open ? " open" : ""}`;
  if (node.dataset.sig === sig) return;
  node.dataset.sig = sig;
  node.replaceChildren(el("div", { class: "hub-card-head" }, [el("span", { class: "dnd-card-glyph" }, "…"), el("div", { class: "hub-card-title" }, [el("strong", {}, it.name), el("span", {}, "Loading…")])]));
  const fill = (head, sub, body, colour) => {
    if (node.dataset.sig !== sig) return;   // changed meanwhile
    node.style.setProperty("--tc", colour);
    node.replaceChildren(el("div", { class: "hub-card-head" }, [el("span", { class: "dnd-card-glyph", "aria-hidden": "true" }, head), el("div", { class: "hub-card-title" }, [el("strong", {}, it.name), el("span", {}, sub)])]), ...body.filter(Boolean));
  };
  if (it.type === "monster") data("monsters").then(({ byName }) => {
    const m = byName.get(it.name);
    if (!m) { fill("👹", "Not in the Bestiary", [], "#e05a5a"); return; }
    const ac = Array.isArray(m.ac) ? m.ac[0]?.value : m.ac;
    const speed = Object.entries(m.speed || {}).map(([k, v]) => (k === "walk" ? v : `${k} ${v}`)).join(", ");
    fill(monsterGlyph(m), `${m.size} ${m.type} · CR ${crLabel(m.cr)}`, [
      el("div", { class: "dnd-chips" }, [chip("AC", String(ac ?? "?")), chip("HP", `${m.hp ?? "?"}${m.hitDice ? ` (${m.hitDice})` : ""}`), chip("Speed", speed || "?")]),
      el("div", { class: "dnd-abilities" }, ABILITIES.map((ab) => el("span", {}, [el("small", {}, ab), el("strong", {}, String(m.abilities?.[ab] ?? "?")), el("small", {}, mod(m.abilities?.[ab] ?? 10))]))),
      it.open ? el("div", { class: "dnd-card-body" }, [
        ...(m.traits || []).slice(0, 4).map((t) => el("p", {}, [el("strong", {}, `${t.name}. `), String(t.desc || "").slice(0, 320)])),
        (m.actions || []).length ? el("h5", {}, "Actions") : null,
        ...(m.actions || []).slice(0, 5).map((a) => el("p", {}, [el("strong", {}, `${a.name}. `), String(a.desc || "").slice(0, 320)])),
      ].filter(Boolean)) : el("p", { class: "hub-card-more" }, "Open for traits and actions"),
    ], "#e05a3a");
  });
  else if (it.type === "spell") data("spells").then(({ byName }) => {
    const sp = byName.get(it.name);
    if (!sp) { fill("✨", "Not in the spell list", [], "#9b7be0"); return; }
    fill("✨", `${spellLevelLabel(sp.level)}${sp.level ? ` ${sp.school}` : ` · ${sp.school}`}${sp.ritual ? " (ritual)" : ""}`, [
      el("div", { class: "dnd-chips" }, [chip("Cast", sp.castingTime), chip("Range", sp.range), chip("Lasts", `${sp.concentration ? "Conc., " : ""}${sp.duration}`), chip("Parts", (sp.components || []).join(", "))]),
      it.open ? el("div", { class: "dnd-card-body" }, String(plainText(sp.desc)).split("\n\n").slice(0, 5).map((p) => el("p", {}, p.slice(0, 600))))
        : el("p", { class: "hub-card-more" }, (sp.classes || []).slice(0, 5).join(", ")),
    ], SCHOOL_COLOUR[sp.school] || "#9b7be0");
  });
  else findItem(it.name).then((rec) => {
    const rarity = String(rec?.rarity || "").toLowerCase();
    const sub = rec ? [rec.category || (rec.categories || [])[0], rec.rarity].filter(Boolean).join(" · ") : "An item";
    const cost = rec?.cost ? `${rec.cost.q} ${rec.cost.u}` : "";
    const desc = rec?.desc ? plainText(rec.desc) : "";
    fill(itemGlyph(rec, it), sub, [
      (cost || rec?.weight) ? el("div", { class: "dnd-chips" }, [cost ? chip("Cost", cost) : null, rec?.weight ? chip("Weight", `${rec.weight} lb`) : null].filter(Boolean)) : null,
      it.open && desc ? el("div", { class: "dnd-card-body" }, desc.split("\n\n").slice(0, 4).map((p) => el("p", {}, p.slice(0, 600)))) : desc ? el("p", { class: "hub-card-more" }, "Open for the description") : null,
    ], RARITY_COLOUR[rarity] || "#c98a4a");
  });
}

// ---- the Compendium pull-out (the hub's Dex): Bestiary, Spells, Items ---------------------------------------------------
const LIMIT = 120;
export function compendiumPanel(kind, { CARD_MIME, onPlace, onClose, onSwitch, openFull }) {
  const tabs = [["monster", "Bestiary"], ["spell", "Spells"], ["item", "Items"]];
  const search = el("input", { type: "search", class: "hub-input", placeholder: kind === "monster" ? "Search monsters…" : kind === "spell" ? "Search spells…" : "Search items…", "aria-label": "Search", autocomplete: "off" });
  const filter = el("select", { class: "hub-select", "aria-label": "Filter" });
  const list = el("div", { class: "hub-dex-list", role: "list" });
  const count = el("span", { class: "hub-dex-count" });
  const close = el("button", { type: "button", class: "hub-round small", "aria-label": "Close", title: "Close" }, "×");
  close.addEventListener("click", onClose);
  const full = el("button", { type: "button", class: "hub-round small", "aria-label": "Open the full page", title: "Open the full page" }, "↗");
  full.addEventListener("click", () => openFull({ monster: "dndBestiary", spell: "dndSpells", item: "dndItems" }[kind]));
  const switcher = el("div", { class: "hub-dex-switch", role: "tablist" }, tabs.map(([k, label]) => {
    const b = el("button", { type: "button", role: "tab", class: k === kind ? "on" : "", "aria-selected": String(k === kind) }, label);
    if (k !== kind) b.addEventListener("click", () => onSwitch(k));
    return b;
  }));
  let all = [];
  const meta = (x) => (kind === "monster" ? `${x.size} ${x.type} · CR ${crLabel(x.cr)}` : kind === "spell" ? `${spellLevelLabel(x.level)} · ${x.school}` : [x.category || (x.categories || [])[0], x.rarity].filter(Boolean).join(" · "));
  const glyph = (x) => (kind === "monster" ? monsterGlyph(x) : kind === "spell" ? "✨" : itemGlyph(x));
  function draw() {
    const q = search.value.trim().toLowerCase(), f = filter.value;
    const hits = all.filter((x) => (!q || x.name.toLowerCase().includes(q)) && (!f || (kind === "monster" ? String(x.type).toLowerCase().startsWith(f) : kind === "spell" ? String(x.level) === f : (x.rarity ? "magic" : "gear") === f)));
    count.textContent = hits.length > LIMIT ? `Showing ${LIMIT} of ${hits.length}: search to narrow it` : `${hits.length} ${hits.length === 1 ? "match" : "matches"}`;
    list.replaceChildren(...hits.slice(0, LIMIT).map((x) => {
      const card = { type: kind, name: x.name };
      const add = el("button", { type: "button", class: "hub-dex-add", "aria-label": `Put ${x.name} on the board`, title: "Put it on the board" }, "+");
      add.addEventListener("click", (e) => { e.stopPropagation(); onPlace(card); });
      const row = el("div", { class: "hub-dex-row dnd", role: "listitem", draggable: "true", tabindex: "0", title: "Drag onto the board" }, [el("div", { class: "hub-dex-head" }, [
        el("span", { class: "dnd-item-glyph", "aria-hidden": "true" }, glyph(x)), el("span", { class: "hub-dex-name" }, [el("strong", {}, x.name), el("span", {}, meta(x))]), add,
      ])]);
      row.addEventListener("dragstart", (e) => { e.dataTransfer.setData(CARD_MIME, JSON.stringify(card)); e.dataTransfer.effectAllowed = "copy"; row.classList.add("lifted"); });
      row.addEventListener("dragend", () => row.classList.remove("lifted"));
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") onPlace(card); });
      return row;
    }));
  }
  (async () => {
    list.replaceChildren(el("p", { class: "hub-menu-note" }, "Loading…"));
    if (kind === "monster") {
      all = (await data("monsters")).list;
      const types = [...new Set(all.map((m) => String(m.type).toLowerCase().split(" ")[0]))].sort();
      filter.replaceChildren(el("option", { value: "" }, "All types"), ...types.map((t) => el("option", { value: t }, t)));
    } else if (kind === "spell") {
      all = (await data("spells")).list;
      filter.replaceChildren(el("option", { value: "" }, "All levels"), ...Array.from({ length: 10 }, (_, i) => el("option", { value: String(i) }, spellLevelLabel(i))));
    } else {
      const [eq, magic] = await Promise.all([data("equipment"), data("magicItems")]);
      all = [...eq.list, ...magic.list.filter((m) => !m.variant)];
      filter.replaceChildren(el("option", { value: "" }, "All items"), el("option", { value: "gear" }, "Equipment"), el("option", { value: "magic" }, "Magic items"));
    }
    draw();
  })();
  search.addEventListener("input", draw);
  filter.addEventListener("change", draw);
  const panel = el("aside", { class: "hub-dex dnd-compendium", "aria-label": "Compendium" }, [
    el("div", { class: "hub-dex-top" }, [switcher, el("span", { class: "hub-grow" }), full, close]),
    el("div", { class: "hub-dex-filters" }, [search, filter]),
    el("p", { class: "hub-dex-hint" }, ["Drag onto the board, or press +. ", count]),
    list,
  ]);
  panel.focusSearch = () => search.focus();
  return panel;
}

// ---- the DM's encounters: what can become a button on the board ------------------------------------------------------------
const ENC_LINE = /^(\d+)\s*[×x]\s*(.+?)\s*\(CR/;
function planEncounters() {
  const out = [];
  for (const b of getPlan().boards || []) for (const n of b.nodes || []) {
    if (n.type !== "gen" || n.gen !== "encounter") continue;
    const rows = (n.lines || []).map((l) => l.match(ENC_LINE)).filter(Boolean).map((m) => ({ name: m[2], count: Number(m[1]) || 1 }));
    if (rows.length) out.push({ id: `${b.id}:${n.id}`, title: n.title || "Encounter", rows });
  }
  return out;
}
const toMons = (rows, byName) => rows.flatMap((r) => Array.from({ length: Math.min(6, r.count || 1) }, () => ({ name: r.name, level: Math.max(1, Math.round(byName?.get(r.name)?.cr || 1)) }))).slice(0, 6);

export async function drawerGroups({ entry, group }) {
  const { list, byName } = await data("monsters");
  const saved = getDm().encounters || [];
  const fromPlan = planEncounters();
  const q = el("input", { type: "search", class: "hub-input", placeholder: "Find a monster…", "aria-label": "Find a monster", autocomplete: "off" });
  const results = el("div", { class: "hub-drawer-results" });
  const drawResults = () => {
    const needle = q.value.trim().toLowerCase();
    const hits = (needle ? list.filter((m) => m.name.toLowerCase().includes(needle)) : list.filter((m) => m.cr >= 1 && m.cr <= 5)).slice(0, 24);
    results.replaceChildren(...hits.map((m) => entry(m.name, `${m.size} ${m.type} · CR ${crLabel(m.cr)}`, "wild", { kind: "monster", id: m.id, title: m.name, mons: [{ name: m.name, level: Math.max(1, Math.round(m.cr || 1)) }] })));
  };
  q.addEventListener("input", drawResults);
  q.addEventListener("pointerdown", (e) => e.stopPropagation());
  drawResults();
  return [
    group("Saved encounters", saved.map((e) => {
      const n = (e.monsters || []).reduce((t, r) => t + (r.count || 1), 0);
      return entry(e.name, `${n} monster${n === 1 ? "" : "s"} · ${(e.monsters || []).map((r) => r.name).slice(0, 3).join(", ")}`, "npc", { kind: "encounter", id: e.id, title: e.name, mons: toMons(e.monsters || [], byName) });
    }), "Build and save encounters in the Encounter Builder."),
    group("From your Whiteboard", fromPlan.map((p) => entry(p.title.slice(0, 48), p.rows.map((r) => `${r.count}× ${r.name}`).join(", "), "npc", { kind: "plan", id: p.id, title: p.title, mons: toMons(p.rows, byName) })), "Roll a Random encounter on the Whiteboard and it shows up here."),
    el("section", { class: "hub-drawer-group" }, [el("h3", {}, "From the Bestiary"), q, results]),
  ];
}

// ---- starting a fight from a button (the DM) ---------------------------------------------------------------------------
// The monsters go into the combat tracker (numbered when there are several), every online character joins, initiative is
// rolled for everyone, and the fight is published to the table. Returns how many combatants there are.
export async function startFight(it, { meId, dmToken }) {
  const { byName, byId } = await data("monsters");
  const src = it.source || {};
  let rows = [];
  if (src.kind === "encounter") rows = ((getDm().encounters || []).find((e) => e.id === src.id)?.monsters || []).map((r) => ({ m: (byId?.get?.(r.id)) || byName.get(r.name) || r.custom, count: r.count || 1 }));
  else if (src.kind === "plan") rows = (planEncounters().find((p) => p.id === src.id)?.rows || []).map((r) => ({ m: byName.get(r.name), count: r.count }));
  else if (src.kind === "monster") rows = [{ m: byId?.get?.(src.id) || byName.get(src.mons?.[0]?.name), count: 1 }];
  if (!rows.some((r) => r.m)) {   // the source has gone: fall back to the names the button carries
    const counts = new Map();
    for (const m of src.mons || []) counts.set(m.name, (counts.get(m.name) || 0) + 1);
    rows = [...counts].map(([name, count]) => ({ m: byName.get(name), count }));
  }
  rows = rows.filter((r) => r.m);
  if (!rows.length) return 0;
  resetCombat();
  for (const r of rows) addMonsterToCombat(r.m, r.count, { hpMode: "average" });
  const pcs = [];
  for (const t of await listTrainers(meId)) {
    try { const s = (await getTrainerTeam(t.id))?.team?.dnd; if (s) pcs.push({ t, s }); } catch { /* offline */ }
  }
  mutateCombat((c) => {
    for (const { t, s } of pcs) {
      if (c.combatants.some((x) => x.pcId === s.id && x.owner === t.id)) continue;
      const pc = pcCombatant({ ...s, owner: t.id });
      pc.dexMod = s.initiative ?? 0;
      c.combatants.push(pc);
    }
    for (const x of c.combatants) if (x.init == null) rollInitiative(x);
    c.started = true; c.round = 1; c.turn = 0; c.live = true;
    (c.log ||= []).push({ t: Date.now(), text: `${it.label}: the fight begins.` });
  });
  await publishCombat(dmToken);
  return rows.reduce((t, r) => t + r.count, 0) + pcs.length;
}

// ---- who's here: each player's character at a glance ---------------------------------------------------------------------
export function personInfo(team) {
  const s = team?.dnd;
  if (!s) return el("span", { class: "hub-menu-note" }, "No character yet");
  return el("span", { class: "hub-menu-note" }, [s.name, s.classes ? ` · ${s.classes}` : "", s.maxHp ? ` · ${s.hp}/${s.maxHp} HP` : "", s.ac ? ` · AC ${s.ac}` : ""].join(""));
}


// ---- the Widgets pull-out: smart widgets for everyone, and (for the DM) the places on their map -------------------------------
export function widgetsPanel(kind, { CARD_MIME, onPlace, onClose, onSwitch, dm, saved = [], onDeleteSaved, system = "dnd", templates = PAGE_TEMPLATES }) {
  const tabs = [["widget", "Widgets"], ["page", "Pages"], ...(dm ? [["place", "Places"]] : [])];
  const close = el("button", { type: "button", class: "hub-round small", "aria-label": "Close", title: "Close" }, "×");
  close.addEventListener("click", onClose);
  const switcher = el("div", { class: "hub-dex-switch", role: "tablist" }, tabs.map(([k, label]) => {
    const b = el("button", { type: "button", role: "tab", class: k === kind ? "on" : "", "aria-selected": String(k === kind) }, label);
    if (k !== kind) b.addEventListener("click", () => onSwitch(k));
    return b;
  }));
  const row = (glyphHtml, title, sub, card) => {
    const add = el("button", { type: "button", class: "hub-dex-add", "aria-label": `Put ${title} on the hub`, title: "Put it on the hub" }, "+");
    add.addEventListener("click", (e) => { e.stopPropagation(); onPlace(card); });
    const g = el("span", { class: "dnd-item-glyph", "aria-hidden": "true" });
    g.innerHTML = glyphHtml;
    const r = el("div", { class: "hub-dex-row dnd widget-row", role: "listitem", draggable: "true", tabindex: "0", title: "Drag onto the hub" }, [el("div", { class: "hub-dex-head" }, [g, el("span", { class: "hub-dex-name" }, [el("strong", {}, title), el("span", {}, sub)]), add])]);
    r.addEventListener("dragstart", (e) => { e.dataTransfer.setData(CARD_MIME, JSON.stringify(card)); e.dataTransfer.effectAllowed = "copy"; r.classList.add("lifted"); });
    r.addEventListener("dragend", () => r.classList.remove("lifted"));
    r.addEventListener("keydown", (e) => { if (e.key === "Enter") onPlace(card); });
    return r;
  };
  let rows, hint;
  if (kind === "widget") {
    hint = "Drag a widget onto the hub, or press +. They keep themselves up to date.";
    rows = widgetsFor(system, dm).map((w) => row(widgetIcon(w.id), w.title, `${w.blurb}${w.dm ? " (DM)" : ""}`, { type: "widget", widget: w.id, ...(w.id === "weather" ? { data: WEATHER_DEFAULT } : {}) }));
  } else if (kind === "page") {
    hint = "Paper to write on and pin things to. Drag a page onto the hub. Everything on it moves with it.";
    const paper = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4"/></svg>`;
    rows = Object.entries(templates).map(([k, t]) => row(paper, t.title, t.blurb, { type: "page", pageKind: k, title: t.title }));
    if (saved.length) {
      rows.push(el("h4", { class: "hub-dex-section" }, "Saved pages"));
      for (const s of saved) {
        const r = row(paper, s.title, `${s.count} thing${s.count === 1 ? "" : "s"} on it`, { type: "page", saved: s.id, title: s.title });
        const del = el("button", { type: "button", class: "hub-dex-del", "aria-label": `Delete ${s.title}`, title: "Delete this saved page" }, "×");
        del.addEventListener("click", (e) => { e.stopPropagation(); onDeleteSaved?.(s.id); });
        r.querySelector(".hub-dex-head").append(del);
        rows.push(r);
      }
    } else rows.push(el("p", { class: "hub-menu-note" }, "Drag a page by its header and a Save page box appears: drop it there to keep it here, with everything on it."));
  } else {
    const plan = getPlan(), shared = plan.maps.find((m) => m.shared);
    const places = placeNodes(plan);
    hint = "Drag a place onto the hub. Then drag a player onto it to move them there on the map.";
    rows = places.length ? places.map(({ node }) => {
      const f = pinFields(node);
      const hit = placeOnMaps(plan, node.id, shared?.id);
      const pin = hit && hit.map.id === shared?.id ? hit.pin : null;
      return row(`<span style="font-size:18px">${f.icon}</span>`, f.label, `${f.kind || "Place"} · ${pin ? "on the hub's map" : "not on the hub's map yet"}`, { type: "place", name: f.label, kind: f.kind, known: f.known, note: f.note, icon: f.icon, color: f.color, pin: pin?.id || "" });
    }) : [el("p", { class: "hub-menu-note" }, "No places yet. Add a Place card on the Whiteboard, then put it on a map.")];
  }
  const panel = el("aside", { class: "hub-dex dnd-compendium dnd-widgets", "aria-label": "Widgets" }, [
    el("div", { class: "hub-dex-top" }, [switcher, el("span", { class: "hub-grow" }), close]),
    el("p", { class: "hub-dex-hint" }, hint),
    el("div", { class: "hub-dex-list", role: "list" }, rows),
  ]);
  panel.focusSearch = () => {};
  return panel;
}

// ---- a place on the hub: somewhere the DM put on the board. Drop a player on it and they travel there on the map.
export function fillPlace(node, it, ctx) {
  node.className = `hub-card kind-place dnd-card${it.open ? " open" : ""}`;
  node.style.setProperty("--tc", it.color || "#c8402f");
  const sig = JSON.stringify([it.name, it.kind, it.known, it.note, it.open, it.pin, it.icon, it.color, ctx.dm()]);
  const paintHere = async () => {
    const span = node.querySelector(".hub-place-here"), cur = node.__item;
    if (!span || !cur) return;
    const names = await placeHere(ctx, cur).catch(() => []);
    span.textContent = names.length ? `Here now: ${names.join(", ")}` : "";
  };
  if (node.dataset.sig !== sig) {
    node.dataset.sig = sig;
    const paras = String(it.note || "").split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
    const hint = it.pin ? (ctx.dm() ? "Drop a player here to move them to this place." : "Drag your character here to travel.") : ctx.dm() ? "Its label isn't on the hub's map: show the map on the hub to let players travel here." : "";
    node.replaceChildren(...[
      el("div", { class: "hub-card-head" }, [el("span", { class: "dnd-card-glyph", "aria-hidden": "true" }, it.icon || "📍"), el("div", { class: "hub-card-title" }, [el("strong", {}, it.name), el("span", {}, it.kind || "Place")])]),
      it.known ? el("p", { class: "hub-place-known" }, it.known) : null,
      it.open ? el("div", { class: "dnd-card-body" }, paras.length ? paras.map((t) => el("p", {}, t)) : [el("p", {}, "Nobody has written anything about this place yet.")]) : (paras.length ? el("p", { class: "hub-card-more" }, "Press for the description") : null),
      el("p", { class: "hub-place-here" }),
      hint ? el("p", { class: "hub-place-hint" }, hint) : null,
    ].filter(Boolean));
  }
  if (!node.__hereTimer) node.__hereTimer = setInterval(() => { if (!node.isConnected) { clearInterval(node.__hereTimer); node.__hereTimer = 0; return; } if (!document.hidden) paintHere(); }, 4000);
  paintHere();
}
