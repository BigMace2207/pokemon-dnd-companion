// A checklist of spells with a search box and expandable descriptions. Used by the
// character builder (pick your cantrips and starting spells) and the sheet's
// "add spells" dialog.

import { el, chip } from "../ui.js";
import { renderDesc } from "../../../markdown.js";
import { spellLevelText, componentsText } from "./spellCard.js";

// opts: { spells, selected:[ids], max:number|null, onChange(ids), locked:[ids] (shown ticked, not changeable) }
export function spellPicker({ spells, selected = [], max = null, onChange, locked = [], placeholder = "Search spells…" }) {
  const sel = new Set(selected);
  const lock = new Set(locked);
  const search = el("input", { type: "text", placeholder, autocomplete: "off", "aria-label": "Search spells" });
  const counter = el("div", { class: "dnd-small dnd-muted" });
  const list = el("div", { class: "dnd-list dnd-spell-picklist" });
  const open = new Set();

  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = spells.filter((s) => !q || `${s.name} ${s.school}`.toLowerCase().includes(q));
    counter.textContent = max != null ? `${sel.size} of ${max} chosen` : `${sel.size} chosen`;
    const rows = [];
    let lastLevel = -1;
    for (const s of shown) {
      if (s.level !== lastLevel) { lastLevel = s.level; rows.push(el("div", { class: "dnd-list-group" }, s.level === 0 ? "Cantrips" : `Level ${s.level}`)); }
      const on = sel.has(s.id) || lock.has(s.id);
      const full = max != null && sel.size >= max && !on;
      const box = el("input", { type: "checkbox", ...(lock.has(s.id) || full ? { disabled: "" } : {}), "aria-label": s.name });
      box.checked = on;
      box.addEventListener("change", () => {
        if (box.checked) { if (max != null && sel.size >= max) { box.checked = false; return; } sel.add(s.id); } else sel.delete(s.id);
        onChange([...sel]);
        draw();
      });
      const expand = el("button", { type: "button", class: "dnd-spell-toggle", "aria-expanded": String(open.has(s.id)) }, [
        el("span", { class: "dnd-grow" }, s.name),
        el("span", { class: "dnd-muted dnd-tiny" }, `${s.school}${s.concentration ? " · C" : ""}${s.ritual ? " · R" : ""}`),
      ]);
      expand.addEventListener("click", () => { if (open.has(s.id)) open.delete(s.id); else open.add(s.id); draw(); });
      const row = el("div", { class: `dnd-pick-row${on ? " on" : ""}${full ? " off" : ""}` }, [box, expand]);
      rows.push(row);
      if (open.has(s.id)) {
        rows.push(el("div", { class: "dnd-pick-detail" }, [
          el("div", { class: "dnd-small dnd-muted" }, `${spellLevelText(s)} · ${s.castingTime} · ${s.range} · ${componentsText(s)} · ${s.duration}`),
          renderDesc(s.desc.slice(0, 3)),
          s.concentration ? chip("Concentration", "gold") : null,
        ].filter(Boolean)));
      }
    }
    if (!rows.length) rows.push(el("p", { class: "view-sub", style: "padding:12px" }, "No spells match."));
    list.replaceChildren(...rows);
  }
  search.addEventListener("input", draw);
  draw();
  return { root: el("div", {}, [search, counter, list]), selected: () => [...sel], redraw: draw };
}
