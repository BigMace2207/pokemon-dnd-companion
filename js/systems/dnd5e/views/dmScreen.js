// The DM screen: one page with the things a Dungeon Master reaches for mid-session --
// the party's key numbers, the active fight, quick rolls, conditions, the common DCs and
// a scratch pad. Gated by the campaign's DM password like the other DM pages.

import { el, btn, chip, section, asyncView, toast } from "../ui.js";
import { pageTitle } from "./common.js";
import { withDm } from "../dmAccess.js";
import { loadSet } from "../data.js";
import { getSettings, getDm, updateDm } from "../store.js";
import { getCombat } from "../combatState.js";
import { orderedCombatants, currentCombatant } from "../engine/encounter.js";
import { DC_TABLE, COVER, ACTIONS_IN_COMBAT, TRAVEL_PACE } from "../engine/rules.js";
import { expressionRoll } from "../rolls.js";
import { renderDesc } from "../../../markdown.js";
import { genName, genNpc, genRumor } from "../engine/generators.js";
import { listTrainers, getTrainerTeam } from "../../../network.js";

export function renderDmScreen(container) {
  container.replaceChildren(...pageTitle("DM Screen", "Everything you need at the table, on one page."));
  const host = el("div");
  container.append(host);
  withDm(host, () => build(host));
}

function build(host) {
  host.replaceChildren();
  const edition = getSettings().edition;
  const grid = el("div", { class: "dnd-screen" });
  host.append(grid);
  grid.append(partyCard(), fightCard(), rollCard(), tablesCard(), padCard(), sparkCard());
  const condHost = el("div");
  grid.append(condHost);
  asyncView(condHost, async () => {
    const conds = (await loadSet(edition, "conditions")).list || [];
    return [section("Conditions", conds.map((c) => el("details", { class: "dnd-fold" }, [el("summary", {}, c.name), renderDesc(c.desc || [])])))];
  });
}

function partyCard() {
  const body = el("div", {}, el("p", { class: "view-sub" }, "Looking for adventurers…"));
  const card = section("Party at a glance", body, { cls: "wide" });
  async function load() {
    try {
      const rows = [];
      for (const t of await listTrainers("")) { const s = (await getTrainerTeam(t.id))?.team?.dnd; if (s) rows.push(s); }
      body.replaceChildren(rows.length ? el("div", { class: "dnd-table-scroll" }, el("table", { class: "data-table" }, [
        el("thead", {}, el("tr", {}, ["Character", "Class", "Lv", "HP", "AC", "PP", "Init", "DC", "Speed", "Status"].map((h) => el("th", {}, h)))),
        el("tbody", {}, rows.map((s) => el("tr", {}, [s.name, s.classes, s.level, `${s.hp}/${s.maxHp}${s.tempHp ? ` +${s.tempHp}` : ""}`, s.ac, s.passivePerception, `${s.initiative >= 0 ? "+" : ""}${s.initiative}`, s.dc ?? "—", s.speed, [...(s.conditions || []), s.concentration ? `Conc: ${s.concentration}` : ""].filter(Boolean).join(", ") || "—"].map((c, i) => el("td", { class: i === 0 ? "dnd-strong" : "" }, String(c)))))),
      ])) : el("p", { class: "view-sub" }, "No D&D characters online."));
    } catch { body.replaceChildren(el("p", { class: "view-sub" }, "Couldn't reach the server.")); }
  }
  load();
  const timer = setInterval(() => { if (!document.body.contains(body)) { clearInterval(timer); return; } if (!document.hidden) load(); }, 10000);
  return card;
}

function fightCard() {
  const c = getCombat();
  const order = orderedCombatants(c);
  const cur = currentCombatant(c);
  return section("Active fight", order.length ? [
    el("p", {}, [el("strong", {}, `Round ${c.round}`), c.started && cur ? ` · ${cur.name}’s turn` : " · not started"]),
    el("ol", { class: "dnd-mini-order" }, order.slice(0, 14).map((x) => el("li", { class: x.id === cur?.id && c.started ? "now" : x.dead ? "dead" : "" }, `${x.init ?? "–"}  ${x.name}  (${x.hp}/${x.maxHp})${x.conditions?.length ? ` — ${x.conditions.join(", ")}` : ""}`))),
    btn("Open tracker", () => { location.hash = "dndCombat"; }, "btn secondary small"),
  ] : [el("p", { class: "view-sub" }, "No fight in progress."), btn("Open tracker", () => { location.hash = "dndCombat"; }, "btn secondary small")]);
}

function rollCard() {
  const input = el("input", { type: "text", value: "1d20", autocomplete: "off", "aria-label": "Dice expression", class: "dnd-expr" });
  const roll = (e) => { if (!expressionRoll(e, { label: "DM roll", who: "" })) toast("Can't parse that.", "bad"); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") roll(input.value); });
  return section("Quick roll", [
    el("div", { class: "dnd-row tight" }, [4, 6, 8, 10, 12, 20, 100].map((n) => btn(`d${n}`, () => roll(`1d${n}`), "btn secondary small"))),
    el("div", { class: "dnd-row", style: "margin-top:8px" }, [input, btn("Roll", () => roll(input.value), "btn small")]),
    el("p", { class: "dnd-small dnd-muted" }, "Rolls show on-screen and (if shared) in the Battle Log."),
  ]);
}

function tablesCard() {
  return section("Quick tables", [
    el("table", { class: "data-table" }, [el("thead", {}, el("tr", {}, [el("th", {}, "Difficulty"), el("th", {}, "DC")])), el("tbody", {}, DC_TABLE.map(([a, b]) => el("tr", {}, [el("td", {}, a), el("td", {}, String(b))])))]),
    el("h5", {}, "Cover"), el("ul", { class: "dnd-small" }, COVER.map(([a, b]) => el("li", {}, [el("strong", {}, `${a}: `), b]))),
    el("h5", {}, "Travel pace"), el("ul", { class: "dnd-small" }, TRAVEL_PACE.map((t) => el("li", {}, `${t.name}: ${t.perHour}/hr, ${t.perDay}/day`))),
    el("details", { class: "dnd-fold" }, [el("summary", {}, "Actions in combat"), el("ul", { class: "dnd-small" }, ACTIONS_IN_COMBAT.map(([a, b]) => el("li", {}, [el("strong", {}, `${a}: `), b])))]),
  ]);
}

function padCard() {
  const area = el("textarea", { class: "dnd-text", rows: 10, "aria-label": "Scratch pad", placeholder: "Initiative notes, names you just invented, what the party promised the innkeeper…" });
  area.value = getDm().screenPad || "";
  let t = null;
  area.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => updateDm((dm) => { dm.screenPad = area.value; }), 400); });
  return section("Scratch pad", [area, el("p", { class: "dnd-small dnd-muted" }, "Saved automatically to your account.")]);
}

function sparkCard() {
  const out = el("div", { class: "dnd-stack" });
  const spark = () => {
    const n = genNpc();
    out.replaceChildren(
      el("div", {}, [el("strong", {}, genName(["human", "elf", "dwarf", "halfling", "orc"][Math.floor(Math.random() * 5)])), el("span", { class: "dnd-muted" }, " — a name on demand")]),
      el("div", {}, [el("strong", {}, `${n.name}`), `, ${n.age} ${n.race.toLowerCase()} ${n.occupation}. ${n.trait.charAt(0).toUpperCase()}${n.trait.slice(1)}; ${n.mannerism}.`]),
      el("div", { class: "dnd-muted" }, `“${genRumor()}”`),
    );
  };
  spark();
  return section("Improvise", [out, btn("Another", spark, "btn secondary small"), chip("names · NPCs · rumours", "")]);
}
