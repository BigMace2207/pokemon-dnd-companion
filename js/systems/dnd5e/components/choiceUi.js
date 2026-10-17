// Reusable "pick N of these" widgets used by the builder and the level-up dialog.

import { el, chip } from "../ui.js";

// Choose exactly `count` items from options (strings or {value,label}). Calls onChange(selectedArray).
export function pickMany(options, count, selected, onChange, { disabled = [] } = {}) {
  const sel = new Set(selected || []);
  const wrap = el("div", { class: "dnd-pick" });
  const info = el("div", { class: "dnd-small dnd-muted" });
  function draw() {
    info.textContent = `${sel.size} of ${count} chosen`;
    wrap.replaceChildren(info, el("div", { class: "dnd-chip-row" }, options.map((o) => {
      const value = typeof o === "string" ? o : o.value;
      const label = typeof o === "string" ? o : o.label;
      const off = disabled.includes(value);
      const on = sel.has(value);
      const b = el("button", { type: "button", class: `dnd-chip dnd-pickable${on ? " accent selected" : ""}${off ? " off" : ""}`, ...(off && !on ? { disabled: "" } : {}), "aria-pressed": String(on) }, label);
      b.addEventListener("click", () => {
        if (on) sel.delete(value);
        else if (sel.size < count) sel.add(value);
        else return;
        onChange([...sel]);
        draw();
      });
      return b;
    })));
  }
  draw();
  return wrap;
}

// A single choice from a list, rendered as radio-like buttons with descriptions.
export function pickOne(options, selected, onChange) {
  const wrap = el("div", { class: "dnd-stack", role: "radiogroup" });
  function draw(cur) {
    wrap.replaceChildren(...options.map((o) => {
      const on = cur === o.value;
      const b = el("button", { type: "button", class: `dnd-option${on ? " selected" : ""}`, role: "radio", "aria-checked": String(on) }, [
        el("strong", {}, o.label), o.sub ? el("span", { class: "dnd-muted dnd-small" }, o.sub) : null,
      ].filter(Boolean));
      b.addEventListener("click", () => { onChange(o.value); draw(o.value); });
      return b;
    }));
  }
  draw(selected);
  return wrap;
}

export { chip };
