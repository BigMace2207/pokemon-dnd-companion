import { TYPE_COLORS } from "./data.js";

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    const isTextLike = typeof c === "string" || typeof c === "number" || typeof c === "boolean";
    node.appendChild(isTextLike ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function typePill(type) {
  if (!type) return null;
  const color = TYPE_COLORS[type] || "#888";
  return el("span", { class: "type-pill", style: `background:${color}` }, type);
}

/**
 * A searchable dropdown ("combobox") over a flat list of string options.
 * onSelect(value) fires when an option is chosen. Returns the wrapper element
 * plus a `.setValue(v)` helper to programmatically set the text.
 */
export function makeCombo({ options, placeholder = "Search…", initial = "", onSelect = () => {} }) {
  const input = el("input", { type: "text", placeholder, value: initial, autocomplete: "off" });
  const list = el("div", { class: "combo-list" });
  const wrap = el("div", { class: "combo" }, [input, list]);

  let hiIndex = -1;
  let filtered = [];

  function render(q) {
    const query = q.trim().toLowerCase();
    filtered = !query
      ? options.slice(0, 50)
      : options.filter((o) => o.toLowerCase().includes(query)).slice(0, 50);
    list.innerHTML = "";
    filtered.forEach((opt, i) => {
      const optEl = el("div", {
        class: "combo-opt" + (i === hiIndex ? " hi" : ""),
        onmousedown: (e) => {
          e.preventDefault();
          input.value = opt;
          list.classList.remove("open");
          onSelect(opt);
        },
      }, opt);
      list.appendChild(optEl);
    });
    list.classList.toggle("open", filtered.length > 0);
  }

  input.addEventListener("focus", () => render(input.value));
  input.addEventListener("input", () => { hiIndex = -1; render(input.value); });
  input.addEventListener("blur", () => setTimeout(() => list.classList.remove("open"), 120));
  input.addEventListener("keydown", (e) => {
    if (!list.classList.contains("open")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); hiIndex = Math.min(hiIndex + 1, filtered.length - 1); render(input.value); }
    else if (e.key === "ArrowUp") { e.preventDefault(); hiIndex = Math.max(hiIndex - 1, 0); render(input.value); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[hiIndex]) { input.value = filtered[hiIndex]; list.classList.remove("open"); onSelect(filtered[hiIndex]); } }
    else if (e.key === "Escape") { list.classList.remove("open"); }
  });

  wrap.setValue = (v) => { input.value = v; };
  // Lets a caller populate the option list after an async fetch (e.g. the
  // trainer sprite picker) instead of only at construction time.
  wrap.setOptions = (newOptions) => { options = newOptions; };
  wrap.inputEl = input;
  return wrap;
}

export function field(labelText, inputEl) {
  const label = el("label", { class: "field" }, [el("span", {}, labelText), inputEl]);
  return label;
}

export function statBars(stats) {
  const max = 255;
  const rows = [
    ["HP", stats.hp], ["Attack", stats.atk], ["Defense", stats.def],
    ["Sp. Atk", stats.spa], ["Sp. Def", stats.spd], ["Speed", stats.spe],
  ];
  const wrap = el("div", { class: "stat-bars" });
  rows.forEach(([label, val]) => {
    const pct = Math.min(100, (val / max) * 100);
    wrap.appendChild(el("div", { class: "row" }, [
      el("div", {}, label),
      el("div", { class: "bar-bg" }, [el("div", { class: "bar-fill", style: `width:${pct}%` })]),
      el("div", {}, String(val)),
    ]));
  });
  return wrap;
}
