// Quick-reference tables: the ones that are always being looked up mid-session.

import { el, field } from "../ui.js";
import { pageTitle } from "./common.js";
import {
  XP_THRESHOLDS, profBonus, FULL_CASTER_SLOTS, PACT_MAGIC, DC_TABLE, COVER, TRAVEL_PACE, LIFESTYLE, SIZE_SPACE, ACTIONS_IN_COMBAT,
  CURRENCY, EXHAUSTION_2014, EXHAUSTION_2024, CR_LIST, CR_XP, crLabel, ENCOUNTER_THRESHOLDS_2014, XP_BUDGET_2024, ordinal,
} from "../engine/rules.js";
import { getSettings } from "../store.js";

function tables() {
  const ed = getSettings().edition;
  const lv = Array.from({ length: 20 }, (_, i) => i + 1);
  return [
    { group: "Checks", title: "Difficulty classes", head: ["Task", "DC"], rows: DC_TABLE },
    { group: "Checks", title: "Cover", head: ["Cover", "Effect"], rows: COVER },
    { group: "Checks", title: "Typical ability uses", head: ["Ability", "Examples"], rows: [
      ["Strength", "Athletics, lifting, breaking, forcing doors, grappling, shoving"],
      ["Dexterity", "Acrobatics, Sleight of Hand, Stealth, initiative, AC, ranged and finesse attacks"],
      ["Constitution", "Holding breath, forced marches, concentration saves, hit points"],
      ["Intelligence", "Arcana, History, Investigation, Nature, Religion, recalling lore"],
      ["Wisdom", "Animal Handling, Insight, Medicine, Perception, Survival"],
      ["Charisma", "Deception, Intimidation, Performance, Persuasion, many spellcasting classes"],
    ] },
    { group: "Combat", title: "Actions in combat", head: ["Action", "What it does"], rows: ACTIONS_IN_COMBAT },
    { group: "Combat", title: "Exhaustion", head: ["Level", "Effect"], rows: (ed === "2024" ? EXHAUSTION_2024 : EXHAUSTION_2014).map((t, i) => [String(i), t]) },
    { group: "Combat", title: "Creature size and space", head: ["Size", "Space"], rows: SIZE_SPACE },
    { group: "Combat", title: "Two-weapon, grapple & shove", head: ["Situation", "Rule"], rows: [
      ["Opportunity attack", "Reaction when a creature you can see leaves your reach."],
      ["Two-weapon fighting", "Bonus action attack with a different Light weapon; no ability modifier on damage unless negative."],
      ["Grapple", "Attack action: your Athletics against the target's Athletics or Acrobatics. Speed becomes 0."],
      ["Shove", "Attack action: your Athletics against Athletics or Acrobatics. Knock prone or push 5 ft."],
      ["Ranged in melee", "Disadvantage on ranged attack rolls with a hostile creature within 5 ft."],
      ["Long range", "Disadvantage on attacks beyond normal range, up to the maximum."],
      ["Unseen attacker/target", "Attacking an unseen target has disadvantage; attacking while unseen has advantage."],
    ] },
    { group: "Characters", title: "Experience & proficiency bonus", head: ["Level", "XP", "Proficiency"], rows: lv.map((l) => [String(l), XP_THRESHOLDS[l - 1].toLocaleString(), `+${profBonus(l)}`]) },
    { group: "Characters", title: "Full caster spell slots", head: ["Level", ...Array.from({ length: 9 }, (_, i) => ordinal(i + 1))], rows: lv.map((l) => [String(l), ...FULL_CASTER_SLOTS[l - 1].map((n) => (n ? String(n) : "—"))]) },
    { group: "Characters", title: "Warlock Pact Magic", head: ["Level", "Slots", "Slot level"], rows: lv.map((l) => [String(l), String(PACT_MAGIC[l - 1].count), ordinal(PACT_MAGIC[l - 1].level)]) },
    { group: "Characters", title: "Carrying capacity", head: ["Measure", "Rule"], rows: [
      ["Carrying capacity", "Strength score × 15 lb."], ["Push, drag or lift", "Strength score × 30 lb. (speed 5 ft.)"],
      ["Variant: encumbered", "Over Strength × 5 lb.: speed −10 ft."], ["Variant: heavily encumbered", "Over Strength × 10 lb.: speed −20 ft., disadvantage on checks, attacks and Str/Dex/Con saves"],
    ] },
    { group: "Travel & Living", title: "Travel pace", head: ["Pace", "Per hour", "Per day", "Effect"], rows: TRAVEL_PACE.map((t) => [t.name, t.perHour, t.perDay, t.effect]) },
    { group: "Travel & Living", title: "Lifestyle expenses", head: ["Lifestyle", "Cost"], rows: LIFESTYLE },
    { group: "Travel & Living", title: "Coins", head: ["Coin", "Worth in copper"], rows: CURRENCY.map((c) => [`${c.name} (${c.key})`, c.cp.toLocaleString()]) },
    { group: "Travel & Living", title: "Resting", head: ["Rest", "Rule"], rows: [
      ["Short rest", "1 hour. Spend Hit Dice to heal (roll + Con modifier each)."],
      ["Long rest", "8 hours (6 asleep). Regain all HP and half your Hit Dice. Only one per 24 hours; needs at least 1 HP."],
      ["Interrupted rest", "A long rest broken by 1 hour of strenuous activity must restart."],
    ] },
    { group: "Encounters", title: ed === "2024" ? "XP budget per character" : "XP thresholds by character level", head: ed === "2024" ? ["Level", "Low", "Moderate", "High"] : ["Level", "Easy", "Medium", "Hard", "Deadly"], rows: lv.map((l) => [String(l), ...(ed === "2024" ? XP_BUDGET_2024 : ENCOUNTER_THRESHOLDS_2014)[l - 1].map((n) => n.toLocaleString())]) },
    { group: "Encounters", title: "Challenge rating & XP", head: ["CR", "XP"], rows: CR_LIST.map((c) => [crLabel(c), (CR_XP[c] ?? 0).toLocaleString()]) },
    { group: "Encounters", title: "Encounter size multiplier (2014)", head: ["Monsters", "Multiplier"], rows: [["1", "×1"], ["2", "×1.5"], ["3–6", "×2"], ["7–10", "×2.5"], ["11–14", "×3"], ["15+", "×4"]] },
    { group: "Encounters", title: "Damage by level (DMG, rough)", head: ["Level", "Easy hit", "Typical hit", "Big hit"], rows: [["1–4", "5", "11", "18"], ["5–10", "11", "25", "55"], ["11–16", "30", "55", "100"], ["17–20", "55", "100", "200"]] },
  ];
}

export function renderTables(container) {
  container.replaceChildren();
  container.append(...pageTitle("Reference Tables", "DCs, cover, XP, spell slots, travel and more — the tables you keep flipping to."));
  const all = tables();
  const groups = [...new Set(all.map((t) => t.group))];
  const q = el("input", { type: "text", placeholder: "Filter tables…", autocomplete: "off", "aria-label": "Filter tables" });
  const groupSel = el("select", { "aria-label": "Group" }, [el("option", { value: "" }, "All groups"), ...groups.map((g) => el("option", { value: g }, g))]);
  const host = el("div", { class: "dnd-grid-auto wide" });
  const draw = () => {
    const needle = q.value.trim().toLowerCase();
    const shown = all.filter((t) => (!groupSel.value || t.group === groupSel.value) && (!needle || `${t.title} ${t.group} ${t.rows.flat().join(" ")}`.toLowerCase().includes(needle)));
    host.replaceChildren(...shown.map((t) => el("div", { class: "card" }, [
      el("div", { class: "dnd-section-head" }, [el("h4", {}, t.title), el("span", { class: "dnd-chip" }, t.group)]),
      el("div", { class: "dnd-table-scroll" }, el("table", { class: "data-table" }, [
        el("thead", {}, el("tr", {}, t.head.map((h) => el("th", {}, h)))),
        el("tbody", {}, t.rows.map((r) => el("tr", {}, r.map((c) => el("td", {}, String(c)))))),
      ])),
    ])));
    if (!shown.length) host.replaceChildren(el("p", { class: "view-sub" }, "No table matches."));
  };
  q.addEventListener("input", draw);
  groupSel.addEventListener("change", draw);
  draw();
  container.append(el("div", { class: "card", style: "margin-bottom:14px" }, el("div", { class: "dnd-grid-2" }, [field("Search", q), field("Group", groupSel)])), host);
}
