// The rules reader: SRD rules text (2014 edition, as Markdown), plus conditions, skills,
// abilities, damage types, weapon properties and the other short reference entries.

import { el, asyncView, chip } from "../ui.js";
import { loadSet } from "../data.js";
import { browser } from "../components/browser.js";
import { pageTitle, editionSwitch, attribution } from "./common.js";
import { getSettings } from "../store.js";
import { renderMarkdown, renderDesc } from "../../../markdown.js";

export function renderRules(container) {
  container.replaceChildren();
  container.append(...pageTitle("Rules", "Searchable SRD rules text, conditions, skills and other quick references."));
  const edition = getSettings().edition;
  const holder = el("div");
  container.append(editionSwitch(() => renderRules(container)), el("div", { style: "height:12px" }), holder);

  asyncView(holder, async () => {
    const [conditions, skills, ref] = await Promise.all([loadSet(edition, "conditions"), loadSet(edition, "skills"), loadSet(edition, "reference")]);
    const items = [];
    let rulesNote = null;
    try {
      const rules = await loadSet(edition, "rules");
      for (const cat of rules.categories) for (const id of cat.sections) {
        const s = rules.sections[id];
        if (s) items.push({ id: `rule:${id}`, name: s.name, group: cat.name, kind: "md", md: s.md });
      }
    } catch { rulesNote = "The full rules text is only included for the 2014 edition (SRD 5.1). The quick references below are available for both editions."; }
    if (edition === "2024") rulesNote = "SRD 5.2 does not ship in the same section format, so the long rules chapters are 2014-only. Conditions, skills and the references below follow the 2024 rules.";
    for (const c of (conditions.list || conditions)) items.push({ id: `cond:${c.id}`, name: c.name, group: "Conditions", kind: "desc", desc: c.desc });
    for (const s of (skills.list || skills)) items.push({ id: `skill:${s.id}`, name: s.name, group: "Skills", kind: "desc", desc: s.desc, sub: s.ability });
    const r = ref.list || ref;
    for (const a of r.abilityScores || []) items.push({ id: `ab:${a.id}`, name: a.name, group: "Ability scores", kind: "desc", desc: a.desc, sub: (a.skills || []).join(", ") });
    for (const a of r.alignments || []) items.push({ id: `al:${a.abbr}`, name: a.name, group: "Alignments", kind: "desc", desc: [].concat(a.desc) });
    for (const a of r.damageTypes || []) items.push({ id: `dt:${a.name}`, name: a.name, group: "Damage types", kind: "desc", desc: [].concat(a.desc) });
    for (const a of r.schools || []) items.push({ id: `sc:${a.name}`, name: a.name, group: "Schools of magic", kind: "desc", desc: [].concat(a.desc) });
    for (const a of r.weaponProperties || []) items.push({ id: `wp:${a.name}`, name: a.name, group: "Weapon properties", kind: "desc", desc: [].concat(a.desc) });
    for (const a of r.masteries || []) items.push({ id: `wm:${a.name}`, name: a.name, group: "Weapon mastery", kind: "desc", desc: [].concat(a.desc) });
    for (const a of r.languages || []) items.push({ id: `lg:${a.name}`, name: a.name, group: "Languages", kind: "desc", desc: [`${a.type || ""}${a.script ? ` · script: ${a.script}` : ""}`, a.speakers?.length ? `Typical speakers: ${a.speakers.join(", ")}` : ""].filter(Boolean) });

    const groups = [...new Set(items.map((i) => i.group))];
    const b = browser({
      items, stateKey: `dnd:rules:${edition}`, id: (i) => i.id, label: (i) => i.name,
      search: (i) => `${i.name} ${i.group} ${i.md || (i.desc || []).join(" ")}`,
      group: (i) => i.group, groupOrder: groups,
      filters: [{ key: "g", label: "Section", options: groups.map((g) => [g, g]), test: (i, v) => i.group === v }],
      sorts: [{ id: "book", label: "Book order", cmp: (a, c) => items.indexOf(a) - items.indexOf(c) }],
      detail: (i) => el("div", {}, [
        el("p", { class: "dnd-row tight" }, [chip(i.group)]),
        i.kind === "md" ? renderMarkdown(i.md) : el("div", {}, [el("h2", {}, i.name), i.sub ? el("p", { class: "dnd-muted" }, i.sub) : null, renderDesc(i.desc || [])].filter(Boolean)),
      ]),
    });
    return [rulesNote ? el("p", { class: "view-sub" }, rulesNote) : null, b.root, attribution()].filter(Boolean);
  });
}
