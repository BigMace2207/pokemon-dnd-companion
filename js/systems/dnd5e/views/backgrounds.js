// Backgrounds and feats in one page (two tabs). Both come from the SRD, which includes
// only a few of each in the 2014 edition and more in 2024.

import { el, asyncView, chip, tabs, section } from "../ui.js";
import { loadSet } from "../data.js";
import { browser } from "../components/browser.js";
import { pageTitle, editionSwitch, attribution } from "./common.js";
import { getSettings } from "../store.js";
import { renderDesc } from "../../../markdown.js";

export function renderBackgrounds(container) {
  container.replaceChildren();
  container.append(...pageTitle("Backgrounds & Feats", "Where your character came from, and the special talents they've picked up."));
  const edition = getSettings().edition;
  const holder = el("div");
  container.append(editionSwitch(() => renderBackgrounds(container)), el("div", { style: "height:12px" }), holder);
  asyncView(holder, async () => {
    const bgs = (await loadSet(edition, "backgrounds")).list;
    const feats = (await loadSet(edition, "feats")).list;
    const t = tabs([
      { id: "bg", label: `Backgrounds (${bgs.length})`, render: (p) => p.append(bgBrowser(bgs, edition).root) },
      { id: "feat", label: `Feats (${feats.length})`, render: (p) => p.append(featBrowser(feats, edition).root) },
    ], { stateKey: "dnd:bg:tab", initial: "bg" });
    return [t.bar, t.panel, attribution()];
  });
}

function bgBrowser(list, edition) {
  return browser({
    items: list, stateKey: `dnd:bgs:${edition}`, id: (b) => b.id, label: (b) => b.name,
    sorts: [{ id: "name", label: "Name", cmp: (a, b) => a.name.localeCompare(b.name) }],
    detail: (b) => {
      const kv = [
        ["Skill proficiencies", (b.skills || []).join(", ")],
        ["Tool proficiencies", (b.tools || []).join(", ") || (b.toolChoices ? `Choose ${b.toolChoices}` : "")],
        ["Languages", b.languageChoices ? `Choose ${b.languageChoices}` : ""],
        ["Ability scores", b.abilityScores ? `+2/+1 or +1/+1/+1 among ${b.abilityScores.join(", ")}` : ""],
        ["Origin feat", b.feat ? `${b.feat.name}${b.feat.note ? ` (${b.feat.note})` : ""}` : ""],
        ["Starting gold", b.gold != null ? `${b.gold} gp` : ""],
      ].filter(([, v]) => v);
      const parts = [el("h2", {}, b.name), el("table", { class: "data-table dnd-kv" }, kv.map(([k, v]) => el("tr", {}, [el("th", {}, k), el("td", {}, v)])))];
      if (b.equipmentOptions?.length) parts.push(section("Equipment", b.equipmentOptions.map((o) => el("p", { class: "dnd-small" }, o.desc || ""))));
      if (b.equipment?.length) parts.push(el("p", { class: "dnd-small" }, [el("strong", {}, "Also gives: "), b.equipment.map((e) => `${e.qty > 1 ? `${e.qty} ` : ""}${e.name}`).join(", ")]));
      if (b.feature) parts.push(section(`Feature: ${b.feature.name}`, renderDesc(b.feature.desc || [])));
      if (b.desc?.length) parts.push(renderDesc(b.desc));
      return el("div", {}, parts);
    },
  });
}

function featBrowser(list, edition) {
  return browser({
    items: list, stateKey: `dnd:feats:${edition}`, id: (f) => f.id, label: (f) => f.name, meta: (f) => f.prerequisite || f.type || "",
    group: edition === "2024" ? (f) => ({ origin: "Origin feats", general: "General feats", "fighting-style": "Fighting Style feats", "epic-boon": "Epic Boons" }[f.type] || "Feats") : null,
    sorts: [{ id: "name", label: "Name", cmp: (a, b) => a.name.localeCompare(b.name) }],
    detail: (f) => el("div", {}, [
      el("h2", {}, f.name),
      el("p", { class: "dnd-row tight" }, [f.type ? chip(f.type, "accent") : null, f.prerequisite ? chip(`Prerequisite: ${f.prerequisite}`) : null, f.repeatable ? chip("Repeatable", "gold") : null].filter(Boolean)),
      renderDesc(f.desc || []),
    ]),
  });
}
