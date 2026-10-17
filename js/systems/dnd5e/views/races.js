// Races (2014) and species (2024), with subraces and every trait.

import { el, asyncView, chip, section } from "../ui.js";
import { loadSet } from "../data.js";
import { browser } from "../components/browser.js";
import { pageTitle, editionSwitch, attribution } from "./common.js";
import { getSettings } from "../store.js";
import { renderDesc } from "../../../markdown.js";
import { ABILITY_NAME } from "../engine/rules.js";

export function renderRaces(container) {
  container.replaceChildren();
  const edition = getSettings().edition;
  container.append(...pageTitle(edition === "2024" ? "Species" : "Races", "Ancestry traits, ability bonuses and subraces from the SRD."));
  const holder = el("div");
  container.append(editionSwitch(() => renderRaces(container)), el("div", { style: "height:12px" }), holder);
  asyncView(holder, async () => {
    const { list } = await loadSet(edition, "races");
    const b = browser({
      items: list, stateKey: `dnd:races:${edition}`,
      id: (r) => r.id, label: (r) => r.name, meta: (r) => r.size || "",
      sorts: [{ id: "name", label: "Name", cmp: (a, c) => a.name.localeCompare(c.name) }],
      detail: (r) => raceDetail(r),
    });
    return [b.root, attribution()];
  });
}

const bonusText = (bs) => (bs || []).map((b) => `${ABILITY_NAME[b.ability] || b.ability} ${b.bonus >= 0 ? "+" : ""}${b.bonus}`).join(", ") || "—";

function traitBlock(t) {
  return el("details", { class: "dnd-fold", open: "" }, [
    el("summary", {}, t.name),
    renderDesc(t.desc || []),
    t.options?.length ? el("div", { class: "dnd-row" }, t.options.map((o) => chip(typeof o === "string" ? o : o.name))) : null,
  ].filter(Boolean));
}

function raceDetail(r) {
  const out = [el("h2", {}, r.name)];
  const kv = [["Size", r.size], ["Speed", r.speed ? `${r.speed} ft.` : ""], ["Type", r.type], ["Ability scores", r.abilityBonuses ? bonusText(r.abilityBonuses) : ""], ["Languages", r.languageDesc || (r.languages || []).join(", ")]];
  out.push(el("table", { class: "data-table dnd-kv" }, kv.filter(([, v]) => v).map(([k, v]) => el("tr", {}, [el("th", {}, k), el("td", {}, v)]))));
  for (const [label, text] of [["Age", r.ageDesc], ["Alignment", r.alignDesc], ["Size", r.sizeDesc]]) if (text) out.push(el("p", { class: "dnd-small" }, [el("strong", {}, `${label}. `), text]));
  out.push(section("Traits", (r.traits || []).map(traitBlock)));
  if (r.subraces?.length) {
    out.push(section("Subraces", r.subraces.map((s) => el("details", { class: "dnd-fold" }, [
      el("summary", {}, [s.name, s.abilityBonuses?.length ? el("span", { class: "dnd-muted dnd-small" }, `  ${bonusText(s.abilityBonuses)}`) : null].filter(Boolean)),
      s.desc ? el("p", { class: "dnd-small" }, s.desc) : null,
      ...(s.traits || []).map(traitBlock),
    ].filter(Boolean)))));
  }
  return el("div", {}, out);
}
