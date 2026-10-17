// Bits shared by several D&D pages.

import { el, pill } from "../ui.js";
import { EDITIONS } from "../data.js";
import { getSettings, setSettings } from "../store.js";

export function pageTitle(title, sub) {
  return [
    el("h1", { class: "view-title" }, title),
    sub ? el("p", { class: "view-sub" }, sub) : null,
  ].filter(Boolean);
}

// A compact "2014 | 2024" switch that remembers the choice in the D&D settings.
export function editionSwitch(onChange, current = getSettings().edition) {
  const wrap = el("div", { class: "dnd-row tight", role: "group", "aria-label": "Rules edition" });
  let cur = current;
  const draw = () => wrap.replaceChildren(...EDITIONS.map((e) => pill(e.id === "2014" ? "2014 rules" : "2024 rules", e.id === cur, () => {
    if (cur === e.id) return;
    cur = e.id;
    setSettings({ edition: cur });
    draw();
    onChange(cur);
  })));
  draw();
  return wrap;
}

export function editionOf(char) {
  return char?.edition || getSettings().edition || "2014";
}

export function attribution() {
  return el("p", { class: "dnd-attrib dnd-muted dnd-tiny" }, [
    "This work includes material from the System Reference Document 5.1 and 5.2 (“SRD”) by Wizards of the Coast LLC, licensed under the ",
    el("a", { href: "https://creativecommons.org/licenses/by/4.0/legalcode", target: "_blank", rel: "noopener noreferrer" }, "Creative Commons Attribution 4.0 International License"),
    ". Data via the community 5e-database.",
  ]);
}
