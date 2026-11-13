// The Compendium: one page for every rules section (Spells, Bestiary, Items, Classes, Species, Backgrounds & Feats,
// Rules, Reference Tables), opened from the hub's Compendium button or the Compendium pull-out's "full page" button.
// A pill tab bar like the hub's Dex switch picks the section; each section is its own page's list (search, filters,
// groups, detail), drawn underneath. The tab is remembered (viewState "dnd:compendium:tab"), so the hub can open the
// page on a given section.

import { el } from "../ui.js";
import { getSettings } from "../store.js";
import { getViewState, setViewState } from "../../../viewState.js";

const SECTIONS = [
  ["spells", "Spells", () => import("./spells.js").then((m) => m.renderSpells)],
  ["bestiary", "Bestiary", () => import("./bestiary.js").then((m) => m.renderBestiary)],
  ["items", "Items", () => import("./items.js").then((m) => m.renderItems)],
  ["classes", "Classes", () => import("./classes.js").then((m) => m.renderClasses)],
  ["races", () => (getSettings().edition === "2024" ? "Species" : "Races"), () => import("./races.js").then((m) => m.renderRaces)],
  ["backgrounds", "Backgrounds & Feats", () => import("./backgrounds.js").then((m) => m.renderBackgrounds)],
  ["rules", "Rules", () => import("./rules.js").then((m) => m.renderRules)],
  ["tables", "Tables", () => import("./tables.js").then((m) => m.renderTables)],
];
// the old page ids, so the hub can ask for a section by the page it used to be
const FROM_VIEW = { dndSpells: "spells", dndBestiary: "bestiary", dndItems: "items", dndClasses: "classes", dndRaces: "races", dndBackgrounds: "backgrounds", dndRules: "rules", dndTables: "tables" };

/** Opens the Compendium on a section next time it renders (a section id, or one of the old page ids). */
export function compendiumTab(idOrView) { setViewState("dnd:compendium:tab", FROM_VIEW[idOrView] || idOrView); }

export function renderCompendium(container, state) {
  container.replaceChildren();
  let tab = getViewState("dnd:compendium:tab", "spells");
  tab = FROM_VIEW[tab] || tab;   // the hub asks by the section's old page id
  if (!SECTIONS.some(([id]) => id === tab)) tab = "spells";
  const label = (l) => (typeof l === "function" ? l() : l);
  const body = el("div", { class: "dnd-comp-body" });
  const bar = el("div", { class: "dnd-comp-tabs", role: "tablist", "aria-label": "Compendium sections" });
  const sub = el("p", { class: "view-sub" }, "Every rule, spell, monster and item in the SRD. Pick a section, then search or filter.");

  function show(id, focus = false) {
    tab = id;
    setViewState("dnd:compendium:tab", id);
    bar.querySelectorAll("button").forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    body.replaceChildren(el("p", { class: "view-sub" }, "Loading…"));
    const entry = SECTIONS.find(([x]) => x === id);
    entry[2]().then((render) => { if (tab === id && body.isConnected) render(body, state); }).catch(() => body.replaceChildren(el("p", { class: "view-sub" }, "Couldn't load that section.")));
  }
  SECTIONS.forEach(([id, l]) => {
    const b = el("button", { type: "button", role: "tab", "data-tab": id }, label(l));
    b.addEventListener("click", () => { if (tab !== id) show(id); });
    bar.append(b);
  });
  // arrow keys move along the tabs, like any tab bar
  bar.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = SECTIONS.findIndex(([x]) => x === tab), n = SECTIONS.length;
    show(SECTIONS[(i + (e.key === "ArrowRight" ? 1 : n - 1)) % n][0], true);
    e.preventDefault();
  });
  container.append(el("h1", { class: "view-title" }, "Compendium"), sub, bar, body);
  show(tab);
}
