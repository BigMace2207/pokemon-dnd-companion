// The rules reader: SRD rules text (2014 edition, as Markdown), plus conditions, skills, abilities, damage types, weapon
// properties, racial traits and the other short reference entries. These entries are also the site's keywords (glossary.js):
// a rule term anywhere on the site opens its entry here, and inside this page every keyword is coloured, bold and linked.

import { el, asyncView, chip } from "../ui.js";
import { browser } from "../components/browser.js";
import { pageTitle, editionSwitch, attribution } from "./common.js";
import { getSettings } from "../store.js";
import { renderMarkdown, renderDesc } from "../../../markdown.js";
import { docItems, warmGlossary } from "../glossary.js";

export function renderRules(container) {
  container.replaceChildren();
  container.append(...pageTitle("Rules", "Searchable SRD rules text, conditions, skills and other quick references. Keywords are coloured; click one to jump to its entry."));
  const edition = getSettings().edition;
  const holder = el("div");
  container.append(editionSwitch(() => renderRules(container)), el("div", { style: "height:12px" }), holder);
  // another page asked for a particular entry while this one is open
  const onOpen = () => { if (document.body.contains(holder)) renderRules(container); else window.removeEventListener("dnd-open-rules", onOpen); };
  window.addEventListener("dnd-open-rules", onOpen);

  asyncView(holder, async () => {
    await warmGlossary(edition);   // so keywords inside the entries can be linked
    const { items, rulesNote } = await docItems(edition);
    const groups = [...new Set(items.map((i) => i.group))];
    const b = browser({
      items, stateKey: `dnd:rules:${edition}`, id: (i) => i.id, label: (i) => i.name,
      search: (i) => `${i.name} ${i.group} ${i.md || (i.desc || []).join(" ")}`,
      group: (i) => i.group, groupOrder: groups,
      filters: [{ key: "g", label: "Section", options: groups.map((g) => [g, g]), test: (i, v) => i.group === v }],
      sorts: [{ id: "book", label: "Book order", cmp: (a, c) => items.indexOf(a) - items.indexOf(c) }],
      detail: (i) => el("div", { class: "dnd-rules-doc" }, [
        el("p", { class: "dnd-row tight" }, [chip(i.group)]),
        i.kind === "md" ? renderMarkdown(i.md, { keywords: "docs" }) : el("div", {}, [el("h2", {}, i.name), i.sub ? el("p", { class: "dnd-muted" }, i.sub) : null, renderDesc(i.desc || [], { keywords: "docs" })].filter(Boolean)),
      ]),
    });
    return [rulesNote ? el("p", { class: "view-sub" }, rulesNote) : null, b.root, attribution()].filter(Boolean);
  });
}
