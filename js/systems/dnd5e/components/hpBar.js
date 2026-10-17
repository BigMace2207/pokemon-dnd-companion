// A hit-point bar (green -> amber -> red) with the numbers and any temporary HP.

import { el } from "../ui.js";

export function hpClass(cur, max) {
  if (!max) return "bad";
  const r = cur / max;
  return r > 0.5 ? "good" : r > 0.25 ? "warn" : "bad";
}

export function hpBar(cur, max, temp = 0, { compact = false } = {}) {
  const pct = max ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  const tempPct = max && temp ? Math.min(100 - pct, (temp / max) * 100) : 0;
  return el("div", { class: `dnd-hp${compact ? " compact" : ""}`, role: "img", "aria-label": `${cur} of ${max} hit points${temp ? `, ${temp} temporary` : ""}` }, [
    el("div", { class: "dnd-hp-track" }, [
      el("div", { class: `dnd-hp-fill ${hpClass(cur, max)}`, style: `width:${pct}%` }),
      tempPct ? el("div", { class: "dnd-hp-temp", style: `width:${tempPct}%` }) : null,
    ].filter(Boolean)),
    el("div", { class: "dnd-hp-text" }, `${cur ?? "?"} / ${max ?? "?"} HP${temp ? ` (+${temp})` : ""}`),
  ]);
}
