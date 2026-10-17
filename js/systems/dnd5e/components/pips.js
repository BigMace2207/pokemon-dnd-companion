// A row of round "pips" for things you spend and recover (spell slots, ki, rages,
// death saves). Clicking pip i toggles it; onChange receives the new used count.

import { el } from "../ui.js";

// used = how many are spent (filled = available when `invert`).
export function pips(total, used, onChange, { label = "", cls = "" } = {}) {
  const wrap = el("div", { class: `dnd-pips ${cls}`, role: "group", "aria-label": label || null });
  for (let i = 0; i < total; i++) {
    const spent = i < used;
    const b = el("button", { type: "button", class: `dnd-pip${spent ? " spent" : ""}`, "aria-pressed": String(spent), "aria-label": `${label} ${i + 1} ${spent ? "spent" : "available"}` });
    b.addEventListener("click", () => onChange(spent && i === used - 1 ? i : i < used ? i : i + 1));
    wrap.append(b);
  }
  return wrap;
}

// Death-save pips: `count` filled of 3 (success or failure flavour).
export function savePips(count, kind, onChange) {
  const wrap = el("div", { class: `dnd-pips save ${kind}`, role: "group", "aria-label": kind === "s" ? "Death save successes" : "Death save failures" });
  for (let i = 0; i < 3; i++) {
    const on = i < count;
    const b = el("button", { type: "button", class: `dnd-pip${on ? " spent" : ""}`, "aria-pressed": String(on) });
    b.addEventListener("click", () => onChange(on && i === count - 1 ? i : i + 1));
    wrap.append(b);
  }
  return wrap;
}
