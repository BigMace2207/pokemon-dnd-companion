import { el } from "../../../components.js";

export function renderOverview(container) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Dungeons & Dragons"));
  container.appendChild(el("div", { class: "card" }, [
    el("p", {}, "This campaign uses the regular D&D system, which is still being built. Everything shared between systems already works here: the campaign, Settings, the shared Battle Log, the DM's notes and the dice tray."),
    el("p", { class: "view-sub" }, "Available now: Dice Roller and Ability Scores. Coming next: character sheets, spells, monsters and combat."),
  ]));
}
