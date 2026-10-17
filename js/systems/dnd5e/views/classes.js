// Class compendium: proficiencies, the level table (features, proficiency bonus, slots),
// every feature's text and the SRD subclasses.

import { el, asyncView, chip, section } from "../ui.js";
import { loadSet } from "../data.js";
import { browser } from "../components/browser.js";
import { pageTitle, editionSwitch, attribution } from "./common.js";
import { getSettings } from "../store.js";
import { renderDesc } from "../../../markdown.js";
import { ordinal } from "../engine/rules.js";

export function renderClasses(container) {
  container.replaceChildren();
  container.append(...pageTitle("Classes", "The twelve SRD classes with their full level progression and subclasses."));
  const edition = getSettings().edition;
  const holder = el("div");
  container.append(editionSwitch(() => renderClasses(container)), el("div", { style: "height:12px" }), holder);
  asyncView(holder, async () => {
    const { list } = await loadSet(edition, "classes");
    const b = browser({
      items: list, stateKey: `dnd:classes:${edition}`,
      id: (c) => c.id, label: (c) => c.name, meta: (c) => `d${c.hitDie}`,
      sorts: [{ id: "name", label: "Name", cmp: (a, b) => a.name.localeCompare(b.name) }],
      detail: (c) => classDetail(c, edition),
    });
    return [b.root, attribution()];
  });
}

const prettyKey = (k) => k.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

function classDetail(c, edition) {
  const out = [el("h2", {}, c.name)];
  const kv = [
    ["Hit die", `d${c.hitDie}`],
    ["Saving throws", (c.saves || []).join(", ")],
    ["Armor", (c.armor || []).join(", ") || "None"],
    ["Weapons", (c.weapons || []).join(", ") || "None"],
    ["Skills", c.skills ? `Choose ${c.skills.choose} from ${(c.skills.from || []).join(", ")}` : ""],
  ];
  if (c.primaryAbility) kv.push(["Primary ability", [].concat(c.primaryAbility).join(", ")]);
  if (c.multiclass?.requirements?.length) kv.push(["Multiclassing", c.multiclass.requirements.map((r) => `${r.ability} ${r.min}`).join(" or ")]);
  if (c.spellcasting?.ability) kv.push(["Spellcasting ability", c.spellcasting.ability]);
  out.push(el("table", { class: "data-table dnd-kv" }, kv.filter(([, v]) => v).map(([k, v]) => el("tr", {}, [el("th", {}, k), el("td", {}, v)]))));

  // level table
  const csKeys = [...new Set(c.levels.flatMap((l) => Object.keys(l.cs || {})))].filter((k) => c.levels.some((l) => (l.cs || {})[k]));
  const slotCols = c.levels.some((l) => l.sc?.slots?.some(Boolean)) ? Array.from({ length: 9 }, (_, i) => i).filter((i) => c.levels.some((l) => l.sc?.slots?.[i])) : [];
  const featName = (id) => c.features?.[id]?.name || id;
  const head = ["Level", "Prof.", "Features", ...csKeys.map(prettyKey), ...(c.levels.some((l) => l.sc) ? ["Cantrips"] : []), ...slotCols.map((i) => ordinal(i + 1))];
  const rows = c.levels.map((l) => el("tr", {}, [
    el("td", {}, ordinal(l.level)), el("td", {}, `+${l.pb}`),
    el("td", {}, [...(l.features || []).map(featName), ...(l.asi ? ["Ability Score Improvement"] : [])].join(", ") || "—"),
    ...csKeys.map((k) => el("td", {}, String(l.cs?.[k] ?? "—"))),
    ...(l.sc ? [el("td", {}, String(l.sc.cantrips ?? "—"))] : c.levels.some((x) => x.sc) ? [el("td", {}, "—")] : []),
    ...slotCols.map((i) => el("td", {}, String(l.sc?.slots?.[i] || "—"))),
  ]));
  out.push(section("Level progression", el("div", { class: "dnd-table-scroll" }, el("table", { class: "data-table dnd-level-table" }, [el("thead", {}, el("tr", {}, head.map((h) => el("th", {}, h)))), el("tbody", {}, rows)]))));

  // features
  const feats = Object.values(c.features || {}).sort((a, b) => a.level - b.level);
  out.push(section("Class features", feats.filter((f) => !/Ability Score Improvement/i.test(f.name)).map((f) => el("details", { class: "dnd-fold" }, [
    el("summary", {}, [f.name, " ", el("span", { class: "dnd-muted dnd-small" }, `level ${f.level}`)]),
    renderDesc(f.desc || []),
    f.options?.length ? el("div", { class: "dnd-row" }, f.options.slice(0, 40).map((o) => chip(o.name))) : null,
  ].filter(Boolean)))));

  // subclasses
  if (c.subclasses?.length) {
    out.push(section(edition === "2024" ? "Subclasses" : (c.subclasses[0].flavor || "Subclasses"), c.subclasses.map((s) => el("details", { class: "dnd-fold" }, [
      el("summary", {}, s.name),
      renderDesc(s.desc || []),
      ...(s.features || []).map((f) => el("div", {}, [el("h5", {}, [f.name, " ", el("span", { class: "dnd-muted dnd-small" }, `level ${f.level}`)]), renderDesc(f.desc || [])])),
    ]))));
  }
  return el("div", {}, out);
}
