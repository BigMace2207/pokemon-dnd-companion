// D&D overview: your active character at a glance, the party, any live combat,
// quick links and a quick roller.

import { el, asyncView, btn, section, chip } from "../ui.js";
import { loadCtx } from "../data.js";
import { activeCharacter, listCharacters, createCharacter, setActive } from "../store.js";
import { derive, classLabel, applyDamage, applyHeal, longRest } from "../engine/character.js";
import { saveCharacter } from "../store.js";
import { expressionRoll } from "../rolls.js";
import { attribution, pageTitle } from "./common.js";
import { fetchPublicCombat } from "../combatState.js";
import { listTrainers, getTrainerTeam } from "../../../network.js";
import { loadSave } from "../../../storage.js";
import { hpBar } from "../components/hpBar.js";

const go = (view) => { location.hash = view; };

export function renderHome(container) {
  container.replaceChildren(...pageTitle("Dungeons & Dragons", "Your character, your party and the table — all in one place."));
  const holder = el("div");
  container.append(holder);
  asyncView(holder, async () => {
    const chars = listCharacters();
    const char = activeCharacter();
    const blocks = [];
    if (!char) {
      blocks.push(section("Welcome, adventurer", [
        el("p", {}, "You don’t have a character yet. Build one step by step with the rules built in, or import one from a file."),
        el("div", { class: "dnd-row" }, [
          btn("Create a character", () => go("dndCharacters"), "btn"),
          btn("Open the compendium", () => go("dndSpells"), "btn secondary"),
        ]),
      ]));
    } else {
      const ctx = await loadCtx(char.edition);
      blocks.push(characterCard(char, ctx, () => renderHome(container)));
    }
    blocks.push(combatBanner(), partyCard(), quickRoller(), linksCard(chars.length), attribution());
    return el("div", { class: "dnd-home-grid" }, blocks.filter(Boolean));
  });
}

function characterCard(char, ctx, refresh) {
  const d = derive(char, ctx);
  const act = (fn) => { fn(); saveCharacter(char); refresh(); };
  const sw = chars => chars;
  void sw;
  const switcher = listCharacters().length > 1
    ? el("select", { "aria-label": "Switch character" }, listCharacters().map((c) => el("option", { value: c.id, ...(c.id === char.id ? { selected: "" } : {}) }, c.name || "Unnamed")))
    : null;
  if (switcher) switcher.addEventListener("change", () => { setActive(switcher.value); refresh(); });
  const head = el("div", { class: "dnd-char-head" }, [
    char.portrait ? el("img", { class: "dnd-portrait", src: char.portrait, alt: "" }) : el("div", { class: "dnd-portrait placeholder" }, (char.name || "?").charAt(0).toUpperCase()),
    el("div", { class: "dnd-grow" }, [
      el("h3", { class: "dnd-char-name" }, char.name || "Unnamed character"),
      el("div", { class: "dnd-muted" }, `${char.race?.name || "No race"} · ${classLabel(char, ctx)} · Level ${d.level}`),
    ]),
    switcher,
  ].filter(Boolean));
  const stats = el("div", { class: "dnd-stat-row" }, [
    bigStat("AC", d.ac.value), bigStat("Speed", `${d.speed} ft`), bigStat("Initiative", d.initiative >= 0 ? `+${d.initiative}` : d.initiative),
    bigStat("Prof.", `+${d.pb}`), d.casting[0] ? bigStat("Spell DC", d.casting[0].dc) : null,
  ].filter(Boolean));
  const hp = hpBar(d.hp.current, d.hp.max, d.hp.temp);
  const dmgIn = el("input", { type: "number", min: "0", value: "5", "aria-label": "Amount", class: "dnd-num" });
  const row = el("div", { class: "dnd-row" }, [
    dmgIn,
    btn("Damage", () => act(() => applyDamage(char, d, Number(dmgIn.value) || 0)), "btn secondary small"),
    btn("Heal", () => act(() => applyHeal(char, d, Number(dmgIn.value) || 0)), "btn secondary small"),
    btn("Long rest", () => act(() => longRest(char, d)), "btn secondary small"),
    btn("Open sheet", () => go("dndSheet"), "btn small"),
  ]);
  const cond = char.conditions?.length ? el("div", { class: "dnd-chip-row" }, char.conditions.map((c) => chip(c, "warn"))) : null;
  return section("", [head, stats, hp, row, cond].filter(Boolean), { cls: "dnd-home-char" });
}

const bigStat = (label, value) => el("div", { class: "dnd-bigstat" }, [el("div", { class: "v" }, String(value)), el("div", { class: "l" }, label)]);

function combatBanner() {
  const holder = el("div");
  fetchPublicCombat().then((ft) => {
    if (!ft || ft.phase !== "live" || !ft.combatants.length) return;
    const cur = ft.combatants[ft.currentIndex];
    const b = el("div", { class: "card dnd-combat-banner" }, [
      el("div", {}, [el("strong", {}, `Combat in progress — Round ${ft.round}`), el("div", { class: "dnd-muted" }, cur ? `${cur.name}’s turn` : "")]),
      btn("Open combat", () => go("dndCombat"), "btn small"),
    ]);
    holder.append(b);
  });
  return holder;
}

function partyCard() {
  const holder = section("The party", [el("p", { class: "view-sub" }, "Looking for other adventurers…")]);
  (async () => {
    const me = loadSave().networkId;
    const trainers = await listTrainers("");
    const rows = [];
    for (const t of trainers) {
      const res = await getTrainerTeam(t.id);
      const s = res?.team?.dnd;
      if (!s) continue;
      rows.push(el("div", { class: "dnd-party-row" }, [
        el("div", {}, [el("strong", {}, s.name || t.name), el("span", { class: "dnd-muted dnd-small" }, ` ${s.classes || ""}${t.id === me ? " (you)" : ""}`)]),
        hpBar(s.hp, s.maxHp, s.tempHp, { compact: true }),
      ]));
    }
    holder.replaceChildren(el("div", { class: "dnd-section-head" }, [el("h4", {}, "The party"), btn("Full view", () => go("dndParty"), "btn secondary tiny")]),
      ...(rows.length ? rows : [el("p", { class: "view-sub" }, "No D&D characters are online right now.")]));
  })();
  return holder;
}

function quickRoller() {
  const dice = [["d4", 4], ["d6", 6], ["d8", 8], ["d10", 10], ["d12", 12], ["d20", 20], ["d100", 100]];
  return section("Quick roll", [
    el("div", { class: "dnd-row tight" }, dice.map(([label, n]) => btn(label, () => expressionRoll(`1d${n}`, { label, who: activeCharacter()?.name || "" }), "btn secondary small"))),
    el("p", { class: "view-sub dnd-small", style: "margin-top:8px" }, "Hold Shift for advantage or Ctrl for disadvantage on a d20 — or use the full Dice Roller."),
  ]);
}

function linksCard(count) {
  const links = [
    ["dndCharacters", `Characters (${count})`, "Create, import and switch characters."], ["dndSheet", "Character Sheet", "HP, spells, inventory, features."],
    ["dndDice", "Dice Roller", "Expressions, macros and history."], ["dndSpells", "Spells", "Every SRD spell."],
    ["dndBestiary", "Bestiary", "Monsters with rollable stat blocks."], ["dndRules", "Rules", "The SRD rules, searchable."],
    ["dndCombat", "Combat", "Initiative and turn order."], ["library", "Library", "Your own books, with an e-reader."],
  ];
  return section("Jump to", el("div", { class: "dnd-grid-auto" }, links.map(([id, t, s]) => {
    const b = el("button", { class: "dnd-link-tile", type: "button" }, [el("strong", {}, t), el("span", { class: "dnd-muted dnd-small" }, s)]);
    b.addEventListener("click", () => go(id));
    return b;
  })));
}

export { createCharacter };
